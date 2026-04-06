import type { BaseMessage } from "@langchain/core/messages";
import { createLogger } from "@cat-crawl/core";
import type { AppEnv } from "../../../config/env.js";
import { createOpenAIModel } from "./openai.js";
import { createGeminiModel } from "./gemini-chat.js";
import { createVertexModel } from "./vertex-chat.js";

export type AgentProvider = "openai" | "gemini" | "vertex";
export type ModelTask = "chat" | "classify" | "summarize";

type ModelOptions = {
  provider?: AgentProvider;
  task?: ModelTask;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
};

type InvokableModel = {
  invoke: (messages: BaseMessage[]) => Promise<{ content: unknown }>;
};
const logger = createLogger();

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

function resolveModelProvider(
  env: AppEnv,
  options: Pick<ModelOptions, "provider" | "task">,
): AgentProvider {
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
  const modelOptions = {
    model: options.model,
    maxTokens: options.maxTokens,
    timeout: options.timeout,
    temperature: options.temperature,
  };

  if (provider === "gemini" || provider === "vertex") {
    const createGoogleModel = provider === "gemini" ? createGeminiModel : createVertexModel;
    const model = createGoogleModel(env, modelOptions);
    return {
      invoke(messages) {
        return model.invoke(messages);
      },
    };
  }

  const model = createOpenAIModel(env, {
    ...modelOptions,
    apiKey: env.openaiApiKey,
    baseUrl: env.openaiBaseUrl,
    defaultModel: env.openaiModel,
  });
  return {
    invoke(messages) {
      return model.invoke(messages);
    },
  };
}

export function createModel(env: AppEnv, options: ModelOptions = {}): InvokableModel {
  const provider = resolveModelProvider(env, options);
  if (provider === "gemini") {
    logger.info(
      `[model] task=${options.task || "default"} provider=gemini using=${env.geminiApiKeySource || "none"} model=${options.model || env.geminiModel}`,
    );
  } else if (provider === "vertex") {
    const location = env.vertexLocation || "default";
    logger.info(
      `[model] task=${options.task || "default"} provider=vertex auth=ADC/OAuth model=${options.model || env.geminiModel} location=${location}`,
    );
  } else {
    logger.info(
      `[model] task=${options.task || "default"} provider=openai model=${options.model || env.openaiModel}`,
    );
  }
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
