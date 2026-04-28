import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger } from "@cat-crawl/core";
import fs from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { extractAudioFromVideo } from "../../ingest/video/media/extract-audio.js";
import { createModel } from "../llm/models/index.js";
import { transcribeAudio } from "../../ingest/video/transcription/index.js";
import { resolveDouyinVideoSource } from "../../ingest/video/handlers/douyin.js";
import { resolveFileVideoSource } from "../../ingest/video/handlers/file.js";
import { selectVideoHandler } from "../../ingest/video/registry.js";
import { resolveYouTubeVideoSource } from "../../ingest/video/handlers/youtube.js";
import type { ResolvedVideoSource } from "../../ingest/video/types.js";

const inputSchema = z.object({
  source: z.string().min(1).describe("视频 URL 或本地文件路径"),
  provider: z.literal("whisper_cpp").optional(),
  language: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  resolved_adapter: z.enum(["file", "youtube", "douyin"]).optional(),
  resolved_source_url: z.string().min(1).optional(),
  resolved_media_path: z.string().min(1).optional(),
  resolved_transcript_path: z.string().min(1).optional(),
  resolved_title: z.string().min(1).optional(),
  resolved_published: z.string().min(1).optional(),
  resolved_author: z.string().min(1).optional(),
});

type TranscribeVideoInput = z.infer<typeof inputSchema>;

type TranscribeVideoDeps = {
  selectVideoHandler?: typeof selectVideoHandler;
  resolveFileVideoSource?: typeof resolveFileVideoSource;
  resolveYouTubeVideoSource?: typeof resolveYouTubeVideoSource;
  resolveDouyinVideoSource?: typeof resolveDouyinVideoSource;
  extractAudioFromVideo?: typeof extractAudioFromVideo;
  transcribeAudio?: typeof transcribeAudio;
  buildTranscriptMarkdown?: (input: {
    sourceUrl: string;
    transcriptText: string;
    transcriptSrt?: string;
  }) => Promise<{ markdown: string; description?: string; tags?: string[] }>;
};

const logger = createLogger();
const DEFAULT_TEMP_ROOT_DIR = "/tmp/cat-crawl";

function getTempDirs(env: AppEnv) {
  const root = env.tempRootDir || DEFAULT_TEMP_ROOT_DIR;
  return {
    root,
    youtube: join(root, "youtube"),
    douyin: join(root, "douyin"),
    audio: join(root, "audio"),
    whisper: join(root, "whisper"),
  };
}

function hasPreResolvedSource(
  input: TranscribeVideoInput,
): input is TranscribeVideoInput & {
  resolved_adapter: ResolvedVideoSource["adapter"];
  resolved_source_url: string;
  resolved_media_path: string;
} {
  return Boolean(input.resolved_adapter && input.resolved_source_url && input.resolved_media_path);
}

function toResolvedVideoSource(input: TranscribeVideoInput): ResolvedVideoSource {
  if (!hasPreResolvedSource(input)) {
    throw new Error("Resolved video source is incomplete.");
  }

  return {
    adapter: input.resolved_adapter,
    sourceUrl: input.resolved_source_url,
    mediaPath: input.resolved_media_path,
    transcriptPath: input.resolved_transcript_path,
    title: input.resolved_title,
    published: input.resolved_published,
    author: input.resolved_author,
  };
}

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
  const latinMatches = sample.match(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g) || [];
  const cjkMatches = sample.match(/[\u3400-\u9fff]/g) || [];
  if (latinMatches.length === 0) {
    return false;
  }
  if (cjkMatches.length === 0) {
    return true;
  }
  return latinMatches.length > cjkMatches.length;
}

function srtToPlainText(srt: string): string {
  return srt
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line && !/^\d+$/.test(line) && !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickGeminiSummarizeModel(env: AppEnv, translateToChinese: boolean): string {
  if (translateToChinese && env.geminiModel) {
    return env.geminiModel;
  }
  return env.geminiModel || "gemini-2.5-pro";
}

function pickSummarizeModel(
  env: AppEnv,
  provider: AppEnv["aiProvider"],
  translateToChinese: boolean,
): string {
  if (provider === "gemini" || provider === "vertex") {
    return pickGeminiSummarizeModel(env, translateToChinese);
  }
  return env.openaiModel || "gpt-4o-mini";
}

function pickSummarizeMaxTokens(sourceMaterial: string): number {
  return Math.max(24000, Math.min(64000, Math.ceil(sourceMaterial.length / 5)));
}

function pickTranscriptSourceMaterial(input: {
  transcriptText: string;
  transcriptSrt?: string;
}): string {
  return input.transcriptText.trim() || input.transcriptSrt?.trim() || "";
}

function splitTranscriptIntoParagraphs(text: string, maxChars = 480): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!normalized) {
    return [];
  }

  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return [normalized];
  }

  const paragraphs: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars && current) {
      paragraphs.push(current.trim());
      current = sentence;
      continue;
    }
    current = candidate;
  }

  if (current.trim()) {
    paragraphs.push(current.trim());
  }

  return paragraphs;
}

