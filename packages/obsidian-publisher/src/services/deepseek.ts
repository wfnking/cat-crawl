import { ChatOpenAI } from "@langchain/openai";
import type { AppEnv } from "../config/env.js";

type DeepSeekModelOptions = {
  model?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
};

export function createDeepSeekModel(env: AppEnv, options: DeepSeekModelOptions = {}): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: env.deepseekApiKey || "",
    model: options.model || env.deepseekModel,
    temperature: options.temperature ?? 0,
    maxTokens: options.maxTokens,
    timeout: options.timeout,
    configuration: {
      baseURL: env.deepseekBaseUrl,
    },
  });
}
