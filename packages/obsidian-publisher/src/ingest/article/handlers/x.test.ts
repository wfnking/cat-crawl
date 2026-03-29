import assert from "node:assert/strict";
import test from "node:test";
import { XHandler } from "./x.js";

const MAIN_TEXT = [
  "- Drafted a blog post",
  "- Used an LLM to meticulously improve the argument over 4 hours.",
  "- Wow, feeling great, it’s so convincing!",
  "- Fun idea let’s ask it to argue the opposite.",
  "- LLM demolishes the entire argument and convinces me that the opposite is in fact true.",
  "- lol",
  "",
  "The LLMs may elicit an opinion when asked but are extremely competent in arguing almost any direction. This is actually super useful as a tool for forming your own opinions, just make sure to ask different directions and be careful with the sycophancy.",
].join("\n");

const mainPayload = {
  code: 200,
  message: "OK",
  tweet: {
    url: "https://x.com/karpathy/status/2037921699824607591",
    text: MAIN_TEXT,
    raw_text: { text: MAIN_TEXT, facets: [] },
    created_at: "Sat Mar 28 15:56:10 +0000 2026",
    created_timestamp: 1774713370,
    author: {
      name: "Andrej Karpathy",
      screen_name: "karpathy",
    },
  },
};

test("XHandler should use full main tweet text and derive a semantic title", async () => {
  const handler = new XHandler({
    fetchPrimaryTweet: async () => mainPayload,
    fetchReplies: async () => [],
    appendVideoTranscript: async ({ sourceUrl, title, author, published, contentBody }) => ({
      sourceUrl,
      title,
      author,
      published,
      contentBody,
    }),
  });

  const result = await handler.handle(new URL("https://x.com/karpathy/status/2037921699824607591"), {
    env: {} as never,
    crawlWithBrowserAdapter: async () => {
      throw new Error("browser fallback should not run");
    },
  });

  assert.equal(
    result.title,
    "The LLMs may elicit an opinion when asked but are extremely competent in arguing almost any direction.",
  );
  assert.match(result.content_markdown, /The LLMs may elicit an opinion when asked/);
  assert.doesNotMatch(result.content_markdown, /The…/);
});

test("XHandler should append only the first three replies when replies are available", async () => {
  const handler = new XHandler({
    fetchPrimaryTweet: async () => mainPayload,
    fetchReplies: async () => [
      {
        authorName: "Sebastian Raschka",
        author: "@rasbt",
        published: "2026-03-28",
        sourceUrl: "https://x.com/rasbt/status/1",
        text: "Reply one.",
      },
      {
        authorName: "Jed Polglase",
        author: "@jedpolglase",
        published: "2026-03-28",
        sourceUrl: "https://x.com/jedpolglase/status/2",
        text: "Reply two.",
      },
      {
        authorName: "Luong NGUYEN",
        author: "@luongnv89",
        published: "2026-03-28",
        sourceUrl: "https://x.com/luongnv89/status/3",
        text: "Reply three.",
      },
      {
        authorName: "Aryaman Iyer",
        author: "@AryamanIyer3",
        published: "2026-03-28",
        sourceUrl: "https://x.com/AryamanIyer3/status/4",
        text: "Reply four should be dropped.",
      },
    ],
    appendVideoTranscript: async ({ sourceUrl, title, author, published, contentBody }) => ({
      sourceUrl,
      title,
      author,
      published,
      contentBody,
    }),
  });

  const result = await handler.handle(new URL("https://x.com/karpathy/status/2037921699824607591"), {
    env: {} as never,
    crawlWithBrowserAdapter: async () => {
      throw new Error("browser fallback should not run");
    },
  });

  assert.match(result.content_markdown, /Sebastian Raschka/);
  assert.match(result.content_markdown, /Jed Polglase/);
  assert.match(result.content_markdown, /Luong NGUYEN/);
  assert.doesNotMatch(result.content_markdown, /Aryaman Iyer/);
});
