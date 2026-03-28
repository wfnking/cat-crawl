import { createLogger } from "@cat-crawl/core";
import { getHistoryStore, inferSourceFromUrl, type HistoryChannel } from "./history-store.js";
import type { IngestContentResult } from "../types.js";
import type { SaveToolResult } from "../../workflows/types.js";
import type { AgentRequestContext } from "../../workflows/types.js";

const logger = createLogger();

export function persistSuccessHistory(
  crawlResult: IngestContentResult,
  saveResult: SaveToolResult,
  context: AgentRequestContext | undefined,
): void {
  if (!saveResult.saved || !saveResult.vault || !saveResult.path) {
    return;
  }

  const store = getHistoryStore();
  const source = inferSourceFromUrl(crawlResult.source_url);
  const channel: HistoryChannel = context?.channel ?? "cli";
  const tags = (saveResult.tags ?? []).map((item) => item.trim()).filter(Boolean);

  try {
    store.insertSuccessRecord({
      createdAt: new Date().toISOString(),
      source,
      channel,
      sourceUrl: crawlResult.source_url,
      title: crawlResult.title,
      tags,
      vault: saveResult.vault,
      path: saveResult.path,
      dynamicFolder: saveResult.dynamic_folder,
      author: crawlResult.author ?? undefined,
      senderId: context?.senderId,
      roomId: context?.roomId,
      messageId: context?.messageId,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[history] persist success history failed: ${detail}`);
  }
}
