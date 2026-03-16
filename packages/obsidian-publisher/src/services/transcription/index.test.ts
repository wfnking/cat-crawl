import assert from "node:assert/strict";
import test from "node:test";
import { transcribeAudio } from "./index.js";

test("transcribeAudio should use configured default provider", async () => {
  const result = await transcribeAudio("/tmp/audio.mp3", {
    provider: "whisper_cpp",
    fallbackProvider: "gemini",
    whisperCpp: {
      bin: "whisper-cli",
      modelPath: "/models/base.bin",
    },
    gemini: {
      apiKey: "gemini-demo-key",
    },
    providers: {
      whisperCpp: async () => ({
        provider: "whisper_cpp",
        text: "local transcript",
        srt: "1\n00:00:00,000 --> 00:00:01,000\nlocal transcript\n",
      }),
      gemini: async () => ({ provider: "gemini", text: "gemini transcript" }),
    },
  });

  assert.equal(result.providerUsed, "whisper_cpp");
  assert.equal(result.text, "local transcript");
  assert.match(result.srt || "", /00:00:00,000 --> 00:00:01,000/);
  assert.equal(result.fallbackUsed, false);
});

test("transcribeAudio should fallback from whisper cpp to gemini", async () => {
  const result = await transcribeAudio("/tmp/audio.mp3", {
    provider: "whisper_cpp",
    fallbackProvider: "gemini",
    whisperCpp: {
      bin: "whisper-cli",
      modelPath: "/models/base.bin",
    },
    gemini: {
      apiKey: "gemini-demo-key",
    },
    providers: {
      whisperCpp: async () => {
        throw new Error("whisper.cpp failed: spawn whisper-cli ENOENT");
      },
      gemini: async () => ({ provider: "gemini", text: "gemini transcript" }),
    },
  });

  assert.equal(result.providerUsed, "gemini");
  assert.equal(result.text, "gemini transcript");
  assert.equal(result.fallbackUsed, true);
});

test("transcribeAudio should not fallback when provider is explicitly forced", async () => {
  await assert.rejects(
    () =>
      transcribeAudio("/tmp/audio.mp3", {
        provider: "whisper_cpp",
        fallbackProvider: "gemini",
        forceProvider: true,
        whisperCpp: {
          bin: "whisper-cli",
          modelPath: "/models/base.bin",
        },
        gemini: {
          apiKey: "gemini-demo-key",
        },
        providers: {
          whisperCpp: async () => {
            throw new Error("whisper.cpp failed: spawn whisper-cli ENOENT");
          },
          gemini: async () => ({ provider: "gemini", text: "gemini transcript" }),
        },
      }),
    /whisper.cpp failed/,
  );
});

test("transcribeAudio should fail when gemini fallback is not configured", async () => {
  await assert.rejects(
    () =>
      transcribeAudio("/tmp/audio.mp3", {
        provider: "whisper_cpp",
        fallbackProvider: "gemini",
        whisperCpp: {
          bin: "whisper-cli",
          modelPath: "/models/base.bin",
        },
        providers: {
          whisperCpp: async () => {
            throw new Error("whisper.cpp failed: spawn whisper-cli ENOENT");
          },
        },
      }),
    /Gemini fallback is not configured/,
  );
});
