import { createLogger } from "@cat-crawl/core";
import { loadEnv } from "../config/env.js";
import { getHistoryStore } from "../ingest/history/history-store.js";
import { crawlWebArticleTool } from "./tools/crawl-web-article.js";
import { createResolveVideoSourceTool } from "./tools/resolve-video-source.js";
import { createSaveToObsidianTool } from "./tools/save-to-obsidian.js";
import { createTranscribeVideoTool } from "./tools/transcribe-video.js";
import { findExistingSavedRecordByUrl } from "../ingest/history/existing-save-check.js";
import { persistSuccessHistory } from "../ingest/history/persist-success-history.js";
import { resolveVaultPath } from "../obsidian/vault-path.js";
import { runAgentGraph } from "./graph.js";
import type {
  AgentDeps,
  AgentRunOptions,
  AgentRunResult,
  ResolvedAgentDeps,
} from "./types.js";

const logger = createLogger();

export type {
  AgentDeps,
  AgentRequestContext,
  AgentRunOptions,
  AgentRunResult,
  AgentStatusUpdate,
  SaveToolResult,
} from "./types.js";
export type { IngestContentResult } from "../ingest/types.js";

function resolveAgentRuntime(options?: AgentRunOptions, deps: AgentDeps = {}) {
  const env = (deps.loadEnv || loadEnv)();
  const existingChecker =
    deps.findExistingSavedRecordByUrl ||
    ((url: string) =>
      findExistingSavedRecordByUrl(url, {
        resolveVaultPath: async () => resolveVaultPath(env.obsidianVault),
      }));
  const resolvedDeps: ResolvedAgentDeps = {
    existingChecker,
    articleTool: deps.crawlWebArticleTool || crawlWebArticleTool,
    buildResolveVideoTool: deps.createResolveVideoSourceTool || createResolveVideoSourceTool,
    buildSaveTool: deps.createSaveToObsidianTool || createSaveToObsidianTool,
    buildTranscribeTool: deps.createTranscribeVideoTool || createTranscribeVideoTool,
    persistHistory: deps.persistSuccessHistory || persistSuccessHistory,
    historyStoreFactory: deps.getHistoryStore || getHistoryStore,
  };

  return {
    env,
    options,
    deps: resolvedDeps,
  };
}

export async function runAgent(
  userInput: string,
  options?: AgentRunOptions,
  deps: AgentDeps = {},
): Promise<AgentRunResult> {
  logger.info("[agent] start processing input");
  const runtime = resolveAgentRuntime(options, deps);
  const finalState = await runAgentGraph(userInput, runtime);
  return {
    reply: finalState.reply,
    usedTools: finalState.usedTools,
  };
}
