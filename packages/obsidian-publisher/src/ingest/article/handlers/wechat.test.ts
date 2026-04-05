import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { createBrowserScrapeFunction } from "../helpers/browser.js";
import { WechatHandler, WECHAT_SCRAPE_FUNCTION_SOURCE } from "./wechat.js";

test("WechatHandler should keep body images", () => {
  const handler = new WechatHandler() as any;
  const result = handler.buildResult(new URL("https://mp.weixin.qq.com/s/example"), {
    title: "Test Title",
    author: "Author",
    published: "2026-04-04",
    publishedTimestamp: null,
    contentHtml: '<p>Intro</p><img data-src="https://example.com/a.jpg" alt="Cover"><p>More</p>',
    canonical: null,
  });

  const matches = result.content_markdown.match(/https:\/\/example\.com\/a\.jpg/g) || [];
  assert.equal(matches.length, 1);
});

test("Wechat scrape function should remove repeated images from article html", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <html>
        <body>
          <div id="js_content">
            <p>Intro</p>
            <img data-src="https://example.com/a.jpg" alt="Cover">
            <p>More</p>
            <img data-src="https://example.com/a.jpg" alt="Cover Again">
          </div>
        </body>
      </html>
    `);
    const scraped = await page.evaluate(
      createBrowserScrapeFunction(WECHAT_SCRAPE_FUNCTION_SOURCE as never),
    );
    const matches = String((scraped as any).contentHtml).match(/https:\/\/example\.com\/a\.jpg/g) || [];
    assert.equal(matches.length, 1);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
});
