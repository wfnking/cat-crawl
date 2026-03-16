import assert from "node:assert/strict";
import test from "node:test";
import { runWechatAgent } from "./run-wechat-agent.js";

test("runWechatAgent should route supported video URLs to transcribe_video", async () => {
  let transcribeCalled = false;
  let crawlCalled = false;
  let persisted = false;

  const result = await runWechatAgent(
    "帮我处理这个视频 https://www.youtube.com/watch?v=demo123",
    undefined,
    {
      loadEnv: () =>
        ({
          obsidianDynamicFolders: [],
          transcriptionProvider: "whisper_cpp",
          transcriptionFallbackProvider: "gemini",
          whisperCppBin: "whisper-cli",
          whisperCppModelPath: "/models/base.bin",
          whisperCppLanguage: undefined,
          geminiApiKey: "gemini-demo-key",
          geminiModel: "gemini-3-flash-preview",
        }) as never,
      findExistingSavedRecordByUrl: async () => null,
      createTranscribeVideoTool: () =>
        ({
          invoke: async (input: { source: string; save: boolean }) => {
            transcribeCalled = true;
            assert.equal(input.source, "https://www.youtube.com/watch?v=demo123");
            assert.equal(input.save, true);
            return {
              saved: true,
              title: "YouTube Demo",
              source_url: "https://www.youtube.com/watch?v=demo123",
              vault: "知识库",
              path: "Clippings/YouTube Demo.md",
              tags: ["video", "transcript"],
              transcript_markdown: "# YouTube Demo\n\nhello transcript",
              provider_used: "whisper_cpp",
              fallback_used: false,
            };
          },
        }) as never,
      crawlWebArticleTool: {
        invoke: async () => {
          crawlCalled = true;
          throw new Error("crawl should not be called for video URLs");
        },
      },
      persistSuccessHistory: () => {
        persisted = true;
      },
    },
  );

  assert.equal(transcribeCalled, true);
  assert.equal(crawlCalled, false);
  assert.equal(persisted, true);
  assert.deepEqual(result.usedTools, ["transcribe_video"]);
  assert.match(result.reply, /视频转写已成功保存到 Obsidian/);
  assert.match(result.reply, /知识库\/Clippings\/YouTube Demo\.md/);
});

test("runWechatAgent should keep article URLs on crawl path", async () => {
  let transcribeCalled = false;
  let crawlCalled = false;
  let saveCalled = false;

  const result = await runWechatAgent(
    "看看这个 https://example.com/post",
    undefined,
    {
      loadEnv: () =>
        ({
          obsidianDynamicFolders: [],
        }) as never,
      findExistingSavedRecordByUrl: async () => null,
      createTranscribeVideoTool: () =>
        ({
          invoke: async () => {
            transcribeCalled = true;
            throw new Error("transcribe should not be called for article URLs");
          },
        }) as never,
      crawlWebArticleTool: {
        invoke: async () => {
          crawlCalled = true;
          return {
            title: "Example Article",
            author: "Author",
            published: "2026-03-16",
            source_url: "https://example.com/post",
            content_markdown: "# Example\n\nBody",
          };
        },
      },
      createSaveToObsidianTool: () =>
        ({
          invoke: async (input: { title: string }) => {
            saveCalled = true;
            assert.equal(input.title, "Example Article");
            return {
              saved: true,
              vault: "知识库",
              path: "Clippings/Example Article.md",
            };
          },
        }) as never,
      persistSuccessHistory: () => {},
    },
  );

  assert.equal(transcribeCalled, false);
  assert.equal(crawlCalled, true);
  assert.equal(saveCalled, true);
  assert.deepEqual(result.usedTools, ["crawl_web_article", "save_to_obsidian"]);
  assert.match(result.reply, /文章已成功保存到 Obsidian/);
});
