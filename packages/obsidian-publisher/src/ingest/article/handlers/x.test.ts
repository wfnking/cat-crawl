import assert from "node:assert/strict";
import test from "node:test";
import { XHandler } from "./x.js";

test("XHandler should pass Chrome cookies into rendered crawl", async () => {
  let renderedCookies: Array<{ domain: string; name: string }> = [];
  const handler = new XHandler({
    loadChromeCookies: () => [
      {
        name: "auth_token",
        value: "secret",
        domain: ".x.com",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "twid",
        value: "u=1",
        domain: ".twitter.com",
        path: "/",
        secure: true,
        httpOnly: false,
      },
    ],
    fetchRenderedHtml: async (_url, cookies) => {
      renderedCookies = cookies.map((cookie) => ({ domain: cookie.domain, name: cookie.name }));
      return "<html><body>rendered x page</body></html>";
    },
    extractWithDefuddle: async (html, url) => ({
      title: "Thread by @yaroslavvb",
      author: "@yaroslavvb",
      published: "2026-04-06",
      source_url: url,
      content_markdown: html,
    }),
  });

  await handler.handle(new URL("https://x.com/yaroslavvb/status/2039043379825360988"), {
    env: {} as never,
    crawlWithBrowserAdapter: async () => {
      throw new Error("browser fallback should not run");
    },
  });

  assert.deepEqual(renderedCookies, [
    { domain: ".x.com", name: "auth_token" },
    { domain: ".twitter.com", name: "twid" },
  ]);
});

test("XHandler should use defuddle output from rendered html", async () => {
  let renderedUrl = "";
  let extractedHtml = "";
  let extractedUrl = "";
  const handler = new XHandler({
    fetchRenderedHtml: async (url) => {
      renderedUrl = url;
      return "<html><body>rendered x page</body></html>";
    },
    extractWithDefuddle: async (html, url) => {
      extractedHtml = html;
      extractedUrl = url;
      return {
        title: "Thread by @yaroslavvb",
        author: "@yaroslavvb",
        published: "2026-04-06",
        source_url: url,
        content_markdown: "# Thread by @yaroslavvb\n\nBody from defuddle.\n\n---\n\nReply from defuddle.",
      };
    },
  });

  const result = await handler.handle(new URL("https://twitter.com/yaroslavvb/status/2039043379825360988?t=1"), {
    env: {} as never,
    crawlWithBrowserAdapter: async () => {
      throw new Error("browser fallback should not run");
    },
  });

  assert.equal(renderedUrl, "https://x.com/yaroslavvb/status/2039043379825360988");
  assert.equal(extractedHtml, "<html><body>rendered x page</body></html>");
  assert.equal(extractedUrl, "https://x.com/yaroslavvb/status/2039043379825360988");
  assert.equal(result.source_url, "https://x.com/yaroslavvb/status/2039043379825360988");
  assert.match(result.content_markdown, /Body from defuddle/);
  assert.match(result.content_markdown, /Reply from defuddle/);
});

test("XHandler should fallback to generic browser adapter when defuddle returns null", async () => {
  let fallbackUrl = "";
  let fallbackAdapter = "";
  const handler = new XHandler({
    fetchRenderedHtml: async () => "<html><body>rendered x page</body></html>",
    extractWithDefuddle: async () => null,
  });

  const result = await handler.handle(new URL("https://x.com/yaroslavvb/status/2039043379825360988"), {
    env: {} as never,
    crawlWithBrowserAdapter: async (url, adapter) => {
      fallbackUrl = url;
      fallbackAdapter = adapter;
      return {
        title: "Generic fallback result",
        author: "@yaroslavvb",
        published: "2026-04-06",
        source_url: url,
        content_markdown: "# Generic fallback result\n\nFallback body.",
      };
    },
  });

  assert.equal(fallbackUrl, "https://x.com/yaroslavvb/status/2039043379825360988");
  assert.equal(fallbackAdapter, "generic");
  assert.equal(result.title, "Generic fallback result");
});

test("XHandler should fallback to generic browser adapter when rendered html fetch fails", async () => {
  const handler = new XHandler({
    fetchRenderedHtml: async () => {
      throw new Error("playwright failed");
    },
    extractWithDefuddle: async () => {
      throw new Error("defuddle should not run");
    },
  });

  const result = await handler.handle(new URL("https://x.com/yaroslavvb/status/2039043379825360988"), {
    env: {} as never,
    crawlWithBrowserAdapter: async (url, adapter) => ({
      title: `Fallback via ${adapter}`,
      author: "@yaroslavvb",
      published: "2026-04-06",
      source_url: url,
      content_markdown: "# Fallback\n\nFallback body.",
    }),
  });

  assert.equal(result.title, "Fallback via generic");
});
