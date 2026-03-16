import { createLogger } from "@cat-crawl/core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChromeCookiesForDomains } from "./chrome-cookies.js";

const logger = createLogger();

export const douyinVideoSourceAdapter = {
  name: "douyin",
} as const;

type ExtractedDouyinVideo = {
  pageUrl: string;
  mediaUrl: string;
  title?: string;
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
  downloadVideo?: (mediaUrl: string, outputDir: string) => Promise<string>;
};

type ResolvedDouyinVideoSource = {
  adapter: "douyin";
  sourceUrl: string;
  mediaPath: string;
  title?: string;
};

type DouyinExtractAttemptOptions = {
  attempts: number;
  intervalMs: number;
  clickCenter?: boolean;
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
}

async function waitForDouyinPageReady(page: DouyinPage, sourceUrl: string): Promise<void> {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
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
  } = {
    headless: true,
    attempts: 5,
    intervalMs: 800,
  },
): Promise<ExtractedDouyinVideo> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: options.headless, channel: "chrome" });
  const context = await browser.newContext();
  await applyDouyinCookies(context, cookieHeader, loadChromeCookies);
  const page = await context.newPage();
  try {
    await waitForDouyinPageReady(page, sourceUrl);
    return await extractDouyinVideoFromPage(page, {
      attempts: options.attempts,
      intervalMs: options.intervalMs,
      clickCenter: options.clickCenter,
    });
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
  });
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
  const extracted = await extractVideo(sourceUrl, options.cookieHeader, options.loadChromeCookies);
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

export const __test__ = {
  applyDouyinCookies,
  clickDouyinPlayerCenter,
  extractDouyinVideoFromPage,
  isExecutionContextDestroyedError,
  toDouyinCookies,
};
