import assert from "node:assert/strict";
import test from "node:test";
import { __test__, createReadableVideoMarkdown } from "./video-chapters.js";

test("parseSrt should parse timestamped segments", () => {
  const segments = __test__.parseSrt([
    "1",
    "00:00:05,000 --> 00:00:09,000",
    "first line",
    "",
    "2",
    "00:00:10,500 --> 00:00:14,000",
    "second line",
  ].join("\n"));

  assert.deepEqual(segments, [
    { index: 1, startSeconds: 5, endSeconds: 9, text: "first line" },
    { index: 2, startSeconds: 10.5, endSeconds: 14, text: "second line" },
  ]);
});

test("createReadableVideoMarkdown should render linked youtube chapters", async () => {
  const markdown = await createReadableVideoMarkdown({
    sourceUrl: "https://www.youtube.com/watch?v=demo123",
    transcriptText: "raw transcript",
    transcriptSrt: [
      "1",
      "00:00:05,000 --> 00:00:09,000",
      "first line",
      "",
      "2",
      "00:00:10,000 --> 00:00:14,000",
      "second line",
    ].join("\n"),
    summarizeChapter: async ({ index }) => ({
      title: index === 0 ? "为什么这个问题重要" : "总结",
      body: index === 0 ? "第一章正文。" : "第二章正文。",
    }),
  });

  assert.match(markdown, /^- Source: https:\/\/www\.youtube\.com\/watch\?v=demo123/m);
  assert.match(markdown, /## \[为什么这个问题重要\]\(https:\/\/www\.youtube\.com\/watch\?v=demo123&t=5s\)/);
  assert.match(markdown, /第一章正文。/);
});

test("createReadableVideoMarkdown should fallback to visible timestamp for non-youtube urls", async () => {
  const markdown = await createReadableVideoMarkdown({
    sourceUrl: "https://www.douyin.com/video/123456",
    transcriptText: "raw transcript",
    transcriptSrt: [
      "1",
      "00:00:35,000 --> 00:00:39,000",
      "hello world",
    ].join("\n"),
    summarizeChapter: async () => ({
      title: "开场重点",
      body: "整理后的内容。",
    }),
  });

  assert.match(markdown, /## 开场重点（00:35）/);
  assert.match(markdown, /整理后的内容。/);
  assert.doesNotMatch(markdown, /## .*翻译|## 开场重点\n\n整理后的内容。+\n+\n##/);
});

test("createReadableVideoMarkdown should support summarizing all chapters in one model call", async () => {
  let called = 0;
  const markdown = await createReadableVideoMarkdown({
    sourceUrl: "https://www.youtube.com/watch?v=demo123",
    transcriptText: "raw transcript",
    transcriptSrt: [
      "1",
      "00:00:05,000 --> 00:00:09,000",
      "first line",
      "",
      "2",
      "00:00:10,000 --> 00:00:14,000",
      "second line",
      "",
      "3",
      "00:00:35,000 --> 00:00:39,000",
      "third line",
    ].join("\n"),
    summarizeChapters: async ({ chapters }) => {
      called += 1;
      assert.equal(chapters.length, 2);
      assert.equal(chapters[0]?.startSeconds, 5);
      assert.equal(chapters[1]?.startSeconds, 35);
      return [
        {
          title: "First Chapter",
          startSeconds: 5,
          body: "First chapter body.",
          translatedTitle: "第一章标题",
          translatedBody: "第一章正文。",
        },
        {
          title: "Second Chapter",
          startSeconds: 35,
          body: "Second chapter body.",
          translatedTitle: "第二章标题",
          translatedBody: "第二章正文。",
        },
      ];
    },
  });

  assert.equal(called, 1);
  assert.match(markdown, /## \[First Chapter\]\(https:\/\/www\.youtube\.com\/watch\?v=demo123&t=5s\)/);
  assert.match(markdown, /First chapter body\./);
  assert.match(markdown, /## 第一章标题/);
  assert.match(markdown, /第一章正文。/);
  assert.match(markdown, /## \[Second Chapter\]\(https:\/\/www\.youtube\.com\/watch\?v=demo123&t=35s\)/);
  assert.match(markdown, /Second chapter body\./);
  assert.match(markdown, /## 第二章标题/);
  assert.match(markdown, /第二章正文。/);
});

test("createReadableVideoMarkdown should allow model to merge candidates into fewer titled chapters", async () => {
  const markdown = await createReadableVideoMarkdown({
    sourceUrl: "https://www.youtube.com/watch?v=demo123",
    transcriptText: "raw transcript",
    transcriptSrt: [
      "1",
      "00:00:05,000 --> 00:00:09,000",
      "part one",
      "",
      "2",
      "00:00:10,000 --> 00:00:14,000",
      "part two",
      "",
      "3",
      "00:00:35,000 --> 00:00:39,000",
      "part three",
    ].join("\n"),
    summarizeChapters: async ({ chapters }) => {
      assert.equal(chapters.length, 2);
      return [
        {
          title: "Overview",
          startSeconds: 5,
          body: "Merged body.",
          translatedTitle: "整体概览",
          translatedBody: "合并后的正文。",
        },
      ];
    },
  });

  assert.match(markdown, /## \[Overview\]\(https:\/\/www\.youtube\.com\/watch\?v=demo123&t=5s\)/);
  assert.match(markdown, /Merged body\./);
  assert.match(markdown, /## 整体概览/);
  assert.match(markdown, /合并后的正文。/);
  assert.doesNotMatch(markdown, /章节 2/);
});

test("coalesceCandidateChapters should reduce oversplit short videos", () => {
  const segments = Array.from({ length: 12 }, (_, index) => ({
    index: index + 1,
    startSeconds: index * 10,
    endSeconds: index * 10 + 5,
    text: `segment ${index + 1}`,
  }));

  const groups = segments.map((segment) => [segment]);
  const candidates = __test__.buildCandidateChapters(groups);
  const coalesced = __test__.coalesceCandidateChapters(candidates);

  assert.ok(coalesced.length < candidates.length);
  assert.ok(coalesced.length <= 4);
  assert.equal(coalesced[0]?.startSeconds, 0);
});

test("createReadableVideoMarkdown should omit translated block when source chapter is already Chinese", async () => {
  const markdown = await createReadableVideoMarkdown({
    sourceUrl: "https://www.youtube.com/watch?v=demo123",
    transcriptText: "raw transcript",
    transcriptSrt: [
      "1",
      "00:00:05,000 --> 00:00:09,000",
      "这是中文内容",
    ].join("\n"),
    summarizeChapters: async () => [
      {
        title: "中文标题",
        startSeconds: 5,
        body: "这是中文正文。",
        translatedTitle: "Chinese Title",
        translatedBody: "This is English.",
      },
    ],
  });

  assert.match(markdown, /## \[中文标题\]\(https:\/\/www\.youtube\.com\/watch\?v=demo123&t=5s\)/);
  assert.match(markdown, /这是中文正文。/);
  assert.doesNotMatch(markdown, /Chinese Title/);
  assert.doesNotMatch(markdown, /This is English\./);
});
