import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./save-to-obsidian.js";

test("buildNoteContent should render frontmatter properties in expected order", () => {
  const content = __test__.buildNoteContent(
    {
      title: "X Platform User Feedback",
      source_url: "https://x.com/example/status/1",
      content_markdown: "# X Platform User Feedback\n\n正文内容",
      author: "@elonmusk",
      published: "2026/03/01",
      description: "自动生成摘要",
      tags: ["clippings", "opc"],
      mode: "create",
    },
    ["clippings", "opc"],
  );

  const lines = content.split("\n");
  assert.equal(lines[0], "---");
  assert.match(lines[1] || "", /^title:/);
  assert.match(lines[2] || "", /^source:/);
  assert.match(lines[3] || "", /^author:/);
  assert.match(lines[4] || "", /^published:/);
  assert.match(lines[5] || "", /^created:/);
  assert.match(lines[6] || "", /^description:/);
  assert.match(lines[7] || "", /^tags:/);
});

test("normalizeDateString should normalize common date formats", () => {
  assert.equal(__test__.normalizeDateString("2026年3月1日"), "2026-03-01");
  assert.equal(__test__.normalizeDateString("2026/03/01"), "2026-03-01");
  assert.equal(__test__.normalizeDateString("2026-03-01"), "2026-03-01");
});

test("formatObsidianCommandForLog should avoid printing full content payload", () => {
  const rendered = __test__.formatObsidianCommandForLog([
    "vault=知识库",
    "create",
    "path=Clippings/demo.md",
    "content=hello world",
  ]);
  assert.equal(
    rendered,
    "obsidian vault=知识库 create path=Clippings/demo.md content=<11 chars>",
  );
});

test("hasObsidianOutputError should detect vault missing output", () => {
  assert.equal(__test__.hasObsidianOutputError("Vault not found."), true);
  assert.equal(__test__.hasObsidianOutputError("ERROR: something wrong"), true);
  assert.equal(__test__.hasObsidianOutputError(""), false);
});

test("parseVaultsVerbose should parse tsv vault listings", () => {
  assert.deepEqual(
    __test__.parseVaultsVerbose(
      "知识库\t/Users/alfwong/Library/Mobile Documents/iCloud~md~obsidian/Documents/知识库\nWork\t/tmp/work\n",
    ),
    [
      {
        name: "知识库",
        path: "/Users/alfwong/Library/Mobile Documents/iCloud~md~obsidian/Documents/知识库",
      },
      {
        name: "Work",
        path: "/tmp/work",
      },
    ],
  );
});

test("resolveVaultNotePath should keep notes inside vault", () => {
  assert.equal(
    __test__.resolveVaultNotePath("/tmp/vault", "Clippings/OPC/demo.md"),
    "/tmp/vault/Clippings/OPC/demo.md",
  );
  assert.throws(
    () => __test__.resolveVaultNotePath("/tmp/vault", "../escape.md"),
    /cannot escape the vault/i,
  );
});

test("resolveAvailableNotePath should append numeric suffix when file already exists", async () => {
  const existing = new Set([
    "/tmp/vault/Clippings/demo.md",
    "/tmp/vault/Clippings/demo (2).md",
  ]);

  const resolved = await __test__.resolveAvailableNotePath(
    "/tmp/vault",
    "Clippings/demo.md",
    async (path) => existing.has(path),
  );

  assert.equal(resolved, "Clippings/demo (3).md");
});

test("extractDescriptionCandidate should skip article metadata and media noise", () => {
  const candidate = __test__.extractDescriptionCandidate(`# 美国司法部扣押中国籍诈骗犯陈志价值150亿美元比特币

- Source: https://m.huxiu.com/article/4794991.html
- Author: 虎嗅网
- Published: 2025-10-21

![cover](https://example.com/cover.jpg)

本文来自微信公众号：冰川思享号（ID：icereview），作者：上官金虹，题图来自：AI生成

福建省连江县晓澳镇的晓兴村，是一个有着千余户人家的富庶村。1987年12月，陈志出生在这里。`);

  assert.equal(
    candidate,
    "福建省连江县晓澳镇的晓兴村，是一个有着千余户人家的富庶村。",
  );
});

test("extractDescriptionCandidate should skip transcript preamble and timestamps", () => {
  const candidate = __test__.extractDescriptionCandidate(`- Source: https://www.douyin.com/video/7601522393686089978

Sure! Here's a transcript of the video.

00:00 - 00:30

Now I have two hooks that I'm going to put here on the screen and I want us to see if we can pick which one is the best. So take a look at this first one.`);

  assert.equal(
    candidate,
    "Now I have two hooks that I'm going to put here on the screen and I want us to see if we can pick which one is the best.",
  );
});

test("shouldFallbackToGeneratedDescription should detect noisy candidates", () => {
  assert.equal(
    __test__.shouldFallbackToGeneratedDescription(
      "Sure! Here's a transcript of the video. 00:00 - 00:30 https://example.com",
    ),
    true,
  );
  assert.equal(
    __test__.shouldFallbackToGeneratedDescription("福建省连江县晓澳镇的晓兴村，是一个有着千余户人家的富庶村。"),
    false,
  );
});

test("resolveDescription should fallback to generator when candidate is noisy", async () => {
  const description = await __test__.resolveDescription(
    {
      content_markdown: `- Source: https://www.douyin.com/video/7601522393686089978

Sure! Here's a transcript of the video.

00:00 - 00:30

https://example.com/frame.jpg`,
    },
    async (markdown) => {
      assert.match(markdown, /Sure! Here's a transcript/);
      return "这段视频讲解了如何用提问式钩子提升英文写作开头的吸引力。";
    },
  );

  assert.equal(description, "这段视频讲解了如何用提问式钩子提升英文写作开头的吸引力。");
});

test("resolveDescription should keep rule-based candidate when generator fails", async () => {
  const description = await __test__.resolveDescription(
    {
      content_markdown: `福建省连江县晓澳镇的晓兴村，是一个有着千余户人家的富庶村。1987年12月，陈志出生在这里。`,
    },
    async () => {
      throw new Error("gemini unavailable");
    },
  );

  assert.equal(description, "福建省连江县晓澳镇的晓兴村，是一个有着千余户人家的富庶村。");
});

test("resolveDescription should return noisy candidate when generator fails for fallback case", async () => {
  const description = await __test__.resolveDescription(
    {
      content_markdown: `- Source: https://www.douyin.com/video/7601522393686089978

Sure! Here's a transcript of the video.

00:00 - 00:30

Now I have two hooks that I'm going to put here on the screen and I want us to see if we can pick which one is the best.`,
    },
    async () => {
      throw new Error("gemini unavailable");
    },
  );

  assert.equal(
    description,
    "Now I have two hooks that I'm going to put here on the screen and I want us to see if we can pick which one is the best.",
  );
});

test("resolveDescription should return empty string when no candidate exists and generator fails", async () => {
  const description = await __test__.resolveDescription(
    {
      content_markdown: `- Source: https://example.com

00:00 - 00:30

https://example.com/image.jpg`,
    },
    async () => {
      throw new Error("gemini unavailable");
    },
  );

  assert.equal(description, "");
});
