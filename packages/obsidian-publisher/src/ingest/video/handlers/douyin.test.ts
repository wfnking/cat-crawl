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
    downloadVideo: async (mediaUrl, _outputDir, preferredName) => {
      assert.equal(mediaUrl, "https://video-cdn.example.com/demo.mp4");
      assert.equal(preferredName, "Demo Douyin Video");
      return "/tmp/cat-crawl-video/Demo Douyin Video.mp4";
    },
  });

  assert.equal(result.adapter, "douyin");
  assert.equal(result.sourceUrl, "https://www.douyin.com/video/123456");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/Demo Douyin Video.mp4");
  assert.equal(result.title, "Demo Douyin Video");
});

test("resolveDouyinVideoSource should retry candidate urls until one has audio", async () => {
  const downloaded: string[] = [];
  const result = await resolveDouyinVideoSource("https://v.douyin.com/ABCDE/", {
    extractVideo: async () => ({
      pageUrl: "https://www.douyin.com/video/123456",
      mediaUrl: "https://video-cdn.example.com/video-only.mp4",
      mediaUrls: [
        "https://video-cdn.example.com/video-only.mp4",
        "https://video-cdn.example.com/video-with-audio.mp4",
      ],
      title: "Demo Douyin Video",
    }),
    downloadVideo: async (mediaUrl, _outputDir, preferredName) => {
      downloaded.push(mediaUrl);
      assert.equal(preferredName, "Demo Douyin Video");
      return mediaUrl.includes("video-only")
        ? "/tmp/cat-crawl-video/video-only.mp4"
        : "/tmp/cat-crawl-video/video-with-audio.mp4";
    },
    hasAudioTrack: async (mediaPath) => mediaPath.includes("with-audio"),
  });

  assert.deepEqual(downloaded, [
    "https://video-cdn.example.com/video-only.mp4",
    "https://video-cdn.example.com/video-with-audio.mp4",
  ]);
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/video-with-audio.mp4");
});

test("resolveDouyinVideoSource should ignore placeholder media candidate", async () => {
  const result = await resolveDouyinVideoSource("https://v.douyin.com/ABCDE/", {
    extractVideo: async () => ({
      pageUrl: "https://www.douyin.com/video/123456",
      mediaUrl: "https://lf-douyin-pc-web.douyinstatic.com/obj/douyin-pc-web/uuu_265.mp4",
      mediaUrls: [
        "https://lf-douyin-pc-web.douyinstatic.com/obj/douyin-pc-web/uuu_265.mp4",
        "https://video-cdn.example.com/video-with-audio.mp4",
      ],
    }),
    downloadVideo: async (mediaUrl) => {
      assert.equal(mediaUrl, "https://video-cdn.example.com/video-with-audio.mp4");
      return "/tmp/cat-crawl-video/video-with-audio.mp4";
    },
    hasAudioTrack: async () => true,
  });

  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/video-with-audio.mp4");
});

test("resolveDouyinVideoSource should skip blob URLs and use http(s) candidates only", async () => {
  const blobUrl = "blob:https://www.douyin.com/d87178b6-97a7-4f39-8ccb-7d299bb44d10";
  const mp4Url = "https://video-cdn.example.com/real.mp4";

  const result = await resolveDouyinVideoSource("https://v.douyin.com/ABCDE/", {
    extractVideo: async () => ({
      pageUrl: "https://www.douyin.com/video/123456",
      mediaUrl: blobUrl,
      mediaUrls: [blobUrl, mp4Url],
      title: "Demo",
    }),
    downloadVideo: async (mediaUrl) => {
      assert.equal(mediaUrl, mp4Url);
      return "/tmp/cat-crawl-video/real.mp4";
    },
    hasAudioTrack: async () => true,
  });

  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/real.mp4");
});

test("resolveDouyinVideoSource should exclude rejected media host suffixes", async () => {
  const playUrl =
    "https://www.douyin.com/aweme/v1/play/?file_id=abc&video_id=v0200fg10000d19qsvfog65pttmoqksg";
  const effectUrl =
    "https://lf6-effectcdn-tos.byteeffecttos.com/obj/ies.fe.effect/73a925431aac3cf511e0fb73158c9be8.mp4";

  const result = await resolveDouyinVideoSource("https://v.douyin.com/ABCDE/", {
    extractVideo: async () => ({
      pageUrl: "https://www.douyin.com/video/123456",
      mediaUrl: effectUrl,
      mediaUrls: [effectUrl, playUrl],
      title: "Demo",
    }),
    downloadVideo: async (mediaUrl) => {
      assert.equal(mediaUrl, playUrl);
      return "/tmp/cat-crawl-video/from-play.mp4";
    },
    hasAudioTrack: async () => true,
  });

  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/from-play.mp4");
});

test("resolveDouyinVideoSource should fail when all candidates have no audio track", async () => {
  await assert.rejects(
    () =>
      resolveDouyinVideoSource("https://v.douyin.com/ABCDE/", {
        extractVideo: async () => ({
          pageUrl: "https://www.douyin.com/video/123456",
          mediaUrl: "https://video-cdn.example.com/video-only.mp4",
          mediaUrls: ["https://video-cdn.example.com/video-only.mp4"],
        }),
        downloadVideo: async () => "/tmp/cat-crawl-video/video-only.mp4",
        hasAudioTrack: async () => false,
        waitBeforeRetry: async () => {},
      }),
    /all downloaded candidates have no audio track/i,
  );
});

test("resolveDouyinVideoSource should re-extract once after no-audio candidates", async () => {
  let extractAttempt = 0;
  const waited: number[] = [];

  const result = await resolveDouyinVideoSource("https://v.douyin.com/ABCDE/", {
    extractVideo: async () => {
      extractAttempt += 1;
      return extractAttempt === 1
        ? {
            pageUrl: "https://www.douyin.com/video/123456",
            mediaUrl: "https://video-cdn.example.com/video-only.mp4",
            mediaUrls: ["https://video-cdn.example.com/video-only.mp4"],
            title: "Demo Douyin Video",
          }
        : {
            pageUrl: "https://www.douyin.com/video/123456",
            mediaUrl: "https://video-cdn.example.com/video-with-audio.mp4",
            mediaUrls: ["https://video-cdn.example.com/video-with-audio.mp4"],
            title: "Demo Douyin Video",
          };
    },
    downloadVideo: async (mediaUrl) =>
      mediaUrl.includes("with-audio")
        ? "/tmp/cat-crawl-video/video-with-audio.mp4"
        : "/tmp/cat-crawl-video/video-only.mp4",
    hasAudioTrack: async (mediaPath) => mediaPath.includes("with-audio"),
    noAudioRetryDelayMs: 1234,
    waitBeforeRetry: async (timeoutMs) => {
      waited.push(timeoutMs);
    },
  });

  assert.equal(extractAttempt, 2);
  assert.deepEqual(waited, [1234]);
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/video-with-audio.mp4");
});

test("resolveDouyinVideoSource should fail when all candidates fail to download", async () => {
  await assert.rejects(
    () =>
      resolveDouyinVideoSource("https://v.douyin.com/ABCDE/", {
        extractVideo: async () => ({
          pageUrl: "https://www.douyin.com/video/123456",
          mediaUrl: "https://video-cdn.example.com/video-only.mp4",
          mediaUrls: ["https://video-cdn.example.com/video-only.mp4"],
        }),
        downloadVideo: async () => {
          throw new Error("network failed");
        },
      }),
    /no downloadable media candidate succeeded/i,
  );
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
