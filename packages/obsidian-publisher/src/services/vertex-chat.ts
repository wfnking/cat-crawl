import { ChatVertexAI } from "@langchain/google-vertexai";
import type { AppEnv } from "../config/env.js";

type VertexModelOptions = {
  model?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
};

export function createVertexModel(
  env: AppEnv,
  options: VertexModelOptions = {},
): ChatVertexAI {
  return new ChatVertexAI({
    apiKey: env.vertexApiKey || env.googleApiKey || env.geminiApiKey || "",
    model: options.model || env.geminiModel,
    temperature: options.temperature ?? 0,
    maxOutputTokens: options.maxTokens,
    location: env.vertexLocation,
    endpoint: env.vertexEndpoint,
  });
}
