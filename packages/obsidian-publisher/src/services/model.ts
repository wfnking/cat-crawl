import type { BaseMessage } from "@langchain/core/messages";
import type { AppEnv } from "../config/env.js";
import { createDeepSeekModel } from "./deepseek.js";
import { createGeminiModel } from "./gemini-chat.js";

export type AgentProvider = "deepseek" | "gemini";
export type ModelTask = "chat" | "classify" | "summarize";

type ModelOptions = {
  provider?: AgentProvider;
  task?: ModelTask;
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

function resolveModelProvider(env: AppEnv, options: Pick<ModelOptions, "provider" | "task">): AgentProvider {
  if (options.provider) {
    return options.provider;
  }
  if (options.task === "chat" && env.aiChatProvider) {
    return env.aiChatProvider;
  }
  if (options.task === "classify" && env.aiClassifyProvider) {
    return env.aiClassifyProvider;
  }
  if (options.task === "summarize" && env.aiSummarizeProvider) {
    return env.aiSummarizeProvider;
  }
  return env.aiProvider || env.agent;
}

function createProviderModel(
  provider: AgentProvider,
  env: AppEnv,
  options: Omit<ModelOptions, "provider" | "task">,
): InvokableModel {
  if (provider === "gemini") {
    const model = createGeminiModel(env, options);
    return {
      invoke(messages) {
        return model.invoke(messages);
      },
    };
  }
  const model = createDeepSeekModel(env, options);
  return {
    invoke(messages) {
      return model.invoke(messages);
    },
  };
}

export function createModel(env: AppEnv, options: ModelOptions = {}): InvokableModel {
  const provider = resolveModelProvider(env, options);
  const model = createProviderModel(provider, env, options);
  return {
    invoke(messages) {
      return withTimeout(model.invoke(messages), options.timeout);
    },
  };
}

export function createAgentModel(env: AppEnv, options: ModelOptions = {}): InvokableModel {
  return createModel(env, options);
}

export const __test__ = {
  resolveModelProvider,
};
