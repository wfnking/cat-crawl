import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSearchHandler } from "./google-search.js";

test("GoogleSearchHandler should prefer rendered AI overview content when available", async () => {
  const handler = new GoogleSearchHandler({
    crawlRenderedSearch: async (_url, _cookies) => ({
      title: "initiative - Google Search",
      content:
        "initiative\n3 hours ago\nInitiative is the ability to independently assess situations and act to achieve goals.\n\nKey Characteristics of Taking Initiative\n\nProactivity: Identifying problems and taking action before being asked.\n\n## Sources\n- [Indeed](https://www.indeed.com/example)",
    }),
    fetchPageHtml: async () => {
      throw new Error("html fallback should not run");
    },
  });

  const result = await handler.handle(new URL("https://www.google.com/search?q=initiative&udm=50"), {
    env: {} as never,
    crawlWithBrowserAdapter: async () => {
      throw new Error("browser adapter should not run");
    },
  });

  assert.equal(result.title, "initiative - Google Search");
  assert.doesNotMatch(result.content_markdown, /Search Query: initiative/);
  assert.doesNotMatch(result.content_markdown, /3 hours ago/);
  assert.match(result.content_markdown, /Initiative is the ability to independently assess situations/);
  assert.match(result.content_markdown, /Key Characteristics of Taking Initiative/);
  assert.doesNotMatch(result.content_markdown, /## Sources/);
});

test("GoogleSearchHandler should pass Chrome cookies into rendered crawl", async () => {
  let receivedCookieCount = 0;
  const handler = new GoogleSearchHandler({
    loadChromeCookies: () => [
      {
        name: "SID",
        value: "cookie-value",
        domain: ".google.com",
        path: "/",
        secure: true,
        httpOnly: true,
      },
    ],
    crawlRenderedSearch: async (_url, cookies) => {
      receivedCookieCount = cookies.length;
      return {
        title: "initiative - Google Search",
        content: "Rendered content with authenticated session.",
      };
    },
  });

  const result = await handler.handle(new URL("https://www.google.com/search?q=initiative&udm=50"), {
    env: {} as never,
    crawlWithBrowserAdapter: async () => {
      throw new Error("browser adapter should not run");
    },
  });

  assert.equal(receivedCookieCount, 1);
  assert.match(result.content_markdown, /Rendered content with authenticated session/);
});

test("GoogleSearchHandler should parse google shell search pages into a structured result", async () => {
  const handler = new GoogleSearchHandler({
    crawlRenderedSearch: async (_url, _cookies) => null,
    fetchPageHtml: async () => `<!DOCTYPE html><html><head><title>Google Search</title></head><body>
      <div id="yvlrue" style="display:none">If you're having trouble accessing Google Search, please
      <a href="/search?q=initiative&amp;sca_esv=6d9dd3a5ccf2ccd8&amp;aep=34&amp;emsg=SG_REL&amp;sei=abc123">click here</a></div>
    </body></html>`,
    fetchResolvedSearchHtml: async () => `<!DOCTYPE html><html><head><title>initiative - Google Search</title></head><body>
      <main>
        <div class="MjjYud">
          <a href="https://dictionary.cambridge.org/dictionary/english/initiative"><h3>initiative</h3></a>
          <div class="VwiC3b">the ability to use your judgment to make decisions.</div>
        </div>
        <div class="MjjYud">
          <a href="https://www.merriam-webster.com/dictionary/initiative"><h3>initiative Definition &amp; Meaning</h3></a>
          <div class="VwiC3b">an introductory step.</div>
        </div>
      </main>
    </body></html>`,
  });

  const result = await handler.handle(new URL("https://www.google.com/search?q=initiative&udm=50"), {
    env: {} as never,
    crawlWithBrowserAdapter: async () => {
      throw new Error("browser fallback should not run");
    },
  });

  assert.equal(result.title, "initiative - Google Search");
  assert.equal(result.source_url, "https://www.google.com/search?q=initiative&udm=50");
  assert.match(result.content_markdown, /Search Query: initiative/);
  assert.match(result.content_markdown, /initiative Definition & Meaning/);
  assert.match(result.content_markdown, /https:\/\/dictionary\.cambridge\.org/);
});

test("GoogleSearchHandler should fall back to a query note when resolved results are unavailable", async () => {
  const handler = new GoogleSearchHandler({
    crawlRenderedSearch: async (_url, _cookies) => null,
    fetchPageHtml: async () => `<!DOCTYPE html><html><body>
      <div id="yvlrue"><a href="/search?q=initiative&amp;emsg=SG_REL">click here</a></div>
    </body></html>`,
    fetchResolvedSearchHtml: async () =>
      `<!DOCTYPE html><html><body>About this page\nOur systems have detected unusual traffic</body></html>`,
  });

  const result = await handler.handle(new URL("https://www.google.com/search?q=initiative&udm=50"), {
    env: {} as never,
    crawlWithBrowserAdapter: async () => {
      throw new Error("browser fallback should not run");
    },
  });

  assert.equal(result.title, "initiative - Google Search");
  assert.match(result.content_markdown, /This Google search page could not be fully rendered/);
  assert.match(result.content_markdown, /https:\/\/www\.google\.com\/search\?q=initiative/);
});
