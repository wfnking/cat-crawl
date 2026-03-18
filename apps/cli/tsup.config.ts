import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  clean: true,
  format: ["esm"],
  platform: "node",
  target: "node22",
  splitting: false,
  sourcemap: false,
  tsconfig: "../../tsconfig.json",
  noExternal: ["@cat-crawl/core", "@cat-crawl/obsidian-publisher"],
});
