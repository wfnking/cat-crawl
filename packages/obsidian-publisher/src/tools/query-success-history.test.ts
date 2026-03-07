import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHistoryStore } from "../history/history-store.js";
import { createQuerySuccessHistoryTool } from "./query-success-history.js";

function createTempDbPath(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cat-crawl-tool-test-"));
  const dbPath = join(dir, "history.db");
  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("query_success_history filters by tag", async () => {
  const { dbPath, cleanup } = createTempDbPath();
  const store = createHistoryStore({ dbPath });
  const tool = createQuerySuccessHistoryTool(store);

  try {
    store.insertSuccessRecord({
      createdAt: new Date().toISOString(),
      source: "wechat",
      channel: "feishu",
      sourceUrl: "https://mp.weixin.qq.com/s/demo",
      title: "Demo",
      tags: ["wechat", "learning"],
      vault: "知识库",
      path: "Clippings/Demo.md",
    });

    const output = await tool.invoke({ scope: "all", tag: "learning", limit: 20 });
    assert.equal(output.total, 1);
    assert.equal(output.items.length, 1);
    assert.equal(output.items[0]?.title, "Demo");
  } finally {
    store.close();
    cleanup();
  }
});
