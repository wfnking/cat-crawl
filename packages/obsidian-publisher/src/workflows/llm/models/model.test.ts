import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./index.js";

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
      aiClassifyProvider: "openai",
    } as never,
    {
      task: "classify",
    },
  );
  assert.equal(classifyProvider, "openai");

  const summarizeProvider = __test__.resolveModelProvider(
    {
      aiProvider: "openai",
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
      aiProvider: "openai",
      aiChatProvider: "gemini",
    } as never,
    {
      task: "chat",
      provider: "openai",
    },
  );
  assert.equal(provider, "openai");
});
