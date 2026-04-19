import assert from "node:assert/strict";
import test from "node:test";
import { resolveYouTubeVideoSource } from "./youtube.js";

function isSubtitleDownloadArgs(args: string[]): boolean {
  return args.includes("--write-subs") || args.includes("--write-auto-subs");
}

test("resolveYouTubeVideoSource should return local file path from yt-dlp output", async () => {
  let callCount = 0;
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (file, args) => {
      callCount += 1;
      assert.equal(file, "yt-dlp");
      if (callCount === 1) {
        assert.ok(args.includes("--skip-download"));
        assert.ok(!args.includes("--cookies-from-browser"));
        assert.ok(args.includes("published:%(upload_date)s"));
        assert.ok(args.includes("author:%(uploader)s"));
        assert.ok(args.includes("title:%(title)s"));
        return {
          stdout: "published:20251123\nauthor:AI Engineer\ntitle:Demo Title\n",
          stderr: "",
        };
      }
      if (callCount === 2) {
        assert.ok(args.includes("--skip-download"));
        assert.ok(args.includes("--write-subs"));
        assert.ok(args.includes("--write-auto-subs"));
        assert.ok(args.includes("--sub-langs"));
        assert.ok(args.includes("en,en-orig,zh-Hans,zh-Hant"));
        assert.ok(args.includes("/tmp/cat-crawl-video/Demo Title.%(ext)s"));
        return {
          stdout: "",
          stderr: "",
        };
      }
      assert.ok(args.includes("--cookies-from-browser"));
      assert.ok(args.includes("chrome"));
      assert.ok(args.includes("-f"));
      assert.ok(args.includes("bestaudio/best"));
      assert.ok(args.includes("after_move:filepath"));
      assert.ok(args.includes("/tmp/cat-crawl-video/Demo Title.%(ext)s"));
      return {
        stdout: "/tmp/cat-crawl-video/Demo Title.webm\n",
        stderr: "",
      };
    },
  });

  assert.equal(callCount, 3);
  assert.equal(result.adapter, "youtube");
  assert.equal(result.sourceUrl, "https://www.youtube.com/watch?v=abc123");
  assert.equal(result.published, "2025-11-23");
  assert.equal(result.author, "AI Engineer");
  assert.equal(result.title, "Demo Title");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/Demo Title.webm");
});

test("resolveYouTubeVideoSource should return subtitle path before downloading media", async () => {
  let callCount = 0;
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (_file, args) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stdout: "published:20251123\nauthor:AI Engineer\ntitle:Captioned Title\n",
          stderr: "",
        };
      }
      assert.ok(isSubtitleDownloadArgs(args));
      return {
        stdout: "",
        stderr: "[info] Writing video subtitles to: /tmp/cat-crawl-video/Captioned Title.en.srt\n",
      };
    },
  });

  assert.equal(callCount, 2);
  assert.equal(result.title, "Captioned Title");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/Captioned Title.en.srt");
  assert.equal(result.transcriptPath, "/tmp/cat-crawl-video/Captioned Title.en.srt");
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

test("resolveYouTubeVideoSource should handle empty uploader field", async () => {
  let callCount = 0;
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (_file, args) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stdout: "published:20251123\nauthor:\ntitle:Some Title\n",
          stderr: "",
        };
      }
      if (callCount === 2) {
        assert.ok(isSubtitleDownloadArgs(args));
        return {
          stdout: "",
          stderr: "",
        };
      }
      assert.ok(args.includes("/tmp/cat-crawl-video/Some Title.%(ext)s"));
      return {
        stdout: "/tmp/cat-crawl-video/Some Title.webm\n",
        stderr: "",
      };
    },
  });

  assert.equal(result.author, undefined);
  assert.equal(result.title, "Some Title");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/Some Title.webm");
});

test("resolveYouTubeVideoSource should ignore yt-dlp warnings when filepath is present", async () => {
  let callCount = 0;
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stdout: "published:20251123\nauthor:AI Engineer\ntitle:Warning Resistant Title\n",
          stderr: "",
        };
      }
      if (callCount === 2) {
        return {
          stdout: "",
          stderr:
            "WARNING: [youtube] abc123: nsig extraction failed: Some formats may be missing.\n" +
            "WARNING: [youtube] abc123: n challenge solving failed.\n",
        };
      }
      return {
        stdout: "/tmp/cat-crawl-video/video.webm\n",
        stderr:
          "WARNING: [youtube] abc123: nsig extraction failed: Some formats may be missing.\n" +
          "WARNING: [youtube] abc123: n challenge solving failed.\n",
      };
    },
  });

  assert.equal(result.title, "Warning Resistant Title");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/video.webm");
});

