import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger } from "@cat-crawl/core";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { extractAudioFromVideo } from "../services/media/extract-audio.js";
import { createAgentModel } from "../services/model.js";
import { transcribeAudio } from "../services/transcription/index.js";
import { createReadableVideoMarkdown } from "../services/video-chapters.js";
import { resolveDouyinVideoSource } from "../services/video-sources/douyin.js";
import { resolveFileVideoSource } from "../services/video-sources/file.js";
import { selectVideoSourceAdapter } from "../services/video-sources/index.js";
import { resolveYouTubeVideoSource } from "../services/video-sources/youtube.js";
import { createSaveToObsidianTool } from "./save-to-obsidian.js";

const inputSchema = z.object({
  source: z.string().min(1).describe("视频 URL 或本地文件路径"),
  provider: z.enum(["whisper_cpp", "gemini"]).optional(),
  language: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  save: z.boolean().default(true),
});

type TranscribeVideoInput = z.infer<typeof inputSchema>;

type SaveResult = {
  saved?: boolean;
  vault?: string;
  path?: string;
  tags?: string[];
  dynamic_folder?: string;
};

type TranscribeVideoDeps = {
  selectVideoSourceAdapter?: typeof selectVideoSourceAdapter;
  resolveFileVideoSource?: typeof resolveFileVideoSource;
  resolveYouTubeVideoSource?: typeof resolveYouTubeVideoSource;
  resolveDouyinVideoSource?: typeof resolveDouyinVideoSource;
  extractAudioFromVideo?: typeof extractAudioFromVideo;
  transcribeAudio?: typeof transcribeAudio;
  saveToObsidian?: (input: {
    title: string;
    source_url: string;
    content_markdown: string;
    source?: string;
    tags?: string[];
  }) => Promise<SaveResult>;
  buildTranscriptMarkdown?: (input: {
    sourceUrl: string;
    transcriptText: string;
    transcriptSrt?: string;
  }) => Promise<string>;
};

const logger = createLogger();

