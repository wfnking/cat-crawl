#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(currentDir, "../dist/apps/cli/src/index.js");

if (!existsSync(distEntry)) {
  console.error("cat-crawl CLI is not built. Run `pnpm build` in the repo root first.");
  process.exit(1);
}

await import(pathToFileURL(distEntry).href);
