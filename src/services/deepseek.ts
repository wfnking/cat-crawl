import { ChatOpenAI } from "@langchain/openai";
import type { AppEnv } from "../config/env.js";

export function createDeepSeekModel(env: AppEnv): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: env.deepseekApiKey,
    model: env.deepseekModel,
    temperature: 0,
    configuration: {
      baseURL: env.deepseekBaseUrl,
    },
  });
}
