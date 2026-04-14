import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { createLogger } from "@cat-crawl/core";
import { resolveVaultPath } from "../../obsidian/vault-path.js";

const logger = createLogger();

export type ExistingSavedRecord = {
  createdAt: string;
  title: string;
  vault: string;
  path: string;
  sourceUrl: string;
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content.slice(0, 4000);
  }
  const endIndex = content.indexOf("\n---", 4);
  if (endIndex < 0) {
    return content.slice(0, 4000);
  }
  return content.slice(0, endIndex + 4);
}

function extractTitleFromFrontmatter(frontmatter: string, fallbackPath: string): string {
  const match = frontmatter.match(/^title:\s*(.+)$/m);
  if (!match?.[1]) {
    return basename(fallbackPath, ".md");
  }
  return stripYamlQuotes(match[1]) || basename(fallbackPath, ".md");
}

function extractYouTubeVideoId(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }
    if (host !== "youtube.com" && host !== "m.youtube.com") {
      return null;
    }
    const watchId = url.searchParams.get("v");
    if (watchId) {
      return watchId;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "live") {
      return segments[1] || null;
    }
  } catch {
    return null;
  }
  return null;
}

function extractXStatusId(sourceUrl: string): string | null {
  const match = sourceUrl.match(/(?:x|twitter)\.com\/[^/\s]+\/status\/(\d+)/i);
  return match?.[1] ?? null;
}

function buildSourceFrontmatterRegex(sourceUrl: string): RegExp {
  const youtubeId = extractYouTubeVideoId(sourceUrl);
  if (youtubeId) {
    return new RegExp(
      [
        "^source:\\s*[\"']?",
        "https?:\\/\\/(?:www\\.)?",
        "(?:youtube\\.com\\/(?:watch\\?(?:[^#\\n\"']*&)?v=|shorts\\/|embed\\/|live\\/)|youtu\\.be\\/)",
        escapeRegex(youtubeId),
        "(?:[?&][^\\n\"']*)?",
        "[\"']?\\s*$",
      ].join(""),
      "im",
    );
  }

  const xStatusId = extractXStatusId(sourceUrl);
  if (xStatusId) {
    return new RegExp(
      [
        "^source:\\s*[\"']?",
        "https?:\\/\\/(?:www\\.)?(?:x|twitter)\\.com\\/[^/\\s]+\\/status\\/",
        escapeRegex(xStatusId),
        "(?:\\?[^\\n\"']*)?",
        "[\"']?\\s*$",
      ].join(""),
      "im",
    );
  }

  return new RegExp(
    `^source:\\s*["']?${escapeRegex(sourceUrl.trim())}["']?\\s*$`,
    "im",
  );
}

async function findMatchingMarkdownFile(
  currentPath: string,
  sourceRegex: RegExp,
): Promise<string | null> {
  const entries = (await readdir(currentPath, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    const absolutePath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      const nestedMatch = await findMatchingMarkdownFile(absolutePath, sourceRegex);
      if (nestedMatch) {
        return nestedMatch;
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    if (sourceRegex.test(extractFrontmatter(content))) {
      return absolutePath;
    }
  }

  return null;
}

export async function findExistingSavedRecordByUrl(
  sourceUrl: string,
  options?: {
    vaultPath?: string;
    resolveVaultPath?: typeof resolveVaultPath;
  },
): Promise<ExistingSavedRecord | null> {
  const normalizedUrl = sourceUrl.trim();
  if (!normalizedUrl) {
    return null;
  }

  const resolveVault = options?.resolveVaultPath || resolveVaultPath;
  const vaultPath = options?.vaultPath || (await resolveVault());
  if (!vaultPath) {
    return null;
  }

  try {
    const matchedFile = await findMatchingMarkdownFile(
      vaultPath,
      buildSourceFrontmatterRegex(normalizedUrl),
    );
    if (!matchedFile) {
      return null;
    }

    const content = await readFile(matchedFile, "utf8");
    const frontmatter = extractFrontmatter(content);
    return {
      createdAt: "",
      title: extractTitleFromFrontmatter(frontmatter, matchedFile),
      vault: basename(vaultPath),
      path: relative(vaultPath, matchedFile),
      sourceUrl: normalizedUrl,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(`[agent] existing-note scan failed, fallback to normal crawl: ${detail}`);
    return null;
  }
}
