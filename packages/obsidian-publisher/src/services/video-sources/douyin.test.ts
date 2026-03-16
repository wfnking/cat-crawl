import assert from "node:assert/strict";
import test from "node:test";
import { resolveDouyinVideoSource } from "./douyin.js";

test("resolveDouyinVideoSource should resolve redirected share urls and download media", async () => {
  const result = await resolveDouyinVideoSource("https://v.douyin.com/ABCDE/", {
    extractVideo: async (sourceUrl) => {
      assert.equal(sourceUrl, "https://v.douyin.com/ABCDE/");
      return {
        pageUrl: "https://www.douyin.com/video/123456",
        mediaUrl: "https://video-cdn.example.com/demo.mp4",
        title: "Demo Douyin Video",
      };
    },
    downloadVideo: async (mediaUrl) => {
      assert.equal(mediaUrl, "https://video-cdn.example.com/demo.mp4");
      return "/tmp/cat-crawl-video/douyin.mp4";
    },
  });

  assert.equal(result.adapter, "douyin");
  assert.equal(result.sourceUrl, "https://www.douyin.com/video/123456");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/douyin.mp4");
  assert.equal(result.title, "Demo Douyin Video");
});

test("resolveDouyinVideoSource should fail when no downloadable video is found", async () => {
  await assert.rejects(
    () =>
      resolveDouyinVideoSource("https://www.douyin.com/video/123456", {
        extractVideo: async () => ({
          pageUrl: "https://www.douyin.com/video/123456",
          mediaUrl: "",
        }),
      }),
    /Douyin video URL not found/,
  );
});
