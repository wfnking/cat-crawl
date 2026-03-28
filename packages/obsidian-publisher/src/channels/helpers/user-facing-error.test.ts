import assert from "node:assert/strict";
import test from "node:test";
import { toUserFacingErrorMessage } from "./user-facing-error.js";

test("toUserFacingErrorMessage should return Obsidian install guide for CLI not found", () => {
  const message = toUserFacingErrorMessage(new Error("obsidian cli not found"));
  assert.match(message, /未检测到 Obsidian CLI/);
  assert.match(message, /obsidian/);
});

test("toUserFacingErrorMessage should include final error detail for normal failures", () => {
  const message = toUserFacingErrorMessage(new Error("whisper.cpp failed: missing model path"));
  assert.equal(message, "处理失败：whisper.cpp failed: missing model path");
});

test("toUserFacingErrorMessage should redact key-like fragments", () => {
  const message = toUserFacingErrorMessage(
    new Error("request failed: key=abcdef1234567890 apiKey=abcdef1234567890"),
  );
  assert.match(message, /key=\*\*\*/i);
  assert.match(message, /apiKey=\*\*\*/i);
});
