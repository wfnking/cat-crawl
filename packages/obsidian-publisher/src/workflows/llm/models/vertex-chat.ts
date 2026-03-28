import { ChatVertexAI } from "@langchain/google-vertexai";
import { createLogger } from "@cat-crawl/core";
import type { AppEnv } from "../../../config/env.js";

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
  const logger = createLogger();
  if (env.vertexApiKey || env.googleApiKey || env.geminiApiKey) {
    logger.warn(
      "[vertex] API key is configured but Vertex provider uses ADC/OAuth credentials; key-based auth is ignored.",
    );
  }
  if (env.vertexProject && !process.env.GOOGLE_CLOUD_PROJECT && !process.env.GCLOUD_PROJECT) {
    process.env.GOOGLE_CLOUD_PROJECT = env.vertexProject;
  }

  return new ChatVertexAI({
    model: options.model || env.geminiModel,
    temperature: options.temperature ?? 0,
    maxOutputTokens: options.maxTokens,
    location: env.vertexLocation,
    endpoint: env.vertexEndpoint,
  });
}
