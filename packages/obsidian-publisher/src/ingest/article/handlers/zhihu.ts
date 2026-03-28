import { BrowserArticleHandler } from "./base.js";

export class ZhihuHandler extends BrowserArticleHandler {
  readonly name = "zhihu";
  protected readonly adapterName = "zhihu" as const;

  canHandle(url: URL): boolean {
    return url.hostname.toLowerCase().includes("zhihu.com");
  }
}
