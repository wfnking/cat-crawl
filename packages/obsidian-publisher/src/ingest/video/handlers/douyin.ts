import { createLogger } from "@cat-crawl/core";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import type { BrowserContext } from "playwright";
import { loadChromeCookiesForDomains } from "../helpers/chrome-cookies.js";

const logger = createLogger();
const execFileAsync = promisify(execFile);

export const douyinVideoHandler = {
  name: "douyin",
} as const;

const DOUYIN_REJECTED_MEDIA_HOST_SUFFIXES: string[] = ["byteeffecttos.com"];

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
  evaluate: <T, A = undefined>(
    pageFunction: A extends undefined ? () => T : (arg: A) => T,
    arg?: A,
  ) => Promise<T>;
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

export type DouyinDownloadFetchContext = {
  cookieHeader?: string;
  referer?: string;
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
  downloadVideo?: (
    mediaUrl: string,
    outputDir: string,
    preferredName?: string,
    fetchContext?: DouyinDownloadFetchContext,
  ) => Promise<string>;
  hasAudioTrack?: (mediaPath: string) => Promise<boolean>;
  hasVideoTrack?: (mediaPath: string) => Promise<boolean>;
  noAudioRetryDelayMs?: number;
  noAudioRetryAttempts?: number;
  waitBeforeRetry?: (timeoutMs: number) => Promise<void>;
};

type ResolvedDouyinVideoSource = {
  adapter: "douyin";
  sourceUrl: string;
  mediaPath: string;
  title?: string;
  author?: string;
  published?: string;
};

type DownloadCandidateResult = {
  selectedPath: string;
  selectedCandidate: string;
  downloadedCount: number;
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
  return page.evaluate((rejectedSuffixes) => {
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
    const videoEl = document.querySelector("video");
    const currentVideoSourceRaw =
      videoEl && "currentSrc" in videoEl
        ? String((videoEl as { currentSrc?: string }).currentSrc || "").trim()
        : "";
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
      const match = publishedRaw.match(/(\d{4}-\d{2}-\d{2})/);
      published = match ? match[1] : publishedRaw;
    }

    const mediaUrls = Array.from(
      new Set([ogVideo, currentVideoSource, ...sourceUrls, videoSource, ...resourceUrls].filter(Boolean)),
    ).filter((u) => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return false;
        }
        const h = parsed.hostname.toLowerCase();
        const blocked = rejectedSuffixes.some((suffix) => h === suffix || h.endsWith("." + suffix));
        return !blocked;
      } catch {
        return false;
      }
    });
    return {
      pageUrl: window.location.href,
      mediaUrl: mediaUrls[0] || "",
      mediaUrls,
      title,
      author,
      published,
    };
  }, DOUYIN_REJECTED_MEDIA_HOST_SUFFIXES);
}

