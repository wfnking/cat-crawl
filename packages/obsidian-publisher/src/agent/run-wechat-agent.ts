import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger } from "@cat-crawl/core";
import { parseHistoryIntentFromModelOutput, parseHistoryIntentFromText } from "./history-intent.js";
import { appendConversationRound, getRecentConversationMessages } from "./chat-memory.js";
import { pickPolicyFolder } from "./folder-policy.js";
import { loadEnv } from "../config/env.js";
import {
  getHistoryStore,
  inferSourceFromUrl,
  type HistoryChannel,
} from "../history/history-store.js";
import { createModel } from "../services/model.js";
import {
  describeDynamicFolder,
  resolveDynamicFolderOptions,
} from "../services/dynamic-folder-options.js";
import { selectVideoSourceAdapter } from "../services/video-sources/index.js";
import { crawlWebArticleTool } from "../tools/crawl-web-article.js";
import {
  createQuerySuccessHistoryTool,
  type QuerySuccessHistoryResult,
} from "../tools/query-success-history.js";
import { createSaveToObsidianTool } from "../tools/save-to-obsidian.js";
import { createTranscribeVideoTool } from "../tools/transcribe-video.js";
import { findExistingSavedRecordByUrl } from "./existing-save-check.js";
import { shouldForceRecrawlFromText } from "./recrawl-intent.js";
import { extractArticleUrl, normalizeModelText } from "../utils/text.js";

type CrawlToolResult = {
  title: string;
  author: string | null;
  published: string | null;
  source_url: string;
  content_markdown: string;
  description?: string | null;
};

type SaveToolResult = {
  saved?: boolean;
  vault?: string;
  path?: string;
  tags?: string[];
  dynamic_folder?: string;
};

type TranscribeVideoToolResult = SaveToolResult & {
  title: string;
  source_url: string;
  published?: string;
  author?: string;
  description?: string;
  transcript_markdown: string;
  provider_used: "whisper_cpp";
  fallback_used: boolean;
};

const logger = createLogger();

export type AgentRunResult = {
  reply: string;
  usedTools: string[];
};

export type AgentStatusUpdate = {
  stage:
    | "received"
    | "small_chat"
    | "crawl_start"
    | "crawl_done"
    | "classify_start"
    | "classify_done"
    | "save_start"
    | "save_done";
  message: string;
};

export type AgentRequestContext = {
  channel?: HistoryChannel;
  senderId?: string;
  roomId?: string;
  messageId?: string;
};

export type AgentRunOptions = {
  onStatus?: (status: AgentStatusUpdate) => void | Promise<void>;
  context?: AgentRequestContext;
};

type AgentDeps = {
  loadEnv?: typeof loadEnv;
  findExistingSavedRecordByUrl?: typeof findExistingSavedRecordByUrl;
  crawlWebArticleTool?: Pick<typeof crawlWebArticleTool, "invoke">;
  createSaveToObsidianTool?: typeof createSaveToObsidianTool;
  createTranscribeVideoTool?: typeof createTranscribeVideoTool;
  persistSuccessHistory?: typeof persistSuccessHistory;
  getHistoryStore?: typeof getHistoryStore;
};

type HistoryIntent = {
  shouldQuery: boolean;
  scope: "all" | "today";
  tag?: string;
};

async function emitStatus(
  options: AgentRunOptions | undefined,
  status: AgentStatusUpdate,
): Promise<void> {
  if (!options?.onStatus) {
    return;
  }
  try {
    await options.onStatus(status);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[agent] onStatus callback failed: ${detail}`);
  }
}

function buildCapabilityReply(): string {
  return [
    "我当前可以做这些事：",
    "1. 接收文章链接（已支持微信公众号、虎嗅，以及大部分普通网页文章页）。",
    "2. 抓取正文并转换为 Markdown（尽量保留结构与图片）。",
    "3. 根据文章内容选择一个动态目录（或留空）。",
    "4. 保存到你的 Obsidian Vault。",
    "5. 查询历史成功记录（全部 / 今天 / 按标签）。",
    "",
    "直接发文章链接，或说“查看今天成功记录 / 根据标签 ai 查询”。",
  ].join("\n");
}

function shouldReturnCapabilityReply(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) return true;
  return /(可以做什么|能做什么|你能做什么|怎么用|help|what can you do|功能)/i.test(text);
}

function formatHistoryReply(result: QuerySuccessHistoryResult): string {
  if (result.total === 0) {
    if (result.scope === "today") {
      return "今天还没有成功记录。";
    }
    if (result.tag) {
      return `没有找到标签为 \`${result.tag}\` 的成功记录。`;
    }
    return "还没有成功记录。";
  }

  const header = `共找到 ${result.total} 条成功记录（展示 ${result.items.length} 条）。`;
  const lines = result.items.map((item, index) => {
    const fullPath = `${item.vault}/${item.path}`;
    const tagText = item.tags.length > 0 ? item.tags.join(", ") : "(无)";
    return [
      `${index + 1}. [${item.created_at}] [${item.source}/${item.channel}] ${item.title}`,
      `标签: ${tagText}`,
      `路径: ${fullPath}`,
      `链接: ${item.source_url}`,
    ].join("\n");
  });

  return [header, "", ...lines].join("\n\n");
}

