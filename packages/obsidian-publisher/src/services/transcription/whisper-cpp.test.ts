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
      "-of",
      "/tmp/whisper-output/transcript",
    ]),
    "whisper-cli -f /tmp/audio.mp3 -m /models/ggml-base.bin -otxt -of /tmp/whisper-output/transcript",
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
      return { stdout: "", stderr: "" };
    },
    readFileAsync: async () => "hello world",
  });

  assert.equal(result.provider, "whisper_cpp");
  assert.equal(result.text, "hello world");
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
    readFileAsync: async () => "english transcript",
  });
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
