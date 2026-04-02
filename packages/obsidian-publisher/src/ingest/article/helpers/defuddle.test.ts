import test from "node:test";
import assert from "node:assert/strict";
import { extractWithDefuddle } from "./defuddle.js";

test("extractWithDefuddle returns a normalized ingest result", async () => {
  const result = await extractWithDefuddle(
    "<html></html>",
    "https://example.com/post",
    async () => ({
      title: "Example Post",
      author: "Alice",
      published: "2026-04-01",
      contentMarkdown:
        "- Source: https://example.com/post\n\nThis is the first paragraph.\n\nThis is the second paragraph.",
    }),
  );

  assert.deepEqual(result, {
    title: "Example Post",
    author: "Alice",
    published: "2026-04-01",
    source_url: "https://example.com/post",
    content_markdown: [
      "# Example Post",
      "",
      "- Source: https://example.com/post",
      "- Author: Alice",
      "- Published: 2026-04-01",
      "",
      "This is the first paragraph.",
      "",
      "This is the second paragraph.",
    ].join("\n"),
  });
});

test("extractWithDefuddle returns null when parsed content is empty", async () => {
  const result = await extractWithDefuddle(
    "<html></html>",
    "https://example.com/post",
    async () => ({
      title: "Example Post",
      author: "Alice",
      published: "2026-04-01",
      contentMarkdown: "   ",
    }),
  );

  assert.equal(result, null);
});

test("extractWithDefuddle returns null when parser throws", async () => {
  const result = await extractWithDefuddle(
    "<html></html>",
    "https://example.com/post",
    async () => {
      throw new Error("parse failed");
    },
  );

  assert.equal(result, null);
});
