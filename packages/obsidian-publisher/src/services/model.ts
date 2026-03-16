import type { BaseMessage } from "@langchain/core/messages";
import type { AppEnv } from "../config/env.js";
import { createDeepSeekModel } from "./deepseek.js";
import { createGeminiModel } from "./gemini-chat.js";

type ModelOptions = {
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
};

type InvokableModel = {
  invoke: (messages: BaseMessage[]) => Promise<{ content: unknown }>;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`model invoke timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

export function createAgentModel(env: AppEnv, options: ModelOptions = {}): InvokableModel {
  if (env.agent === "gemini") {
    const model = createGeminiModel(env, options);
    return {
      invoke(messages) {
        return withTimeout(model.invoke(messages), options.timeout);
      },
    };
  }
  return createDeepSeekModel(env, options);
}
