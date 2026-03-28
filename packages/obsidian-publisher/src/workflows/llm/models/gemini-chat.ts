import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AppEnv } from "../../../config/env.js";

type GeminiModelOptions = {
  model?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
};

export function createGeminiModel(
  env: AppEnv,
  options: GeminiModelOptions = {},
): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    apiKey: env.geminiApiKey || env.googleApiKey || env.vertexApiKey || "",
    model: options.model || env.geminiModel,
    temperature: options.temperature ?? 0,
    maxOutputTokens: options.maxTokens,
  });
}
