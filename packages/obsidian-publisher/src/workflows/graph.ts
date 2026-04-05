import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createLogger } from "@cat-crawl/core";
import { createModel } from "./llm/models/index.js";
import type { IngestContentResult } from "../ingest/types.js";
import {
  describeDynamicFolder,
  resolveDynamicFolderOptions,
} from "../ingest/folder-options.js";
import {
  createQuerySuccessHistoryTool,
  type QuerySuccessHistoryResult,
} from "../ingest/history/query-success-history.js";
import { selectVideoHandler } from "../ingest/video/registry.js";
import { appendConversationRound, getRecentConversationMessages } from "./llm/memory/chat-memory.js";
import {
  parseHistoryIntentFromModelOutput,
  parseHistoryIntentFromText,
  pickPolicyFolder,
  shouldForceRecrawlFromText,
} from "./policies.js";
import type {
  AgentGraphState,
  AgentRuntime,
  AgentStatusUpdate,
  SaveToolResult,
} from "./types.js";

const logger = createLogger();

const AgentGraphStateAnnotation = Annotation.Root({
  userInput: Annotation<AgentGraphState["userInput"]>(),
  usedTools: Annotation<AgentGraphState["usedTools"]>(),
  mode: Annotation<AgentGraphState["mode"]>(),
  url: Annotation<AgentGraphState["url"]>(),
  forceRecrawl: Annotation<AgentGraphState["forceRecrawl"]>(),
  historyIntent: Annotation<AgentGraphState["historyIntent"]>(),
  historyResult: Annotation<AgentGraphState["historyResult"]>(),
  existingRecord: Annotation<AgentGraphState["existingRecord"]>(),
  contentType: Annotation<AgentGraphState["contentType"]>(),
  ingestResult: Annotation<AgentGraphState["ingestResult"]>(),
  dynamicFolder: Annotation<AgentGraphState["dynamicFolder"]>(),
  saveResult: Annotation<AgentGraphState["saveResult"]>(),
  reply: Annotation<AgentGraphState["reply"]>(),
  replySubject: Annotation<AgentGraphState["replySubject"]>(),
  error: Annotation<AgentGraphState["error"]>(),
});

type AgentGraphStateShape = typeof AgentGraphStateAnnotation.State;

function createEmptyAgentState(userInput: string): AgentGraphState {
  return {
    userInput,
    usedTools: [],
    mode: "small_chat",
    url: null,
    forceRecrawl: false,
    historyIntent: null,
    historyResult: null,
    existingRecord: null,
    contentType: null,
    ingestResult: null,
    dynamicFolder: "",
    saveResult: null,
    reply: "",
    replySubject: null,
    error: null,
  };
}

async function emitStatus(runtime: AgentRuntime, status: AgentStatusUpdate): Promise<void> {
  if (!runtime.options?.onStatus) {
    return;
  }

  try {
    await runtime.options.onStatus(status);
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
  if (!text) {
    return true;
  }
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


export function normalizeModelText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("")
      .trim();
  }
  return String(content ?? "").trim();
}


