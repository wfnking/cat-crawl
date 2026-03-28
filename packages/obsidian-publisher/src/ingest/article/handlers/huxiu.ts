import { BrowserArticleHandler } from "./base.js";

export class HuxiuHandler extends BrowserArticleHandler {
  readonly name = "huxiu";
  protected readonly adapterName = "huxiu" as const;

  canHandle(url: URL): boolean {
    return url.hostname.toLowerCase().includes("huxiu.com");
  }
}
