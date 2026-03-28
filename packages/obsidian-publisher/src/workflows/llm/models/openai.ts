import { ChatOpenAI } from "@langchain/openai";
import type { AppEnv } from "../../../config/env.js";

type OpenAIModelOptions = {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
};

export function createOpenAIModel(env: AppEnv, options: OpenAIModelOptions = {}): ChatOpenAI {
  const apiKey = options.apiKey ?? env.openaiApiKey ?? "";
  const baseURL = options.baseUrl ?? env.openaiBaseUrl;
  const defaultModel = options.defaultModel ?? env.openaiModel;
  return new ChatOpenAI({
    apiKey,
    model: options.model || defaultModel,
    temperature: options.temperature ?? 0,
    maxTokens: options.maxTokens,
    timeout: options.timeout,
    configuration: {
      baseURL,
    },
  });
}
