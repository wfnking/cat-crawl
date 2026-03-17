import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./model.js";

test("resolveModelProvider should use env default provider", () => {
  const provider = __test__.resolveModelProvider(
    {
      aiProvider: "gemini",
    } as never,
    {},
  );
  assert.equal(provider, "gemini");
});

test("resolveModelProvider should use task-level provider override", () => {
  const classifyProvider = __test__.resolveModelProvider(
    {
      aiProvider: "gemini",
      aiClassifyProvider: "deepseek",
    } as never,
    {
      task: "classify",
    },
  );
  assert.equal(classifyProvider, "deepseek");

  const summarizeProvider = __test__.resolveModelProvider(
    {
      aiProvider: "deepseek",
      aiSummarizeProvider: "gemini",
    } as never,
    {
      task: "summarize",
    },
  );
  assert.equal(summarizeProvider, "gemini");
});

test("resolveModelProvider should prioritize explicit provider option", () => {
  const provider = __test__.resolveModelProvider(
    {
      aiProvider: "deepseek",
      aiChatProvider: "gemini",
    } as never,
    {
      task: "chat",
      provider: "deepseek",
    },
  );
  assert.equal(provider, "deepseek");
});
