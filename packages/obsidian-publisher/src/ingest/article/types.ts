import type { AppEnv } from "../../config/env.js";
import type { ChromeCookie } from "../video/helpers/chrome-cookies.js";
import type { IngestContentResult } from "../types.js";
export type { IngestContentResult } from "../types.js";

export type ArticleAdapterName =
  | "google_search"
  | "wechat"
  | "huxiu"
  | "x"
  | "reddit"
  | "chatgpt"
  | "baidu"
  | "zhihu"
  | "tencent"
  | "csdn"
  | "generic";

export type CrawlLogger = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

export type CrawlBrowserAdapterOptions = {
  cookies?: ChromeCookie[];
};

export type CrawlContext = {
  env: AppEnv;
  logger?: CrawlLogger;
  crawlWithBrowserAdapter: (
    url: string,
    adapterName: ArticleAdapterName,
    options?: CrawlBrowserAdapterOptions,
  ) => Promise<IngestContentResult>;
};

export interface ArticleHandler {
  name: string;
  canHandle(url: URL): boolean;
  handle(url: URL, context: CrawlContext): Promise<IngestContentResult>;
}

export abstract class BaseArticleHandler implements ArticleHandler {
  abstract readonly name: string;
  abstract canHandle(url: URL): boolean;
  abstract handle(url: URL, context: CrawlContext): Promise<IngestContentResult>;
}

export type ArticleCrawlerStrategy = ArticleHandler;
