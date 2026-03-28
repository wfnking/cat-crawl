import type { ArticleCrawlerStrategy, CrawlContext, CrawlResult } from "../types.js";

function requireXCrawl(context: CrawlContext): NonNullable<CrawlContext["crawlXPost"]> {
  if (!context.crawlXPost) {
    throw new Error("xCrawler requires context.crawlXPost");
  }
  return context.crawlXPost;
}

export const xCrawler: ArticleCrawlerStrategy = {
  name: "x",
  canHandle: (url) => {
    const host = url.hostname.toLowerCase();
    return host.includes("x.com") || host.includes("twitter.com");
  },
  async crawl(url: URL, context: CrawlContext): Promise<CrawlResult> {
    return requireXCrawl(context)(url.toString());
  },
};
