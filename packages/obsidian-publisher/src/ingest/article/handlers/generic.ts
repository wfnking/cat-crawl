import { BrowserArticleHandler } from "./base.js";

export class GenericHandler extends BrowserArticleHandler {
  readonly name = "generic";
  protected readonly adapterName = "generic" as const;

  canHandle(): boolean {
    return true;
  }
}
