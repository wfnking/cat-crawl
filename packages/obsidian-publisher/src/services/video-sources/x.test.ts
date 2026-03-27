import assert from "node:assert/strict";
import test from "node:test";
import { __test__, resolveXVideoSource } from "./x.js";

test("parseFXTwitterResponse should extract highest bitrate mp4 video", () => {
  const result = __test__.parseFXTwitterResponse({
    code: 200,
    message: "OK",
    tweet: {
      url: "https://x.com/trychroma/status/2037243681988894950",
      text: "Introducing Chroma Context-1",
      author: {
        name: "Chroma",
        screen_name: "trychroma",
      },
      created_at: "Thu Mar 26 19:01:58 +0000 2026",
      created_timestamp: 1774551718,
      media: {
        all: [
          {
            type: "video",
            url: "https://video.twimg.com/fallback.mp4",
            thumbnail_url: "https://pbs.twimg.com/thumb.jpg",
            formats: [
              {
                url: "https://video.twimg.com/360.mp4",
                bitrate: 832000,
                container: "mp4",
                codec: "h264",
              },
              {
                url: "https://video.twimg.com/1080.mp4",
                bitrate: 10368000,
                container: "mp4",
                codec: "h264",
              },
            ],
          },
        ],
      },
    },
  });

  assert.ok(result);
  assert.equal(result.sourceUrl, "https://x.com/trychroma/status/2037243681988894950");
  assert.equal(result.mediaUrl, "https://video.twimg.com/1080.mp4");
  assert.equal(result.title, "Introducing Chroma Context-1");
  assert.equal(result.author, "@trychroma");
  assert.equal(result.published, "2026-03-26");
});

test("resolveXVideoSource should fetch metadata and download the selected video", async () => {
  const result = await resolveXVideoSource("https://x.com/trychroma/status/2037243681988894950", {
    outputDir: "/tmp/cat-crawl-x-video",
    fetchJson: async (url) => {
      assert.match(url, /api\.fxtwitter\.com\/trychroma\/status\/2037243681988894950/);
      return {
        code: 200,
        message: "OK",
        tweet: {
          url: "https://x.com/trychroma/status/2037243681988894950",
          text: "Introducing Chroma Context-1",
          author: {
            name: "Chroma",
            screen_name: "trychroma",
          },
          created_at: "Thu Mar 26 19:01:58 +0000 2026",
          created_timestamp: 1774551718,
          media: {
            all: [
              {
                type: "video",
                url: "https://video.twimg.com/fallback.mp4",
                formats: [
                  {
                    url: "https://video.twimg.com/720.mp4",
                    bitrate: 2176000,
                    container: "mp4",
                    codec: "h264",
                  },
                ],
              },
            ],
          },
        },
      };
    },
    downloadVideo: async (mediaUrl, outputDir) => {
      assert.equal(mediaUrl, "https://video.twimg.com/720.mp4");
      assert.equal(outputDir, "/tmp/cat-crawl-x-video");
      return "/tmp/cat-crawl-x-video/video.mp4";
    },
  });

  assert.equal(result.adapter, "x");
  assert.equal(result.sourceUrl, "https://x.com/trychroma/status/2037243681988894950");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-x-video/video.mp4");
  assert.equal(result.title, "Introducing Chroma Context-1");
  assert.equal(result.author, "@trychroma");
  assert.equal(result.published, "2026-03-26");
});

test("resolveXVideoSource should return null when tweet has no native video", async () => {
  const result = await resolveXVideoSource("https://x.com/trychroma/status/2037243681988894950", {
    outputDir: "/tmp/cat-crawl-x-video",
    fetchJson: async () => ({
      code: 200,
      message: "OK",
      tweet: {
        url: "https://x.com/trychroma/status/2037243681988894950",
        text: "text only",
        media: {
          all: [{ type: "photo", url: "https://pbs.twimg.com/demo.jpg" }],
        },
      },
    }),
    downloadVideo: async () => {
      throw new Error("should not download");
    },
  });

  assert.equal(result, null);
});