async function detectHistoryIntent(
  userInput: string,
  env: ReturnType<typeof loadEnv>,
): Promise<HistoryIntent> {
  const fallback = parseHistoryIntentFromText(userInput);
  const classifyModel = createModel(env, {
    task: "classify",
    maxTokens: 120,
    timeout: 15000,
    temperature: 0,
  });

  try {
    const message = await classifyModel.invoke([
      new SystemMessage(
        [
          "你是意图分类器，只返回 JSON。",
          "识别用户是否在查询历史成功记录。",
          '返回格式：{"should_query":boolean,"scope":"all|today","tag":"可选标签"}',
          "如果不是历史查询，should_query=false，scope=all。",
        ].join("\n"),
      ),
      new HumanMessage(userInput),
    ]);

    const parsed = parseHistoryIntentFromModelOutput(normalizeModelText(message.content));
    if (parsed) {
      return parsed;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(`[agent] history intent classify failed, fallback regex: ${detail}`);
  }

  return fallback;
}

async function chatForNonWechatInput(
  userInput: string,
  env: ReturnType<typeof loadEnv>,
  context: AgentRequestContext | undefined,
): Promise<string> {
  if (shouldReturnCapabilityReply(userInput)) {
    return buildCapabilityReply();
  }

  const chatModel = createModel(env, {
    task: "chat",
    maxTokens: 300,
    timeout: 25000,
  });
  try {
    const memoryMessages = getRecentConversationMessages(context);
    const contextMessages = memoryMessages.map((message) => {
      if (message.role === "assistant") {
        return new AIMessage(message.content);
      }
      return new HumanMessage(message.content);
    });
    logger.info("[agent] invoking model for non-wechat small chat");
    const message = await chatModel.invoke([
      new SystemMessage(
        [
          "你是 cat-crawl 的助手。",
          "你可以做简短聊天，但核心能力是处理文章链接、保存 Obsidian、查询历史成功记录。",
          "回答保持简洁、友好、中文。",
        ].join("\n"),
      ),
      ...contextMessages,
      new HumanMessage(userInput),
    ]);
    const reply = normalizeModelText(message.content);
    const finalReply = reply || buildCapabilityReply();
    appendConversationRound(context, userInput, finalReply);
    return finalReply;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[agent] non-wechat chat fallback failed: ${detail}`);
    return buildCapabilityReply();
  }
}

function buildClassificationSummary(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("- Source:") && !line.startsWith("- Author:"));
  const merged = lines.join(" ").replace(/\s+/g, " ").trim();
  return merged.slice(0, 1800);
}

function buildClassifierPrompt(options: string[]): string {
  const optionText =
    options.length > 0
      ? options.map((item) => `- ${item}: ${describeDynamicFolder(item)}`).join("\n")
      : "- (no options configured)";

  return [
    "You are a strict classifier.",
    "Pick exactly one dynamic_folder from the allowed list based on article content.",
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

function canUseClassificationModel(env: ReturnType<typeof loadEnv>): boolean {
  const provider = env.aiClassifyProvider || env.aiProvider || env.agent;
  if (provider === "openai") {
    return Boolean(env.openaiApiKey?.trim());
  }
  if (provider === "gemini") {
    return Boolean(env.geminiApiKey?.trim());
  }
  return provider === "vertex";
}

function formatSuccessReply(subject: string, saveResult: SaveToolResult): string {
  const vault = saveResult.vault ?? "";
  const path = saveResult.path ?? "";
  const fullPath = vault && path ? `${vault}/${path}` : path || "(unknown path)";
  const folder = saveResult.dynamic_folder?.trim() || "";
  const lines = [`${subject}已成功保存到 Obsidian！`];
  if (folder) {
    lines.push(`分类：\`${folder}\``);
  }
  lines.push(`保存路径：\`${fullPath}\``);
  return lines.join("\n\n");
}

function isSupportedVideoUrl(url: string): boolean {
  try {
    return selectVideoSourceAdapter(url).name !== "file";
  } catch {
    return false;
  }
}

