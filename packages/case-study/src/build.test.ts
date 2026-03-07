import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCaseStudyIndexes } from "./build.js";

function createTempRoot(): { rootDir: string; cleanup: () => void } {
  const rootDir = mkdtempSync(join(tmpdir(), "cat-crawl-case-study-build-"));
  return {
    rootDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}

function seedPage(rootDir: string): void {
  const siteDir = join(rootDir, "case-studies", "sites", "thevibemarketer");
  mkdirSync(siteDir, { recursive: true });
  writeFileSync(
    join(siteDir, "site.json"),
    JSON.stringify(
      {
        title: "The Vibe Marketer",
        updatedAt: "2026-03-07T00:00:00.000Z",
        pageSlugs: ["home"],
      },
      null,
      2,
    ),
  );
  const pageDir = join(rootDir, "case-studies", "sites", "thevibemarketer", "pages", "home");
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(
    join(pageDir, "page.json"),
    JSON.stringify(
      {
        url: "https://www.thevibemarketer.com/",
        title: "The Vibe Marketer",
        pageType: "marketing-home",
        auth: "public",
        summary: "AI marketing ecosystem",
        screenshots: ["screenshot.png"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(pageDir, "tokens.json"),
    JSON.stringify({
      colors: ["#000", "#fff"],
      fontFamilies: ["Inter"],
    }),
  );
  writeFileSync(
    join(pageDir, "components.json"),
    JSON.stringify({
      items: [
        {
          kind: "hero",
          name: "Hero",
        },
      ],
    }),
  );
  writeFileSync(
    join(pageDir, "copy.json"),
    JSON.stringify({
      hero: "AI Marketing That Converts",
      cta: ["Get the Playbook"],
    }),
  );
}

test("buildCaseStudyIndexes aggregates sites and pages into generated indexes", () => {
  const { rootDir, cleanup } = createTempRoot();

  try {
    seedPage(rootDir);
    buildCaseStudyIndexes({ repoRoot: rootDir });

    const indexJson = JSON.parse(
      readFileSync(join(rootDir, "case-studies", "generated", "index.json"), "utf8"),
    ) as {
      sites: Array<{
        slug: string;
        title: string;
        pageCount: number;
        pages: Array<{ slug: string; copySummary?: { hero?: string } }>;
      }>;
    };
    const searchJson = JSON.parse(
      readFileSync(join(rootDir, "case-studies", "generated", "search.json"), "utf8"),
    ) as { pages: Array<{ siteSlug: string; pageSlug: string; title: string }> };

    assert.equal(indexJson.sites[0]?.slug, "thevibemarketer");
    assert.equal(indexJson.sites[0]?.title, "The Vibe Marketer");
    assert.equal(indexJson.sites[0]?.pageCount, 1);
    assert.equal(indexJson.sites[0]?.pages[0]?.slug, "home");
    assert.equal(indexJson.sites[0]?.pages[0]?.copySummary?.hero, "AI Marketing That Converts");
    assert.equal(searchJson.pages[0]?.siteSlug, "thevibemarketer");
    assert.equal(searchJson.pages[0]?.pageSlug, "home");
    assert.equal(searchJson.pages[0]?.title, "The Vibe Marketer");
  } finally {
    cleanup();
  }
});
