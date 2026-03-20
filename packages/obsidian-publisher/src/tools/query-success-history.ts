import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HistoryStore, QueryScope } from "../history/history-store.js";

const inputSchema = z.object({
  scope: z.enum(["all", "today"]).default("all").describe("查询范围：all 或 today"),
  tag: z.string().optional().describe("按标签过滤（精确匹配）"),
  limit: z.number().int().min(1).max(100).default(20).describe("返回记录上限，最大 100"),
});

export type QuerySuccessHistoryResult = {
  total: number;
  scope: QueryScope;
  tag?: string;
  items: Array<{
    id: number;
    created_at: string;
    source: string;
    channel: string;
    title: string;
    tags: string[];
    vault: string;
    path: string;
    source_url: string;
    dynamic_folder?: string;
    author?: string;
  }>;
};

export function createQuerySuccessHistoryTool(store: HistoryStore) {
  return tool(
    async ({ scope, tag, limit }): Promise<QuerySuccessHistoryResult> => {
      const result = store.querySuccessRecords({ scope, tag, limit });
      return {
        total: result.total,
        scope,
        tag: tag?.trim() || undefined,
        items: result.items.map((item) => ({
          id: item.id,
          created_at: item.createdAt,
          source: item.source,
          channel: item.channel,
          title: item.title,
          tags: item.tags,
          vault: item.vault,
          path: item.path,
          source_url: item.sourceUrl,
          dynamic_folder: item.dynamicFolder,
          author: item.author,
        })),
      };
    },
    {
      name: "query_success_history",
      description:
        "查询本地成功抓取历史记录。支持查看全部、查看今天记录、按标签过滤，返回最新记录列表。",
      schema: inputSchema,
    },
  );
}
