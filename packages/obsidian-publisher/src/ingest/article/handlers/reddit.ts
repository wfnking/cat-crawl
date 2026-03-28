import { normalizePublishedDateWithFallback } from "../helpers/dates.js";
import { decodeHtmlEntities } from "../helpers/html.js";
import { createTurndownService, toMarkdown } from "../helpers/markdown.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";

export class RedditHandler extends BaseArticleHandler {
  readonly name = "reddit";

  canHandle(url: URL): boolean {
    return url.hostname.toLowerCase().includes("reddit.com");
  }

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    try {
      const redditResult = await this.crawlViaEmbed(url.toString());
      if (redditResult) {
        context.logger?.info?.("[tool:crawl_web_article] reddit embed fallback succeeded");
        return redditResult;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.logger?.warn?.(`[tool:crawl_web_article] reddit embed fallback failed: ${detail}`);
    }

    return context.crawlWithBrowserAdapter(url.toString(), "reddit");
  }

  private normalizeSourceUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hostname = "www.reddit.com";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private buildEmbedUrl(url: string): string {
    const parsed = new URL(this.normalizeSourceUrl(url));
    parsed.hostname = "embed.reddit.com";
    return parsed.toString();
  }

  private async resolveSourceUrl(url: string): Promise<string | null> {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/comments/")) {
      return this.normalizeSourceUrl(parsed.toString());
    }
    if (!parsed.pathname.includes("/s/")) {
      return null;
    }

    const redirectLookupUrl = new URL(parsed.pathname + parsed.search, "https://rxddit.com");
    const response = await fetch(redirectLookupUrl, {
      headers: { "user-agent": "Mozilla/5.0" },
      redirect: "manual",
    });
    const location = response.headers.get("location")?.trim() || "";
    if (!location) {
      return null;
    }
    return this.normalizeSourceUrl(location);
  }

  private parseEmbedHtml(html: string, sourceUrl: string): IngestContentResult | null {
    const title = decodeHtmlEntities(
      html.match(/<shreddit-embed-title>([\s\S]*?)<\/shreddit-embed-title>/i)?.[1]?.trim() || "",
    );
    const author = decodeHtmlEntities(
      html.match(/href="https:\/\/www\.reddit\.com\/user\/[^\"]+"[^>]*>([\s\S]*?)<\/a>/i)?.[1]?.trim() || "",
    );
    const published = normalizePublishedDateWithFallback(
      html.match(/<faceplate-timeago[^>]*ts="([^"]+)"/i)?.[1]?.trim() || null,
      null,
    );
    const contentHtml =
      html.match(/<div id="t3_[^"]+-post-rtjson-content"[^>]*>([\s\S]*?)<\/div>/i)?.[1]?.trim() || "";
    if (!title || !contentHtml) {
      return null;
    }

    const markdownBody = createTurndownService().turndown(contentHtml).replace(/\n{3,}/g, "\n\n").trim();
    if (!markdownBody) {
      return null;
    }

    const embeddedSourceUrl =
      html.match(/<a id="embed-title"[^>]*href="([^"]+)"/i)?.[1]?.trim().replace(/&amp;/g, "&") || "";
    const finalSourceUrl = this.normalizeSourceUrl(embeddedSourceUrl || sourceUrl);

    return {
      title,
      author: author || null,
      published,
      source_url: finalSourceUrl,
      content_markdown: toMarkdown({
        title,
        author: author || null,
        published,
        sourceUrl: finalSourceUrl,
        contentBody: markdownBody,
      }),
    };
  }

  private async crawlViaEmbed(url: string): Promise<IngestContentResult | null> {
    const sourceUrl = await this.resolveSourceUrl(url);
    if (!sourceUrl) {
      return null;
    }

    const response = await fetch(this.buildEmbedUrl(sourceUrl), {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) {
      throw new Error(`reddit embed request failed with ${response.status}`);
    }

    const html = await response.text();
    return this.parseEmbedHtml(html, sourceUrl);
  }
}
