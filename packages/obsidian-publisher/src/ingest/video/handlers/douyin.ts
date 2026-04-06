import { createLogger } from "@cat-crawl/core";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { loadChromeCookiesForDomains } from "../helpers/chrome-cookies.js";

const logger = createLogger();
const execFileAsync = promisify(execFile);

export const douyinVideoHandler = {
  name: "douyin",
} as const;

type ExtractedDouyinVideo = {
  pageUrl: string;
  mediaUrl: string;
  mediaUrls?: string[];
  title?: string;
  author?: string;
  published?: string;
};

type DouyinPage = {
  goto: (url: string, options: { waitUntil: "domcontentloaded"; timeout: number }) => Promise<unknown>;
  waitForTimeout: (timeout: number) => Promise<void>;
  waitForLoadState: (state: "domcontentloaded" | "networkidle", options?: { timeout?: number }) => Promise<void>;
  waitForURL: (urlOrPredicate: string | RegExp | ((url: URL) => boolean), options?: { timeout?: number }) => Promise<void>;
  evaluate: <T>(pageFunction: () => T) => Promise<T>;
  mouse?: {
    click: (x: number, y: number) => Promise<void>;
  };
};

type DouyinContext = {
  addCookies: (cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly?: boolean;
    expires?: number;
    sameSite?: "Lax" | "None" | "Strict";
  }>) => Promise<void>;
};

type ResolveDouyinVideoSourceOptions = {
  outputDir?: string;
  cookieHeader?: string;
  loadChromeCookies?: typeof loadChromeCookiesForDomains;
  extractVideo?: (
    sourceUrl: string,
    cookieHeader?: string,
    loadChromeCookies?: typeof loadChromeCookiesForDomains,
  ) => Promise<ExtractedDouyinVideo>;
  downloadVideo?: (mediaUrl: string, outputDir: string, preferredName?: string) => Promise<string>;
  hasAudioTrack?: (mediaPath: string) => Promise<boolean>;
};

type ResolvedDouyinVideoSource = {
  adapter: "douyin";
  sourceUrl: string;
  mediaPath: string;
  title?: string;
  author?: string;
  published?: string;
};

type DouyinExtractAttemptOptions = {
  attempts: number;
  intervalMs: number;
  clickCenter?: boolean;
  ensureAudio?: boolean;
};

function isExecutionContextDestroyedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context with specified id")
  );
}

async function readDouyinPageDetails(page: DouyinPage): Promise<ExtractedDouyinVideo> {
  return page.evaluate(() => {
    const protocol = window.location.protocol;
    const ogVideoRaw =
      document.querySelector('meta[property="og:video"]')?.getAttribute("content")?.trim() || "";
    const ogVideo = !ogVideoRaw ? "" : ogVideoRaw.startsWith("//") ? `${protocol}${ogVideoRaw}` : ogVideoRaw;
    const videoSourceRaw = document.querySelector("video")?.getAttribute("src")?.trim() || "";
    const videoSource = !videoSourceRaw
      ? ""
      : videoSourceRaw.startsWith("//")
        ? `${protocol}${videoSourceRaw}`
        : videoSourceRaw;
    const currentVideoSourceRaw =
      (document.querySelector("video") as HTMLVideoElement | null)?.currentSrc?.trim() || "";
    const currentVideoSource = !currentVideoSourceRaw
      ? ""
      : currentVideoSourceRaw.startsWith("//")
        ? `${protocol}${currentVideoSourceRaw}`
        : currentVideoSourceRaw;
    const sourceUrls = Array.from(document.querySelectorAll("video source"))
      .map((node) => node.getAttribute("src")?.trim() || "")
      .map((value) => (!value ? "" : value.startsWith("//") ? `${protocol}${value}` : value))
      .filter(Boolean);
    const resourceUrls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name?.trim() || "")
      .filter((value) => /\.(mp4|m3u8|m4a|mp3|aac|webm)(\?|$)/i.test(value))
      .map((value) => (!value ? "" : value.startsWith("//") ? `${protocol}${value}` : value));
    const title =
      document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
      document.title ||
      "";
    
    // Extract author from meta tags or page content
    const author =
      document.querySelector('meta[name="author"]')?.getAttribute("content")?.trim() ||
      document.querySelector('meta[property="og:author"]')?.getAttribute("content")?.trim() ||
      document.querySelector('[data-e2e="user-info"] .arnSiSbK')?.textContent?.trim() ||
      document.querySelector('[class*="author"]')?.textContent?.trim() ||
      undefined;
    
    // Extract published date from meta tags or page content
    let published: string | undefined;
    const publishedRaw =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute("content")?.trim() ||
      document.querySelector('meta[name="publish_time"]')?.getAttribute("content")?.trim() ||
      document.querySelector('[data-e2e="detail-video-publish-time"]')?.textContent?.trim() ||
      document.querySelector('[class*="publish"]')?.textContent?.trim() ||
      undefined;
    
    if (publishedRaw) {
      // Parse "发布时间：2026-03-09 21:00" format
      const match = publishedRaw.match(/(\d{4}-\d{2}-\d{2})/);
      published = match ? match[1] : publishedRaw;
    }
    
    const mediaUrls = Array.from(
      new Set([ogVideo, currentVideoSource, ...sourceUrls, videoSource, ...resourceUrls].filter(Boolean)),
    );
    return {
      pageUrl: window.location.href,
      mediaUrl: mediaUrls[0] || "",
      mediaUrls,
      title,
      author,
      published,
    };
  });
}