test("resolveYouTubeVideoSource should retry without browser cookies when cookie loading fails", async () => {
  let callCount = 0;
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (_file, args) => {
      callCount += 1;
      if (callCount === 1) {
        assert.ok(args.includes("--skip-download"));
        return {
          stdout: "published:20251123\nauthor:AI Engineer\ntitle:Retried Title\n",
          stderr: "",
        };
      }
      if (callCount === 2) {
        assert.ok(isSubtitleDownloadArgs(args));
        return {
          stdout: "",
          stderr: "",
        };
      }
      if (callCount === 3) {
        assert.ok(args.includes("--cookies-from-browser"));
        throw new Error("yt-dlp: could not extract cookies from chrome");
      }
      assert.ok(!args.includes("--cookies-from-browser"));
      return {
        stdout: "/tmp/cat-crawl-video/retried.webm\n",
        stderr: "",
      };
    },
  });

  assert.equal(callCount, 4);
  assert.equal(result.title, "Retried Title");
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/retried.webm");
});

test("resolveYouTubeVideoSource should retry subtitle download without browser cookies", async () => {
  let callCount = 0;
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (_file, args) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stdout: "published:20251123\nauthor:AI Engineer\ntitle:Subtitle Retry Title\n",
          stderr: "",
        };
      }
      if (callCount === 2) {
        assert.ok(isSubtitleDownloadArgs(args));
        assert.ok(args.includes("--cookies-from-browser"));
        throw new Error("yt-dlp: could not extract cookies from chrome");
      }
      assert.ok(isSubtitleDownloadArgs(args));
      assert.ok(!args.includes("--cookies-from-browser"));
      return {
        stdout: "",
        stderr: "[info] Writing video subtitles to: /tmp/cat-crawl-video/Subtitle Retry Title.en.srt\n",
      };
    },
  });

  assert.equal(callCount, 3);
  assert.equal(result.transcriptPath, "/tmp/cat-crawl-video/Subtitle Retry Title.en.srt");
});

test("resolveYouTubeVideoSource should keep partial subtitle download when another language fails", async () => {
  let callCount = 0;
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (_file, args) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stdout: "published:20251123\nauthor:AI Engineer\ntitle:Partial Subtitle Title\n",
          stderr: "",
        };
      }
      assert.ok(isSubtitleDownloadArgs(args));
      throw Object.assign(new Error("yt-dlp exited with code 1"), {
        stdout: "",
        stderr:
          "[info] Writing video subtitles to: /tmp/cat-crawl-video/Partial Subtitle Title.en.srt\n" +
          "ERROR: Unable to download video subtitles for 'zh-Hans': HTTP Error 429: Too Many Requests\n",
      });
    },
  });

  assert.equal(callCount, 2);
  assert.equal(result.transcriptPath, "/tmp/cat-crawl-video/Partial Subtitle Title.en.srt");
});

test("resolveYouTubeVideoSource should ignore subtitle failures and download media", async () => {
  let callCount = 0;
  const result = await resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
    outputDir: "/tmp/cat-crawl-video",
    execFileAsync: async (_file, args) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stdout: "published:20251123\nauthor:AI Engineer\ntitle:Fallback Title\n",
          stderr: "",
        };
      }
      if (callCount === 2) {
        assert.ok(isSubtitleDownloadArgs(args));
        throw new Error("yt-dlp exited with code 1");
      }
      assert.ok(args.includes("-f"));
      return {
        stdout: "/tmp/cat-crawl-video/fallback.webm\n",
        stderr: "",
      };
    },
  });

  assert.equal(callCount, 3);
  assert.equal(result.transcriptPath, undefined);
  assert.equal(result.mediaPath, "/tmp/cat-crawl-video/fallback.webm");
});

test("resolveYouTubeVideoSource should preserve metadata when audio download fails", async () => {
  await assert.rejects(
    () =>
      resolveYouTubeVideoSource("https://www.youtube.com/watch?v=abc123", {
        outputDir: "/tmp/cat-crawl-video",
        execFileAsync: async (_file, _args) => ({
          stdout: isSubtitleDownloadArgs(_args)
            ? ""
            : _args.includes("--skip-download")
            ? "published:20251123\nauthor:AI Engineer\ntitle:Never Trust An LLM\n"
            : "NA\n",
          stderr: isSubtitleDownloadArgs(_args)
            ? ""
            : _args.includes("--skip-download")
            ? ""
            : "ERROR: [youtube] abc123: Requested format is not available.",
        }),
      }),
    /Requested format is not available/,
  );
});
