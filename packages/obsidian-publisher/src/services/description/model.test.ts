import assert from "node:assert/strict";
import test from "node:test";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { __test__, generateDescriptionWithModel } from "./model.js";

test("extractModelText should support string and array parts", () => {
  assert.equal(__test__.extractModelText("hello"), "hello");
  assert.equal(
    __test__.extractModelText([{ text: "hello " }, { text: "world" }]),
    "hello world",
  );
});

test("generateDescriptionWithModel should invoke unified model contract", async () => {
  let called = false;
  const description = await generateDescriptionWithModel("正文内容", {
    env: {
      agent: "vertex",
      aiProvider: "vertex",
      aiSummarizeProvider: "vertex",
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-chat",
      transcriptionProvider: "whisper_cpp",
      whisperCppBin: "whisper-cli",
      geminiModel: "gemini-2.5-pro",
      feishuEnabled: false,
      feishuDomain: "feishu",
      telegramEnabled: false,
      telegramDmPolicy: "pairing",
      telegramTypingMode: "thinking",
      telegramTypingIntervalSeconds: 6,
      discordEnabled: false,
      obsidianFolder: "Clippings",
      obsidianDynamicFolders: [],
      maxToolSteps: 4,
    },
    invokeModel: async (messages) => {
      called = true;
      assert.equal(messages.length, 2);
      assert.ok(messages[0] instanceof SystemMessage);
      assert.ok(messages[1] instanceof HumanMessage);
      return { content: "这篇内容讲了产品营销、aha 时刻和留存的核心方法。" };
    },
  });

  assert.equal(called, true);
  assert.equal(description, "这篇内容讲了产品营销、aha 时刻和留存的核心方法。");
});
