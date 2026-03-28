import assert from "node:assert/strict";
import test from "node:test";
import { extractAudioFromVideo } from "./extract-audio.js";

test("extractAudioFromVideo should build ffmpeg command and return output path", async () => {
  const result = await extractAudioFromVideo("/tmp/input.mp4", {
    outputDir: "/tmp/cat-crawl-audio",
    execFileAsync: async (file, args) => {
      assert.equal(file, "ffmpeg");
      assert.deepEqual(args, [
        "-y",
        "-i",
        "/tmp/input.mp4",
        "-vn",
        "-acodec",
        "libmp3lame",
        "/tmp/cat-crawl-audio/audio.mp3",
      ]);
      return { stdout: "", stderr: "" };
    },
    statAsync: async () => ({ size: 128 }),
  });

  assert.equal(result, "/tmp/cat-crawl-audio/audio.mp3");
});

test("extractAudioFromVideo should report missing ffmpeg", async () => {
  await assert.rejects(
    () =>
      extractAudioFromVideo("/tmp/input.mp4", {
        outputDir: "/tmp/cat-crawl-audio",
        execFileAsync: async () => {
          throw new Error("spawn ffmpeg ENOENT");
        },
      }),
    /ffmpeg not found/,
  );
});

test("extractAudioFromVideo should reject empty extracted audio", async () => {
  await assert.rejects(
    () =>
      extractAudioFromVideo("/tmp/input.mp4", {
        outputDir: "/tmp/cat-crawl-audio",
        execFileAsync: async () => ({ stdout: "", stderr: "" }),
        statAsync: async () => ({ size: 0 }),
      }),
    /Extracted audio file is empty/,
  );
});
