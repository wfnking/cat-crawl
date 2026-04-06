import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { AppEnv, ObsidianFolderOption } from "../../config/env.js";
import { createModel } from "./models/index.js";

export type FolderClassificationParsedResult = {
  folder?: string;
} | null;

export type FolderClassificationMessage = {
  content?: unknown;
};

export type FolderClassificationResult = {
  folder: string;
  raw?: unknown;
  parsed?: FolderClassificationParsedResult;
  systemPrompt: string;
  userPrompt: string;
};

export type FolderClassificationInput = {
  env: AppEnv;
  baseFolder: string;
  title: string;
  sourceUrl: string;
  description?: string;
  contentPreview: string;
  candidates: ObsidianFolderOption[];
};

type GenerateFolderClassificationOptions = {
  invokeModel?: (messages: BaseMessage[]) => Promise<FolderClassificationMessage>;
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

function parseFolderClassification(text: string): FolderClassificationParsedResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (typeof parsed.folder === "string" && parsed.folder.trim()) {
        return { folder: parsed.folder.trim() };
      }
    }
  } catch {
    // fall through to plain text fallback
  }

  return { folder: trimmed };
}

export function buildSystemPrompt(): string {
  return [
    "你是 Obsidian 目录分类器。",
    "你的任务是从候选目录中选出最合适的一个保存目录。",
    "只能返回候选列表中的 folder 原文，禁止自造路径。",
    "不要返回 JSON，不要解释，不要代码块。",
    "如果没把握，只返回空字符串。",
  ].join("\n");
}

export function buildUserPrompt(input: {
  baseFolder: string;
  title: string;
  sourceUrl: string;
  description?: string;
  contentPreview: string;
  candidates: ObsidianFolderOption[];
}): string {
  const candidateText = input.candidates
    .map((item, index) => `${index + 1}. ${item.folder} :: ${item.description || "(无描述)"}`)
    .join("\n");

  return [
    `Base Folder: ${input.baseFolder}`,
    "",
    "Candidates:",
    candidateText,
    "",
    `Title: ${input.title}`,
    `Source: ${input.sourceUrl}`,
    input.description ? `Description: ${input.description}` : "",
    "",
    "Content Preview:",
    input.contentPreview,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildModelOptions(overrides: Partial<{
  maxTokens: number;
  timeout: number;
  temperature: number;
}> = {}): { maxTokens: number; timeout: number; temperature: number } {
  return {
    maxTokens: overrides.maxTokens ?? 200,
    timeout: overrides.timeout ?? 20000,
    temperature: overrides.temperature ?? 0,
  };
}

export async function generateFolderClassification(
  input: FolderClassificationInput,
  options: GenerateFolderClassificationOptions = {},
): Promise<FolderClassificationResult> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);
  const modelOptions = buildModelOptions();
  const provider = input.env.aiClassifyProvider || input.env.aiProvider || input.env.agent;
  const invoke =
    options.invokeModel ||
    createModel(input.env, {
      task: "classify",
      provider,
      maxTokens: modelOptions.maxTokens,
      timeout: modelOptions.timeout,
      temperature: modelOptions.temperature,
    }).invoke;

  const response = await invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]);
  const text = extractModelText(response.content);
  const parsed = parseFolderClassification(text);
  if (!parsed?.folder) {
    throw new Error("invalid folder classification response");
  }

  return {
    folder: parsed.folder,
    raw: response,
    parsed,
    systemPrompt,
    userPrompt,
  };
}

export const __test__ = {
  buildSystemPrompt,
  buildUserPrompt,
  buildModelOptions,
  extractModelText,
  parseFolderClassification,
};
