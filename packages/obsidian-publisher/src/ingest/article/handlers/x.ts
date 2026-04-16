import { chromium } from "playwright";
import { extractWithDefuddle } from "../helpers/defuddle.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";
import { loadChromeCookiesForDomains, type ChromeCookie } from "../../video/helpers/chrome-cookies.js";

type BrowserCookie = ChromeCookie;

type XHandlerDeps = {
  fetchRenderedHtml?: (url: string, cookies: BrowserCookie[]) => Promise<string>;
  extractWithDefuddle?: typeof extractWithDefuddle;
  loadChromeCookies?: (domains: string[]) => BrowserCookie[];
};

type XPageLike = {
  waitForSelector: (
    selector: string,
    options?: { state?: "attached" | "visible"; timeout?: number },
  ) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
};

function extractRenderedMainHtml(html: string): string | null {
  return html.match(/<main\b[^>]*>[\s\S]*<\/main>/i)?.[0] || null;
}

function sliceRenderedHtmlForDefuddle(html: string): string {
  const mainHtml = extractRenderedMainHtml(html);
  if (!mainHtml) {
    return html;
  }

  const docTypeMatch = html.match(/<!doctype[^>]*>/i);
  const headMatch = html.match(/<head\b[^>]*>[\s\S]*<\/head>/i);
  const docType = docTypeMatch?.[0] || "<!DOCTYPE html>";
  const head = headMatch?.[0] || "<head></head>";
  return `${docType}<html>${head}<body>${mainHtml}</body></html>`;
}

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

async function waitForRenderedMain(page: XPageLike): Promise<void> {
  await page.waitForSelector("main", { state: "attached", timeout: 15000 });
  await page.waitForSelector('main article[data-testid="tweet"]', {
    state: "attached",
    timeout: 15000,
  });
  await page.waitForTimeout(1000);
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
    await waitForRenderedMain(page);
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
      const extracted = await parseWithDefuddle(
        sliceRenderedHtmlForDefuddle(html),
        requestedUrl,
      );
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
      return context.crawlWithBrowserAdapter(requestedUrl, "generic", { cookies });
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
