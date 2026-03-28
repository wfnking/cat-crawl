import type { AppEnv } from "../config/env.js";

export type CrawlResult = {
  title: string;
  author: string | null;
  published: string | null;
  source_url: string;
  content_markdown: string;
};

export type CrawlContext = {
  env: AppEnv;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
};

export interface ArticleCrawlerStrategy {
  name: string;
  canHandle(url: URL): boolean;
  crawl(url: URL, context: CrawlContext): Promise<CrawlResult>;
}
