import { chromium } from "playwright";
import {
  BROWSER_SCRAPE_FUNCTION_SOURCE,
  createBrowserScrapeFunction,
} from "../helpers/browser.js";
import { normalizePublishedDateWithFallback } from "../helpers/dates.js";
import { extractWithDefuddle } from "../helpers/defuddle.js";
import { createTurndownService, toMarkdown } from "../helpers/markdown.js";
import { normalizeUrl, resolveSourceUrl } from "../helpers/urls.js";
import { ChatGPTHandler } from "../handlers/chatgpt.js";
import type {
  ArticleAdapterName,
  CrawlBrowserAdapterOptions,
  CrawlLogger,
  IngestContentResult,
} from "../types.js";

export type BrowserScrapeResult = {
  title: string;
  author: string | null;
  published: string | null;
  publishedTimestamp: number | null;
  contentHtml: string;
  xContentMarkdown: string;
  carouselImages: string[];
  canonical: string | null;
};

const chatgptHandler = new ChatGPTHandler();

function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers")
  );
}

function needsStealthBrowser(adapter: ArticleAdapterName): boolean {
  return adapter === "zhihu" || adapter === "csdn";
}

function getBrowserWaitMs(adapter: ArticleAdapterName): number {
  if (adapter === "zhihu") {
    return 4000;
  }
  if (adapter === "csdn") {
    return 9000;
  }
  return 2200;
}

type PlaywrightPage = { evaluate: <T>(fn: () => T) => Promise<T>; waitForTimeout: (ms: number) => Promise<void> };

async function waitForContentStable(
  page: PlaywrightPage,
  { pollInterval = 500, maxWait = 10000 }: { pollInterval?: number; maxWait?: number } = {},
): Promise<void> {
  let lastLength = 0;
  let stableCount = 0;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const currentLength = await page.evaluate(() => document.body?.innerHTML?.length ?? 0);
    if (currentLength === lastLength && currentLength > 0) {
      stableCount++;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
    }
    lastLength = currentLength;
    await page.waitForTimeout(pollInterval);
  }
}

export async function crawlBrowserAdapterArticle(
  url: string,
  adapter: ArticleAdapterName,
  logger?: CrawlLogger,
  options: CrawlBrowserAdapterOptions = {},
): Promise<IngestContentResult> {
  const launchOptions = needsStealthBrowser(adapter)
    ? { headless: true as const, args: ["--disable-blink-features=AutomationControlled"] }
    : { headless: true as const };
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    logger?.info?.("[tool:crawl_web_article] using bundled playwright chromium");
  } catch (error) {
    if (!isMissingPlaywrightBrowserError(error)) {
      throw error;
    }
    logger?.warn?.("[tool:crawl_web_article] bundled chromium missing, fallback to local Chrome channel");
    browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
    logger?.info?.("[tool:crawl_web_article] using local chrome channel");
  }

  const context = needsStealthBrowser(adapter)
    ? await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        locale: "zh-CN",
        extraHTTPHeaders: {
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      })
    : await browser.newContext();
  if (needsStealthBrowser(adapter)) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });
  }
  if ((options.cookies || []).length > 0) {
    await context.addCookies(options.cookies || []);
  }

  const page = await context.newPage();
  try {
    const waitUntil = adapter === "generic" ? "load" as const : "domcontentloaded" as const;
    await page.goto(url, { waitUntil, timeout: 45000 });
    if (adapter === "generic") {
      await waitForContentStable(page);
    } else {
      await page.waitForTimeout(getBrowserWaitMs(adapter));
    }

    if (adapter === "chatgpt") {
      const pageHtml = await page.content();
      const chatgptResult = chatgptHandler.parseShareHtml(pageHtml, url);
      if (chatgptResult) {
        logger?.info?.("[tool:crawl_web_article] chatgpt page html parse succeeded");
        return chatgptResult;
      }
    }

    if (adapter === "generic") {
      const pageHtml = await page.content();
      const defuddleResult = await extractWithDefuddle(pageHtml, url);
      if (defuddleResult) {
        logger?.info?.("[tool:crawl_web_article] generic defuddle parse succeeded");
        return defuddleResult;
      }
      logger?.info?.("[tool:crawl_web_article] generic defuddle parse yielded no content");
    }

    const scraped = await page.evaluate(
      createBrowserScrapeFunction<[ArticleAdapterName], BrowserScrapeResult>(
        BROWSER_SCRAPE_FUNCTION_SOURCE,
      ),
      adapter,
    );

    const turndown = createTurndownService();
    const markdownBody =
      adapter === "x" && scraped.xContentMarkdown
        ? scraped.xContentMarkdown
        : turndown.turndown(scraped.contentHtml || "");
    const carouselMarkdown = (scraped.carouselImages || [])
      .map((src: string, index: number) => `![Carousel ${index + 1}](${normalizeUrl(src)})`)
      .join("\n\n");
    const contentBody = [carouselMarkdown, markdownBody]
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 30000);
    if (!contentBody) {
      throw new Error("Failed to extract article content.");
    }

    const sourceUrl = resolveSourceUrl(url, scraped.canonical);
    const published = normalizePublishedDateWithFallback(
      scraped.published,
      scraped.publishedTimestamp ?? null,
    );
    return {
      title: scraped.title,
      author: scraped.author,
      published,
      source_url: sourceUrl,
      content_markdown: toMarkdown({
        title: scraped.title,
        author: scraped.author,
        published,
        sourceUrl,
        contentBody,
      }),
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
