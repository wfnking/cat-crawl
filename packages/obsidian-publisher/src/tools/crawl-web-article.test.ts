import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./crawl-web-article.js";

test("extractArticleUrl should detect generic article links", () => {
  assert.equal(
    __test__.extractArticleUrl("看看这个 https://m.huxiu.com/article/4794991.html 很有意思"),
    "https://m.huxiu.com/article/4794991.html",
  );
});

test("extractArticleUrl should still support wechat links", () => {
  assert.equal(
    __test__.extractArticleUrl("https://mp.weixin.qq.com/s/abc123"),
    "https://mp.weixin.qq.com/s/abc123",
  );
});

test("pickArticleAdapter should map hosts to known adapters", () => {
  assert.equal(__test__.pickArticleAdapter("https://mp.weixin.qq.com/s/abc123"), "wechat");
  assert.equal(__test__.pickArticleAdapter("https://m.huxiu.com/article/4794991.html"), "huxiu");
  assert.equal(__test__.pickArticleAdapter("https://x.com/example/status/123"), "x");
  assert.equal(__test__.pickArticleAdapter("https://twitter.com/example/status/123"), "x");
  assert.equal(__test__.pickArticleAdapter("https://example.com/blog/post"), "generic");
});

test("resolveArticleImageSrc should skip inline placeholders", () => {
  assert.equal(
    __test__.resolveArticleImageSrc({
      src: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
      dataSrc: "//cdn.example.com/real.jpg",
    }),
    "https://cdn.example.com/real.jpg",
  );
});

test("normalizePublishedDateWithFallback should use timestamp year for wechat short date", () => {
  assert.equal(__test__.normalizePublishedDateWithFallback("2/28 20:50", 1772283000), "2026-02-28");
});

test("normalizePublishedDateWithFallback should fall back to unix timestamp when raw date missing", () => {
  assert.equal(__test__.normalizePublishedDateWithFallback(null, 1772283000), "2026-02-28");
});

test("normalizePublishedDateWithFallback should parse english month dates from x oembed", () => {
  assert.equal(__test__.normalizePublishedDateWithFallback("March 21, 2006", null), "2006-03-21");
});

test("createBrowserScrapeFunction should avoid ts helper leakage in page.evaluate", () => {
  const browserFn = __test__.createBrowserScrapeFunction();
  const source = browserFn.toString();

  assert.equal(source.includes("__name"), false);
  assert.match(source, /article\[data-testid="tweet"\]/);
});

test("parseXOEmbedResponse should extract public x post metadata", () => {
  const result = __test__.parseXOEmbedResponse({
    url: "https://twitter.com/jack/status/20",
    author_name: "jack",
    author_url: "https://twitter.com/jack",
    html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://twitter.com/jack/status/20?ref_src=twsrc%5Etfw">March 21, 2006</a></blockquote>',
  });

  assert.ok(result);
  assert.equal(result.author, "@jack");
  assert.equal(result.published, "2006-03-21");
  assert.equal(result.sourceUrl, "https://twitter.com/jack/status/20");
  assert.match(result.contentBody, /just setting up my twttr/);
});