function buildFallbackChapterMarkdown(input: {
  sourceUrl: string;
  transcriptText: string;
  transcriptSrt?: string;
}): { markdown: string; description?: string; tags?: string[] } {
  const plain = pickTranscriptSourceMaterial(input);
  const preview = plain.slice(0, 400).trim().replace(/\s+/g, " ");
  const description =
    preview.length > 0
      ? `${preview}${plain.length > 400 ? "…" : ""}`
      : "Video transcript.";
  const tags = ["video", "transcript"];
  const paragraphs = splitTranscriptIntoParagraphs(plain);
  const transcriptBody = paragraphs.length > 0 ? paragraphs.join("\n\n") : plain;
  const markdown = [`- Source: ${input.sourceUrl}`, "", "## Full Transcript", "", transcriptBody].join("\n").trim();
  return { markdown, description, tags };
}

function appendFullTranscript(markdown: string, transcriptText: string): string {
  if (!transcriptText.trim()) {
    return markdown.trim();
  }
  if (/^##\s+Full Transcript$/im.test(markdown)) {
    return markdown.trim();
  }

  const paragraphs = splitTranscriptIntoParagraphs(transcriptText);
  if (paragraphs.length === 0) {
    return markdown.trim();
  }

  return [markdown.trim(), "## Full Transcript", ...paragraphs]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildTranscriptSystemPrompt(input: {
  sourceUrl: string;
  translateToChinese: boolean;
}): string {
  const translationInstruction = input.translateToChinese
    ? [
        "每章先写原始语言内容（保真整理，轻微断句即可），紧接着写对应的中文翻译内容，原文和译文之间不要加分隔线。",
        "若内容过长，优先确保原文完整输出；译文可以按段落精炼翻译，但必须覆盖对应原文段落。",
      ]
    : [
        "如果原文已经是中文，只保留中文整理稿，不要翻译成英文，也不要额外附加双语版本。",
        "每章只写原始语言内容（保真整理，轻微断句即可）。",
      ];

  return [
    "你是视频 SRT 转 Markdown 助手（保真模式）。",
    "把输入的 SRT/转写文本整理为可直接保存的 Markdown",
    "硬约束：必须完整覆盖原文信息与顺序，不要大幅改写，不要删掉有实质信息的句子。",
    "不要把长内容缩成短总结；信息保留优先于文采。",
    "原文完整性优先级高于一切；如果篇幅压力过大，宁可压缩译文，也不要压缩原文。",
    "不要输出导语、结语、总结、编者按、过渡总结；正文只保留原文整理和对应翻译。",
    "轻微断句可以，但不得同义改写、不得合并删减句意、不得漏掉例子、数字、限定词。",
    "必须直接输出最终 Markdown，不要输出 JSON，不要输出解释，不要输出代码块。",
    "第一行必须是：[Description] 2-3 句摘要，覆盖核心主题，不要过度简写。",
    "第二行必须是：[Tags] 3-5个相关标签，用逗号分隔，标签应该反映视频的主题和关键概念。",
    `第三行必须是：- Source: ${input.sourceUrl}`,
    "按主题分章节，章节标题格式：## 标题，标题尽量简短，不要占用过多输出长度。",
    "章节标题和第一段之间必须有一个空行；禁止输出“## 标题”后立刻紧跟正文。",
    "章节必须按内容大意和主题转折拆分，不要按固定时长或固定字数机械切分。",
    ...translationInstruction,
    "长内容需要拆成多章，避免整篇只有一章或一段。",
    "每个章节内部要自然分段，不要把整章写成一整段。",
    "每段尽量短：1-3 句为宜；中文单段建议不超过120字，英文单段建议不超过80词。",
    "段落之间必须保留空行，禁止输出大段连续文本。",
    "如遇并列要点，可用简短无序列表；否则优先自然段。",
    "不要编造、不补充未出现的信息。",
    "优先保留术语、专有名词、数字、例子、对比关系和结论。",
  ].join("\n");
}

export async function buildTranscriptMarkdownWithModel(
  env: AppEnv,
  input: {
    sourceUrl: string;
    transcriptText: string;
    transcriptSrt?: string;
  },
): Promise<{ markdown: string; description?: string; tags?: string[] }> {
  if (!env.transcriptionChapterizeEnabled) {
    logger.info(`[tool:transcribe_video] chapterize skipped source_url=${input.sourceUrl}`);
    return buildFallbackChapterMarkdown(input);
  }

  logger.info(`[tool:transcribe_video] chapterize start source_url=${input.sourceUrl}`);
  const sourceMaterial = pickTranscriptSourceMaterial(input);
  const translateToChinese = shouldTranslateToChinese(sourceMaterial);
  const configuredProvider = env.aiSummarizeProvider || env.aiProvider || env.agent;
  const summarizeModel = pickSummarizeModel(env, configuredProvider, translateToChinese);
  const summarizeMaxTokens = pickSummarizeMaxTokens(sourceMaterial);
  const summarizeTimeoutMs = Math.max(
    60000,
    Math.min(300000, Math.ceil(sourceMaterial.length / 40) * 1000),
  );
  logger.info(
    `[tool:transcribe_video] chapter summarize mode translate_to_zh=${translateToChinese} provider=${configuredProvider} model=${summarizeModel} max_output_tokens=${summarizeMaxTokens} timeout_ms=${summarizeTimeoutMs}`,
  );
  const model = createModel(env, {
    task: "summarize",
    provider: configuredProvider,
    model: summarizeModel,
    maxTokens: summarizeMaxTokens,
    timeout: summarizeTimeoutMs,
    temperature: 0,
  });
  try {
    const message = await model.invoke([
      new SystemMessage(
        buildTranscriptSystemPrompt({
          sourceUrl: input.sourceUrl,
          translateToChinese,
        }),
      ),
      new HumanMessage(
        [`Source: ${input.sourceUrl}`, "", "Transcript Input:", sourceMaterial].join("\n"),
      ),
    ]);
    let markdown = String(message.content ?? "").trim();
    if (!markdown) {
      throw new Error("chapter summarize empty markdown");
    }
    let description: string | undefined;
    let tags: string[] | undefined;

    const descMatch = markdown.match(/^[ \t]*\[Description\][ \t]*[:：]?[ \t]*(.+)/i);
    if (descMatch) {
      description = descMatch[1].trim();
      markdown = markdown.replace(/^[ \t]*\[Description\].*\n?/i, "").trim();
    }

    const tagsMatch = markdown.match(/^[ \t]*\[Tags\][ \t]*[:：]?[ \t]*(.+)/i);
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      markdown = markdown.replace(/^[ \t]*\[Tags\].*\n?/i, "").trim();
    }

    logger.info(
      `[tool:transcribe_video] chapterize done chars=${markdown.length} has_description=${!!description} tags=${tags?.length || 0}`,
    );
    return { markdown, description, tags };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(`[tool:transcribe_video] chapterize failed, transcript-only fallback msg=${detail}`);
    return buildFallbackChapterMarkdown(input);
  }
}

