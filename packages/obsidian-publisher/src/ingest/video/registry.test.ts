import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { selectVideoHandler } from "./registry.js";

function createTempMediaFile(): { filePath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cat-crawl-video-source-"));
  const filePath = join(dir, "sample.mp4");
  writeFileSync(filePath, "demo");
  return {
    filePath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("selectVideoHandler should choose file adapter for local media path", () => {
  const { filePath, cleanup } = createTempMediaFile();
  try {
    const adapter = selectVideoHandler(filePath);
    assert.equal(adapter.name, "file");
  } finally {
    cleanup();
  }
});

test("selectVideoHandler should choose youtube adapter for youtube urls", () => {
  assert.equal(selectVideoHandler("https://www.youtube.com/watch?v=abc123").name, "youtube");
  assert.equal(selectVideoHandler("https://youtu.be/abc123").name, "youtube");
});

test("selectVideoHandler should choose douyin adapter for douyin urls", () => {
  assert.equal(selectVideoHandler("https://www.douyin.com/video/123456").name, "douyin");
  assert.equal(selectVideoHandler("https://v.douyin.com/ABCDE/").name, "douyin");
});

test("selectVideoHandler should reject douyin ai answer share urls", () => {
  assert.throws(
    () =>
      selectVideoHandler(
        "https://so-landing.douyin.com/search_ai_mobile/share?schema_type=66&scene=answer",
      ),
    /Unsupported video source/,
  );
});

test("selectVideoHandler should reject unsupported urls", () => {
  assert.throws(
    () => selectVideoHandler("https://example.com/video/123"),
    /Unsupported video source/,
  );
});
