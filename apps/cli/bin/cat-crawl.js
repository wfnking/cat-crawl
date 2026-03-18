#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(currentDir, "../dist/index.js");

if (!existsSync(distEntry)) {
  console.error("cat-crawl CLI is not built. Run `pnpm --filter cat-crawl build` first.");
  process.exit(1);
}

await import(pathToFileURL(distEntry).href);