function collectMediaCandidates(extracted: ExtractedDouyinVideo): string[] {
  const primary = extracted.mediaUrl?.trim() || "";
  const extras = extracted.mediaUrls || [];
  const all = Array.from(new Set([primary, ...extras].map((item) => item.trim()).filter(Boolean)));
  const filtered = all.filter((url) => {
    const value = url.toLowerCase();
    return !value.includes("/obj/douyin-pc-web/uuu_");
  });
  return filtered.length > 0 ? filtered : all;
}

async function hasAudioTrackDefault(mediaPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        mediaPath,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout
      .split(/\r?\n/g)
      .map((line) => line.trim().toLowerCase())
      .some((line) => line === "audio");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes("spawn ffprobe ENOENT")) {
      logger.warn("[video-source:douyin] ffprobe not found, skip audio-track verification");
      return true;
    }
    logger.warn(`[video-source:douyin] ffprobe check failed msg=${detail}`);
    return false;
  }
}

async function waitForDouyinPageReady(page: DouyinPage, sourceUrl: string): Promise<void> {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 200 * 1000 });
  await page.waitForURL(
    (url) => {
      const href = url.href.toLowerCase();
      return !href.includes("v.douyin.com/");
    },
    { timeout: 15000 },
  ).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

function toDouyinCookies(cookieHeader: string): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly?: boolean;
  sameSite: "Lax";
}> {
  const pairs = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf("=");
      if (separatorIndex <= 0) {
        return null;
      }
      return {
        name: item.slice(0, separatorIndex).trim(),
        value: item.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((item): item is { name: string; value: string } => Boolean(item?.name));

  const domains = [".douyin.com", ".iesdouyin.com"];
  return pairs.flatMap((pair) =>
    domains.map((domain) => ({
      ...pair,
      domain,
      path: "/",
      secure: true,
      sameSite: "Lax" as const,
    })),
  );
}

async function applyDouyinCookies(
  context: DouyinContext,
  cookieHeader?: string,
  chromeCookieLoader: typeof loadChromeCookiesForDomains = loadChromeCookiesForDomains,
): Promise<void> {
  let cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly?: boolean;
    expires?: number;
    sameSite?: "Lax" | "None" | "Strict";
  }> = [];

  if (cookieHeader?.trim()) {
    cookies = toDouyinCookies(cookieHeader);
    if (cookies.length === 0) {
      logger.warn("[video-source:douyin] cookie header provided but no valid cookies were parsed");
    }
  } else {
    cookies = chromeCookieLoader([".douyin.com", "www.douyin.com", ".iesdouyin.com", "iesdouyin.com"]);
    if (cookies.length > 0) {
      logger.info(`[video-source:douyin] loaded cookies from Chrome count=${cookies.length}`);
    }
  }

  if (cookies.length === 0) {
    return;
  }
  await context.addCookies(cookies);
}

async function clickDouyinPlayerCenter(page: DouyinPage): Promise<void> {
  if (!page.mouse?.click) {
    return;
  }
  try {
    await page.mouse.click(720, 420);
  } catch {
    // ignore click failures, they are only a hint for lazy-loaded playback
  }
}

