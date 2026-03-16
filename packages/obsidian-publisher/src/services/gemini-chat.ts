import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AppEnv } from "../config/env.js";

type GeminiModelOptions = {
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
};

export function createGeminiModel(
  env: AppEnv,
  options: GeminiModelOptions = {},
): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    apiKey: env.geminiApiKey || "",
    model: env.geminiModel,
    temperature: options.temperature ?? 0,
    maxOutputTokens: options.maxTokens,
  });
}
