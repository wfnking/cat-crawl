import assert from "node:assert/strict";
import test from "node:test";
import { resolveYouTubeVideoSource } from "./youtube.js";

test("resolveYouTubeVideoSource should return local file path from yt-dlp output", async () => {
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (file, args) => {
      assert.equal(file, "yt-dlp");
      assert.ok(args.includes("--print"));
      assert.ok(args.includes("after_move:filepath"));
      return {
        stdout: "/tmp/cat-crawl-video/video.mp4\n",
        stderr: "",
      };
    },
  });

  assert.equal(result.adapter, "youtube");
  assert.equal(result.sourceUrl, "https://www.youtube.com/watch?v=abc123");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/video.mp4");
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
