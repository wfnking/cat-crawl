import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import { z } from "zod";
import { loadEnv } from "../../config/env.js";
import { createBrowserScrapeFunction } from "../../ingest/article/helpers/browser.js";
import {
  formatUnixSecondsDate,
  normalizePublishedDateWithFallback,
} from "../../ingest/article/helpers/dates.js";
import {
  resolveArticleImageSrc,
  resolveSourceUrl,
} from "../../ingest/article/helpers/urls.js";
import { articleHandlers, fallbackArticleHandler } from "../../ingest/article/handlers/index.js";
import { selectArticleHandler } from "../../ingest/article/registry.js";
import { crawlBrowserAdapterArticle } from "../../ingest/article/helpers/browser-crawl.js";
import type { ArticleAdapterName, CrawlContext, IngestContentResult } from "../../ingest/article/types.js";

const inputSchema = z.object({
  url: z.string().url().describe("文章链接"),
});

const logger = createLogger();

export function pickArticleAdapter(url: string): ArticleAdapterName {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("mp.weixin.qq.com")) {
    return "wechat";
  }
  if (host.includes("huxiu.com")) {
    return "huxiu";
  }
  if (host.includes("x.com") || host.includes("twitter.com")) {
    return "x";
  }
  if (host.includes("reddit.com")) {
    return "reddit";
  }
  if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
    return "chatgpt";
  }
  if (host.includes("zhihu.com")) {
    return "zhihu";
  }
  if (host.includes("cloud.tencent.com")) {
    return "tencent";
  }
  if (host.includes("csdn.net")) {
    return "csdn";
  }
  if (host.includes("mo.mbd.baidu.com") || host.includes("mbd.baidu.com") || host.includes("baijiahao.baidu.com")) {
    return "baidu";
  }
  return "generic";
}

function isRegistryManagedAdapter(adapter: ArticleAdapterName): boolean {
  return (
    adapter === "wechat" ||
    adapter === "huxiu" ||
    adapter === "x" ||
    adapter === "reddit" ||
    adapter === "chatgpt" ||
    adapter === "baidu" ||
    adapter === "zhihu" ||
    adapter === "tencent" ||
    adapter === "csdn" ||
    adapter === "generic"
  );
}

export const crawlWebArticleTool = tool(
  async ({ url }): Promise<IngestContentResult> => {
    const adapter = pickArticleAdapter(url);
    logger.info(`[tool:crawl_web_article] start url=${url} adapter=${adapter}`);

    if (!isRegistryManagedAdapter(adapter)) {
      throw new Error(`Unsupported article adapter: ${adapter}`);
    }

    const parsedUrl = new URL(url);
    const handler = selectArticleHandler(parsedUrl, articleHandlers, fallbackArticleHandler);
    const context: CrawlContext = {
      env: loadEnv(),
      logger,
      crawlWithBrowserAdapter: (sourceUrl, adapterName) =>
        crawlBrowserAdapterArticle(sourceUrl, adapterName, logger),
    };
    return handler.handle(parsedUrl, context);
  },
  {
    name: "crawl_web_article",
    description: "抓取通用网页文章，支持微信、虎嗅、百度百家号、Reddit、X/Twitter、ChatGPT 分享页和普通文章页，返回标题、作者、来源和正文 markdown 内容",
    schema: inputSchema,
  },
);

export const __test__ = {
  isRegistryManagedAdapter,
  pickArticleAdapter,
  resolveArticleImageSrc,
  normalizePublishedDateWithFallback,
  formatUnixSecondsDate,
  createBrowserScrapeFunction,
  resolveSourceUrl,
};
