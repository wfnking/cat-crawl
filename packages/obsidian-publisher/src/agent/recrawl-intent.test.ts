import assert from "node:assert/strict";
import test from "node:test";
import { shouldForceRecrawlFromText } from "./recrawl-intent.js";

test("detect explicit recrawl request", () => {
  assert.equal(shouldForceRecrawlFromText("重新爬这个链接 https://example.com/a"), true);
  assert.equal(shouldForceRecrawlFromText("这个之前爬过也没关系，强制重抓"), true);
  assert.equal(shouldForceRecrawlFromText("忽略历史记录，重新处理一下"), true);
});

test("non recrawl text should not force recrawl", () => {
  assert.equal(shouldForceRecrawlFromText("看看这个 https://example.com/a"), false);
  assert.equal(shouldForceRecrawlFromText("查看历史成功记录"), false);
});
