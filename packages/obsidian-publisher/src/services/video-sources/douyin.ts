import { createLogger } from "@cat-crawl/core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logger = createLogger();

export const douyinVideoSourceAdapter = {
  name: "douyin",
} as const;

type ExtractedDouyinVideo = {
  pageUrl: string;
  mediaUrl: string;
  title?: string;
};

type ResolveDouyinVideoSourceOptions = {
  outputDir?: string;
  extractVideo?: (sourceUrl: string) => Promise<ExtractedDouyinVideo>;
  downloadVideo?: (mediaUrl: string, outputDir: string) => Promise<string>;
};

type ResolvedDouyinVideoSource = {
  adapter: "douyin";
  sourceUrl: string;
  mediaPath: string;
  title?: string;
};

async function extractDouyinVideoDefault(sourceUrl: string): Promise<ExtractedDouyinVideo> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  try {
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const extracted = await page.evaluate(() => {
      const ogVideo =
        document.querySelector('meta[property="og:video"]')?.getAttribute("content")?.trim() || "";
      const videoSource =
        document.querySelector("video")?.getAttribute("src")?.trim() ||
        document.querySelector("video source")?.getAttribute("src")?.trim() ||
        "";
      const title =
        document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
        document.title ||
        "";
      return {
        pageUrl: window.location.href,
        mediaUrl: videoSource || ogVideo,
        title,
      };
    });
    return extracted;
  } finally {
    await browser.close();
  }
}

async function downloadDouyinVideoDefault(mediaUrl: string, outputDir: string): Promise<string> {
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`media download failed: status=${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const targetPath = join(outputDir, "douyin-video.mp4");
  await writeFile(targetPath, bytes);
  return targetPath;
}

export async function resolveDouyinVideoSource(
  sourceUrl: string,
  options: ResolveDouyinVideoSourceOptions = {},
): Promise<ResolvedDouyinVideoSource> {
  const outputDir = options.outputDir || (await mkdtemp(join(tmpdir(), "cat-crawl-douyin-")));
  const extractVideo = options.extractVideo || extractDouyinVideoDefault;
  const downloadVideo = options.downloadVideo || downloadDouyinVideoDefault;

  logger.info(`[video-source:douyin] start source=${sourceUrl}`);
  const extracted = await extractVideo(sourceUrl);
  if (!extracted.mediaUrl.trim()) {
    throw new Error("Douyin video URL not found.");
  }

  const mediaPath = await downloadVideo(extracted.mediaUrl, outputDir);
  return {
    adapter: "douyin",
    sourceUrl: extracted.pageUrl || sourceUrl,
    mediaPath,
    title: extracted.title?.trim() || undefined,
  };
}
