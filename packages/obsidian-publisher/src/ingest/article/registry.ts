import type { ArticleHandler } from "./types.js";

export function selectArticleHandler(
  url: URL,
  handlers: ArticleHandler[],
  fallbackArticleHandler: ArticleHandler,
): ArticleHandler {
  return handlers.find((handler) => handler.canHandle(url)) ?? fallbackArticleHandler;
}
