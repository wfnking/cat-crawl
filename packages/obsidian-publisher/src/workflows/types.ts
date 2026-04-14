import type { AppEnv } from "../config/env.js";
import type { IngestContentResult } from "../ingest/types.js";
import type { loadEnv } from "../config/env.js";
import type { HistoryChannel } from "../ingest/history/history-store.js";
import type { ExistingSavedRecord, findExistingSavedRecordByUrl } from "../ingest/history/existing-save-check.js";
import type { HistoryIntent } from "./policies.js";
import type { QuerySuccessHistoryResult } from "../ingest/history/query-success-history.js";
import type { ResolvedVideoSource } from "../ingest/video/types.js";
import type { crawlWebArticleTool } from "./tools/crawl-web-article.js";
import type { createResolveVideoSourceTool } from "./tools/resolve-video-source.js";
import type { createSaveToObsidianTool } from "./tools/save-to-obsidian.js";
import type { createTranscribeVideoTool } from "./tools/transcribe-video.js";
import type { getHistoryStore } from "../ingest/history/history-store.js";

export type SaveToolResult = {
  saved?: boolean;
  vault?: string;
  path?: string;
  tags?: string[];
  dynamic_folder?: string;
};

export type AgentRunResult = {
  reply: string;
  usedTools: string[];
};

export type AgentStatusUpdate = {
  stage:
    | "received"
    | "small_chat"
    | "crawl_start"
    | "crawl_done"
    | "classify_start"
    | "classify_done"
    | "save_start"
    | "save_done";
  message: string;
};

export type AgentRequestContext = {
  channel?: HistoryChannel;
  senderId?: string;
  roomId?: string;
  messageId?: string;
};

export type AgentRunOptions = {
  onStatus?: (status: AgentStatusUpdate) => void | Promise<void>;
  context?: AgentRequestContext;
};

export type PersistSuccessHistory = (
  crawlResult: IngestContentResult,
  saveResult: SaveToolResult,
  context: AgentRequestContext | undefined,
) => void;

export type AgentDeps = {
  loadEnv?: typeof loadEnv;
  findExistingSavedRecordByUrl?: typeof findExistingSavedRecordByUrl;
  crawlWebArticleTool?: Pick<typeof crawlWebArticleTool, "invoke">;
  createResolveVideoSourceTool?: typeof createResolveVideoSourceTool;
  createSaveToObsidianTool?: typeof createSaveToObsidianTool;
  createTranscribeVideoTool?: typeof createTranscribeVideoTool;
  persistSuccessHistory?: PersistSuccessHistory;
  getHistoryStore?: typeof getHistoryStore;
};

export type AgentGraphMode = "history_query" | "small_chat" | "content_request";
export type AgentGraphContentType = "article" | "video";

export type AgentGraphState = {
  userInput: string;
  usedTools: string[];
  mode: AgentGraphMode;
  url: string | null;
  forceRecrawl: boolean;
  historyIntent: HistoryIntent | null;
  historyResult: QuerySuccessHistoryResult | null;
  existingRecord: ExistingSavedRecord | null;
  contentType: AgentGraphContentType | null;
  resolvedVideoSource: ResolvedVideoSource | null;
  ingestResult: IngestContentResult | null;
  saveResult: SaveToolResult | null;
  reply: string;
  replySubject: string | null;
  error: string | null;
};

export type AgentRuntime = {
  env: AppEnv;
  options?: AgentRunOptions;
  deps: ResolvedAgentDeps;
};

export type ResolvedAgentDeps = {
  existingChecker: (url: string) => Promise<ExistingSavedRecord | null>;
  articleTool: Pick<typeof crawlWebArticleTool, "invoke">;
  buildResolveVideoTool: typeof createResolveVideoSourceTool;
  buildSaveTool: typeof createSaveToObsidianTool;
  buildTranscribeTool: typeof createTranscribeVideoTool;
  persistHistory: PersistSuccessHistory;
  historyStoreFactory: typeof getHistoryStore;
};
