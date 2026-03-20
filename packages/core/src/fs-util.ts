import { mkdirSync, readdirSync } from "node:fs";

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export function listDirectories(rootDir: string): string[] {
  try {
    return readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
