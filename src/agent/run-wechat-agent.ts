import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { loadEnv } from "../config/env.js";
import { createDeepSeekModel } from "../services/deepseek.js";
import { crawlWechatArticleTool } from "../tools/crawl-wechat-article.js";
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

export type AgentRunOptions = {
  onStatus?: (status: AgentStatusUpdate) => void | Promise<void>;
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
    "",
    "直接发公众号链接给我即可开始处理。",
  ].join("\n");
}

function shouldReturnCapabilityReply(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) return true;
  return /(可以做什么|能做什么|你能做什么|怎么用|help|what can you do|功能)/i.test(text);
}

async function chatForNonWechatInput(userInput: string, env: ReturnType<typeof loadEnv>): Promise<string> {
  if (shouldReturnCapabilityReply(userInput)) {
    return buildCapabilityReply();
  }

  const chatModel = createDeepSeekModel(env, {
    maxTokens: 300,
    timeout: 25000,
  });
  try {
    console.info("[agent] invoking model for non-wechat small chat");
    const message = await chatModel.invoke([
      new SystemMessage(
        [
          "你是 cat-crawl 的助手。",
          "你可以做简短聊天，但核心能力是处理微信公众号链接并保存到 Obsidian。",
          "回答保持简洁、友好、中文。",
        ].join("\n"),
      ),
      new HumanMessage(userInput),
    ]);
    const reply = normalizeModelText(message.content);
    return reply || buildCapabilityReply();
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
    "Output JSON only: {\"dynamic_folder\":\"...\"}",
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
      message: "检测到非公众号链接，进入简短对话模式。",
    });
    const reply = await chatForNonWechatInput(userInput, env);
    return {
      reply,
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
