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
