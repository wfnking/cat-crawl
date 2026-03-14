import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import TurndownService from "turndown";
import { z } from "zod";
import { extractArticleUrl } from "../utils/text.js";

export type ArticleAdapterName = "wechat" | "huxiu" | "generic";

type CrawlResult = {
  title: string;
  author: string | null;
  published: string | null;
  source_url: string;
  content_markdown: string;
};

type ArticleImageAttrs = {
  src?: string | null;
  dataSrc?: string | null;
  dataOriginal?: string | null;
  dataOriginalSrc?: string | null;
  dataLazySrc?: string | null;
  srcset?: string | null;
};

const inputSchema = z.object({
  url: z.string().url().describe("文章链接"),
});

const logger = createLogger();

function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers")
  );
}

function normalizeUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

function isInlineDataImage(url: string): boolean {
  return url.toLowerCase().startsWith("data:image/");
}

function firstSrcFromSrcset(raw: string): string {
  return raw
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0] || "")
    .filter(Boolean)[0] || "";
}

export function resolveArticleImageSrc(attrs: ArticleImageAttrs): string {
  const values = [
    attrs.dataSrc,
    attrs.dataOriginal,
    attrs.dataOriginalSrc,
    attrs.dataLazySrc,
    attrs.src,
    attrs.srcset ? firstSrcFromSrcset(attrs.srcset) : "",
  ]
    .map((item) => item?.trim() || "")
    .filter(Boolean);

  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (isInlineDataImage(normalized)) {
      continue;
    }
    return normalized;
  }

  return "";
}

function normalizePublishedDate(raw: string | null): string | null {
  const text = raw?.trim() || "";
  if (!text) {
    return null;
  }
  const matched = text.match(/(\d{4})[./\-年](\d{1,2})[./\-月](\d{1,2})/);
  if (!matched) {
    return null;
  }
  return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
}

function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.remove(["style", "script", "noscript", "iframe"]);

  turndown.addRule("normalizeLinks", {
    filter: "a",
    replacement(content, node) {
      const element = node as HTMLAnchorElement;
      const href = element.getAttribute("href")?.trim() || "";
      if (!href) {
        return content;
      }
      const normalized = normalizeUrl(href);
      return `[${content || normalized}](${normalized})`;
    },
  });

  turndown.addRule("normalizeImages", {
    filter: "img",
    replacement(_content, node) {
      const element = node as HTMLImageElement;
      const alt = (element.getAttribute("alt") || "Image").trim();
      const src = resolveArticleImageSrc({
        src: element.getAttribute("src"),
        dataSrc: element.getAttribute("data-src"),
        dataOriginal: element.getAttribute("data-original"),
        dataOriginalSrc: element.getAttribute("data-original-src"),
        dataLazySrc: element.getAttribute("data-lazy-src"),
        srcset: element.getAttribute("srcset"),
      });
      if (!src) {
        return "";
      }
      return `![${alt}](${src})`;
    },
  });

  return turndown;
}

function toMarkdown(result: {
  title: string;
  author: string | null;
  published: string | null;
  sourceUrl: string;
  contentBody: string;
}): string {
  return [
    `# ${result.title}`,
    "",
    `- Source: ${result.sourceUrl}`,
    `- Author: ${result.author ?? "Unknown"}`,
    `- Published: ${result.published ?? "Unknown"}`,
    "",
    result.contentBody,
  ]
    .join("\n")
    .trim();
}

export function pickArticleAdapter(url: string): ArticleAdapterName {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("mp.weixin.qq.com")) {
    return "wechat";
  }
  if (host.includes("huxiu.com")) {
    return "huxiu";
  }
  return "generic";
}