async function tryEnableDouyinAudio(page: DouyinPage): Promise<void> {
  await page
    .evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      if (video) {
        video.muted = false;
        video.volume = 1;
        void video.play().catch(() => {});
      }

      const selectors = [
        '[aria-label*="取消静音"]',
        '[aria-label*="打开声音"]',
        '[aria-label*="声音"]',
        '[aria-label*="Unmute"]',
        '[aria-label*="unmute"]',
        '[title*="取消静音"]',
        '[title*="声音"]',
        '[data-e2e*="mute"]',
        '[data-e2e*="volume"]',
      ];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node instanceof HTMLElement) {
          try {
            node.click();
          } catch {
            // ignore
          }
        }
      }
    })
    .catch(() => {});
}

async function extractDouyinVideoFromPage(
  page: DouyinPage,
  options: DouyinExtractAttemptOptions = {
    attempts: 5,
    intervalMs: 800,
  },
): Promise<ExtractedDouyinVideo> {
  let lastError: unknown;
  let lastExtracted: ExtractedDouyinVideo | null = null;
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      if (attempt > 0) {
        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      }
      await page.waitForTimeout(options.intervalMs);
      if (options.clickCenter) {
        await clickDouyinPlayerCenter(page);
      }
      if (options.ensureAudio) {
        await tryEnableDouyinAudio(page);
        await page.waitForTimeout(500);
      }
      const extracted = await readDouyinPageDetails(page);
      lastExtracted = extracted;
      if (extracted.mediaUrl.trim()) {
        return extracted;
      }
    } catch (error) {
      lastError = error;
      if (!isExecutionContextDestroyedError(error) || attempt === options.attempts - 1) {
        throw error;
      }
      logger.warn(`[video-source:douyin] page context reset, retry=${attempt + 1}`);
      await page.waitForTimeout(1200);
    }
  }
  if (lastExtracted) {
    return lastExtracted;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function extractDouyinVideoWithBrowser(
  sourceUrl: string,
  cookieHeader?: string,
  loadChromeCookies?: typeof loadChromeCookiesForDomains,
  options: {
    headless: boolean;
    attempts: number;
    intervalMs: number;
    clickCenter?: boolean;
    ensureAudio?: boolean;
  } = {
    headless: true,
    attempts: 5,
    intervalMs: 800,
  },
): Promise<ExtractedDouyinVideo> {
  const networkMediaUrls = new Set<string>();
  const collectNetworkMediaUrl = (
    url: string,
    contentType?: string,
    resourceType?: string,
  ): void => {
    const value = (url || "").trim();
    if (!value) {
      return;
    }
    const lowerUrl = value.toLowerCase();
    const lowerType = (contentType || "").toLowerCase();
    const isMediaByUrl = /\.(mp4|m3u8|m4a|mp3|aac|webm|m4s)(\?|$)/i.test(lowerUrl);
    const isMediaByType = lowerType.startsWith("video/") || lowerType.startsWith("audio/");
    const isMediaResource = (resourceType || "").toLowerCase() === "media";
    if (isMediaByUrl || isMediaByType || isMediaResource) {
      networkMediaUrls.add(value);
    }
  };

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: options.headless, channel: "chrome" });
  const context = await browser.newContext();
  await applyDouyinCookies(context, cookieHeader, loadChromeCookies);
  const page = await context.newPage();
  const eventPage = page as unknown as {
    on?: (event: string, handler: (payload: unknown) => void) => unknown;
  };
  if (typeof eventPage.on === "function") {
    eventPage.on("response", (response: unknown) => {
      const item = response as {
        url?: () => string;
        headers?: () => Record<string, string>;
        request?: () => { resourceType?: () => string };
      };
      const url = item.url?.() || "";
      const headers = item.headers?.() || {};
      const contentType = headers["content-type"] || headers["Content-Type"] || "";
      const resourceType = item.request?.().resourceType?.() || "";
      collectNetworkMediaUrl(url, contentType, resourceType);
    });
    eventPage.on("requestfinished", (request: unknown) => {
      const item = request as {
        url?: () => string;
        resourceType?: () => string;
      };
      collectNetworkMediaUrl(item.url?.() || "", undefined, item.resourceType?.() || "");
    });
  }
  try {
    await waitForDouyinPageReady(page, sourceUrl);
    const extracted = await extractDouyinVideoFromPage(page, {
      attempts: options.attempts,
      intervalMs: options.intervalMs,
      clickCenter: options.clickCenter,
      ensureAudio: options.ensureAudio,
    });
    const mergedMediaUrls = Array.from(
      new Set([...(extracted.mediaUrls || []), ...Array.from(networkMediaUrls)].filter(Boolean)),
    );
    return {
      ...extracted,
      mediaUrl: extracted.mediaUrl || mergedMediaUrls[0] || "",
      mediaUrls: mergedMediaUrls,
    };
  } finally {
    await browser.close();
  }
}

