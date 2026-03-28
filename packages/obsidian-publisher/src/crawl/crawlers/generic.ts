import type { ArticleCrawlerStrategy, CrawlContext, CrawlResult } from "../types.js";

function requireBrowserCrawl(context: CrawlContext): NonNullable<CrawlContext["crawlWithBrowserAdapter"]> {
  if (!context.crawlWithBrowserAdapter) {
    throw new Error("genericCrawler requires context.crawlWithBrowserAdapter");
  }
  return context.crawlWithBrowserAdapter;
}

export const genericCrawler: ArticleCrawlerStrategy = {
  name: "generic",
  canHandle: () => true,
  async crawl(url: URL, context: CrawlContext): Promise<CrawlResult> {
    return requireBrowserCrawl(context)(url.toString(), "generic");
  },
};
