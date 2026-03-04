import { tool } from "@langchain/core/tools";
import TurndownService from "turndown";
import { z } from "zod";

type CrawlResult = {
  title: string;
  author: string | null;
  source_url: string;
  content_markdown: string;
};

type WechatImageAttrs = {
  src?: string | null;
  dataSrc?: string | null;
  dataOriginal?: string | null;
  dataOriginalSrc?: string | null;
  dataLazySrc?: string | null;
};

const inputSchema = z.object({
  url: z.string().url().describe("微信公众号文章链接，必须为 mp.weixin.qq.com 域名"),
});

function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers")
  );
}

function toMarkdown(result: {
  title: string;
  author: string | null;
  sourceUrl: string;
  contentBody: string;
}): string {
  const lines = [
    `# ${result.title}`,
    "",
    `- Source: ${result.sourceUrl}`,
    `- Author: ${result.author ?? "Unknown"}`,
    "",
    result.contentBody,
  ];
  return lines.join("\n").trim();
}

function normalizeUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

function isInlineDataImage(url: string): boolean {
  return url.toLowerCase().startsWith("data:image/");
}

export function resolveWechatImageSrc(attrs: WechatImageAttrs): string {
  const values = [
    attrs.dataSrc,
    attrs.dataOriginal,
    attrs.dataOriginalSrc,
    attrs.dataLazySrc,
    attrs.src,
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
      const normalized = href.startsWith("//") ? `https:${href}` : href;
      return `[${content || normalized}](${normalized})`;
    },
  });

  turndown.addRule("normalizeImages", {
    filter: "img",
    replacement(_content, node) {
      const element = node as HTMLImageElement;
      const alt = (element.getAttribute("alt") || "image").trim();
      const src = resolveWechatImageSrc({
        src: element.getAttribute("src"),
        dataSrc: element.getAttribute("data-src"),
        dataOriginal: element.getAttribute("data-original"),
        dataOriginalSrc: element.getAttribute("data-original-src"),
        dataLazySrc: element.getAttribute("data-lazy-src"),
      });
      if (!src) {
        return "";
      }
      return `![${alt}](${src})`;
    },
  });

  return turndown;
}

export const crawlWechatArticleTool = tool(
  async ({ url }): Promise<CrawlResult> => {
    console.info(`[tool:crawl_wechat_article] start url=${url}`);
    const parsed = new URL(url);
    if (parsed.hostname !== "mp.weixin.qq.com") {
      throw new Error("Only mp.weixin.qq.com links are supported.");
    }

    const { chromium } = await import("playwright");
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      console.info("[tool:crawl_wechat_article] using bundled playwright chromium");
    } catch (error) {
      if (!isMissingPlaywrightBrowserError(error)) {
        throw error;
      }
      console.warn(
        "[tool:crawl_wechat_article] bundled chromium missing, fallback to local Chrome channel",
      );
      browser = await chromium.launch({ channel: "chrome", headless: true });
      console.info("[tool:crawl_wechat_article] using local chrome channel");
    }
    const page = await browser.newPage();

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);

      const scraped = await page.evaluate(() => {
        const title =
          document.querySelector("#activity-name")?.textContent?.trim() ||
          document.querySelector("h1")?.textContent?.trim() ||
          document.title ||
          "Untitled";

        const author =
          document.querySelector("#js_name")?.textContent?.trim() ||
          document.querySelector(".rich_media_meta_text")?.textContent?.trim() ||
          null;

        const contentNode =
          document.querySelector("#js_content") ||
          document.querySelector(".rich_media_content") ||
          document.querySelector("article");

        let contentHtml = "";
        if (contentNode) {
          const clone = contentNode.cloneNode(true) as HTMLElement;
          clone
            .querySelectorAll(
              "script,style,noscript,iframe,svg,.js_uneditable,.original_primary_card_tips,.weapp_display_element",
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
              const src = img.getAttribute("src");
              const preferred =
                img.getAttribute("data-src") ||
                img.getAttribute("data-original") ||
                img.getAttribute("data-original-src") ||
                img.getAttribute("data-lazy-src");
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

        return { title, author, contentHtml };
      });

      const turndown = createTurndownService();
      const markdownBody = turndown.turndown(scraped.contentHtml || "");
      const contentBody = markdownBody.replace(/\n{3,}/g, "\n\n").trim().slice(0, 30000);
      if (!contentBody) {
        throw new Error("Failed to extract article content.");
      }

      return {
        title: scraped.title,
        author: scraped.author,
        source_url: url,
        content_markdown: toMarkdown({
          title: scraped.title,
          author: scraped.author,
          sourceUrl: url,
          contentBody,
        }),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.stack || error.message : String(error);
      console.error(`[tool:crawl_wechat_article] failed url=${url}; error=${detail}`);
      throw error;
    } finally {
      await page.close();
      await browser.close();
    }
  },
  {
    name: "crawl_wechat_article",
    description: "抓取微信公众号文章，返回标题、作者、来源和正文 markdown 内容",
    schema: inputSchema,
  },
);
