import assert from "node:assert/strict";
import test from "node:test";
import { createTranscribeVideoTool } from "./transcribe-video.js";

test("transcribe video tool should transcribe local file and skip save when disabled", async () => {
  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: "whisper_cpp",
      transcriptionFallbackProvider: "gemini",
      whisperCppBin: "whisper-cli",
      whisperCppModelPath: "/models/base.bin",
      whisperCppLanguage: undefined,
      geminiApiKey: "gemini-demo-key",
      geminiModel: "gemini-3-flash-preview",
      obsidianFolder: "Clippings",
      obsidianDynamicFolders: [],
    } as never,
    {
      selectVideoSourceAdapter: () => ({ name: "file" }),
      resolveFileVideoSource: async (source) => ({
        adapter: "file",
        sourceUrl: source,
        mediaPath: source,
      }),
      extractAudioFromVideo: async () => "/tmp/audio.mp3",
      transcribeAudio: async () => ({
        providerUsed: "whisper_cpp",
        text: "hello transcript",
        fallbackUsed: false,
      }),
    },
  );

  const result = await tool.invoke({
    source: "/tmp/input.mp4",
    save: false,
    title: "Local Video",
  });

  assert.equal(result.saved, false);
  assert.equal(result.provider_used, "whisper_cpp");
  assert.match(result.transcript_markdown, /# Local Video/);
  assert.match(result.transcript_markdown, /hello transcript/);
});

test("transcribe video tool should save transcript when enabled", async () => {
  let saveCalled = false;
  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: "whisper_cpp",
      transcriptionFallbackProvider: "gemini",
      whisperCppBin: "whisper-cli",
      whisperCppModelPath: "/models/base.bin",
      whisperCppLanguage: undefined,
      geminiApiKey: "gemini-demo-key",
      geminiModel: "gemini-3-flash-preview",
      obsidianFolder: "Clippings",
      obsidianDynamicFolders: [],
    } as never,
    {
      selectVideoSourceAdapter: () => ({ name: "file" }),
      resolveFileVideoSource: async (source) => ({
        adapter: "file",
        sourceUrl: source,
        mediaPath: source,
      }),
      extractAudioFromVideo: async () => "/tmp/audio.mp3",
      transcribeAudio: async () => ({
        providerUsed: "gemini",
        text: "saved transcript",
        fallbackUsed: true,
      }),
      saveToObsidian: async (input) => {
        saveCalled = true;
        assert.equal(input.title, "Saved Video");
        assert.match(input.content_markdown, /saved transcript/);
        return {
          saved: true,
          path: "Clippings/Saved Video.md",
        };
      },
    },
  );

  const result = await tool.invoke({
    source: "/tmp/input.mp4",
    save: true,
    title: "Saved Video",
  });

  assert.equal(saveCalled, true);
  assert.equal(result.saved, true);
  assert.equal(result.path, "Clippings/Saved Video.md");
});
