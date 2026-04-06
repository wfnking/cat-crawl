import assert from "node:assert/strict";
import test from "node:test";
import type { BaseMessage } from "@langchain/core/messages";
import {
  __test__,
  generateFolderClassification,
} from "./generate-folder-classification.js";

test("buildFolderClassificationSystemPrompt should enforce candidate-only selection", () => {
  const prompt = __test__.buildSystemPrompt();

  assert.match(prompt, /你是 Obsidian 目录分类器/);
  assert.match(prompt, /只能返回候选列表中的 folder/);
  assert.match(prompt, /不要返回 JSON/);
  assert.match(prompt, /如果没把握，只返回空字符串/);
});

test("buildFolderClassificationUserPrompt should include base folder and candidates", () => {
  const prompt = __test__.buildUserPrompt({
    baseFolder: "Clippings",
    title: "娶妻不娶妾，男人擦亮眼睛",
    sourceUrl: "https://www.douyin.com/video/123",
    description: "关于择偶的内容",
    contentPreview: "正文预览",
    candidates: [
      { folder: "Clippings/Relationship", description: "两性关系" },
      { folder: "Clippings/Writing", description: "写作与思考" },
    ],
  });

  assert.match(prompt, /Base Folder: Clippings/);
  assert.match(prompt, /Candidates:/);
  assert.match(prompt, /1\. Clippings\/Relationship :: 两性关系/);
  assert.match(prompt, /2\. Clippings\/Writing :: 写作与思考/);
  assert.match(prompt, /Content Preview:\n正文预览/);
});

test("buildModelOptions should keep plain model settings", () => {
  assert.deepEqual(__test__.buildModelOptions({}), {
    maxTokens: 200,
    timeout: 20000,
    temperature: 0,
  });
});

test("generateFolderClassification should return prompts and structured result", async () => {
  let receivedMessages: BaseMessage[] = [];

  const result = await generateFolderClassification(
    {
      env: {
        aiProvider: "vertex",
        agent: "vertex",
        geminiModel: "gemini-2.5-pro",
      } as never,
      baseFolder: "Clippings",
      title: "娶妻不娶妾，男人擦亮眼睛",
      sourceUrl: "https://www.douyin.com/video/123",
      description: "关于择偶的内容",
      contentPreview: "正文预览",
      candidates: [{ folder: "Clippings/Relationship", description: "两性关系" }],
    },
    {
      invokeModel: async (messages) => {
        receivedMessages = messages;
        return {
          content: "Clippings/Relationship",
        };
      },
    },
  );

  assert.equal(receivedMessages.length, 2);
  assert.equal(result.folder, "Clippings/Relationship");
  assert.deepEqual(result.parsed, { folder: "Clippings/Relationship" });
  assert.deepEqual(result.raw, {
    content: "Clippings/Relationship",
  });
  assert.match(result.systemPrompt, /Obsidian 目录分类器/);
  assert.match(result.userPrompt, /Clippings\/Relationship/);
});

test("generateFolderClassification should parse json-like content when model returns it", async () => {
  const result = await generateFolderClassification(
    {
      env: {
        aiProvider: "vertex",
        agent: "vertex",
        geminiModel: "gemini-2.5-pro",
      } as never,
      baseFolder: "Clippings",
      title: "娶妻不娶妾，男人擦亮眼睛",
      sourceUrl: "https://www.douyin.com/video/123",
      description: "关于择偶的内容",
      contentPreview: "正文预览",
      candidates: [{ folder: "Clippings/Relationship", description: "两性关系" }],
    },
    {
      invokeModel: async () => ({
        content: '{"folder":"Clippings/Relationship"}',
      }),
    },
  );

  assert.equal(result.folder, "Clippings/Relationship");
});
