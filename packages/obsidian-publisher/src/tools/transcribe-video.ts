import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger } from "@cat-crawl/core";
import fs from "node:fs";
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
    published?: string;
    description?: string;
    author?: string;
    source?: string;
    tags?: string[];
    dynamic_folder?: string;
  }) => Promise<SaveResult>;
  buildTranscriptMarkdown?: (input: {
    sourceUrl: string;
    transcriptText: string;
    transcriptSrt?: string;
  }) => Promise<{ markdown: string; description?: string; tags?: string[] }>;
};

const logger = createLogger();

function buildClassificationSummary(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("- Source:") && !line.startsWith("[Source]"));
  return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 1800);
}

function buildClassifierPrompt(options: string[]): string {
  const optionText =
    options.length > 0
      ? options.map((item) => `- ${item}`).join("\n")
      : "- (no options configured)";

  return [
    "You are a strict classifier.",
    "Pick exactly one dynamic_folder from the allowed list based on article/video content.",
    "If nothing fits, return empty string.",
    'Output JSON only: {"dynamic_folder":"..."}',
    "Allowed options:",
    optionText,
  ].join("\n");
}

function pickDynamicFolder(modelOutput: string, options: string[]): string {
  const trimmed = modelOutput.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as { dynamic_folder?: unknown };
    if (typeof parsed.dynamic_folder === "string") {
      const picked = parsed.dynamic_folder.trim();
      if (!picked) return "";
      return options.includes(picked) ? picked : "";
    }
  } catch {
    // fall through to fuzzy matching
  }

  if (trimmed === '""' || trimmed === "''" || trimmed.toLowerCase() === "null") {
    return "";
  }

  for (const option of options) {
    if (trimmed === option || trimmed.includes(option)) {
      return option;
    }
  }

  return "";
}

function pickPolicyDynamicFolder(options: string[], text: string): string {
  const rules: Array<{ option: string; pattern: RegExp }> = [
    {
      option: "AI",
      pattern:
        /(^|[^a-z])ai([^a-z]|$)|artificial intelligence|llm|agentic|machine learning|deep learning|prompt engineering|rag|人工智能|大模型|机器学习|智能体|提示词/u,
    },
    {
      option: "DSA",
      pattern: /data structure|algorithm|leetcode|算法|数据结构|刷题/u,
    },
    {
      option: "English",
      pattern:
        /english learning|english writing|ielts|toefl|vocabulary|pronunciation|grammar|英文写作|英语写作|英语学习|口语|语法/u,
    },
    {
      option: "Go",
      pattern: /(^|[^a-z])go([^a-z]|$)|golang|go语言|gin|gorm/u,
    },
    {
      option: "Job",
      pattern: /interview|resume|job hunting|career|hiring|求职|面试|简历|跳槽/u,
    },
    {
      option: "OPC",
      pattern:
        /创业|创业者|创始人|一人公司|个体创业|商业化|变现|公司经营|startup|founder|one person company|cross[- ]?border e[- ]?commerce|跨境电商|电商|独立开发|独立开发者|个人开发者|solo entrepreneur|indie hacker|indiehacker|side hustle|side project|bootstrap|bootstrapped|micro[- ]?saas|saas|mrr|arr|营收|收入|盈利|月入|年入|赚钱|副业|卖了|收购|acquired|exit/u,
    },
    {
      option: "Procrastination",
      pattern: /procrastination|拖延|拖延症|专注|自律|习惯养成/u,
    },
    {
      option: "Writing",
      pattern: /writing|copywriting|写作|文案|创作|写作技巧/u,
    },
  ];

  for (const option of options) {
    const matched = rules.find((rule) => rule.option.toLowerCase() === option.trim().toLowerCase());
    if (matched && matched.pattern.test(text)) {
      return option;
    }
  }

  return "";
}

