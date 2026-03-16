import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { extractAudioFromVideo } from "../services/media/extract-audio.js";
import { transcribeAudio } from "../services/transcription/index.js";
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

function buildTranscriptMarkdown(sourceUrl: string, transcript: string): string {
  return [`- Source: ${sourceUrl}`, "", transcript.trim()].join("\n").trim();
}

export function createTranscribeVideoTool(env: AppEnv, deps: TranscribeVideoDeps = {}) {
  const saveTool = createSaveToObsidianTool(env);
  const selectAdapter = deps.selectVideoSourceAdapter || selectVideoSourceAdapter;
  const resolveFile = deps.resolveFileVideoSource || resolveFileVideoSource;
  const resolveYoutube = deps.resolveYouTubeVideoSource || resolveYouTubeVideoSource;
  const resolveDouyin = deps.resolveDouyinVideoSource || resolveDouyinVideoSource;
  const extractAudio = deps.extractAudioFromVideo || extractAudioFromVideo;
  const transcribe = deps.transcribeAudio || transcribeAudio;
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
    const transcriptMarkdown = buildTranscriptMarkdown(resolved.sourceUrl, transcription.text);
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
  buildTranscriptMarkdown,
  extractHashtags,
  normalizeVideoTitle,
};