export async function resolveVideoSource(
  env: AppEnv,
  source: string,
  deps: Pick<
    TranscribeVideoDeps,
    "selectVideoHandler" | "resolveFileVideoSource" | "resolveYouTubeVideoSource" | "resolveDouyinVideoSource"
  > = {},
): Promise<ResolvedVideoSource> {
  const selectHandler = deps.selectVideoHandler || selectVideoHandler;
  const resolveFile = deps.resolveFileVideoSource || resolveFileVideoSource;
  const resolveYoutube = deps.resolveYouTubeVideoSource || resolveYouTubeVideoSource;
  const resolveDouyin = deps.resolveDouyinVideoSource || resolveDouyinVideoSource;

  const handler = selectHandler(source);
  logger.info(`[tool:resolve_video_source] start source=${source}`);
  logger.info(`[tool:resolve_video_source] handler=${handler.name}`);

  const dirs = getTempDirs(env);
  const resolved =
    handler.name === "file"
      ? await resolveFile(source)
      : handler.name === "youtube"
        ? await resolveYoutube(source, {
            outputDir: dirs.youtube,
          })
        : await resolveDouyin(source, {
            outputDir: dirs.douyin,
            cookieHeader: env.douyinCookie,
          });

  logger.info(
    `[tool:resolve_video_source] resolved source_url=${resolved.sourceUrl} media_path=${resolved.mediaPath}`,
  );
  return resolved;
}

