import { tool } from "@langchain/core/tools";
import { z } from "zod";

type CrawlResult = {
  title: string;
  author: string | null;
  source_url: string;
  content_markdown: string;
};

const inputSchema = z.object({
  url: z.string().url().describe("微信公众号文章链接，必须为 mp.weixin.qq.com 域名"),
});

function toMarkdown(result: {
  title: string;
  author: string | null;
  sourceUrl: string;
  contentText: string;
}): string {
  const lines = [
    `# ${result.title}`,
    "",
    `- Source: ${result.sourceUrl}`,
    `- Author: ${result.author ?? "Unknown"}`,
    "",
    result.contentText,
  ];
  return lines.join("\n").trim();
}

export const crawlWechatArticleTool = tool(
  async ({ url }): Promise<CrawlResult> => {
    const parsed = new URL(url);
    if (parsed.hostname !== "mp.weixin.qq.com") {
      throw new Error("Only mp.weixin.qq.com links are supported.");
    }

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
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

        const rawText = contentNode?.textContent?.trim() || "";

        return { title, author, rawText };
      });

      const contentText = scraped.rawText.slice(0, 12000);
      if (!contentText) {
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
          contentText,
        }),
      };
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
