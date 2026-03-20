import assert from "node:assert/strict";
import test from "node:test";
import { parseHistoryIntentFromText } from "./history-intent.js";

test("detect all history query", () => {
  const intent = parseHistoryIntentFromText("查看历史成功记录");
  assert.equal(intent.shouldQuery, true);
  assert.equal(intent.scope, "all");
  assert.equal(intent.tag, undefined);
});

test("detect today history query", () => {
  const intent = parseHistoryIntentFromText("查看今天的成功记录");
  assert.equal(intent.shouldQuery, true);
  assert.equal(intent.scope, "today");
});

test("detect tag query", () => {
  const intent = parseHistoryIntentFromText("根据标签 ai 查询");
  assert.equal(intent.shouldQuery, true);
  assert.equal(intent.scope, "all");
  assert.equal(intent.tag, "ai");
});

test("non history text should not query", () => {
  const intent = parseHistoryIntentFromText("你好，你会做什么");
  assert.equal(intent.shouldQuery, false);
});