export function createTranscribeVideoTool(env: AppEnv, deps: TranscribeVideoDeps = {}) {
  const extractAudio = deps.extractAudioFromVideo || extractAudioFromVideo;
  const transcribe = deps.transcribeAudio || transcribeAudio;
  const buildTranscriptMarkdown =
    deps.buildTranscriptMarkdown ||
    (async (input: { sourceUrl: string; transcriptText: string; transcriptSrt?: string }) =>
      buildTranscriptMarkdownWithModel(env, input));

  return tool(
    async (input: TranscribeVideoInput) => {
      const dirs = getTempDirs(env);
      const tempDirList = [dirs.youtube, dirs.douyin, dirs.audio, dirs.whisper];
      for (const dir of tempDirList) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (error) {
          logger.warn(
            `[tool:transcribe_video] failed to ensure temp dir dir=${dir} msg=${(error as Error).message}`,
          );
        }
      }

      logger.info(`[tool:transcribe_video] start source=${input.source}`);
      const resolved = hasPreResolvedSource(input)
        ? toResolvedVideoSource(input)
        : await resolveVideoSource(env, input.source, deps);
      logger.info(
        `[tool:transcribe_video] resolved source_url=${resolved.sourceUrl} media_path=${resolved.mediaPath}`,
      );

      const transcription = resolved.transcriptPath
        ? (() => {
            const srt = fs.readFileSync(resolved.transcriptPath, "utf8");
            return {
              providerUsed: "youtube_subtitles" as const,
              text: srtToPlainText(srt),
              srt,
              fallbackUsed: false,
            };
          })()
        : await (async () => {
            const audioPath = await extractAudio(resolved.mediaPath, {
              outputDir: dirs.audio,
            });
            logger.info(`[tool:transcribe_video] extracted audio_path=${audioPath}`);
            const requestedProvider = input.provider || "whisper_cpp";
            logger.info(
              `[tool:transcribe_video] transcription config provider=${requestedProvider} whisper_model=${env.whisperCppModelPath ? "set" : "missing"}`,
            );

            return transcribe(audioPath, {
              provider: requestedProvider,
              whisperCpp: {
                bin: env.whisperCppBin,
                modelPath: env.whisperCppModelPath,
                language: input.language || env.whisperCppLanguage || "zh",
                outputDir: dirs.whisper,
                ssh: env.whisperCppSshHost
                  ? {
                      host: env.whisperCppSshHost,
                      user: env.whisperCppSshUser,
                      port: env.whisperCppSshPort,
                      audioDir: env.whisperCppSshAudioDir,
                      outputDir: env.whisperCppSshOutputDir,
                    }
                  : undefined,
              },
            });
          })();
      logger.info(
        `[tool:transcribe_video] transcription provider=${transcription.providerUsed} fallback=${transcription.fallbackUsed}`,
      );

      const resolvedTitle = "title" in resolved ? resolved.title?.trim() : undefined;
      const rawTitle = input.title?.trim() || resolvedTitle || "Untitled Video Transcript";
      const normalized = normalizeVideoTitle(rawTitle);
      const title = normalized.title;
      const {
        markdown: transcriptMarkdown,
        description: transcriptDescription,
        tags: aiGeneratedTags,
      } = await buildTranscriptMarkdown({
        sourceUrl: resolved.sourceUrl,
        transcriptText: transcription.text,
        transcriptSrt: transcription.srt,
      });
      const noteTags = Array.from(
        new Set(["video", "transcript", ...normalized.tags, ...(aiGeneratedTags || [])]),
      );
      const contentMarkdown = shouldTranslateToChinese(transcription.text)
        ? appendFullTranscript(transcriptMarkdown, transcription.text)
        : transcriptMarkdown.trim();
      return {
        title,
        source_url: resolved.sourceUrl,
        content_markdown: contentMarkdown,
        tags: noteTags,
        published:
          resolved.adapter === "youtube" || resolved.adapter === "douyin"
            ? (resolved.published ?? null)
            : null,
        author:
          resolved.adapter === "youtube" || resolved.adapter === "douyin"
            ? (resolved.author ?? null)
            : null,
        description: transcriptDescription ?? null,
        meta: {
          provider_used: transcription.providerUsed,
          fallback_used: transcription.fallbackUsed,
        },
      };
    },
    {
      name: "transcribe_video",
      description: "提取视频语音并转写为文本，返回可保存到 Obsidian 的结构化内容",
      schema: inputSchema,
    },
  );
}
