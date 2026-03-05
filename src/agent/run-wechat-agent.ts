import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { parseHistoryIntentFromModelOutput, parseHistoryIntentFromText } from "./history-intent.js";
import { appendConversationRound, getRecentConversationMessages } from "./chat-memory.js";
import { findExistingSavedRecordByUrl } from "./existing-save-check.js";
import { loadEnv } from "../config/env.js";
import { getHistoryStore, inferSourceFromUrl, type HistoryChannel } from "../history/history-store.js";
import { createDeepSeekModel } from "../services/deepseek.js";
import { crawlWechatArticleTool } from "../tools/crawl-wechat-article.js";
import { createQuerySuccessHistoryTool, type QuerySuccessHistoryResult } from "../tools/query-success-history.js";
import { createSaveToObsidianTool } from "../tools/save-to-obsidian.js";
import { extractWechatUrl, normalizeModelText } from "../utils/text.js";

type CrawlToolResult = {
  title: string;
  author: string | null;
  source_url: string;
  content_markdown: string;
};

type SaveToolResult = {
  saved?: boolean;
  vault?: string;
  path?: string;
  tags?: string[];
  dynamic_folder?: string;
};

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

type HistoryIntent = {
  shouldQuery: boolean;
  scope: "all" | "today";
  tag?: string;
};

async function emitStatus(options: AgentRunOptions | undefined, status: AgentStatusUpdate): Promise<void> {
  if (!options?.onStatus) {
    return;
  }
  try {
    await options.onStatus(status);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[agent] onStatus callback failed: ${detail}`);
  }
}

function buildCapabilityReply(): string {
  return [
    "我当前可以做这些事：",
    "1. 接收微信公众号链接（mp.weixin.qq.com）。",
    "2. 抓取文章并转换为 Markdown（尽量保留结构）。",
    "3. 根据文章内容选择一个动态目录（或留空）。",
    "4. 通过 Obsidian CLI 保存到你的 Vault。",
    "5. 查询历史成功记录（全部 / 今天 / 按标签）。",
    "",
    "直接发公众号链接，或说“查看今天成功记录 / 根据标签 ai 查询”。",
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

async function detectHistoryIntent(userInput: string, env: ReturnType<typeof loadEnv>): Promise<HistoryIntent> {
  const fallback = parseHistoryIntentFromText(userInput);
  const classifyModel = createDeepSeekModel(env, {
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
    console.warn(`[agent] history intent classify failed, fallback regex: ${detail}`);
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

  const chatModel = createDeepSeekModel(env, {
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
    console.info("[agent] invoking model for non-wechat small chat");
    const message = await chatModel.invoke([
      new SystemMessage(
        [
          "你是 cat-crawl 的助手。",
          "你可以做简短聊天，但核心能力是处理微信公众号链接、保存 Obsidian、查询历史成功记录。",
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
    console.error(`[agent] non-wechat chat fallback failed: ${detail}`);
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
      ? options.map((item) => `- ${item}`).join("\n")
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

function formatSuccessReply(saveResult: SaveToolResult): string {
  const vault = saveResult.vault ?? "";
  const path = saveResult.path ?? "";
  const fullPath = vault && path ? `${vault}/${path}` : path || "(unknown path)";
  return `文章已成功保存到 Obsidian！\n\n保存路径：\`${fullPath}\``;
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
    console.error(`[agent] persist success history failed: ${detail}`);
  }
}