async function detectHistoryIntent(userInput: string, runtime: AgentRuntime) {
  const fallback = parseHistoryIntentFromText(userInput);
  const classifyModel = createModel(runtime.env, {
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
          '{"should_query":boolean,"scope":"all|today","tag":"可选标签"}',
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

async function chatForNonWechatInput(userInput: string, runtime: AgentRuntime): Promise<string> {
  if (shouldReturnCapabilityReply(userInput)) {
    return buildCapabilityReply();
  }

  const chatModel = createModel(runtime.env, {
    task: "chat",
    maxTokens: 300,
    timeout: 25000,
  });

  try {
    const memoryMessages = getRecentConversationMessages(runtime.options?.context);
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
    appendConversationRound(runtime.options?.context, userInput, finalReply);
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
      if (!picked) {
        return "";
      }
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

function canUseClassificationModel(runtime: AgentRuntime): boolean {
  const provider = runtime.env.aiClassifyProvider || runtime.env.aiProvider || runtime.env.agent;
  if (provider === "openai") {
    return Boolean(runtime.env.openaiApiKey?.trim());
  }
  if (provider === "gemini") {
    return Boolean(runtime.env.geminiApiKey?.trim());
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

function formatExistingRecordReply(record: { title: string; vault: string; path: string }): string {
  return `该内容之前已经帮您处理并保存过，无需重复抓取。\n\n历史标题：${record.title}\n保存路径：\`${record.vault}/${record.path}\``;
}

function isSupportedVideoUrl(url: string): boolean {
  try {
    return selectVideoHandler(url).name !== "file";
  } catch {
    return false;
  }
}

async function classifyDynamicFolder(
  crawlResult: IngestContentResult,
  runtime: AgentRuntime,
): Promise<string> {
  const summary = buildClassificationSummary(crawlResult.content_markdown);
  const dynamicFolderOptions = await resolveDynamicFolderOptions(runtime.env);
  const policyOptions = dynamicFolderOptions.length > 0 ? dynamicFolderOptions : ["OPC"];
  const policyFolder = pickPolicyFolder({
    title: crawlResult.title,
    summary,
    options: policyOptions,
  });

  if (policyFolder) {
    logger.info(`[agent] dynamic_folder policy selected=${policyFolder}`);
    return policyFolder;
  }

  if (dynamicFolderOptions.length === 0) {
    logger.info("[agent] dynamic folder options empty, skip classification");
    return "";
  }

  if (!canUseClassificationModel(runtime)) {
    logger.info("[agent] classification model unavailable (missing auth), skip model classify");
    return "";
  }

  logger.info("[agent] preparing summarized context for dynamic folder classification");
  try {
    const classifierModel = createModel(runtime.env, {
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
    const dynamicFolder = pickDynamicFolder(modelOutput, dynamicFolderOptions);
    logger.info(`[agent] dynamic_folder selected=${dynamicFolder || "(empty)"}`);
    return dynamicFolder;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[agent] dynamic_folder classify failed, fallback base folder msg=${msg}`);
    return "";
  }
}

function createHistoryQueryTool(runtime: AgentRuntime) {
  return createQuerySuccessHistoryTool(runtime.deps.historyStoreFactory());
}

function extractArticleUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s)]+/i);
  return matches?.[0] ?? null;
}

function createParseInputNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    await emitStatus(runtime, {
      stage: "received",
      message: `已收到请求：${state.userInput.slice(0, 80)}`,
    });

    const url = extractArticleUrl(state.userInput);
    if (!url) {
      await emitStatus(runtime, {
        stage: "small_chat",
        message: "检测到非文章链接，先尝试历史查询意图，否则进入简短对话模式。",
      });

      const historyIntent = await detectHistoryIntent(state.userInput, runtime);
      if (historyIntent.shouldQuery) {
        return {
          mode: "history_query",
          historyIntent,
        };
      }

      if (!shouldReturnCapabilityReply(state.userInput)) {
        return {
          mode: "small_chat",
        };
      }

      return {
        mode: "small_chat",
        reply: buildCapabilityReply(),
      };
    }

    return {
      mode: "content_request",
      url,
      forceRecrawl: shouldForceRecrawlFromText(state.userInput),
    };
  };
}

function createQueryHistoryNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    const intent = state.historyIntent;
    if (!intent?.shouldQuery) {
      return {};
    }

    const tool = createHistoryQueryTool(runtime);
    const historyResult = await tool.invoke({
      scope: intent.scope,
      tag: intent.tag,
      limit: 20,
    });

    return {
      historyResult,
      usedTools: [...state.usedTools, "query_success_history"],
      reply: formatHistoryReply(historyResult),
    };
  };
}

function createCheckExistingSaveNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    if (!state.url || state.forceRecrawl) {
      if (state.forceRecrawl && state.url) {
        logger.info(`[agent] force recrawl requested for url: ${state.url}`);
      }
      return { existingRecord: null };
    }

    const existingRecord = await runtime.deps.existingChecker(state.url);
    if (existingRecord) {
      logger.info(`[agent] found existing record for url: ${state.url}`);
      await emitStatus(runtime, {
        stage: "save_done",
        message: `该内容之前已经帮您处理并保存过，无需重复抓取。\n\n历史标题：${existingRecord.title}\n保存路径：${existingRecord.vault}/${existingRecord.path}`,
      });
    }

    return { existingRecord };
  };
}

async function routeContentNode(
  state: AgentGraphStateShape,
): Promise<Partial<AgentGraphStateShape>> {
  if (!state.url) {
    return {};
  }

  return {
    contentType: isSupportedVideoUrl(state.url) ? "video" : "article",
  };
}

function createCrawlArticleNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    if (!state.url) {
      return {};
    }

    await emitStatus(runtime, {
      stage: "crawl_start",
      message: `开始抓取文章：${state.url}`,
    });
    logger.info("[agent] invoking tool=crawl_web_article");

    const ingestResult = await runtime.deps.articleTool.invoke({ url: state.url });
    const crawlSummary = buildClassificationSummary(ingestResult.content_markdown).slice(0, 120);

    logger.info("[agent] tool success: crawl_web_article");
    await emitStatus(runtime, {
      stage: "crawl_done",
      message: [
        "爬取成功。",
        `标题：${ingestResult.title}`,
        `作者：${ingestResult.author ?? "Unknown"}`,
        `发布时间：${ingestResult.published ?? "Unknown"}`,
        `摘要：${crawlSummary || "(空)"}`,
      ].join("\n"),
    });

    return {
      ingestResult,
      usedTools: [...state.usedTools, "crawl_web_article"],
      replySubject: "文章",
    };
  };
}

function createTranscribeVideoNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    if (!state.url) {
      return {};
    }

    await emitStatus(runtime, {
      stage: "crawl_start",
      message: `开始提取视频并转写：${state.url}`,
    });
    logger.info("[agent] invoking tool=transcribe_video");

    const transcribeTool = runtime.deps.buildTranscribeTool(runtime.env);
    const ingestResult = await transcribeTool.invoke({
      source: state.url,
    });

    return {
      ingestResult,
      usedTools: [...state.usedTools, "transcribe_video"],
      replySubject: "视频转写",
    };
  };
}

function createClassifyFolderNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    if (!state.ingestResult) {
      return {};
    }

    await emitStatus(runtime, {
      stage: "classify_start",
      message: "正在根据内容选择目录分类...",
    });

    const dynamicFolder = await classifyDynamicFolder(state.ingestResult, runtime);

    await emitStatus(runtime, {
      stage: "classify_done",
      message: `目录分类完成：${dynamicFolder || "(未命中，保存到基础目录)"}`,
    });

    return { dynamicFolder };
  };
}

function createSaveNoteNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    const saveContent = state.ingestResult
      ? {
          title: state.ingestResult.title,
          source_url: state.ingestResult.source_url,
          content_markdown: state.ingestResult.content_markdown,
          author: state.ingestResult.author ?? undefined,
          published: state.ingestResult.published ?? undefined,
          description: state.ingestResult.description ?? undefined,
          tags: state.contentType === "video" ? state.ingestResult.tags : undefined,
          dynamic_folder: state.dynamicFolder || state.ingestResult.dynamic_folder,
          source: state.contentType === "video" ? "Video" : "WeChat",
        }
      : null;

    if (!saveContent) {
      return {};
    }

    const saveToObsidianTool = runtime.deps.buildSaveTool(runtime.env);
    await emitStatus(runtime, {
      stage: "save_start",
      message: "正在保存到 Obsidian...",
    });
    logger.info("[agent] invoking tool=save_to_obsidian");

    const saveResult = await saveToObsidianTool.invoke(saveContent);

    if (state.ingestResult) {
      runtime.deps.persistHistory(state.ingestResult, saveResult, runtime.options?.context);
    }

    logger.info("[agent] tool success: save_to_obsidian");
    await emitStatus(runtime, {
      stage: "save_done",
      message: `保存成功：${saveResult.vault ?? ""}/${saveResult.path ?? "(unknown path)"}`,
    });

    return {
      saveResult,
      usedTools: [...state.usedTools, "save_to_obsidian"],
    };
  };
}

function createBuildReplyNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    if (state.existingRecord) {
      return {
        reply: formatExistingRecordReply(state.existingRecord),
      };
    }

    if (state.historyResult) {
      return {
        reply: formatHistoryReply(state.historyResult),
      };
    }

    if (state.reply) {
      return {};
    }

    if (state.mode === "small_chat") {
      return {
        reply: await chatForNonWechatInput(state.userInput, runtime),
      };
    }

    if (state.saveResult && state.replySubject) {
      return {
        reply: formatSuccessReply(state.replySubject, state.saveResult),
      };
    }

    return {
      reply: "处理失败：未生成可返回结果。",
    };
  };
}

export function createAgentGraph(runtime: AgentRuntime) {
  return new StateGraph(AgentGraphStateAnnotation)
    .addNode("parse_input", createParseInputNode(runtime))
    .addNode("query_history", createQueryHistoryNode(runtime))
    .addNode("check_existing_save", createCheckExistingSaveNode(runtime))
    .addNode("route_content", routeContentNode)
    .addNode("crawl_article", createCrawlArticleNode(runtime))
    .addNode("transcribe_video", createTranscribeVideoNode(runtime))
    .addNode("classify_folder", createClassifyFolderNode(runtime))
    .addNode("save_note", createSaveNoteNode(runtime))
    .addNode("build_reply", createBuildReplyNode(runtime))
    .addEdge(START, "parse_input")
    .addConditionalEdges("parse_input", (state) => {
      if (state.mode === "history_query") {
        return "query_history";
      }
      if (state.mode === "small_chat") {
        return "build_reply";
      }
      return "check_existing_save";
    })
    .addEdge("query_history", "build_reply")
    .addConditionalEdges("check_existing_save", (state) => {
      return state.existingRecord ? "build_reply" : "route_content";
    })
    .addConditionalEdges("route_content", (state) => {
      return state.contentType === "video" ? "transcribe_video" : "crawl_article";
    })
    .addEdge("transcribe_video", "classify_folder")
    .addEdge("crawl_article", "classify_folder")
    .addEdge("classify_folder", "save_note")
    .addEdge("save_note", "build_reply")
    .addEdge("build_reply", END)
    .compile();
}

export async function runAgentGraph(userInput: string, runtime: AgentRuntime) {
  const graph = createAgentGraph(runtime);
  return graph.invoke(createEmptyAgentState(userInput));
}
