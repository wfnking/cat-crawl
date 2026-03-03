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

export async function runWechatAgent(userInput: string): Promise<AgentRunResult> {
  console.info("[agent] start processing input");
  const env = loadEnv();
  const usedTools: string[] = [];

  const url = extractWechatUrl(userInput);
  if (!url) {
    return {
      reply: "当前仅支持微信公众号文章链接。",
      usedTools,
    };
  }

  console.info("[agent] invoking tool=crawl_wechat_article");
  const crawlResult = (await crawlWechatArticleTool.invoke({ url })) as CrawlToolResult;
  usedTools.push("crawl_wechat_article");
  console.info("[agent] tool success: crawl_wechat_article");

  let dynamicFolder = "";
  if (env.obsidianDynamicFolders.length > 0) {
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
  } else {
    console.info("[agent] dynamic folder options empty, skip classification");
  }

  const saveToObsidianTool = createSaveToObsidianTool(env);
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

  return {
    reply: formatSuccessReply(saveResult),
    usedTools,
  };
}
