import assert from "node:assert/strict";
import test from "node:test";
import { transcribeWithWhisperCpp } from "./whisper-cpp.js";

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

test("transcribeWithWhisperCpp should use ssh when configured", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const result = await transcribeWithWhisperCpp(
    "/tmp/audio.mp3",
    {
      bin: "/opt/homebrew/bin/whisper-cli",
      modelPath: "/Users/alfwong/codes/ai-coding/asr/models/ggml-large-v3-turbo-q8_0.bin",
      language: "zh",
      outputDir: "/tmp/whisper-output",
      ssh: {
        host: "192.168.10.16",
        user: "alfwong",
        port: 22,
      },
      execFileAsync: async (file, args) => {
        calls.push({ file, args });
        return { stdout: "", stderr: "" };
      },
      readFileAsync: async (path) =>
        path.endsWith(".srt")
          ? "1\n00:00:00,000 --> 00:00:01,000\nhello transcript\n"
          : "hello transcript",
    } as never,
  );

  assert.equal(result.text, "hello transcript");
  assert.equal(calls.length, 4);
  assert.equal(calls[0]?.file, "ssh");
  assert.deepEqual(calls[0]?.args, [
    "-p",
    "22",
    "alfwong@192.168.10.16",
    "mkdir -p /tmp/cat-crawl/audio /tmp/cat-crawl/whisper",
  ]);
  assert.equal(calls[1]?.file, "scp");
  assert.deepEqual(calls[1]?.args.slice(0, 2), ["-P", "22"]);
  assert.ok(calls[1]?.args.join(" ").includes("/tmp/cat-crawl/audio/audio.mp3"));
  assert.equal(calls[2]?.file, "ssh");
  assert.ok(calls[2]?.args.join(" ").includes("/opt/homebrew/bin/whisper-cli"));
  assert.ok(calls[2]?.args.join(" ").includes("/tmp/cat-crawl/whisper/transcript"));
  assert.equal(calls[3]?.file, "scp");
  assert.deepEqual(calls[3]?.args.slice(0, 2), ["-P", "22"]);
  assert.ok(calls[3]?.args.join(" ").includes("/tmp/cat-crawl/whisper/transcript.txt"));
  assert.ok(calls[3]?.args.join(" ").includes("/tmp/cat-crawl/whisper/transcript.srt"));
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
