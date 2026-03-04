import assert from "node:assert/strict";
import test from "node:test";
import { toUserFacingErrorMessage } from "./user-facing-error.js";

test("returns install guide when Obsidian CLI is missing", () => {
  const message = toUserFacingErrorMessage(new Error("Obsidian CLI not found. Please ensure `obsidian` is available in PATH."));
  assert.match(message, /Obsidian CLI/);
  assert.match(message, /command -v obsidian/);
  assert.match(message, /obsidian\.md\/download/);
});

test("returns install guide when process spawn reports obsidian ENOENT", () => {
  const message = toUserFacingErrorMessage(new Error("spawn obsidian ENOENT"));
  assert.match(message, /Obsidian CLI/);
});

test("returns generic message for unknown errors", () => {
  const message = toUserFacingErrorMessage(new Error("network timeout"));
  assert.equal(message, "处理失败，请稍后重试。");
});
