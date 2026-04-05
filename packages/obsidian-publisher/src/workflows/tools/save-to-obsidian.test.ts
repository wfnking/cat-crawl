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
    ["cat-crawl", "opc"],
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

test("buildNoteContent should use overrides for title and description", () => {
  const content = __test__.buildNoteContent(
    {
      title: "Original Title",
      source_url: "https://x.com/example/status/1",
      content_markdown: "正文内容",
      author: "@user",
      mode: "create",
    },
    ["cat-crawl"],
    { title: "AI Generated Title", description: "AI generated description" },
  );

  assert.match(content, /title: "AI Generated Title"/);
  assert.match(content, /description: "AI generated description"/);
});

test("buildNoteContent should fallback to input values when no overrides", () => {
  const content = __test__.buildNoteContent(
    {
      title: "Original Title",
      source_url: "https://example.com",
      content_markdown: "正文内容",
      description: "Explicit description",
      mode: "create",
    },
    ["cat-crawl"],
  );

  assert.match(content, /title: "Original Title"/);
  assert.match(content, /description: "Explicit description"/);
});

test("buildNoteContent should keep frontmatter valid when title and description contain newlines", () => {
  const content = __test__.buildNoteContent(
    {
      title: "Learn algorithms - visually!\nAn excellent collection",
      source_url: "https://twitter.com/vivekgalatage/status/123",
      content_markdown: "# Learn algorithms\n\nBody",
      author: "@vivekgalatage",
      published: "2026-03-19",
      tags: ["x"],
      mode: "create",
    },
    ["x"],
  );

  assert.match(
    content,
    /title: "Learn algorithms - visually! An excellent collection"/,
  );
  assert.equal(content.includes('title: "Learn algorithms - visually!\n'), false);
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

test("findVaultPathFromDesktopConfig should resolve configured vault by local obsidian config", () => {
  const configText = JSON.stringify({
    vaults: {
      "5212a2d276cfc4a4": {
        path: "/Users/alfwong/Library/Mobile Documents/iCloud~md~obsidian/Documents/知识库",
        ts: 1769770344100,
        open: true,
      },
      work: {
        path: "/tmp/work",
        ts: 1769770344101,
        open: false,
      },
    },
    cli: true,
  });

  assert.equal(
    __test__.findVaultPathFromDesktopConfig(configText, "知识库"),
    "/Users/alfwong/Library/Mobile Documents/iCloud~md~obsidian/Documents/知识库",
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

test("normalizeObsidianTag should convert unsupported tag characters", () => {
  assert.equal(__test__.normalizeObsidianTag("Google Stitch"), "Google-Stitch");
  assert.equal(__test__.normalizeObsidianTag("#AI News"), "AI-News");
  assert.equal(__test__.normalizeObsidianTag("  "), "");
});

test("inferTags should normalize and deduplicate explicit tags", () => {
  assert.deepEqual(
    __test__.inferTags({
      title: "Demo",
      source_url: "https://example.com/article",
      content_markdown: "hello",
      tags: ["Google Stitch", "google stitch", "#AI News"],
      mode: "create",
    }),
    ["Google-Stitch", "AI-News", "cat-crawl"],
  );
});

test("inferTags should always add the project tag", () => {
  assert.deepEqual(
    __test__.inferTags({
      title: "Demo",
      source_url: "https://example.com/article",
      content_markdown: "hello",
      mode: "create",
    }),
    ["cat-crawl"],
  );
});

test("inferTags should keep source tags and add the project tag", () => {
  assert.deepEqual(
    __test__.inferTags({
      title: "Demo",
      source_url: "https://x.com/example/status/1",
      content_markdown: "hello",
      mode: "create",
    }),
    ["x", "cat-crawl"],
  );
  assert.deepEqual(
    __test__.inferTags({
      title: "Demo",
      source_url: "https://mp.weixin.qq.com/s/example",
      content_markdown: "hello",
      mode: "create",
    }),
    ["wechat", "cat-crawl"],
  );
  assert.deepEqual(
    __test__.inferTags({
      title: "Demo",
      source_url: "https://www.youtube.com/watch?v=abc",
      content_markdown: "hello",
      mode: "create",
    }),
    ["youtube", "cat-crawl"],
  );
  assert.deepEqual(
    __test__.inferTags({
      title: "Demo",
      source_url: "https://www.reddit.com/r/AppBusiness/comments/1s336tn/demo/",
      content_markdown: "hello",
      mode: "create",
    }),
    ["reddit", "cat-crawl"],
  );
});
