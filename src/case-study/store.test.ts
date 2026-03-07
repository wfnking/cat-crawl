import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  resolveCaseStudyPageDir,
  resolveCaseStudySiteDir,
  writeCaseStudyPageArtifacts,
} from "./store.js";

function createTempRoot(): { rootDir: string; cleanup: () => void } {
  const rootDir = mkdtempSync(join(tmpdir(), "cat-crawl-case-study-"));
  return {
    rootDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}

test("resolveCaseStudySiteDir returns site root", () => {
  const result = resolveCaseStudySiteDir("/repo", "thevibemarketer");
  assert.equal(result, "/repo/case-studies/sites/thevibemarketer");
});

test("resolveCaseStudyPageDir returns page root", () => {
  const result = resolveCaseStudyPageDir("/repo", "thevibemarketer", "home");
  assert.equal(result, "/repo/case-studies/sites/thevibemarketer/pages/home");
});

test("writeCaseStudyPageArtifacts writes expected files", () => {
  const { rootDir, cleanup } = createTempRoot();

  try {
    const pageDir = writeCaseStudyPageArtifacts({
      repoRoot: rootDir,
      siteSlug: "thevibemarketer",
      pageSlug: "home",
      files: {
        "page.json": {
          title: "Home",
        },
        "tokens.json": {
          colors: ["#000000"],
        },
        "html.html": "<html></html>",
      },
    });

    assert.equal(
      pageDir,
      join(rootDir, "case-studies", "sites", "thevibemarketer", "pages", "home"),
    );
    assert.equal(
      readFileSync(join(pageDir, "page.json"), "utf8"),
      `${JSON.stringify({ title: "Home" }, null, 2)}\n`,
    );
    assert.equal(
      readFileSync(join(pageDir, "tokens.json"), "utf8"),
      `${JSON.stringify({ colors: ["#000000"] }, null, 2)}\n`,
    );
    assert.equal(readFileSync(join(pageDir, "html.html"), "utf8"), "<html></html>");
  } finally {
    cleanup();
  }
});
