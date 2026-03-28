import type { ArticleCrawlerStrategy } from "./types.js";

export function selectCrawlerStrategy(
  url: URL,
  strategies: ArticleCrawlerStrategy[],
  fallbackStrategy: ArticleCrawlerStrategy,
): ArticleCrawlerStrategy {
  return strategies.find((strategy) => strategy.canHandle(url)) ?? fallbackStrategy;
}
