import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { findExistingSavedRecordByUrl } from "./existing-save-check.js";

async function writeNote(
  vaultPath: string,
  relativePath: string,
  frontmatter: { title: string; source: string },
): Promise<void> {
  const absolutePath = join(vaultPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    [
      "---",
      `title: "${frontmatter.title}"`,
      `source: "${frontmatter.source}"`,
      "---",
      "",
      "# Body",
    ].join("\n"),
    "utf8",
  );
}

test("returns existing record when vault note frontmatter matches source url", async () => {
  const vaultPath = await mkdtemp(join(tmpdir(), "existing-save-check-"));
  await writeNote(vaultPath, "Clippings/Repeat.md", {
    title: "Repeat",
    source: "https://mp.weixin.qq.com/s/repeat",
  });

  const result = await findExistingSavedRecordByUrl("https://mp.weixin.qq.com/s/repeat", {
    vaultPath,
  });

  assert.ok(result);
  assert.equal(result.title, "Repeat");
  assert.equal(result.vault, vaultPath.split("/").at(-1));
  assert.equal(result.path, "Clippings/Repeat.md");
});

test("returns existing record when youtube source matches by video id regex", async () => {
  const vaultPath = await mkdtemp(join(tmpdir(), "existing-save-check-"));
  await writeNote(vaultPath, "Clippings/YouTube Demo.md", {
    title: "YouTube Demo",
    source: "https://www.youtube.com/watch?v=9dQ_ZIIGGzY",
  });

  const result = await findExistingSavedRecordByUrl(
    "https://youtube.com/shorts/9dQ_ZIIGGzY?si=zBs_Y1xoF18NwDkh",
    {
      vaultPath,
    },
  );

  assert.ok(result);
  assert.equal(result.path, "Clippings/YouTube Demo.md");
});

test("returns null when no markdown note matches the source regex", async () => {
  const vaultPath = await mkdtemp(join(tmpdir(), "existing-save-check-"));
  await writeNote(vaultPath, "Clippings/Other.md", {
    title: "Other",
    source: "https://example.com/other",
  });

  const result = await findExistingSavedRecordByUrl("https://mp.weixin.qq.com/s/repeat", {
    vaultPath,
  });

  assert.equal(result, null);
});
