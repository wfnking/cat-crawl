import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { AppEnv } from "../../config/env.js";
import type { AgentProvider } from "./models/index.js";
import { createModel } from "./models/index.js";

export type TitleDescriptionResult = {
  title: string;
  description: string;
};

type GenerateTitleDescriptionOptions = {
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

function parseJsonResult(text: string): TitleDescriptionResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (typeof parsed.title === "string" && typeof parsed.description === "string") {
      return {
        title: parsed.title.trim(),
        description: parsed.description.trim(),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function generateTitleAndDescription(
  title: string,
  contentMarkdown: string,
  options: GenerateTitleDescriptionOptions,
): Promise<TitleDescriptionResult> {
  const provider =
    options.provider ||
    options.env.aiSummarizeProvider ||
    options.env.aiProvider ||
    options.env.agent;
  const model =
    options.model || (provider === "openai" ? options.env.openaiModel : options.env.geminiModel);
  const timeoutMs = options.timeoutMs ?? 20000;
  const invoke =
    options.invokeModel ||
    createModel(options.env, {
      task: "summarize",
      provider,
      model,
      timeout: timeoutMs,
      maxTokens: 1500,
      temperature: 0,
    }).invoke;

  const truncatedContent = contentMarkdown.slice(0, 1000);

  try {
    const response = await invoke([
      new SystemMessage(
        [
          "You are an article metadata generator. Given a title and content, return JSON:",
          '{"title":"...","description":"..."}',
          "",
          "Title rules:",
          "- If the original title already clearly describes the article, keep it unchanged",
          "- If the original title is a username, platform name, or not descriptive enough (e.g. 'XXX on X'), generate a concise new title based on the content",
          "- IMPORTANT: Use the SAME language as the article content (Chinese content → Chinese title, English content → English title, etc.)",
          "",
          "Description rules:",
          "- Summarize the core idea in one sentence, max 200 characters",
          "- IMPORTANT: Use the SAME language as the article content",
          "- Do not include URLs, timestamps, or metadata labels",
          "",
          "Return JSON only, no other text.",
        ].join("\n"),
      ),
      new HumanMessage([`Original title: ${title}`, "", "Content:", truncatedContent].join("\n")),
    ]);
    const text = extractModelText(response.content);
    const result = parseJsonResult(text);
    if (!result || !result.title || !result.description) {
      throw new Error("invalid model response");
    }
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Title & description generation failed: ${detail}`);
  }
}
