import { BaseArticleHandler, type ArticleAdapterName, type CrawlContext, type IngestContentResult } from "../types.js";

export abstract class BrowserArticleHandler extends BaseArticleHandler {
  protected abstract readonly adapterName: ArticleAdapterName;

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    return context.crawlWithBrowserAdapter(url.toString(), this.adapterName);
  }
}
