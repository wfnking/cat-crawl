import { BrowserArticleHandler } from "./base.js";

export class CsdnHandler extends BrowserArticleHandler {
  readonly name = "csdn";
  protected readonly adapterName = "csdn" as const;

  canHandle(url: URL): boolean {
    return url.hostname.toLowerCase().includes("csdn.net");
  }
}
