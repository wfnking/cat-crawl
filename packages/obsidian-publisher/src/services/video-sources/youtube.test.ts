import assert from "node:assert/strict";
import test from "node:test";
import { resolveYouTubeVideoSource } from "./youtube.js";

test("resolveYouTubeVideoSource should return local file path from yt-dlp output", async () => {
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (file, args) => {
      assert.equal(file, "yt-dlp");
      assert.ok(args.includes("-f"));
      assert.ok(args.includes("bestaudio/best"));
      assert.ok(args.includes("--print"));
      assert.ok(args.includes("after_move:filepath"));
      assert.ok(args.includes("title"));
      return {
        stdout: "Demo Title\n/tmp/cat-crawl-video/audio.webm\n",
        stderr: "",
      };
    },
  });

  assert.equal(result.adapter, "youtube");
  assert.equal(result.sourceUrl, "https://www.youtube.com/watch?v=abc123");
  assert.equal(result.title, "Demo Title");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/audio.webm");
});

test("resolveYouTubeVideoSource should report missing yt-dlp", async () => {
  await assert.rejects(
    () =>
      resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
        outputDir: "/tmp/cat-crawl-video",
        execFileAsync: async () => {
          throw new Error("spawn yt-dlp ENOENT");
        },
      }),
    /yt-dlp not found/,
  );
});

test("resolveYouTubeVideoSource should surface yt-dlp failures", async () => {
  await assert.rejects(
    () =>
      resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
        outputDir: "/tmp/cat-crawl-video",
        execFileAsync: async () => {
          throw new Error("yt-dlp exited with code 1");
        },
      }),
    /YouTube download failed/,
  );
});

test("resolveYouTubeVideoSource should ignore yt-dlp warnings when filepath is present", async () => {
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async () => ({
      stdout: "Warning Resistant Title\n/tmp/cat-crawl-video/video.webm\n",
      stderr:
        "WARNING: [youtube] abc123: nsig extraction failed: Some formats may be missing.\n" +
        "WARNING: [youtube] abc123: n challenge solving failed.\n",
    }),
  });

  assert.equal(result.title, "Warning Resistant Title");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/video.webm");
});
