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
  assert.equal(__test__.pickArticleAdapter("https://chatgpt.com/s/t_123"), "chatgpt");
  assert.equal(__test__.pickArticleAdapter("https://mo.mbd.baidu.com/r/abc123"), "baidu");
  assert.equal(__test__.pickArticleAdapter("https://mbd.baidu.com/newspage/data/landingshare"), "baidu");
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
  assert.match(source, /\[data-message-author-role\]/);
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

test("parseChatGPTSharePost should extract messages from chatgpt share loader data", () => {
  const result = __test__.parseChatGPTSharePost(
    {
      text: "Book Recommendations.",
      posted_at: 1774172085.469512,
      messages: [
        {
          author: { role: "user" },
          content: { parts: ["Recommend a few self-help books."] },
        },
        {
          author: { role: "assistant" },
          content: {
            parts: [
              "Sure! Here are a few self-help book recommendations that you might find helpful:\n\n1. Atomic Habits",
            ],
          },
        },
      ],
    },
    "https://chatgpt.com/s/t_69bfb7b5782881918cf872d323e18145",
  );

  assert.ok(result);
  assert.equal(result.title, "Book Recommendations.");
  assert.equal(result.author, "ChatGPT");
  assert.equal(result.published, "2026-03-22");
  assert.equal(result.source_url, "https://chatgpt.com/s/t_69bfb7b5782881918cf872d323e18145");
  assert.match(result.content_markdown, /Atomic Habits/);
  assert.match(result.content_markdown, /Recommend a few self-help books/);
  assert.match(result.content_markdown, /## User/);
  assert.match(result.content_markdown, /## Assistant/);
});

test("parseChatGPTShareHtml should extract messages from react router stream html", () => {
  const payload =
    '["loaderData",{"routes/s.$postId":{"postWithProfile":{"post":{"text":"Book Recommendations.","posted_at":1774172085.469512,"messages",[45],{"author",{"role","assistant"},"content",{"parts",[62],"Sure! Here are a few self-help book recommendations that you might find helpful:\\n\\n1. \\"Atomic Habits\\""},"permalink","https://chatgpt.com/s/t_69bfb7b5782881918cf872d323e18145"}}}}]';
  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>ChatGPT - Book Recommendations.</title>
    <meta property="article:published_time" content="2026-03-22T09:34:45.469Z" />
    <link rel="canonical" href="https://chatgpt.com/s/t_69bfb7b5782881918cf872d323e18145" />
  </head>
  <body>
    <script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(payload)});</script>
  </body>
</html>`;

  const result = __test__.parseChatGPTShareHtml(
    html,
    "https://chatgpt.com/s/t_69bfb7b5782881918cf872d323e18145",
  );

  assert.ok(result);
  assert.equal(result.title, "Book Recommendations.");
  assert.equal(result.author, "ChatGPT");
  assert.equal(result.published, "2026-03-22");
  assert.match(result.content_markdown, /Atomic Habits/);
});

test("parseBaiduShareHtml should extract article metadata from baidu share landing html", () => {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>为什么 Claude 写代码比国产 AI 强那么多？一个外行人的观察指南</title>
    <link rel="canonical" href="https://mbd.baidu.com/newspage/data/landingshare?nid=sv_123" />
  </head>
  <body>
    <div data-testid="author-name">粮草督运官</div>
    <div data-testid="updatetime">2026-03-12 22:13</div>
    <div class="_18p7x" data-testid="article">
      <div class="dpu8C"><p>真正的差距，不是模型参数，而是工程完整度。</p></div>
      <div class="dpu8C"><p>这类产品对上下文、工具链和错误恢复的处理更成熟。</p></div>
    </div>
  </body>
</html>`;

  const result = __test__.parseBaiduShareHtml(
    html,
    "https://mo.mbd.baidu.com/r/1TuVkZD9NWE",
  );

  assert.ok(result);
  assert.equal(result.title, "为什么 Claude 写代码比国产 AI 强那么多？一个外行人的观察指南");
  assert.equal(result.author, "粮草督运官");
  assert.equal(result.published, "2026-03-12");
  assert.equal(result.source_url, "https://mbd.baidu.com/newspage/data/landingshare?nid=sv_123");
  assert.match(result.content_markdown, /真正的差距/);
  assert.match(result.content_markdown, /工程完整度/);
  assert.match(result.content_markdown, /上下文、工具链和错误恢复/);
});
