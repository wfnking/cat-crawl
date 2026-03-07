import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCaseStudyCrawl } from "./run-crawl.js";

function createTempRoot(): { rootDir: string; cleanup: () => void } {
  const rootDir = mkdtempSync(join(tmpdir(), "cat-crawl-run-crawl-"));
  return {
    rootDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}

test("runCaseStudyCrawl writes core page artifacts and site metadata", async () => {
  const { rootDir, cleanup } = createTempRoot();

  try {
    const pageDir = await runCaseStudyCrawl(
      {
        url: "https://www.thevibemarketer.com/",
      },
      {
        repoRoot: rootDir,
        capture: async ({ screenshotPath }) => ({
          finalUrl: "https://www.thevibemarketer.com/",
          title: "The Vibe Marketer",
          html: "<main><section><h1>AI Marketing That Converts</h1><p>Proof</p><a>Get the Playbook</a></section></main>",
          screenshotPath,
        }),
      },
    );

    assert.ok(existsSync(join(pageDir, "page.json")));
    assert.ok(existsSync(join(pageDir, "tokens.json")));
    assert.ok(existsSync(join(pageDir, "components.json")));
    assert.ok(existsSync(join(pageDir, "copy.json")));
    assert.ok(existsSync(join(pageDir, "html.html")));

    const pageJson = JSON.parse(readFileSync(join(pageDir, "page.json"), "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(pageJson.title, "The Vibe Marketer");
    assert.equal(pageJson.pageType, "marketing-home");

    const siteJson = JSON.parse(
      readFileSync(
        join(rootDir, "case-studies", "sites", "thevibemarketer", "site.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(siteJson.title, "The Vibe Marketer");
    assert.deepEqual(siteJson.pageSlugs, ["home"]);
  } finally {
    cleanup();
  }
});

test("runCaseStudyCrawl keeps site title stable when first crawl is a subpage", async () => {
  const { rootDir, cleanup } = createTempRoot();

  try {
    await runCaseStudyCrawl(
      {
        url: "https://ads.thevibemarketer.com/daily-ads",
      },
      {
        repoRoot: rootDir,
        capture: async ({ screenshotPath }) => ({
          finalUrl: "https://ads.thevibemarketer.com/daily-ads",
          title: "Daily Ads — AI-Generated Ad Creatives",
          html: "<main><section><h1>Daily Ads</h1><a>Start Free</a></section></main>",
          screenshotPath,
        }),
      },
    );

    const siteJson = JSON.parse(
      readFileSync(
        join(rootDir, "case-studies", "sites", "thevibemarketer", "site.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(siteJson.title, "thevibemarketer");
  } finally {
    cleanup();
  }
});

test("runCaseStudyCrawl lets home page refresh site title", async () => {
  const { rootDir, cleanup } = createTempRoot();

  try {
    await runCaseStudyCrawl(
      {
        url: "https://ads.thevibemarketer.com/daily-ads",
      },
      {
        repoRoot: rootDir,
        capture: async ({ screenshotPath }) => ({
          finalUrl: "https://ads.thevibemarketer.com/daily-ads",
          title: "Daily Ads — AI-Generated Ad Creatives",
          html: "<main><section><h1>Daily Ads</h1><a>Start Free</a></section></main>",
          screenshotPath,
        }),
      },
    );

    await runCaseStudyCrawl(
      {
        url: "https://www.thevibemarketer.com/",
      },
      {
        repoRoot: rootDir,
        capture: async ({ screenshotPath }) => ({
          finalUrl: "https://www.thevibemarketer.com/",
          title: "The Vibe Marketer - 10x Your Speed To Market With AI",
          html: "<main><section><h1>AI Marketing That Converts</h1><a>Get the Playbook</a></section></main>",
          screenshotPath,
        }),
      },
    );

    const siteJson = JSON.parse(
      readFileSync(
        join(rootDir, "case-studies", "sites", "thevibemarketer", "site.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(siteJson.title, "The Vibe Marketer - 10x Your Speed To Market With AI");
  } finally {
    cleanup();
  }
});