function extractHashtags(text: string): string[] {
  return Array.from(text.matchAll(/#([^\s#]+)/g))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function normalizeVideoTitle(rawTitle: string): { title: string; tags: string[] } {
  const tags = Array.from(new Set(extractHashtags(rawTitle)));
  const withoutTags = rawTitle.replace(/#([^\s#]+)/g, " ");
  const withoutSourceSuffix = withoutTags.replace(/\s*-\s*抖音\s*$/u, " ");
  const title = withoutSourceSuffix.replace(/\s+/g, " ").trim();
  return {
    title: title || rawTitle.trim(),
    tags,
  };
}

function normalizeModelJsonText(raw: string): string {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonPayload(raw: string): string {
  const normalized = normalizeModelJsonText(raw);
  const arrayStart = normalized.indexOf("[");
  const objectStart = normalized.indexOf("{");
  const startCandidates = [arrayStart, objectStart].filter((value) => value >= 0);
  if (startCandidates.length === 0) {
    return normalized;
  }
  const start = Math.min(...startCandidates);
  const opening = normalized[start];
  const closing = opening === "[" ? "]" : "}";
  const end = normalized.lastIndexOf(closing);
  if (end < start) {
    return normalized.slice(start).trim();
  }
  return normalized.slice(start, end + 1).trim();
}

async function buildTranscriptMarkdownWithModel(
  env: AppEnv,
  input: {
    sourceUrl: string;
    transcriptText: string;
    transcriptSrt?: string;
  },
): Promise<string> {
  logger.info(`[tool:transcribe_video] chapterize start source_url=${input.sourceUrl}`);
  return createReadableVideoMarkdown({
    sourceUrl: input.sourceUrl,
    transcriptText: input.transcriptText,
    transcriptSrt: input.transcriptSrt,
    summarizeChapters: async ({ chapters }) => {
      logger.info(
        `[tool:transcribe_video] chapter summarize batch start count=${chapters.length}`,
      );
      try {
        const model = createAgentModel(env, {
          maxTokens: 1600,
          timeout: 60000,
          temperature: 0,
        });
        const chapterPayload = chapters
          .map((chapter) =>
            [
              `Chapter ${chapter.index + 1}`,
              `startSeconds: ${Math.floor(chapter.startSeconds)}`,
              `endSeconds: ${Math.floor(chapter.endSeconds)}`,
              "Transcript:",
              chapter.segments
                .map((segment) => `[${Math.floor(segment.startSeconds)}s] ${segment.text}`)
                .join("\n"),
            ].join("\n"),
          )
          .join("\n\n---\n\n");
        const message = await model.invoke([
          new SystemMessage(
            [
              "你是视频内容整理助手。",
              "输入是整段视频按时间切好的章节候选，请一次性整理成最终章节数组。",
              '只返回 JSON 数组：[{"title":"...","startSeconds":0,"body":"...","translatedTitle":"...","translatedBody":"..."}]',
              "数组顺序必须和输入章节顺序一致。",
              "startSeconds 优先使用输入章节的开始时间，单位是秒。",
              "title 和 body 保持原始语言。如果原始内容是英文，就保留英文，不要翻译成中文。",
              "translatedTitle 和 translatedBody 输出对应的中文翻译。",
              "title 要简短，适合作为章节标题，不要带时间戳，不要 Markdown 标记。",
              "body 要整理成 1-3 段可读内容，保留原意，删除口头禅、重复、明显转写噪音，不要编造。",
              "translatedBody 要准确翻译 body，不要遗漏。",
              "body 和 translatedBody 都不要使用项目符号列表，不要输出额外解释。",
            ].join("\n"),
          ),
          new HumanMessage(
            [
              `Source: ${input.sourceUrl}`,
              "",
              "Chapters:",
              chapterPayload,
            ].join("\n"),
          ),
        ]);

        const payload = extractJsonPayload(String(message.content ?? ""));
        const parsed = JSON.parse(payload) as Array<{
          title?: unknown;
          startSeconds?: unknown;
          body?: unknown;
          translatedTitle?: unknown;
          translatedBody?: unknown;
        }>;
        logger.info(
          `[tool:transcribe_video] chapter summarize batch done count=${parsed.length}`,
        );
        return parsed.map((chapter, index) => ({
          title: typeof chapter.title === "string" ? chapter.title.trim() : `章节 ${index + 1}`,
          startSeconds:
            typeof chapter.startSeconds === "number" && Number.isFinite(chapter.startSeconds)
              ? chapter.startSeconds
              : undefined,
          body: typeof chapter.body === "string" ? chapter.body.trim() : "",
          translatedTitle:
            typeof chapter.translatedTitle === "string" ? chapter.translatedTitle.trim() : undefined,
          translatedBody:
            typeof chapter.translatedBody === "string" ? chapter.translatedBody.trim() : undefined,
        }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.error(`[tool:transcribe_video] chapter summarize batch failed msg=${detail}`);
        throw error;
      }
    },
  }).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[tool:transcribe_video] chapterize failed msg=${detail}`);
    throw error;
  }).then((markdown) => {
    logger.info(`[tool:transcribe_video] chapterize done chars=${markdown.length}`);
    return markdown;
  });
}

export function createTranscribeVideoTool(env: AppEnv, deps: TranscribeVideoDeps = {}) {
  const saveTool = createSaveToObsidianTool(env);
  const selectAdapter = deps.selectVideoSourceAdapter || selectVideoSourceAdapter;
  const resolveFile = deps.resolveFileVideoSource || resolveFileVideoSource;
  const resolveYoutube = deps.resolveYouTubeVideoSource || resolveYouTubeVideoSource;
  const resolveDouyin = deps.resolveDouyinVideoSource || resolveDouyinVideoSource;
  const extractAudio = deps.extractAudioFromVideo || extractAudioFromVideo;
  const transcribe = deps.transcribeAudio || transcribeAudio;
  const buildTranscriptMarkdown =
    deps.buildTranscriptMarkdown ||
    (async (input: { sourceUrl: string; transcriptText: string; transcriptSrt?: string }) =>
      buildTranscriptMarkdownWithModel(env, input));
  const saveToObsidian =
    deps.saveToObsidian ||
    (async (input) => {
      return (await saveTool.invoke({
        ...input,
        source: input.source || "Video",
        mode: "create",
      })) as SaveResult;
    });

  return tool(async (input: TranscribeVideoInput) => {
    const adapter = selectAdapter(input.source);
    logger.info(`[tool:transcribe_video] start source=${input.source}`);
    logger.info(`[tool:transcribe_video] adapter=${adapter.name}`);
    const resolved =
      adapter.name === "file"
        ? await resolveFile(input.source)
        : adapter.name === "youtube"
          ? await resolveYoutube(input.source, { outputDir: "/tmp/cat-crawl-youtube" })
          : await resolveDouyin(input.source, { cookieHeader: env.douyinCookie });
    logger.info(
      `[tool:transcribe_video] resolved source_url=${resolved.sourceUrl} media_path=${resolved.mediaPath}`,
    );

    const audioPath = await extractAudio(resolved.mediaPath, {
      outputDir: "/tmp/cat-crawl-audio",
    });
    logger.info(`[tool:transcribe_video] extracted audio_path=${audioPath}`);

    const transcription = await transcribe(audioPath, {
      provider: input.provider || env.transcriptionProvider,
      fallbackProvider: input.provider ? undefined : env.transcriptionFallbackProvider,
      forceProvider: Boolean(input.provider),
      whisperCpp: {
        bin: env.whisperCppBin,
        modelPath: env.whisperCppModelPath,
        language: input.language || env.whisperCppLanguage,
        outputDir: "/tmp/cat-crawl-whisper",
      },
      gemini: {
        apiKey: env.geminiApiKey,
        model: env.geminiModel,
      },
    });
    logger.info(
      `[tool:transcribe_video] transcription provider=${transcription.providerUsed} fallback=${transcription.fallbackUsed}`,
    );

    const resolvedTitle = "title" in resolved ? resolved.title?.trim() : undefined;
    const rawTitle = input.title?.trim() || resolvedTitle || "Untitled Video Transcript";
    const normalized = normalizeVideoTitle(rawTitle);
    const title = normalized.title;
    const transcriptMarkdown = await buildTranscriptMarkdown({
      sourceUrl: resolved.sourceUrl,
      transcriptText: transcription.text,
      transcriptSrt: transcription.srt,
    });
    const noteTags = Array.from(new Set(["video", "transcript", ...normalized.tags]));

    if (!input.save) {
      logger.info(`[tool:transcribe_video] skip save title=${title}`);
      return {
        saved: false,
        title,
        source_url: resolved.sourceUrl,
        provider_used: transcription.providerUsed,
        fallback_used: transcription.fallbackUsed,
        transcript_markdown: transcriptMarkdown,
      };
    }

    const saveResult = await saveToObsidian({
      title,
      source_url: resolved.sourceUrl,
      content_markdown: transcriptMarkdown,
      source: "Video",
      tags: noteTags,
    });
    logger.info(
      `[tool:transcribe_video] saved title=${title} path=${saveResult.path || "<unknown>"} vault=${saveResult.vault || "<active>"}`,
    );

    return {
      saved: Boolean(saveResult.saved),
      title,
      source_url: resolved.sourceUrl,
      vault: saveResult.vault,
      path: saveResult.path,
      tags: saveResult.tags,
      dynamic_folder: saveResult.dynamic_folder,
      provider_used: transcription.providerUsed,
      fallback_used: transcription.fallbackUsed,
      transcript_markdown: transcriptMarkdown,
    };
  }, {
    name: "transcribe_video",
    description: "提取视频语音并转写为文本，可选择保存到 Obsidian",
    schema: inputSchema,
  });
}

export const __test__ = {
  buildTranscriptMarkdownWithModel,
  extractJsonPayload,
  extractHashtags,
  normalizeModelJsonText,
  normalizeVideoTitle,
};
