import { HumanMessage, SystemMessage } from "@langchain/core/messages";
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

export async function generateFolderClassification(
  input: FolderClassificationInput,
): Promise<string> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);

  const modelOptions = {
    maxTokens: 200,
    timeout: 20000,
    temperature: 0,
  };
  const provider = input.env.aiClassifyProvider || input.env.aiProvider || input.env.agent;
  const model = createModel(input.env, {
    task: "classify",
    provider,
    maxTokens: modelOptions.maxTokens,
    timeout: modelOptions.timeout,
    temperature: modelOptions.temperature,
  });

  const { content } = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  console.log('content from folder', )

  return content as string;
}
