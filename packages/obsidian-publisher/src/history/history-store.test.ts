import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHistoryStore } from "./history-store.js";

function createTempDbPath(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cat-crawl-history-test-"));
  const dbPath = join(dir, "history.db");
  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("records successful save and can query today", () => {
  const { dbPath, cleanup } = createTempDbPath();
  const store = createHistoryStore({ dbPath });

  try {
    store.insertSuccessRecord({
      createdAt: new Date().toISOString(),
      source: "wechat",
      channel: "cli",
      sourceUrl: "https://mp.weixin.qq.com/s/test",
      title: "Test title",
      tags: ["wechat", "clippings"],
      vault: "知识库",
      path: "Clippings/2026-03-04 Test.md",
      dynamicFolder: "AI学习法技能提升",
      author: "Tester",
    });

    const result = store.querySuccessRecords({ scope: "today", limit: 20 });
    assert.equal(result.total, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.title, "Test title");
  } finally {
    store.close();
    cleanup();
  }
});

test("query by tag should only return matching records", () => {
  const { dbPath, cleanup } = createTempDbPath();
  const store = createHistoryStore({ dbPath });

  try {
    store.insertSuccessRecord({
      createdAt: new Date().toISOString(),
      source: "wechat",
      channel: "telegram",
      sourceUrl: "https://mp.weixin.qq.com/s/a",
      title: "A",
      tags: ["wechat", "ai"],
      vault: "知识库",
      path: "Clippings/A.md",
    });
    store.insertSuccessRecord({
      createdAt: new Date().toISOString(),
      source: "x",
      channel: "discord",
      sourceUrl: "https://x.com/test/status/1",
      title: "B",
      tags: ["x", "news"],
      vault: "知识库",
      path: "Clippings/B.md",
    });

    const result = store.querySuccessRecords({ scope: "all", tag: "ai", limit: 20 });
    assert.equal(result.total, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.title, "A");
  } finally {
    store.close();
    cleanup();
  }
});

test("findLatestSuccessBySourceUrl should return newest matched record", () => {
  const { dbPath, cleanup } = createTempDbPath();
  const store = createHistoryStore({ dbPath });

  try {
    store.insertSuccessRecord({
      createdAt: "2026-03-05T01:00:00.000Z",
      source: "wechat",
      channel: "telegram",
      sourceUrl: "https://mp.weixin.qq.com/s/repeat",
      title: "Old",
      tags: ["wechat"],
      vault: "知识库",
      path: "Clippings/Old.md",
    });
    store.insertSuccessRecord({
      createdAt: "2026-03-05T02:00:00.000Z",
      source: "wechat",
      channel: "telegram",
      sourceUrl: "https://mp.weixin.qq.com/s/repeat",
      title: "New",
      tags: ["wechat"],
      vault: "知识库",
      path: "Clippings/New.md",
    });

    const latest = store.findLatestSuccessBySourceUrl("https://mp.weixin.qq.com/s/repeat");
    assert.ok(latest);
    assert.equal(latest.title, "New");
    assert.equal(latest.path, "Clippings/New.md");
  } finally {
    store.close();
    cleanup();
  }
});
