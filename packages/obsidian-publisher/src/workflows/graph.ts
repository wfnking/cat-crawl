import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createLogger } from "@cat-crawl/core";
import { createModel } from "./llm/models/index.js";
import {
  createQuerySuccessHistoryTool,
  type QuerySuccessHistoryResult,
} from "../ingest/history/query-success-history.js";
import { selectVideoHandler } from "../ingest/video/registry.js";
import { appendConversationRound, getRecentConversationMessages } from "./llm/memory/chat-memory.js";
import {
  parseHistoryIntentFromText,
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
  resolvedVideoSource: Annotation<AgentGraphState["resolvedVideoSource"]>(),
  ingestResult: Annotation<AgentGraphState["ingestResult"]>(),
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
    resolvedVideoSource: null,
    ingestResult: null,
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
    "3. 保存到配置里的 Obsidian 目录。",
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

function buildContentPreview(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("- Source:") && !line.startsWith("- Author:"));
  const merged = lines.join(" ").replace(/\s+/g, " ").trim();
  return merged.slice(0, 1800);
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
    return reply || buildCapabilityReply();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[agent] non-wechat chat fallback failed: ${detail}`);
    return buildCapabilityReply();
  }
}

function formatSuccessReply(subject: string, saveResult: SaveToolResult): string {
  const vault = saveResult.vault ?? "";
  const path = saveResult.path ?? "";
  const fullPath = vault && path ? `${vault}/${path}` : path || "(unknown path)";
  const lines = [`${subject}已成功保存到 Obsidian！`];
  lines.push(`保存路径：\`${fullPath}\``);
  return lines.join("\n\n");
}

function formatExistingRecordReply(record: { title: string; vault: string; path: string }): string {
  return `该内容之前已经帮您处理并保存过，无需重复抓取。\n\n历史标题：${record.title}\n保存路径：\`${record.vault}/${record.path}\`\n\n如果你确认还要重新抓取，直接回复“继续抓取”就行。`;
}

function isSupportedVideoUrl(url: string): boolean {
  try {
    return selectVideoHandler(url).name !== "file";
  } catch {
    return false;
  }
}

function createHistoryQueryTool(runtime: AgentRuntime) {
  return createQuerySuccessHistoryTool(runtime.deps.historyStoreFactory());
}

function extractArticleUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s)]+/i);
  return matches?.[0] ?? null;
}

function findLatestUrlFromMemory(
  messages: ReturnType<typeof getRecentConversationMessages>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const url = extractArticleUrl(messages[index]?.content ?? "");
    if (url) {
      return url;
    }
  }
  return null;
}

function createParseInputNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    await emitStatus(runtime, {
      stage: "received",
      message: `已收到请求：${state.userInput.slice(0, 80)}`,
    });

    const url = extractArticleUrl(state.userInput);
    const memoryMessages = getRecentConversationMessages(runtime.options?.context);
    const recentUrl = url ? null : findLatestUrlFromMemory(memoryMessages);
    if (!url) {
      await emitStatus(runtime, {
        stage: "small_chat",
        message: "检测到非文章链接，先尝试历史查询意图，否则进入简短对话模式。",
      });

      if (recentUrl && shouldForceRecrawlFromText(state.userInput)) {
        logger.info(`[agent] reuse recent source from memory: ${recentUrl}`);
        return {
          mode: "content_request",
          url: recentUrl,
          forceRecrawl: true,
        };
      }

      const historyIntent = parseHistoryIntentFromText(state.userInput);
      if (historyIntent.shouldQuery) {
        return {
          mode: "history_query",
          historyIntent,
        };
      }

      if (shouldReturnCapabilityReply(state.userInput)) {
        return {
          mode: "small_chat",
          reply: buildCapabilityReply(),
        };
      }

      return {
        mode: "small_chat",
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
    const sourceUrl =
      state.resolvedVideoSource?.sourceUrl?.trim() || state.ingestResult?.source_url?.trim();
    if (!sourceUrl || state.forceRecrawl) {
      if (state.forceRecrawl && sourceUrl) {
        logger.info(`[agent] force recrawl requested for url: ${sourceUrl}`);
      }
      return { existingRecord: null };
    }

    const existingRecord = await runtime.deps.existingChecker(sourceUrl);
    if (existingRecord) {
      logger.info(`[agent] found existing record for url: ${sourceUrl}`);
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

function createResolveVideoSourceNode(runtime: AgentRuntime) {
  return async (state: AgentGraphStateShape): Promise<Partial<AgentGraphStateShape>> => {
    if (!state.url) {
      return {};
    }

    await emitStatus(runtime, {
      stage: "crawl_start",
      message: `开始解析视频来源：${state.url}`,
    });
    logger.info("[agent] invoking tool=resolve_video_source");

    const resolveVideoTool = runtime.deps.buildResolveVideoTool(runtime.env);
    const resolvedVideoSource = await resolveVideoTool.invoke({
      source: state.url,
    });

    logger.info("[agent] tool success: resolve_video_source");
    return {
      resolvedVideoSource,
      usedTools: [...state.usedTools, "resolve_video_source"],
      replySubject: "视频转写",
    };
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
    const crawlSummary = buildContentPreview(ingestResult.content_markdown).slice(0, 120);

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
    if (!state.url || !state.resolvedVideoSource) {
      return {};
    }

    await emitStatus(runtime, {
      stage: "crawl_start",
      message: `开始转写视频：${state.resolvedVideoSource.sourceUrl}`,
    });
    logger.info("[agent] invoking tool=transcribe_video");

    const transcribeTool = runtime.deps.buildTranscribeTool(runtime.env);
    const ingestResult = await transcribeTool.invoke({
      source: state.url,
      resolved_adapter: state.resolvedVideoSource.adapter,
      resolved_source_url: state.resolvedVideoSource.sourceUrl,
      resolved_media_path: state.resolvedVideoSource.mediaPath,
      resolved_transcript_path: state.resolvedVideoSource.transcriptPath,
      resolved_title: state.resolvedVideoSource.title,
      resolved_author: state.resolvedVideoSource.author,
      resolved_published: state.resolvedVideoSource.published,
    });

    return {
      ingestResult,
      usedTools: [...state.usedTools, "transcribe_video"],
      replySubject: "视频转写",
    };
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
          description:
            state.contentType === "video" ? state.ingestResult.description ?? undefined : undefined,
          description_source:
            state.contentType === "article" ? state.ingestResult.content_markdown : undefined,
          tags: state.contentType === "video" ? state.ingestResult.tags : undefined,
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
    .addNode("route_content", routeContentNode)
    .addNode("resolve_video_source", createResolveVideoSourceNode(runtime))
    .addNode("crawl_article", createCrawlArticleNode(runtime))
    .addNode("transcribe_video", createTranscribeVideoNode(runtime))
    .addNode("check_existing_save", createCheckExistingSaveNode(runtime))
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
      return "route_content";
    })
    .addEdge("query_history", "build_reply")
    .addConditionalEdges("route_content", (state) => {
      return state.contentType === "video" ? "resolve_video_source" : "crawl_article";
    })
    .addEdge("resolve_video_source", "check_existing_save")
    .addEdge("crawl_article", "check_existing_save")
    .addConditionalEdges("check_existing_save", (state) => {
      if (state.existingRecord) {
        return "build_reply";
      }
      return state.contentType === "video" ? "transcribe_video" : "save_note";
    })
    .addEdge("transcribe_video", "save_note")
    .addEdge("save_note", "build_reply")
    .addEdge("build_reply", END)
    .compile();
}

export async function runAgentGraph(userInput: string, runtime: AgentRuntime) {
  const graph = createAgentGraph(runtime);
  const finalState = await graph.invoke(createEmptyAgentState(userInput));
  if (finalState.reply?.trim()) {
    appendConversationRound(runtime.options?.context, userInput, finalState.reply);
  }
  return finalState;
}
