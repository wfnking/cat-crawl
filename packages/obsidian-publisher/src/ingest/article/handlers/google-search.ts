import { chromium } from "playwright";
import { loadChromeCookiesForDomains } from "../../video/helpers/chrome-cookies.js";
import { createBrowserScrapeFunction } from "../helpers/browser.js";
import { decodeHtmlEntities, extractHtmlTitle, stripHtmlTags } from "../helpers/html.js";
import { toMarkdown } from "../helpers/markdown.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";

type GoogleSearchResultItem = {
  title: string;
  url: string;
  snippet: string | null;
};

type RenderedGoogleSearch = {
  title: string | null;
  content: string | null;
};

type BrowserCookie = ReturnType<typeof loadChromeCookiesForDomains>[number];

type GoogleSearchHandlerDeps = {
  fetchPageHtml?: (url: string) => Promise<string>;
  fetchResolvedSearchHtml?: (url: string) => Promise<string>;
  loadChromeCookies?: (domains: string[]) => BrowserCookie[];
  crawlRenderedSearch?: (url: string, cookies: BrowserCookie[]) => Promise<RenderedGoogleSearch | null>;
};

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

const GOOGLE_RENDERED_SEARCH_FUNCTION_SOURCE = String.raw`function() {
  const bodyText = document.body?.innerText || '';
  if (/our systems have detected unusual traffic|about this page/i.test(bodyText)) {
    return null;
  }

  const cleanLines = (text) => text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^Good response|^Bad response|^Thank you|^Share more feedback|^Report a problem|^Close$/i.test(line))
    .filter((line) => !/^\d+\s+sites$/i.test(line))
    .filter((line) => !/^About this result$/i.test(line));

  const aiRoot = document.querySelector('[data-xid="aim-mars-turn-root"]');
  if (aiRoot instanceof HTMLElement) {
    const lines = cleanLines(aiRoot.innerText || '');
    const links = Array.from(aiRoot.querySelectorAll('a[href]'))
      .map((element) => {
        const href = element.getAttribute('href') || '';
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        if (!href.startsWith('http') || !text) {
          return null;
        }
        if (/^sign in$/i.test(text)) {
          return null;
        }
        return { text, href };
      })
      .filter(Boolean)
      .slice(0, 8);
    const contentParts = [lines.join('\n')];
    if (links.length > 0) {
      contentParts.push(
        '## Sources',
        links.map((link) => '- [' + link.text + '](' + link.href + ')').join('\n'),
      );
    }
    return {
      title: document.title || null,
      content: contentParts.filter(Boolean).join('\n\n').trim(),
    };
  }

  const isProbablyNoise = (text) => {
    const sample = text.slice(0, 600);
    const punctuationCount = (sample.match(/[{};]/g) || []).length;
    return (
      sample.includes(':root{') ||
      sample.includes('CopiedCopyEdit') ||
      sample.includes('--') ||
      punctuationCount > 12
    );
  };

  const containers = Array.from(document.querySelectorAll('div[style*="display: contents"]'));
  const content = containers
    .map((element) => (element.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((text) => text.length > 80 && !isProbablyNoise(text))
    .slice(0, 3)
    .join('\n\n')
    .trim();
  if (!content) {
    return null;
  }
  return {
    title: document.title || null,
    content,
  };
}`;

export class GoogleSearchHandler extends BaseArticleHandler {
  readonly name = "google_search";

  constructor(private readonly deps: GoogleSearchHandlerDeps = {}) {
    super();
  }

  canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return (host === "google.com" || host.endsWith(".google.com")) && url.pathname === "/search";
  }

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    const sourceUrl = url.toString();
    const query = this.extractQuery(sourceUrl);
    const rendered = await this.crawlRenderedSearch(sourceUrl, context);
    if (rendered?.content) {
      context.logger?.info?.("[tool:crawl_web_article] google search rendered parse succeeded");
      return this.buildRenderedResult(query, sourceUrl, rendered);
    }

    const initialHtml = await this.fetchPageHtml(sourceUrl);
    const initialResults = this.parseSearchResults(initialHtml);
    if (initialResults.length > 0) {
      context.logger?.info?.("[tool:crawl_web_article] google search parse succeeded");
      return this.buildSearchResult(query, sourceUrl, initialHtml, initialResults, null);
    }

    const fallbackUrl = this.extractFallbackSearchUrl(initialHtml, sourceUrl);
    if (fallbackUrl) {
      try {
        const resolvedHtml = await this.fetchResolvedSearchHtml(fallbackUrl);
        const resolvedResults = this.parseSearchResults(resolvedHtml);
        if (resolvedResults.length > 0) {
          context.logger?.info?.("[tool:crawl_web_article] google fallback search parse succeeded");
          return this.buildSearchResult(query, sourceUrl, resolvedHtml, resolvedResults, fallbackUrl);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        context.logger?.warn?.(`[tool:crawl_web_article] google fallback search parse failed: ${detail}`);
      }
    }

    context.logger?.warn?.("[tool:crawl_web_article] google search fallback note generated");
    return this.buildFallbackResult(query, sourceUrl, fallbackUrl);
  }

  private async crawlRenderedSearch(url: string, context: CrawlContext): Promise<RenderedGoogleSearch | null> {
    const cookies = this.loadChromeCookies();
    if (this.deps.crawlRenderedSearch) {
      return this.deps.crawlRenderedSearch(url, cookies);
    }

    let browser;
    let browserContext;
    try {
      browser = await chromium.launch({ headless: true, channel: "chrome" }).catch(() =>
        chromium.launch({ headless: true }),
      );
      browserContext = await browser.newContext({
        userAgent: DEFAULT_HEADERS["user-agent"],
        locale: "en-US",
        extraHTTPHeaders: {
          "accept-language": DEFAULT_HEADERS["accept-language"],
        },
      });
      if (cookies.length > 0) {
        await browserContext.addCookies(
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
      const page = await browserContext.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(5000);
        const rendered = await page.evaluate(createBrowserScrapeFunction<[], RenderedGoogleSearch | null>(GOOGLE_RENDERED_SEARCH_FUNCTION_SOURCE));
        return rendered;
      } finally {
        await page.close().catch(() => {});
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.logger?.warn?.(`[tool:crawl_web_article] google rendered parse failed: ${detail}`);
      return null;
    } finally {
      await browserContext?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  private loadChromeCookies(): BrowserCookie[] {
    const loader = this.deps.loadChromeCookies || loadChromeCookiesForDomains;
    try {
      return loader([".google.com", "google.com"]);
    } catch {
      return [];
    }
  }

  private async fetchPageHtml(url: string): Promise<string> {
    if (this.deps.fetchPageHtml) {
      return this.deps.fetchPageHtml(url);
    }
    return this.fetchHtml(url);
  }

  private async fetchResolvedSearchHtml(url: string): Promise<string> {
    if (this.deps.fetchResolvedSearchHtml) {
      return this.deps.fetchResolvedSearchHtml(url);
    }
    return this.fetchHtml(url);
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
      throw new Error(`google request failed with ${response.status}`);
    }
    return response.text();
  }

  private extractQuery(url: string): string {
    const parsed = new URL(url);
    return parsed.searchParams.get("q")?.trim() || "Google Search";
  }

  private extractFallbackSearchUrl(html: string, sourceUrl: string): string | null {
    const raw =
      html.match(/id="yvlrue"[\s\S]*?<a href="([^"]+)"/i)?.[1] ||
      html.match(/Please click <a href="([^"]+)">here<\/a>/i)?.[1] ||
      html.match(/meta content="0;url=([^"]+)"/i)?.[1] ||
      "";
    if (!raw) {
      return null;
    }

    const decoded = decodeHtmlEntities(raw).trim();
    try {
      const candidate = new URL(decoded, sourceUrl);
      const host = candidate.hostname.toLowerCase();
      if ((host === "google.com" || host.endsWith(".google.com")) && candidate.pathname === "/search") {
        return candidate.toString();
      }
    } catch {}

    return null;
  }

  private parseSearchResults(html: string): GoogleSearchResultItem[] {
    if (this.isBlockedPage(html)) {
      return [];
    }

    const results: GoogleSearchResultItem[] = [];
    const headingLinkPattern = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>\s*(?:<[^>]+>\s*)*<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    let match: RegExpExecArray | null = null;
    while ((match = headingLinkPattern.exec(html)) !== null && results.length < 8) {
      const resultUrl = decodeHtmlEntities(match[1]).trim();
      const title = stripHtmlTags(match[2]).replace(/\s+/g, " ").trim();
      if (!resultUrl || !title) {
        continue;
      }

      const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 1600);
      const snippet =
        stripHtmlTags(
          tail.match(/<div[^>]+class="[^"]*(?:VwiC3b|GI74Re|yXK7lf|s3v9rd)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "",
        ) || null;
      results.push({ title, url: resultUrl, snippet });
    }
    return results;
  }

  private isBlockedPage(html: string): boolean {
    const normalized = html.toLowerCase();
    return (
      normalized.includes("our systems have detected unusual traffic") ||
      normalized.includes("about this page") ||
      normalized.includes("/sorry/") ||
      normalized.includes("/httpservice/retry/enablejs")
    );
  }

  private buildSearchResult(
    query: string,
    sourceUrl: string,
    html: string,
    results: GoogleSearchResultItem[],
    fallbackUrl: string | null,
  ): IngestContentResult {
    const title = extractHtmlTitle(html) || `${query} - Google Search`;
    const contentBody = [
      `Search Query: ${query}`,
      "",
      "## Results",
      "",
      ...results.flatMap((item, index) => [
        `${index + 1}. [${item.title}](${item.url})`,
        item.snippet ? `   - ${item.snippet}` : "",
      ]),
      fallbackUrl ? "" : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

    return {
      title,
      author: "Google Search",
      published: null,
      source_url: sourceUrl,
      content_markdown: toMarkdown({
        title,
        author: "Google Search",
        published: null,
        sourceUrl,
        contentBody,
      }),
      tags: ["google"],
    };
  }

  private buildRenderedResult(query: string, sourceUrl: string, rendered: RenderedGoogleSearch): IngestContentResult {
    const title = rendered.title?.trim() || `${query} - Google Search`;
    const contentBody = [
      `Search Query: ${query}`,
      "",
      "## Search Content",
      "",
      rendered.content || "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

    return {
      title,
      author: "Google Search",
      published: null,
      source_url: sourceUrl,
      content_markdown: toMarkdown({
        title,
        author: "Google Search",
        published: null,
        sourceUrl,
        contentBody,
      }),
      tags: ["google"],
    };
  }

  private buildFallbackResult(query: string, sourceUrl: string, fallbackUrl: string | null): IngestContentResult {
    const title = `${query} - Google Search`;
    const contentBody = [
      `Search Query: ${query}`,
      "",
      "This Google search page could not be fully rendered in the current environment.",
      "Google returned a JavaScript shell or anti-bot interstitial instead of normal search results.",
      "",
      `Original Search URL: ${sourceUrl}`,
      fallbackUrl ? `Fallback Search URL: ${fallbackUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

    return {
      title,
      author: "Google Search",
      published: null,
      source_url: sourceUrl,
      content_markdown: toMarkdown({
        title,
        author: "Google Search",
        published: null,
        sourceUrl,
        contentBody,
      }),
      tags: ["google"],
    };
  }
}
