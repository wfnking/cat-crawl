import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("workspace manifests cover feature packages", () => {
  const workspace = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const tsconfig = JSON.parse(readFileSync(join(repoRoot, "tsconfig.json"), "utf8")) as {
    compilerOptions?: {
      paths?: Record<string, string[]>;
    };
    include?: string[];
  };
  const cliSource = readFileSync(join(repoRoot, "apps", "cli", "src", "index.ts"), "utf8");

  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
  assert.match(packageJson.scripts?.test || "", /packages\/\*\*\/\*\.test\.ts/);
  assert.match(packageJson.scripts?.dev || "", /apps\/cli\/src\/index\.ts/);
  assert.equal(packageJson.dependencies?.["@cat-crawl/case-study"], "workspace:*");
  assert.equal(packageJson.dependencies?.["@cat-crawl/obsidian-publisher"], "workspace:*");
  assert.equal(packageJson.dependencies?.["@cat-crawl/core"], "workspace:*");
  assert.ok((tsconfig.compilerOptions?.paths || {})["@cat-crawl/case-study"]);
  assert.ok((tsconfig.compilerOptions?.paths || {})["@cat-crawl/obsidian-publisher"]);
  assert.ok((tsconfig.compilerOptions?.paths || {})["@cat-crawl/core"]);
  assert.match(cliSource, /from "@cat-crawl\/case-study"/);
  assert.match(cliSource, /from "@cat-crawl\/obsidian-publisher"/);
  assert.ok((tsconfig.include || []).some((entry) => entry.includes("packages")));
  assert.ok((tsconfig.include || []).some((entry) => entry.includes("apps")));
});
