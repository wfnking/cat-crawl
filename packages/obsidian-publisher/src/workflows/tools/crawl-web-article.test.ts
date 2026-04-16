import assert from "node:assert/strict";
import test from "node:test";
import { pickArticleAdapter, resolveInputArticleUrl } from "./crawl-web-article.js";

test("resolveInputArticleUrl should unwrap google redirect urls", () => {
  const resolved = resolveInputArticleUrl(
    "https://www.google.com/url?url=https%3A%2F%2Fx.com%2Fkarpathy%2Fstatus%2F2037921699824607591",
  );

  assert.equal(resolved, "https://x.com/karpathy/status/2037921699824607591");
});

test("resolveInputArticleUrl should preserve google search result pages", () => {
  const resolved = resolveInputArticleUrl(
    "https://www.google.com/search?smstk=foo&q=initiative&udm=50&source=sh%2Fx%2Faio%2Fm1%2F1",
  );

  assert.equal(
    resolved,
    "https://www.google.com/search?smstk=foo&q=initiative&udm=50&source=sh%2Fx%2Faio%2Fm1%2F1",
  );
});

test("pickArticleAdapter should route google search pages to google handler", () => {
  assert.equal(pickArticleAdapter("https://www.google.com/search?q=initiative&udm=50"), "google_search");
});
