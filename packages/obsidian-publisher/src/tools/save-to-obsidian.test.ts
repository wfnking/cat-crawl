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
