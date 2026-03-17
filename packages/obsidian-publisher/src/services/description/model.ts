import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { AppEnv } from "../../config/env.js";
import type { AgentProvider } from "../model.js";
import { createModel } from "../model.js";

type GenerateDescriptionOptions = {
  env: AppEnv;
  provider?: AgentProvider;
  model?: string;
  timeoutMs?: number;
  invokeModel?: (messages: BaseMessage[]) => Promise<{ content: unknown }>;
};

function extractModelText(content: unknown): string {
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
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("")
      .trim();
  }
  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") {
      return text.trim();
    }
  }
  return String(content ?? "").trim();
}

export async function generateDescriptionWithModel(
  markdown: string,
  options: GenerateDescriptionOptions,
): Promise<string> {
  const provider =
    options.provider || options.env.aiSummarizeProvider || options.env.aiProvider || options.env.agent;
  const model =
    options.model || (provider === "deepseek" ? options.env.deepseekModel : options.env.geminiModel);
  const timeoutMs = options.timeoutMs ?? 20000;
  const invoke =
    options.invokeModel ||
    createModel(options.env, {
      task: "summarize",
      provider,
      model,
      timeout: timeoutMs,
      maxTokens: 120,
      temperature: 0,
    }).invoke;

  try {
    const response = await invoke([
      new SystemMessage(
        [
          "Summarize the main idea of the content in one concise sentence.",
          "Use the same language as the content when possible.",
          "Do not include URLs, timestamps, source labels, title labels, or preamble.",
          "Return only the sentence.",
        ].join("\n"),
      ),
      new HumanMessage(markdown.slice(0, 6000)),
    ]);
    const text = extractModelText(response.content);
    if (!text) {
      throw new Error("empty summary response");
    }
    return text;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Description generation failed: ${detail}`);
  }
}

export const __test__ = {
  extractModelText,
};