export async function runWechatAgent(
  userInput: string,
  options?: AgentRunOptions,
): Promise<AgentRunResult> {
  console.info("[agent] start processing input");
  const env = loadEnv();
  const usedTools: string[] = [];
  await emitStatus(options, {
    stage: "received",
    message: `已收到请求：${userInput.slice(0, 80)}`,
  });

  const url = extractWechatUrl(userInput);
  if (!url) {
    await emitStatus(options, {
      stage: "small_chat",
      message: "检测到非公众号链接，先尝试历史查询意图，否则进入简短对话模式。",
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

  const existing = await findExistingSavedRecordByUrl(url);
  if (existing) {
    const fullPath = `${existing.vault}/${existing.path}`;
    return {
      reply: [
        "这篇文章之前已经爬取并保存过了。",
        `标题：${existing.title}`,
        `保存路径：\`${fullPath}\``,
        "如果你希望强制重抓，我可以再加一个参数支持覆盖保存。",
      ].join("\n"),
      usedTools,
    };
  }

  await emitStatus(options, {
    stage: "crawl_start",
    message: `开始爬取公众号文章：${url}`,
  });
  console.info("[agent] invoking tool=crawl_wechat_article");
  const crawlResult = (await crawlWechatArticleTool.invoke({ url })) as CrawlToolResult;
  usedTools.push("crawl_wechat_article");
  console.info("[agent] tool success: crawl_wechat_article");
  const crawlSummary = buildClassificationSummary(crawlResult.content_markdown).slice(0, 120);
  await emitStatus(options, {
    stage: "crawl_done",
    message: [
      "爬取成功。",
      `标题：${crawlResult.title}`,
      `作者：${crawlResult.author ?? "Unknown"}`,
      `摘要：${crawlSummary || "(空)"}`,
    ].join("\n"),
  });

  let dynamicFolder = "";
  if (env.obsidianDynamicFolders.length > 0) {
    await emitStatus(options, {
      stage: "classify_start",
      message: "正在根据文章内容选择目录分类...",
    });
    console.info("[agent] preparing summarized context for dynamic folder classification");
    const summary = buildClassificationSummary(crawlResult.content_markdown);

    const classifierModel = createDeepSeekModel(env, {
      maxTokens: 500,
      timeout: 30000,
    });
    const classifyStart = Date.now();
    console.info("[agent] invoking model for dynamic_folder classification");
    const classifyMessage = await classifierModel.invoke([
      new SystemMessage(buildClassifierPrompt(env.obsidianDynamicFolders)),
      new HumanMessage(
        [
          `Title: ${crawlResult.title}`,
          "",
          `Summary: ${summary}`,
          "",
          "Return JSON only.",
        ].join("\n"),
      ),
    ]);
    const classifyCostMs = Date.now() - classifyStart;
    console.info(`[agent] classification model done in ${classifyCostMs}ms`);

    const modelOutput = normalizeModelText(classifyMessage.content);
    dynamicFolder = pickDynamicFolder(modelOutput, env.obsidianDynamicFolders);
    console.info(`[agent] dynamic_folder selected=${dynamicFolder || "(empty)"}`);
    await emitStatus(options, {
      stage: "classify_done",
      message: `目录分类完成：${dynamicFolder || "(未命中，保存到基础目录)"}`,
    });
  } else {
    console.info("[agent] dynamic folder options empty, skip classification");
    await emitStatus(options, {
      stage: "classify_done",
      message: "未配置目录分类候选，使用基础目录保存。",
    });
  }

  const saveToObsidianTool = createSaveToObsidianTool(env);
  await emitStatus(options, {
    stage: "save_start",
    message: "正在保存到 Obsidian...",
  });
  console.info("[agent] invoking tool=save_to_obsidian");
  const saveResult = (await saveToObsidianTool.invoke({
    title: crawlResult.title,
    source_url: crawlResult.source_url,
    content_markdown: crawlResult.content_markdown,
    author: crawlResult.author ?? undefined,
    source: "WeChat",
    dynamic_folder: dynamicFolder,
  })) as SaveToolResult;
  usedTools.push("save_to_obsidian");
  persistSuccessHistory(crawlResult, saveResult, options?.context);

  console.info("[agent] tool success: save_to_obsidian");
  console.info("[agent] finalize response");
  await emitStatus(options, {
    stage: "save_done",
    message: `保存成功：${saveResult.vault ?? ""}/${saveResult.path ?? "(unknown path)"}`,
  });

  return {
    reply: formatSuccessReply(saveResult),
    usedTools,
  };
}
