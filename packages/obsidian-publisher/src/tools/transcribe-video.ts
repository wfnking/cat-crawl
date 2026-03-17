import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger } from "@cat-crawl/core";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { extractAudioFromVideo } from "../services/media/extract-audio.js";
import { createModel } from "../services/model.js";
import { transcribeAudio } from "../services/transcription/index.js";
import { resolveDouyinVideoSource } from "../services/video-sources/douyin.js";
import { resolveFileVideoSource } from "../services/video-sources/file.js";
import { selectVideoSourceAdapter } from "../services/video-sources/index.js";
import { resolveYouTubeVideoSource } from "../services/video-sources/youtube.js";
import { createSaveToObsidianTool } from "./save-to-obsidian.js";

const inputSchema = z.object({
  source: z.string().min(1).describe("视频 URL 或本地文件路径"),
  provider: z.literal("whisper_cpp").optional(),
  language: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  save: z.boolean().default(true),
});

type TranscribeVideoInput = z.infer<typeof inputSchema>;

type SaveResult = {
  saved?: boolean;
  vault?: string;
  path?: string;
  author?: string;
  published?: string;
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

function normalizeVideoTitle(rawTitle: string): {
  title: string;
  tags: string[];
} {
  const tags = Array.from(new Set(extractHashtags(rawTitle)));
  const withoutTags = rawTitle.replace(/#([^\s#]+)/g, " ");
  const withoutSourceSuffix = withoutTags.replace(/\s*-\s*抖音\s*$/u, " ");
  const title = withoutSourceSuffix.replace(/\s+/g, " ").trim();
  return {
    title: title || rawTitle.trim(),
    tags,
  };
}

function shouldTranslateToChinese(sourceText: string): boolean {
  const sample = sourceText.slice(0, 8000);
  if (!sample.trim()) {
    return false;
  }
  const latinMatches = sample.match(/[A-Za-z]/g) || [];
  const cjkMatches = sample.match(/[\u3400-\u9fff]/g) || [];
  if (latinMatches.length === 0) {
    return false;
  }
  if (cjkMatches.length === 0) {
    return true;
  }
  return latinMatches.length > cjkMatches.length;
}

function pickGeminiSummarizeModel(translateToChinese: boolean): string {
  return translateToChinese ? "gemini-2.5-pro" : "gemini-2.5-pro";
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
  const sourceMaterial = input.transcriptSrt?.trim() || input.transcriptText.trim();
  const translateToChinese = shouldTranslateToChinese(sourceMaterial);
  const configuredProvider = env.aiSummarizeProvider || env.aiProvider || env.agent;
  const summarizeModel =
    configuredProvider === "deepseek"
      ? env.deepseekModel
      : pickGeminiSummarizeModel(translateToChinese);
  const summarizeTimeoutMs = Math.max(
    60000,
    Math.min(300000, Math.ceil(sourceMaterial.length / 40) * 1000),
  );
  logger.info(
    `[tool:transcribe_video] chapter summarize mode translate_to_zh=${translateToChinese} provider=${configuredProvider} model=${summarizeModel} timeout_ms=${summarizeTimeoutMs}`,
  );
  const model = createModel(env, {
    task: "summarize",
    provider: configuredProvider,
    model: summarizeModel,
    maxTokens: 6000,
    timeout: summarizeTimeoutMs,
    temperature: 0,
  });
  try {
    const message = await model.invoke([
      new SystemMessage(
        [
          "你是视频 SRT 转文章助手。",
          "把输入的 SRT/转写文本整理为可直接保存的 Markdown 文章。",
          "必须直接输出最终 Markdown，不要输出 JSON，不要输出解释，不要输出代码块。",
          `第一行必须是：- Source: ${input.sourceUrl}`,
          "按主题分章节，章节标题格式：## 标题",
          "每章先写整理后的原文内容（原始语言），再写对应的中文翻译内容。",
          "长内容需要拆成多章，避免整篇只有一章或一段。",
          "保留关键信息，不要编造。",
        ].join("\n"),
      ),
      new HumanMessage(
        [
          `Source: ${input.sourceUrl}`,
          "",
          "Transcript Input:",
          sourceMaterial,
        ].join("\n"),
      ),
    ]);
    const markdown = String(message.content ?? "").trim();
    if (!markdown) {
      throw new Error("chapter summarize empty markdown");
    }
    logger.info(`[tool:transcribe_video] chapterize done chars=${markdown.length}`);
    return markdown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[tool:transcribe_video] chapterize failed msg=${detail}`);
    throw error;
  }
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

  return tool(
    async (input: TranscribeVideoInput) => {
      const adapter = selectAdapter(input.source);
      logger.info(`[tool:transcribe_video] start source=${input.source}`);
      logger.info(`[tool:transcribe_video] adapter=${adapter.name}`);
      const resolved =
        adapter.name === "file"
          ? await resolveFile(input.source)
          : adapter.name === "youtube"
            ? await resolveYoutube(input.source, {
                outputDir: "/tmp/cat-crawl-youtube",
              })
            : await resolveDouyin(input.source, {
                cookieHeader: env.douyinCookie,
              });
      logger.info(
        `[tool:transcribe_video] resolved source_url=${resolved.sourceUrl} media_path=${resolved.mediaPath}`,
      );

      const audioPath = await extractAudio(resolved.mediaPath, {
        outputDir: "/tmp/cat-crawl-audio",
      });
      logger.info(`[tool:transcribe_video] extracted audio_path=${audioPath}`);
      const requestedProvider = input.provider || "whisper_cpp";
      logger.info(
        `[tool:transcribe_video] transcription config provider=${requestedProvider} whisper_model=${env.whisperCppModelPath ? "set" : "missing"}`,
      );

      const transcription = await transcribe(audioPath, {
        provider: requestedProvider,
        whisperCpp: {
          bin: env.whisperCppBin,
          modelPath: env.whisperCppModelPath,
          language: input.language || env.whisperCppLanguage,
          outputDir: "/tmp/cat-crawl-whisper",
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
          published: resolved.adapter === "youtube" ? resolved.published : undefined,
          transcript_markdown: transcriptMarkdown,
        };
      }

      const saveResult = await saveToObsidian({
        title,
        source_url: resolved.sourceUrl,
        content_markdown: transcriptMarkdown,
        published: resolved.adapter === "youtube" ? resolved.published : undefined,
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
        published: resolved.adapter === "youtube" ? resolved.published : undefined,
        provider_used: transcription.providerUsed,
        fallback_used: transcription.fallbackUsed,
        transcript_markdown: transcriptMarkdown,
      };
    },
    {
      name: "transcribe_video",
      description: "提取视频语音并转写为文本，可选择保存到 Obsidian",
      schema: inputSchema,
    },
  );
}

export const __test__ = {
  buildTranscriptMarkdownWithModel,
  shouldTranslateToChinese,
  pickGeminiSummarizeModel,
  extractHashtags,
  normalizeVideoTitle,
};
