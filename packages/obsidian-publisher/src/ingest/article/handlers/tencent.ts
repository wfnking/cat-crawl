import { BrowserArticleHandler } from "./base.js";

export class TencentHandler extends BrowserArticleHandler {
  readonly name = "tencent";
  protected readonly adapterName = "tencent" as const;

  canHandle(url: URL): boolean {
    return url.hostname.toLowerCase().includes("cloud.tencent.com");
  }
}
