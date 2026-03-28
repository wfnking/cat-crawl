import { chromium } from "playwright";
import { createBrowserScrapeFunction } from "../helpers/browser.js";
import { normalizePublishedDateWithFallback } from "../helpers/dates.js";
import { createTurndownService, toMarkdown } from "../helpers/markdown.js";
import { normalizeUrl, resolveSourceUrl } from "../helpers/urls.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";

type WechatScrapeResult = {
  title: string;
  author: string | null;
  published: string | null;
  publishedTimestamp: number | null;
  contentHtml: string;
  carouselImages: string[];
  canonical: string | null;
};

export const WECHAT_SCRAPE_FUNCTION_SOURCE = String.raw`function() {
  const meta = (name, attr = 'name') =>
    document.querySelector('meta[' + attr + '="' + name + '"]')?.getAttribute('content')?.trim() || null;
  const text = (selectors) => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value) {
        return value;
      }
    }
    return null;
  };

  const title =
    meta('og:title', 'property') ||
    meta('twitter:title', 'name') ||
    text(['#activity-name', 'h1']) ||
    document.title ||
    'Untitled';

  let author =
    text([
      '#js_name',
      '.account_nickname_inner',
      '.rich_media_meta_nickname',
      '.rich_media_meta_link',
      '.rich_media_meta_text.nickname',
      '.rich_media_meta_text',
    ]) || meta('author', 'name');

  const anyWindow = window;
  const authorLooksLikeDate = /^(\d{1,4}[./\-年]\d{1,2}([./\-月]\d{1,2})?)(\s+\d{1,2}:\d{2})?$/.test(
    (author || '').trim(),
  );
  if (!author || authorLooksLikeDate) {
    const authorFromWindow = anyWindow.cgiDataNew?.nick_name?.trim() || anyWindow.nickname?.trim() || null;
    if (authorFromWindow) {
      author = authorFromWindow;
    }
  }

  const published =
    text([
      '#publish_time',
      '.publish_time',
      '.rich_media_meta_text#publish_time',
      ".rich_media_meta_text[id*='publish']",
      'time',
    ]) || meta('article:published_time', 'property');

  const timestampCandidates = [
    anyWindow.ct,
    anyWindow.createTime,
    anyWindow.msg_publish_time,
    anyWindow.ori_create_time,
    anyWindow.appmsgpublishtime,
    anyWindow.cgiDataNew?.create_time,
  ];
  let publishedTimestamp = null;
  for (const candidate of timestampCandidates) {
    const numeric = Number(String(candidate ?? '').trim());
    if (!Number.isFinite(numeric)) {
      continue;
    }
    const seconds = numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    if (seconds > 0) {
      publishedTimestamp = seconds;
      break;
    }
  }

  const contentNode =
    document.querySelector('#js_content') ||
    document.querySelector('.rich_media_content') ||
    document.querySelector('article');
  const contentHtml = contentNode instanceof HTMLElement ? contentNode.innerHTML.trim() : '';

  const carouselImages = Array.from(
    document.querySelectorAll('.js_article img, #img-content img, .rich_media_content img'),
  )
    .map((img) => {
      const src =
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('src') ||
        '';
      return src.trim();
    })
    .filter(Boolean);

  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || null;

  return {
    title,
    author: author || null,
    published: published || null,
    publishedTimestamp,
    contentHtml,
    carouselImages: Array.from(new Set(carouselImages)),
    canonical,
  };
}`;

export class WechatHandler extends BaseArticleHandler {
  readonly name = "wechat";

  canHandle(url: URL): boolean {
    return url.hostname.toLowerCase().includes("mp.weixin.qq.com");
  }

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    const browser = await this.launchBrowser(context);
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    try {
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);

      const scraped = await page.evaluate(
        createBrowserScrapeFunction<[], WechatScrapeResult>(WECHAT_SCRAPE_FUNCTION_SOURCE),
      );

      return this.buildResult(url, scraped);
    } finally {
      await page.close().catch(() => {});
      await browserContext.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  private async launchBrowser(context: CrawlContext) {
    try {
      const browser = await chromium.launch({ headless: true });
      context.logger?.info?.("[tool:crawl_web_article] using bundled playwright chromium");
      return browser;
    } catch (error) {
      if (!this.isMissingPlaywrightBrowserError(error)) {
        throw error;
      }
      context.logger?.warn?.(
        "[tool:crawl_web_article] bundled chromium missing, fallback to local Chrome channel",
      );
      const browser = await chromium.launch({ headless: true, channel: "chrome" });
      context.logger?.info?.("[tool:crawl_web_article] using local chrome channel");
      return browser;
    }
  }

  private isMissingPlaywrightBrowserError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("Executable doesn't exist") ||
      message.includes("Please run the following command to download new browsers")
    );
  }

  private buildResult(url: URL, scraped: WechatScrapeResult): IngestContentResult {
    const turndown = createTurndownService();
    const markdownBody = turndown.turndown(scraped.contentHtml || "");
    const carouselMarkdown = (scraped.carouselImages || [])
      .map((src, index) => `![Carousel ${index + 1}](${normalizeUrl(src)})`)
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

    const sourceUrl = resolveSourceUrl(url.toString(), scraped.canonical);
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
  }
}
