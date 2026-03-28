import type { ArticleCrawlerStrategy, CrawlContext, CrawlResult } from "../types.js";

function requireBrowserCrawl(context: CrawlContext): NonNullable<CrawlContext["crawlWithBrowserAdapter"]> {
  if (!context.crawlWithBrowserAdapter) {
    throw new Error("wechatCrawler requires context.crawlWithBrowserAdapter");
  }
  return context.crawlWithBrowserAdapter;
}

export const wechatCrawler: ArticleCrawlerStrategy = {
  name: "wechat",
  canHandle: (url) => url.hostname.toLowerCase().includes("mp.weixin.qq.com"),
  async crawl(url: URL, context: CrawlContext): Promise<CrawlResult> {
    return requireBrowserCrawl(context)(url.toString(), "wechat");
  },
};
