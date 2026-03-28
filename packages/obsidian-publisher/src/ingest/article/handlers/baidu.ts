import { normalizePublishedDateWithFallback } from "../helpers/dates.js";
import { decodeEscapedJsonString, extractCanonicalUrl, extractHtmlTitle } from "../helpers/html.js";
import { createTurndownService, toMarkdown } from "../helpers/markdown.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";

export class BaiduHandler extends BaseArticleHandler {
  readonly name = "baidu";

  canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("mo.mbd.baidu.com") || host.includes("mbd.baidu.com") || host.includes("baijiahao.baidu.com");
  }

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    try {
      const response = await fetch(url.toString());
      if (response.ok) {
        const html = await response.text();
        const parsed = this.parseShareHtml(html, url.toString());
        if (parsed) {
          context.logger?.info?.("[tool:crawl_web_article] baidu html parse succeeded");
          return parsed;
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.logger?.warn?.(`[tool:crawl_web_article] baidu direct fetch parse failed: ${detail}`);
    }

    return context.crawlWithBrowserAdapter(url.toString(), "baidu");
  }

  private extractInnerHtmlByDataTestId(html: string, testId: string): string {
    const marker = `data-testid="${testId}"`;
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) return "";
    const startIndex = html.lastIndexOf("<div", markerIndex);
    if (startIndex < 0) return "";
    const contentStart = html.indexOf(">", markerIndex);
    if (contentStart < 0) return "";

    let depth = 0;
    let cursor = startIndex;
    while (cursor < html.length) {
      const nextOpen = html.indexOf("<div", cursor);
      const nextClose = html.indexOf("</div>", cursor);
      if (nextClose < 0) return "";
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + 4;
        continue;
      }
      depth -= 1;
      cursor = nextClose + 6;
      if (depth === 0) {
        return html.slice(contentStart + 1, nextClose).trim();
      }
    }
    return "";
  }

  private extractTextByDataTestId(html: string, testId: string): string | null {
    const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp(`data-testid=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/`, "i"));
    const text = match?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
    return text || null;
  }

  private extractSourceUrl(html: string, fallbackUrl: string): string {
    const canonical = extractCanonicalUrl(html)?.replace(/^http:\/\//i, "https://") || "";
    if (canonical) return canonical;
    const readsrcMatch = html.match(/"readsrc"\s*:\s*\{[\s\S]*?"link":"((?:\\.|[^"])*)"/i);
    const decoded = readsrcMatch?.[1] ? decodeEscapedJsonString(readsrcMatch[1]) : "";
    const normalized = decoded.trim().replace(/^http:\/\//i, "https://");
    return normalized || fallbackUrl;
  }

  parseShareHtml(html: string, sourceUrl: string): IngestContentResult | null {
    const title = extractHtmlTitle(html);
    const author = this.extractTextByDataTestId(html, "author-name");
    const published = normalizePublishedDateWithFallback(this.extractTextByDataTestId(html, "updatetime"), null);
    const contentHtml = this.extractInnerHtmlByDataTestId(html, "article");
    if (!title || !contentHtml) return null;

    const markdownBody = createTurndownService().turndown(contentHtml).replace(/\n{3,}/g, "\n\n").trim();
    if (!markdownBody) return null;

    const finalSourceUrl = this.extractSourceUrl(html, sourceUrl);
    return {
      title,
      author,
      published,
      source_url: finalSourceUrl,
      content_markdown: toMarkdown({
        title,
        author,
        published,
        sourceUrl: finalSourceUrl,
        contentBody: markdownBody,
      }),
    };
  }
}
