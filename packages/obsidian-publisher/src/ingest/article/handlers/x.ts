import { chromium } from "playwright";
import { extractWithDefuddle } from "../helpers/defuddle.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";
import { loadChromeCookiesForDomains } from "../../video/helpers/chrome-cookies.js";

type BrowserCookie = ReturnType<typeof loadChromeCookiesForDomains>[number];

type XHandlerDeps = {
  fetchRenderedHtml?: (url: string, cookies: BrowserCookie[]) => Promise<string>;
  extractWithDefuddle?: typeof extractWithDefuddle;
  loadChromeCookies?: (domains: string[]) => BrowserCookie[];
};

function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers")
  );
}

function normalizeXSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = "x.com";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

async function fetchRenderedHtmlDefault(url: string, cookies: BrowserCookie[]): Promise<string> {
  const launchOptions = { headless: true as const, args: ["--disable-blink-features=AutomationControlled"] };
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (error) {
    if (!isMissingPlaywrightBrowserError(error)) {
      throw error;
    }
    browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
  }

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    locale: "en-US",
    extraHTTPHeaders: {
      "accept-language": "en-US,en;q=0.9",
    },
  });

  if (cookies.length > 0) {
    await context.addCookies(
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expires: cookie.expires,
        sameSite: cookie.sameSite,
      })),
    );
  }

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);
    return await page.content();
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export class XHandler extends BaseArticleHandler {
  readonly name = "x";

  constructor(private readonly deps: XHandlerDeps = {}) {
    super();
  }

  canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("x.com") || host.includes("twitter.com");
  }

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    const requestedUrl = normalizeXSourceUrl(url.toString());
    const renderHtml = this.deps.fetchRenderedHtml || fetchRenderedHtmlDefault;
    const parseWithDefuddle = this.deps.extractWithDefuddle || extractWithDefuddle;
    const cookies = this.loadChromeCookies();

    try {
      const html = await renderHtml(requestedUrl, cookies);
      const extracted = await parseWithDefuddle(html, requestedUrl);
      if (!extracted) {
        throw new Error("x defuddle parse failed");
      }
      return {
        ...extracted,
        source_url: normalizeXSourceUrl(extracted.source_url || requestedUrl),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.logger?.warn?.(`[tool:crawl_web_article] x defuddle parse failed: ${detail}`);
      return context.crawlWithBrowserAdapter(requestedUrl, "generic");
    }
  }

  private loadChromeCookies(): BrowserCookie[] {
    const loader = this.deps.loadChromeCookies || loadChromeCookiesForDomains;
    try {
      return loader([".x.com", "x.com", ".twitter.com", "twitter.com"]);
    } catch {
      return [];
    }
  }
}
