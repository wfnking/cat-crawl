import assert from "node:assert/strict";
import test from "node:test";
import { __test__, transcribeWithWhisperCpp } from "./whisper-cpp.js";

test("formatWhisperCommandForLog should render executable and args", () => {
  assert.equal(
    __test__.formatWhisperCommandForLog("whisper-cli", [
      "-f",
      "/tmp/audio.mp3",
      "-m",
      "/models/ggml-base.bin",
      "-otxt",
      "-osrt",
      "-of",
      "/tmp/whisper-output/transcript",
    ]),
    "whisper-cli -f /tmp/audio.mp3 -m /models/ggml-base.bin -otxt -osrt -of /tmp/whisper-output/transcript",
  );
});

test("transcribeWithWhisperCpp should omit language when not configured", async () => {
  const result = await transcribeWithWhisperCpp("/tmp/audio.mp3", {
    bin: "whisper-cli",
    modelPath: "/models/ggml-base.bin",
    outputDir: "/tmp/whisper-output",
    execFileAsync: async (file, args) => {
      assert.equal(file, "whisper-cli");
      assert.ok(!args.includes("-l"));
      assert.ok(args.includes("-osrt"));
      return { stdout: "", stderr: "" };
    },
    readFileAsync: async (path) => (path.endsWith(".srt") ? "1\n00:00:00,000 --> 00:00:01,000\nhello\n" : "hello world"),
  });

  assert.equal(result.provider, "whisper_cpp");
  assert.equal(result.text, "hello world");
  assert.match(result.srt || "", /00:00:00,000 --> 00:00:01,000/);
});

test("transcribeWithWhisperCpp should include language when configured", async () => {
  await transcribeWithWhisperCpp("/tmp/audio.mp3", {
    bin: "whisper-cli",
    modelPath: "/models/ggml-base.bin",
    language: "en",
    outputDir: "/tmp/whisper-output",
    execFileAsync: async (_file, args) => {
      assert.ok(args.includes("-l"));
      assert.ok(args.includes("en"));
      return { stdout: "", stderr: "" };
    },
    readFileAsync: async (path) =>
      path.endsWith(".srt")
        ? "1\n00:00:00,000 --> 00:00:01,000\nenglish transcript\n"
        : "english transcript",
  });
});

test("transcribeWithWhisperCpp should fail when srt output is empty", async () => {
  await assert.rejects(
    () =>
      transcribeWithWhisperCpp("/tmp/audio.mp3", {
        bin: "whisper-cli",
        modelPath: "/models/ggml-base.bin",
        outputDir: "/tmp/whisper-output",
        execFileAsync: async () => ({ stdout: "", stderr: "" }),
        readFileAsync: async (path) => (path.endsWith(".srt") ? "" : "hello world"),
      }),
    /empty srt output/i,
  );
});

test("transcribeWithWhisperCpp should normalize command failures", async () => {
  await assert.rejects(
    () =>
      transcribeWithWhisperCpp("/tmp/audio.mp3", {
        bin: "whisper-cli",
        modelPath: "/models/ggml-base.bin",
        outputDir: "/tmp/whisper-output",
        execFileAsync: async () => {
          throw new Error("spawn whisper-cli ENOENT");
        },
      }),
    /whisper.cpp failed/,
  );
});