function hostnameMatchesRejectedMediaSuffix(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return DOUYIN_REJECTED_MEDIA_HOST_SUFFIXES.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

function isRejectedDouyinMediaUrl(url: string): boolean {
  try {
    return hostnameMatchesRejectedMediaSuffix(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isNodeFetchableHttpUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeDouyinNetworkMediaRequest(
  lowerUrl: string,
  contentType: string | undefined,
  resourceType: string,
): boolean {
  const lowerType = (contentType || "").toLowerCase();
  const rt = resourceType.toLowerCase();
  if (/\.(mp4|m3u8|m4a|mp3|aac|webm|m4s|flv)(\?|#|$)/i.test(lowerUrl)) {
    return true;
  }
  if (/\/aweme\/v\d+\/play\b/i.test(lowerUrl)) {
    return true;
  }
  if (/\/video\/tos\//i.test(lowerUrl)) {
    return true;
  }
  if (lowerType.startsWith("video/") || lowerType.startsWith("audio/")) {
    return true;
  }
  if (rt === "media") {
    return true;
  }
  if (rt === "xhr" || rt === "fetch") {
    if (
      lowerType.includes("video") ||
      lowerType.includes("audio") ||
      (lowerType.includes("octet-stream") &&
        (/douyinstatic\.com|bytecdn|pstatp\.com|snssdk\.com|douyin\.com\/aweme/i.test(lowerUrl) ||
          /\/video\/tos\//i.test(lowerUrl)))
    ) {
      return true;
    }
  }
  return false;
}

function findDouyinSplitVideoAudioPair(candidates: string[]): { videoUrl: string; audioUrl: string } | null {
  const videoUrls = candidates.filter((u) => /media-video/i.test(u));
  const audioUrls = candidates.filter((u) => /media-audio/i.test(u));
  if (videoUrls.length === 0 || audioUrls.length === 0) {
    return null;
  }
  return { videoUrl: videoUrls[0], audioUrl: audioUrls[0] };
}

async function muxDouyinSplitStreamsWithFfmpeg(videoPath: string, audioPath: string, outputPath: string) {
  await execFileAsync(
    "ffmpeg",
    ["-y", "-i", videoPath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest", outputPath],
    { maxBuffer: 16 * 1024 * 1024 },
  );
}

async function safeUnlink(p: string) {
  try {
    await unlink(p);
  } catch {
    /* ignore */
  }
}

async function tryMuxDouyinSplitPair(
  pair: { videoUrl: string; audioUrl: string },
  outputDir: string,
  preferredName: string | undefined,
  downloadVideo: (
    mediaUrl: string,
    outputDir: string,
    preferredName?: string,
    fetchContext?: DouyinDownloadFetchContext,
  ) => Promise<string>,
  verifyMedia: (mediaPath: string) => Promise<boolean>,
  fetchContext?: DouyinDownloadFetchContext,
): Promise<DownloadCandidateResult | null> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let videoPath = "";
  let audioPath = "";
  let outPath = "";
  try {
    await mkdir(outputDir, { recursive: true });
    logger.info("[video-source:douyin] split CDN: download video+audio then ffmpeg mux");
    videoPath = await downloadVideo(pair.videoUrl, outputDir, `.douyin-split-${id}-v`, fetchContext);
    audioPath = await downloadVideo(pair.audioUrl, outputDir, `.douyin-split-${id}-a`, fetchContext);
    outPath = join(outputDir, `${inferDouyinMediaFileName(pair.videoUrl, preferredName)}.mp4`);
    await muxDouyinSplitStreamsWithFfmpeg(videoPath, audioPath, outPath);
    if (!(await verifyMedia(outPath))) {
      logger.warn("[video-source:douyin] muxed file failed verification, will try single URLs");
      await safeUnlink(outPath);
      return null;
    }
    return {
      selectedPath: outPath,
      selectedCandidate: `${pair.videoUrl} |+ ${pair.audioUrl}`,
      downloadedCount: 2,
    };
  } catch (error) {
    logger.warn(
      `[video-source:douyin] split mux failed msg=${error instanceof Error ? error.message : String(error)}`,
    );
    if (outPath) await safeUnlink(outPath);
    return null;
  } finally {
    if (videoPath) await safeUnlink(videoPath);
    if (audioPath) await safeUnlink(audioPath);
  }
}

function collectMediaCandidates(extracted: ExtractedDouyinVideo): string[] {
  const primary = extracted.mediaUrl?.trim() || "";
  const extras = extracted.mediaUrls || [];
  const all = Array.from(
    new Set([primary, ...extras].map((item) => item.trim()).filter(Boolean).filter(isNodeFetchableHttpUrl)),
  );
  const stripRejectedHosts = (urls: string[]) => urls.filter((url) => !isRejectedDouyinMediaUrl(url));
  const stripPlaceholder = (urls: string[]) =>
    urls.filter((url) => !url.toLowerCase().includes("/obj/douyin-pc-web/uuu_"));
  const filtered = stripRejectedHosts(stripPlaceholder(all));
  const merged =
    filtered.length > 0 ? filtered : stripRejectedHosts(all);
  return merged;
}

async function ffprobeHasStream(mediaPath: string, kind: "audio" | "video"): Promise<boolean> {
  const sel = kind === "audio" ? "a" : "v";
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        sel,
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
      .some((line) => line === kind);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes("spawn ffprobe ENOENT")) {
      logger.warn(`[video-source:douyin] ffprobe not found, skip ${kind} verification`);
      return true;
    }
    logger.warn(`[video-source:douyin] ffprobe ${kind} check failed msg=${detail}`);
    return false;
  }
}

const hasAudioTrackDefault = (p: string) => ffprobeHasStream(p, "audio");
const hasVideoStreamDefault = (p: string) => ffprobeHasStream(p, "video");

function buildMediaVerifier(options: ResolveDouyinVideoSourceOptions): (mediaPath: string) => Promise<boolean> {
  const skipVerification =
    Boolean(options.downloadVideo) &&
    options.hasAudioTrack === undefined &&
    options.hasVideoTrack === undefined;

  if (skipVerification) {
    return async () => true;
  }

  const audioFn = options.hasAudioTrack ?? hasAudioTrackDefault;
  const videoFn = options.hasVideoTrack ?? hasVideoStreamDefault;
  return async (mediaPath: string) => {
    const okAudio = await audioFn(mediaPath);
    const okVideo = await videoFn(mediaPath);
    return okAudio && okVideo;
  };
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
      const video = document.querySelector("video");
      if (video) {
        video.muted = false;
        video.volume = 1;
        try {
          void video.play();
        } catch {
          /* ignore */
        }
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
      let extracted: ExtractedDouyinVideo;
      if (options.ensureAudio) {
        await tryEnableDouyinAudio(page);
        await page.waitForTimeout(1000);
        extracted = await readDouyinPageDetails(page);
      } else {
        extracted = await readDouyinPageDetails(page);
      }
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

type DouyinBrowserSessionOptions = {
  headless: boolean;
  attempts: number;
  intervalMs: number;
  clickCenter?: boolean;
  ensureAudio?: boolean;
};

type DouyinBrowserSession = {
  extracted: ExtractedDouyinVideo;
  downloadMedia: (mediaUrl: string, outputDir: string, preferredName?: string) => Promise<string>;
  close: () => Promise<void>;
};

async function downloadDouyinMediaViaBrowserRequest(
  context: BrowserContext,
  referer: string,
  mediaUrl: string,
  outputDir: string,
  preferredName?: string,
): Promise<string> {
  const response = await context.request.get(mediaUrl, {
    headers: {
      Referer: referer,
      Accept: "*/*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    timeout: 180_000,
  });
  if (!response.ok()) {
    throw new Error(`media download failed: status=${response.status()}`);
  }
  const buffer = Buffer.from(await response.body());
  const extension = extname(new URL(mediaUrl).pathname) || ".mp4";
  const targetPath = join(outputDir, `${inferDouyinMediaFileName(mediaUrl, preferredName)}${extension}`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(targetPath, buffer);
  return targetPath;
}

async function openDouyinBrowserSession(
  sourceUrl: string,
  cookieHeader: string | undefined,
  loadChromeCookies: typeof loadChromeCookiesForDomains | undefined,
  options: DouyinBrowserSessionOptions,
): Promise<DouyinBrowserSession> {
  const networkMediaUrls = new Set<string>();
  const collectNetworkMediaUrl = (
    url: string,
    contentType?: string,
    resourceType?: string,
  ): void => {
    const value = (url || "").trim();
    if (!value || !isNodeFetchableHttpUrl(value)) {
      return;
    }
    const lowerUrl = value.toLowerCase();
    if (!looksLikeDouyinNetworkMediaRequest(lowerUrl, contentType, resourceType || "")) {
      return;
    }
    if (!isRejectedDouyinMediaUrl(value)) {
      networkMediaUrls.add(value);
    }
  };

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: options.headless, channel: "chrome" });
  const context = await browser.newContext();
  await applyDouyinCookies(context, cookieHeader, loadChromeCookies);
  const page = await context.newPage();
  page.on("request", (request) => {
    collectNetworkMediaUrl(request.url(), undefined, request.resourceType());
  });
  page.on("response", (response) => {
    const headers = response.headers();
    const contentType = headers["content-type"] ?? headers["Content-Type"] ?? "";
    collectNetworkMediaUrl(response.url(), contentType, response.request().resourceType());
  });
  page.on("requestfinished", (request) => {
    collectNetworkMediaUrl(request.url(), undefined, request.resourceType());
  });

  await waitForDouyinPageReady(page, sourceUrl);
  const extracted = await extractDouyinVideoFromPage(page, {
    attempts: options.attempts,
    intervalMs: options.intervalMs,
    clickCenter: options.clickCenter,
    ensureAudio: options.ensureAudio,
  });
  const mergedMediaUrls = Array.from(
    new Set(
      [...Array.from(networkMediaUrls), ...(extracted.mediaUrls || []), extracted.mediaUrl].filter(Boolean),
    ),
  ).filter((u) => !isRejectedDouyinMediaUrl(u) && isNodeFetchableHttpUrl(u));
  const extractedFinal: ExtractedDouyinVideo = {
    ...extracted,
    mediaUrl:
      mergedMediaUrls[0] ||
      (extracted.mediaUrl &&
      !isRejectedDouyinMediaUrl(extracted.mediaUrl) &&
      isNodeFetchableHttpUrl(extracted.mediaUrl)
        ? extracted.mediaUrl
        : ""),
    mediaUrls: mergedMediaUrls,
  };

  const referer = extractedFinal.pageUrl?.trim() || sourceUrl;

  return {
    extracted: extractedFinal,
    downloadMedia: (mediaUrl, outputDir, preferredName) =>
      downloadDouyinMediaViaBrowserRequest(context, referer, mediaUrl, outputDir, preferredName),
    close: async () => {
      await browser.close();
    },
  };
}

async function extractDouyinVideoWithBrowser(
  sourceUrl: string,
  cookieHeader?: string,
  loadChromeCookies?: typeof loadChromeCookiesForDomains,
  options: DouyinBrowserSessionOptions = {
    headless: true,
    attempts: 5,
    intervalMs: 800,
  },
): Promise<ExtractedDouyinVideo> {
  const session = await openDouyinBrowserSession(sourceUrl, cookieHeader, loadChromeCookies, options);
  try {
    return session.extracted;
  } finally {
    await session.close();
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

const CHROME_LIKE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
  fetchContext?: DouyinDownloadFetchContext,
): Promise<string> {
  const headers = new Headers();
  const cookie = fetchContext?.cookieHeader?.trim();
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  const referer = fetchContext?.referer?.trim();
  if (referer) {
    headers.set("Referer", referer);
  }
  headers.set("User-Agent", CHROME_LIKE_UA);
  headers.set("Accept", "*/*");
  headers.set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");

  const response = await fetch(mediaUrl, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`media download failed: status=${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const extension = extname(new URL(mediaUrl).pathname) || ".mp4";
  const targetPath = join(outputDir, `${inferDouyinMediaFileName(mediaUrl, preferredName)}${extension}`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(targetPath, bytes);
  return targetPath;
}

function waitBeforeRetryDefault(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

async function downloadFirstCandidateWithAudio(
  candidates: string[],
  outputDir: string,
  preferredName: string | undefined,
  downloadVideo: (
    mediaUrl: string,
    outputDir: string,
    preferredName?: string,
    fetchContext?: DouyinDownloadFetchContext,
  ) => Promise<string>,
  verifyMedia: (mediaPath: string) => Promise<boolean>,
  fetchContext?: DouyinDownloadFetchContext,
): Promise<DownloadCandidateResult> {
  const splitPair = findDouyinSplitVideoAudioPair(candidates);
  if (splitPair) {
    const muxed = await tryMuxDouyinSplitPair(
      splitPair,
      outputDir,
      preferredName,
      downloadVideo,
      verifyMedia,
      fetchContext,
    );
    if (muxed?.selectedPath) {
      return muxed;
    }
  }

  let selectedPath = "";
  let selectedCandidate = "";
  let downloadedCount = 0;

  for (const candidate of candidates) {
    try {
      const mediaPath = await downloadVideo(candidate, outputDir, preferredName, fetchContext);
      downloadedCount += 1;
      const ok = await verifyMedia(mediaPath);
      if (ok) {
        selectedPath = mediaPath;
        selectedCandidate = candidate;
        break;
      }
      logger.warn(
        `[video-source:douyin] candidate failed verification (need muxed video+audio), retry next url=${candidate}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn(`[video-source:douyin] candidate download failed url=${candidate} msg=${detail}`);
    }
  }

  return {
    selectedPath,
    selectedCandidate,
    downloadedCount,
  };
}

function toResolvedDouyinVideo(
  extracted: ExtractedDouyinVideo,
  sourceUrl: string,
  downloadResult: DownloadCandidateResult,
): ResolvedDouyinVideoSource {
  logger.info(`[video-source:douyin] selected media candidate=${downloadResult.selectedCandidate}`);
  return {
    adapter: "douyin",
    sourceUrl: extracted.pageUrl || sourceUrl,
    mediaPath: downloadResult.selectedPath,
    title: extracted.title?.trim() || undefined,
    author: extracted.author?.trim() || undefined,
    published: extracted.published?.trim() || undefined,
  };
}

export async function resolveDouyinVideoSource(
  sourceUrl: string,
  options: ResolveDouyinVideoSourceOptions = {},
): Promise<ResolvedDouyinVideoSource> {
  const tempRootDir = join(tmpdir(), "cat-crawl");
  await mkdir(tempRootDir, { recursive: true });
  const outputDir = options.outputDir || (await mkdtemp(join(tempRootDir, "douyin-")));
  const noAudioRetryDelayMs = options.noAudioRetryDelayMs ?? 5000;
  const noAudioRetryAttempts = options.noAudioRetryAttempts ?? 1;
  const waitBeforeRetry = options.waitBeforeRetry || waitBeforeRetryDefault;

  const useBrowserRequestDownload = !options.extractVideo && !options.downloadVideo;

  logger.info(`[video-source:douyin] start source=${sourceUrl}`);
  const verifyMedia = buildMediaVerifier(options);

  const browserExtractOptions: DouyinBrowserSessionOptions = {
    headless: false,
    attempts: 12,
    intervalMs: 5000,
    clickCenter: true,
    ensureAudio: true,
  };

  for (let attempt = 0; attempt <= noAudioRetryAttempts; attempt += 1) {
    let session: DouyinBrowserSession | null = null;
    try {
      let extracted: ExtractedDouyinVideo;
      if (useBrowserRequestDownload) {
        session = await openDouyinBrowserSession(
          sourceUrl,
          options.cookieHeader,
          options.loadChromeCookies,
          browserExtractOptions,
        );
        extracted = session.extracted;
      } else {
        extracted = await (options.extractVideo || extractDouyinVideoDefault)(
          sourceUrl,
          options.cookieHeader,
          options.loadChromeCookies,
        );
      }

      const candidates = collectMediaCandidates(extracted);
      if (candidates.length === 0) {
        throw new Error("Douyin video URL not found.");
      }
      logger.info(
        `[video-source:douyin] media candidates=${candidates.length} sample=${candidates.slice(0, 3).join(" | ")}`,
      );

      const fetchContext: DouyinDownloadFetchContext | undefined = useBrowserRequestDownload
        ? undefined
        : {
            cookieHeader: options.cookieHeader,
            referer: extracted.pageUrl?.trim() || sourceUrl,
          };

      const browserSession = session;
      const downloadVideo =
        browserSession !== null
          ? (u: string, d: string, n?: string) => browserSession.downloadMedia(u, d, n)
          : options.downloadVideo ||
            ((u, d, n, fc) => downloadDouyinVideoDefault(u, d, n, fc ?? fetchContext!));

      const downloadResult = await downloadFirstCandidateWithAudio(
        candidates,
        outputDir,
        extracted.title,
        downloadVideo,
        verifyMedia,
        fetchContext,
      );

      if (downloadResult.selectedPath) {
        return toResolvedDouyinVideo(extracted, sourceUrl, downloadResult);
      }
      if (downloadResult.downloadedCount === 0) {
        throw new Error("Douyin video URL resolved, but no downloadable media candidate succeeded.");
      }
      if (attempt < noAudioRetryAttempts) {
        logger.warn(
          `[video-source:douyin] all downloaded candidates failed muxed verification, wait ${noAudioRetryDelayMs}ms before re-extract retry=${attempt + 1}`,
        );
        await waitBeforeRetry(noAudioRetryDelayMs);
      }
    } finally {
      await session?.close();
    }
  }

  throw new Error(
    "Douyin video URL resolved, but no downloaded file passed muxed verification (ffprobe: both video and audio required). Douyin often serves audio-only and video-only URLs separately; another candidate may be needed.",
  );
}