function persistSuccessHistory(
  crawlResult: CrawlToolResult,
  saveResult: SaveToolResult,
  context: AgentRequestContext | undefined,
): void {
  if (!saveResult.saved || !saveResult.vault || !saveResult.path) {
    return;
  }

  const store = getHistoryStore();
  const source = inferSourceFromUrl(crawlResult.source_url);
  const channel = context?.channel ?? "cli";
  const tags = (saveResult.tags ?? []).map((item) => item.trim()).filter(Boolean);

  try {
    store.insertSuccessRecord({
      createdAt: new Date().toISOString(),
      source,
      channel,
      sourceUrl: crawlResult.source_url,
      title: crawlResult.title,
      tags,
      vault: saveResult.vault,
      path: saveResult.path,
      dynamicFolder: saveResult.dynamic_folder,
      author: crawlResult.author ?? undefined,
      senderId: context?.senderId,
      roomId: context?.roomId,
      messageId: context?.messageId,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[agent] persist success history failed: ${detail}`);
  }
}

export async function runAgent(
  userInput: string,
  options?: AgentRunOptions,
  deps: AgentDeps = {},
): Promise<AgentRunResult> {
  logger.info("[agent] start processing input");
  const env = (deps.loadEnv || loadEnv)();
  const existingChecker = deps.findExistingSavedRecordByUrl || findExistingSavedRecordByUrl;
  const articleTool = deps.crawlWebArticleTool || crawlWebArticleTool;
  const buildSaveTool = deps.createSaveToObsidianTool || createSaveToObsidianTool;
  const buildTranscribeTool = deps.createTranscribeVideoTool || createTranscribeVideoTool;
  const persistHistory = deps.persistSuccessHistory || persistSuccessHistory;
  const usedTools: string[] = [];
  await emitStatus(options, {
    stage: "received",
    message: `已收到请求：${userInput.slice(0, 80)}`,
  });

  const url = extractArticleUrl(userInput);
  if (!url) {
    await emitStatus(options, {
      stage: "small_chat",
      message: "检测到非文章链接，先尝试历史查询意图，否则进入简短对话模式。",
    });
    if (shouldReturnCapabilityReply(userInput)) {
      return {
        reply: buildCapabilityReply(),
        usedTools,
      };
    }
    const historyIntent = await detectHistoryIntent(userInput, env);
    if (historyIntent.shouldQuery) {
      const historyTool = createQuerySuccessHistoryTool(getHistoryStore());
      const historyResult = (await historyTool.invoke({
        scope: historyIntent.scope,
        tag: historyIntent.tag,
        limit: 20,
      })) as QuerySuccessHistoryResult;
      usedTools.push("query_success_history");
      return {
        reply: formatHistoryReply(historyResult),
        usedTools,
      };
    }

    const reply = await chatForNonWechatInput(userInput, env, options?.context);
    return {
      reply,
      usedTools,
    };
  }

  const forceRecrawl = shouldForceRecrawlFromText(userInput);
  const existingRecord = forceRecrawl ? null : await existingChecker(url);
  if (existingRecord) {
    logger.info(`[agent] found existing record for url: ${url}`);
    await emitStatus(options, {
      stage: "save_done",
      message: `该内容之前已经帮您处理并保存过，无需重复抓取。\n\n历史标题：${existingRecord.title}\n保存路径：${existingRecord.vault}/${existingRecord.path}`,
    });
    return {
      reply: `该内容之前已经帮您处理并保存过，无需重复抓取。\n\n历史标题：${existingRecord.title}\n保存路径：\`${existingRecord.vault}/${existingRecord.path}\``,
      usedTools,
    };
  }
  if (forceRecrawl) {
    logger.info(`[agent] force recrawl requested for url: ${url}`);
  }

  const isVideoUrl = isSupportedVideoUrl(url);

  if (isVideoUrl) {
    await emitStatus(options, {
      stage: "crawl_start",
      message: `开始提取视频并转写：${url}`,
    });
    logger.info("[agent] invoking tool=transcribe_video");
    const transcribeTool = buildTranscribeTool(env);
    const transcribeResult = (await transcribeTool.invoke({
      source: url,
      save: true,
    })) as TranscribeVideoToolResult;
    usedTools.push("transcribe_video");
    persistHistory(
      {
        title: transcribeResult.title,
        author: transcribeResult.author ?? null, // Pass author from transcribeResult
        published: transcribeResult.published ?? null,
        source_url: transcribeResult.source_url,
        content_markdown: transcribeResult.transcript_markdown,
        description: transcribeResult.description,
      },
      transcribeResult,
      options?.context,
    );
    await emitStatus(options, {
      stage: "save_done",
      message: `视频转写已保存：${transcribeResult.vault ?? ""}/${transcribeResult.path ?? "(unknown path)"}`,
    });
    return {
      reply: formatSuccessReply("视频转写", transcribeResult),
      usedTools,
    };
  }

  await emitStatus(options, {
    stage: "crawl_start",
    message: `开始抓取文章：${url}`,
  });
  logger.info("[agent] invoking tool=crawl_web_article");
  const crawlResult = (await articleTool.invoke({ url })) as CrawlToolResult;
  usedTools.push("crawl_web_article");
  logger.info("[agent] tool success: crawl_web_article");
  const crawlSummary = buildClassificationSummary(crawlResult.content_markdown).slice(0, 120);
  await emitStatus(options, {
    stage: "crawl_done",
    message: [
      "爬取成功。",
      `标题：${crawlResult.title}`,
      `作者：${crawlResult.author ?? "Unknown"}`,
      `发布时间：${crawlResult.published ?? "Unknown"}`,
      `摘要：${crawlSummary || "(空)"}`,
    ].join("\n"),
  });

  let dynamicFolder = "";
  const summary = buildClassificationSummary(crawlResult.content_markdown);
  const dynamicFolderOptions = await resolveDynamicFolderOptions(env);
  const policyOptions = dynamicFolderOptions.length > 0 ? dynamicFolderOptions : ["OPC"];
  const policyFolder = pickPolicyFolder({
    title: crawlResult.title,
    summary,
    options: policyOptions,
  });

  if (policyFolder) {
    dynamicFolder = policyFolder;
    logger.info(`[agent] dynamic_folder policy selected=${dynamicFolder}`);
    await emitStatus(options, {
      stage: "classify_done",
      message: `目录分类完成：${dynamicFolder}`,
    });
  } else if (dynamicFolderOptions.length > 0) {
    await emitStatus(options, {
      stage: "classify_start",
      message: "正在根据文章内容选择目录分类...",
    });
    if (!canUseClassificationModel(env)) {
      logger.info("[agent] classification model unavailable (missing auth), skip model classify");
      await emitStatus(options, {
        stage: "classify_done",
        message: "目录分类完成：(仅使用规则，未启用模型分类)",
      });
      dynamicFolder = "";
    } else {
    logger.info("[agent] preparing summarized context for dynamic folder classification");
    try {
      const classifierModel = createModel(env, {
        task: "classify",
        maxTokens: 500,
        timeout: 30000,
      });
      const classifyStart = Date.now();
      logger.info("[agent] invoking model for dynamic_folder classification");
      const classifyMessage = await classifierModel.invoke([
        new SystemMessage(buildClassifierPrompt(dynamicFolderOptions)),
        new HumanMessage(
          [`Title: ${crawlResult.title}`, "", `Summary: ${summary}`, "", "Return JSON only."].join(
            "\n",
          ),
        ),
      ]);
      const classifyCostMs = Date.now() - classifyStart;
      logger.info(`[agent] classification model done in ${classifyCostMs}ms`);

      const modelOutput = normalizeModelText(classifyMessage.content);
      dynamicFolder = pickDynamicFolder(modelOutput, dynamicFolderOptions);
      logger.info(`[agent] dynamic_folder selected=${dynamicFolder || "(empty)"}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[agent] dynamic_folder classify failed, fallback base folder msg=${msg}`);
      dynamicFolder = "";
    }
    await emitStatus(options, {
      stage: "classify_done",
      message: `目录分类完成：${dynamicFolder || "(未命中，保存到基础目录)"}`,
    });
    }
  } else {
    logger.info("[agent] dynamic folder options empty, skip classification");
    await emitStatus(options, {
      stage: "classify_done",
      message: "未配置目录分类候选，使用基础目录保存。",
    });
  }

  const saveToObsidianTool = buildSaveTool(env);
  await emitStatus(options, {
    stage: "save_start",
    message: "正在保存到 Obsidian...",
  });
  logger.info("[agent] invoking tool=save_to_obsidian");
  const saveResult = (await saveToObsidianTool.invoke({
    title: crawlResult.title,
    source_url: crawlResult.source_url,
    content_markdown: crawlResult.content_markdown,
    author: crawlResult.author ?? undefined,
    published: crawlResult.published ?? undefined,
    description: buildClassificationSummary(crawlResult.content_markdown).slice(0, 200),
    source: "WeChat",
    dynamic_folder: dynamicFolder,
  })) as SaveToolResult;
  usedTools.push("save_to_obsidian");
  persistHistory(crawlResult, saveResult, options?.context);

  logger.info("[agent] tool success: save_to_obsidian");
  logger.info("[agent] finalize response");
  await emitStatus(options, {
    stage: "save_done",
    message: `保存成功：${saveResult.vault ?? ""}/${saveResult.path ?? "(unknown path)"}`,
  });

  return {
    reply: formatSuccessReply("文章", saveResult),
    usedTools,
  };
}

export async function runWechatAgent(
  userInput: string,
  options?: AgentRunOptions,
  deps: AgentDeps = {},
): Promise<AgentRunResult> {
  return runAgent(userInput, options, deps);
}