async function resolveDynamicFolder(
  env: AppEnv,
  input: { title: string; transcriptMarkdown: string },
): Promise<string> {
  if (env.obsidianDynamicFolders.length === 0) {
    return "";
  }

  const summary = buildClassificationSummary(input.transcriptMarkdown);
  const policyFolder = pickPolicyDynamicFolder(
    env.obsidianDynamicFolders,
    `${input.title}\n${summary}`.toLowerCase(),
  );
  if (policyFolder) {
    logger.info(`[tool:transcribe_video] dynamic_folder policy selected=${policyFolder}`);
    return policyFolder;
  }

  const classifierModel = createModel(env, {
    task: "classify",
    maxTokens: 300,
    timeout: 30000,
    temperature: 0,
  });
  try {
    logger.info("[tool:transcribe_video] invoking model for dynamic_folder classification");
    const classifyMessage = await classifierModel.invoke([
      new SystemMessage(buildClassifierPrompt(env.obsidianDynamicFolders)),
      new HumanMessage([`Title: ${input.title}`, "", `Summary: ${summary}`, "", "Return JSON only."].join("\n")),
    ]);
    const modelOutput = String(classifyMessage.content ?? "").trim();
    const folder = pickDynamicFolder(modelOutput, env.obsidianDynamicFolders);
    logger.info(`[tool:transcribe_video] dynamic_folder selected=${folder || "(empty)"}`);
    return folder;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[tool:transcribe_video] dynamic_folder classify failed msg=${msg}`);
    return "";
  }
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

function pickGeminiSummarizeModel(env: AppEnv, translateToChinese: boolean): string {
  if (translateToChinese && env.geminiModel) {
    return env.geminiModel;
  }
  return env.geminiModel || "gemini-2.5-pro";
}

async function buildTranscriptMarkdownWithModel(
  env: AppEnv,
  input: {
    sourceUrl: string;
    transcriptText: string;
    transcriptSrt?: string;
  },
): Promise<{ markdown: string; description?: string; tags?: string[] }> {
  logger.info(`[tool:transcribe_video] chapterize start source_url=${input.sourceUrl}`);
  const sourceMaterial = input.transcriptSrt?.trim() || input.transcriptText.trim();
  const translateToChinese = shouldTranslateToChinese(sourceMaterial);
  const configuredProvider = env.aiSummarizeProvider || env.aiProvider || env.agent;
  const summarizeModel =
    configuredProvider === "openai"
      ? env.openaiModel
      : pickGeminiSummarizeModel(env, translateToChinese);
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
          "第一行必须是：[Description] 一两句话的视频摘要内容。",
          "第二行必须是：[Tags] 3-5个相关标签，用逗号分隔，标签应该反映视频的主题和关键概念。",
          `第三行必须是：- Source: ${input.sourceUrl}`,
          "按主题分章节，章节标题格式：## 标题",
          "章节标题和第一段之间必须有一个空行。",
          "章节必须按内容大意和主题转折拆分，不要按固定时长或固定字数机械切分。",
          "每章先写整理后的原文内容（原始语言），紧接着写对应的中文翻译内容，原文和译文之间不要加分隔线。",
          "整体文风参考微信公众号文章：结构清晰、节奏舒适、适合手机阅读。",
          "长内容需要拆成多章，避免整篇只有一章或一段。",
          "每个章节内部要自然分段，不要把整章写成一整段。",
          "每段尽量短：1-3 句为宜；中文单段建议不超过120字，英文单段建议不超过80词。",
          "段落之间必须保留空行，禁止输出大段连续文本。",
          "如遇并列要点，可用简短无序列表；否则优先自然段。",
          "保留关键信息，不要编造。",
        ].join("\n"),
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
      const tempDirs = ["/tmp/cat-crawl-youtube", "/tmp/cat-crawl-audio", "/tmp/cat-crawl-whisper"];
      for (const dir of tempDirs) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
        } catch (error) {
          logger.warn(
            `[tool:transcribe_video] failed to clean temp dir dir=${dir} msg=${(error as Error).message}`,
          );
        }
      }

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
      const dynamicFolder = await resolveDynamicFolder(env, {
        title,
        transcriptMarkdown,
      });

      if (!input.save) {
        logger.info(`[tool:transcribe_video] skip save title=${title}`);
        return {
          saved: false,
          title,
          source_url: resolved.sourceUrl,
          provider_used: transcription.providerUsed,
          fallback_used: transcription.fallbackUsed,
          published:
            resolved.adapter === "youtube" || resolved.adapter === "douyin"
              ? resolved.published
              : undefined,
          author:
            resolved.adapter === "youtube" || resolved.adapter === "douyin"
              ? resolved.author
              : undefined,
          description: transcriptDescription,
          transcript_markdown: transcriptMarkdown,
        };
      }

      const saveResult = await saveToObsidian({
        title,
        source_url: resolved.sourceUrl,
        content_markdown: transcriptMarkdown,
        published:
          resolved.adapter === "youtube" || resolved.adapter === "douyin"
            ? resolved.published
            : undefined,
        author:
          resolved.adapter === "youtube" || resolved.adapter === "douyin"
            ? resolved.author
            : undefined,
        description: transcriptDescription,
        source: "Video",
        tags: noteTags,
        dynamic_folder: dynamicFolder,
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
        published:
          resolved.adapter === "youtube" || resolved.adapter === "douyin"
            ? resolved.published
            : undefined,
        author:
          resolved.adapter === "youtube" || resolved.adapter === "douyin"
            ? resolved.author
            : undefined,
        description: transcriptDescription,
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