export const crawlWebArticleTool = tool(
  async ({ url }): Promise<CrawlResult> => {
    const adapter = pickArticleAdapter(url);
    logger.info(`[tool:crawl_web_article] start url=${url} adapter=${adapter}`);

    const { chromium } = await import("playwright");
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      logger.info("[tool:crawl_web_article] using bundled playwright chromium");
    } catch (error) {
      if (!isMissingPlaywrightBrowserError(error)) {
        throw error;
      }
      logger.warn("[tool:crawl_web_article] bundled chromium missing, fallback to local Chrome channel");
      browser = await chromium.launch({ channel: "chrome", headless: true });
      logger.info("[tool:crawl_web_article] using local chrome channel");
    }

    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(adapter === "wechat" ? 1500 : 2200);

      const scraped = await page.evaluate((currentAdapter) => {
        const meta = (name: string, attr: "name" | "property" = "name"): string | null =>
          document.querySelector(`meta[${attr}="${name}"]`)?.getAttribute("content")?.trim() || null;
        const text = (selectors: string[]): string | null => {
          for (const selector of selectors) {
            const value = document.querySelector(selector)?.textContent?.trim();
            if (value) {
              return value;
            }
          }
          return null;
        };
        const html = (selectors: string[]): HTMLElement | null => {
          for (const selector of selectors) {
            const node = document.querySelector(selector);
            if (node instanceof HTMLElement) {
              return node;
            }
          }
          return null;
        };

        const selectorMap: Record<string, string[]> = {
          wechat: ["#js_content", ".rich_media_content", "article"],
          huxiu: [
            ".article-content",
            ".article__content",
            ".detail-content",
            ".article-wrap",
            "article",
            "main article",
            "main",
          ],
          generic: [
            "article",
            "[itemprop='articleBody']",
            ".article-content",
            ".post-content",
            ".entry-content",
            ".content",
            "main",
          ],
        };

        const title =
          meta("og:title", "property") ||
          meta("twitter:title", "name") ||
          text(["#activity-name", "h1", ".article-title", ".title"]) ||
          document.title ||
          "Untitled";

        const author =
          text([
            "#js_name",
            ".author-info__username",
            ".author-name",
            ".author",
            "[rel='author']",
            ".rich_media_meta_text",
          ]) || meta("author", "name");

        const published =
          text([
            "#publish_time",
            "time",
            ".article-time",
            ".publish-time",
            ".time",
            "[data-role='publish-time']",
          ]) ||
          meta("article:published_time", "property") ||
          meta("publishdate", "name") ||
          meta("pubdate", "name");

        const contentNode = html(selectorMap[currentAdapter] || selectorMap.generic);
        let contentHtml = "";
        if (contentNode) {
          const clone = contentNode.cloneNode(true) as HTMLElement;
          clone
            .querySelectorAll(
              "script,style,noscript,iframe,svg,form,button,.advertisement,.ad,.related-article,.recommend-wrap,.m-player-wrap",
            )
            .forEach((el) => el.remove());

          clone.querySelectorAll<HTMLElement>("*").forEach((el) => {
            const style = (el.getAttribute("style") || "").toLowerCase();
            if (style.includes("display:none") || style.includes("visibility:hidden")) {
              el.remove();
              return;
            }

            if (el.tagName.toLowerCase() === "img") {
              const img = el as HTMLImageElement;
              const preferred =
                img.getAttribute("data-src") ||
                img.getAttribute("data-original") ||
                img.getAttribute("data-original-src") ||
                img.getAttribute("data-lazy-src") ||
                img.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
              const src = img.getAttribute("src");
              const isDataImage = (src || "").toLowerCase().startsWith("data:image/");
              if ((!src || isDataImage) && preferred) {
                img.setAttribute("src", preferred);
              }
            }

            if (el.tagName.toLowerCase() === "a") {
              const href = el.getAttribute("href");
              if (href?.startsWith("//")) {
                el.setAttribute("href", `https:${href}`);
              }
            }
          });

          contentHtml = clone.innerHTML;
        }

        const canonical =
          document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim() || null;

        return {
          title,
          author: author || null,
          published: published || null,
          contentHtml,
          canonical,
        };
      }, adapter);

      const turndown = createTurndownService();
      const markdownBody = turndown.turndown(scraped.contentHtml || "");
      const contentBody = markdownBody.replace(/\n{3,}/g, "\n\n").trim().slice(0, 30000);
      if (!contentBody) {
        throw new Error("Failed to extract article content.");
      }

      const sourceUrl = scraped.canonical ? normalizeUrl(scraped.canonical) : url;
      return {
        title: scraped.title,
        author: scraped.author,
        published: normalizePublishedDate(scraped.published),
        source_url: sourceUrl,
        content_markdown: toMarkdown({
          title: scraped.title,
          author: scraped.author,
          published: normalizePublishedDate(scraped.published),
          sourceUrl,
          contentBody,
        }),
      };
    } finally {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  },
  {
    name: "crawl_web_article",
    description: "抓取通用网页文章，支持微信、虎嗅和普通文章页，返回标题、作者、来源和正文 markdown 内容",
    schema: inputSchema,
  },
);

export const __test__ = {
  extractArticleUrl,
  pickArticleAdapter,
  resolveArticleImageSrc,
};
