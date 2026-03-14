import type { BaseMessage } from "@langchain/core/messages";
import type { AppEnv } from "../config/env.js";
import { createCodexModel } from "./codex.js";
import { createDeepSeekModel } from "./deepseek.js";

type ModelOptions = {
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
};

type InvokableModel = {
  invoke: (messages: BaseMessage[]) => Promise<{ content: unknown }>;
};

export function createAgentModel(env: AppEnv, options: ModelOptions = {}): InvokableModel {
  if (env.agent === "codex") {
    return createCodexModel(env, {
      timeout: options.timeout,
    });
  }
  return createDeepSeekModel(env, options);
}