async function extractDouyinVideoDefault(
  sourceUrl: string,
  cookieHeader?: string,
  loadChromeCookies?: typeof loadChromeCookiesForDomains,
): Promise<ExtractedDouyinVideo> {
  return extractDouyinVideoWithBrowser(sourceUrl, cookieHeader, loadChromeCookies, {
    headless: false,
    attempts: 12,
    intervalMs: 5000,
    clickCenter: true,
    ensureAudio: true,
  });
}

function sanitizeMediaFileName(input: string): string {
  return input
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/g, "")
    .slice(0, 120)
    .trim();
}

function inferDouyinMediaFileName(mediaUrl: string, preferredName?: string): string {
  const preferred = sanitizeMediaFileName(preferredName || "");
  if (preferred) {
    return preferred;
  }

  try {
    const pathname = new URL(mediaUrl).pathname;
    const rawBaseName = basename(pathname, extname(pathname));
    const normalized = sanitizeMediaFileName(rawBaseName);
    if (normalized) {
      return normalized;
    }
  } catch {
    // Fall through to default filename.
  }

  return "douyin-video";
}

async function downloadDouyinVideoDefault(
  mediaUrl: string,
  outputDir: string,
  preferredName?: string,
): Promise<string> {
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`media download failed: status=${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const extension = extname(new URL(mediaUrl).pathname) || ".mp4";
  const targetPath = join(outputDir, `${inferDouyinMediaFileName(mediaUrl, preferredName)}${extension}`);
  await writeFile(targetPath, bytes);
  return targetPath;
}

export async function resolveDouyinVideoSource(
  sourceUrl: string,
  options: ResolveDouyinVideoSourceOptions = {},
): Promise<ResolvedDouyinVideoSource> {
  const outputDir = options.outputDir || (await mkdtemp(join(tmpdir(), "cat-crawl/douyin")));
  const extractVideo = options.extractVideo || extractDouyinVideoDefault;
  const downloadVideo = options.downloadVideo || downloadDouyinVideoDefault;

  logger.info(`[video-source:douyin] start source=${sourceUrl}`);
  const extracted = await extractVideo(sourceUrl, options.cookieHeader, options.loadChromeCookies);
  const candidates = collectMediaCandidates(extracted);
  if (candidates.length === 0) {
    throw new Error("Douyin video URL not found.");
  }
  logger.info(
    `[video-source:douyin] media candidates=${candidates.length} sample=${candidates.slice(0, 3).join(" | ")}`,
  );

  const hasAudioTrack =
    options.hasAudioTrack || (!options.downloadVideo ? hasAudioTrackDefault : async () => true);
  let selectedPath = "";
  let selectedCandidate = "";
  let downloadedCount = 0;
  for (const candidate of candidates) {
    try {
      const mediaPath = await downloadVideo(candidate, outputDir, extracted.title);
      downloadedCount += 1;
      const hasAudio = await hasAudioTrack(mediaPath);
      if (hasAudio) {
        selectedPath = mediaPath;
        selectedCandidate = candidate;
        break;
      }
      logger.warn(`[video-source:douyin] candidate has no audio, retry next url=${candidate}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn(`[video-source:douyin] candidate download failed url=${candidate} msg=${detail}`);
    }
  }
  if (!selectedPath) {
    if (downloadedCount === 0) {
      throw new Error("Douyin video URL resolved, but no downloadable media candidate succeeded.");
    }
    throw new Error(
      "Douyin video URL resolved, but all downloaded candidates have no audio track. Please confirm the video has audible track in Chrome playback and try again.",
    );
  }
  logger.info(`[video-source:douyin] selected media candidate=${selectedCandidate}`);
  return {
    adapter: "douyin",
    sourceUrl: extracted.pageUrl || sourceUrl,
    mediaPath: selectedPath,
    title: extracted.title?.trim() || undefined,
    author: extracted.author?.trim() || undefined,
    published: extracted.published?.trim() || undefined,
  };
}
