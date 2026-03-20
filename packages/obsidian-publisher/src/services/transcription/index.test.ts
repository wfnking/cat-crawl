import assert from "node:assert/strict";
import test from "node:test";
import { transcribeAudio } from "./index.js";

test("transcribeAudio should use configured default provider", async () => {
  const result = await transcribeAudio("/tmp/audio.mp3", {
    provider: "whisper_cpp",
    whisperCpp: {
      bin: "whisper-cli",
      modelPath: "/models/base.bin",
    },
    providers: {
      whisperCpp: async () => ({
        provider: "whisper_cpp",
        text: "local transcript",
        srt: "1\n00:00:00,000 --> 00:00:01,000\nlocal transcript\n",
      }),
    },
  });

  assert.equal(result.providerUsed, "whisper_cpp");
  assert.equal(result.text, "local transcript");
  assert.match(result.srt || "", /00:00:00,000 --> 00:00:01,000/);
  assert.equal(result.fallbackUsed, false);
});

test("transcribeAudio should fail directly when whisper cpp fails", async () => {
  await assert.rejects(
    () =>
      transcribeAudio("/tmp/audio.mp3", {
        provider: "whisper_cpp",
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
    /whisper.cpp failed/,
  );
});
