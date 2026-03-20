import assert from "node:assert/strict";
import test from "node:test";
import { findExistingSavedRecordByUrl } from "./existing-save-check.js";
import type { HistoryStore, SuccessRecordInput } from "../history/history-store.js";

function createMockStore(record: {
  createdAt: string;
  sourceUrl: string;
  title: string;
  vault: string;
  path: string;
} | null): HistoryStore {
  return {
    insertSuccessRecord(_record: SuccessRecordInput): void {
      throw new Error("not implemented in test");
    },
    querySuccessRecords() {
      throw new Error("not implemented in test");
    },
    findLatestSuccessBySourceUrl(sourceUrl: string) {
      if (!record || sourceUrl !== record.sourceUrl) {
        return null;
      }
      return {
        id: 1,
        createdAt: record.createdAt,
        source: "wechat",
        channel: "telegram",
        sourceUrl: record.sourceUrl,
        title: record.title,
        tags: ["wechat"],
        vault: record.vault,
        path: record.path,
      };
    },
    close(): void {
      // noop
    },
  };
}

test("returns existing record when history matched and obsidian lookup succeeds", async () => {
  const store = createMockStore({
    createdAt: "2026-03-05T08:00:00.000Z",
    sourceUrl: "https://mp.weixin.qq.com/s/repeat",
    title: "Repeat",
    vault: "知识库",
    path: "Clippings/Repeat.md",
  });
  const result = await findExistingSavedRecordByUrl("https://mp.weixin.qq.com/s/repeat", {
    store,
    lookup: async () => "path\tClippings/Repeat.md\nname\tRepeat",
  });
  assert.ok(result);
  assert.equal(result.path, "Clippings/Repeat.md");
});

test("returns null when obsidian lookup says not found", async () => {
  const store = createMockStore({
    createdAt: "2026-03-05T08:00:00.000Z",
    sourceUrl: "https://mp.weixin.qq.com/s/repeat",
    title: "Repeat",
    vault: "知识库",
    path: "Clippings/Repeat.md",
  });
  const result = await findExistingSavedRecordByUrl("https://mp.weixin.qq.com/s/repeat", {
    store,
    lookup: async () => 'Error: File "Clippings/Repeat.md" not found.',
  });
  assert.equal(result, null);
});

test("returns null when history has no match", async () => {
  const store = createMockStore(null);
  const result = await findExistingSavedRecordByUrl("https://mp.weixin.qq.com/s/repeat", {
    store,
    lookup: async () => "path\tClippings/Repeat.md",
  });
  assert.equal(result, null);
});
