import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, writeJsonFile } from "@cat-crawl/core";
import type { CaseStudyPageArtifacts, CaseStudySiteMetadata } from "./schema.js";

export function resolveCaseStudySiteDir(repoRoot: string, siteSlug: string): string {
  return join(repoRoot, "case-studies", "sites", siteSlug);
}

export function resolveCaseStudyPageDir(
  repoRoot: string,
  siteSlug: string,
  pageSlug: string,
): string {
  return join(resolveCaseStudySiteDir(repoRoot, siteSlug), "pages", pageSlug);
}

function writeArtifactFile(pageDir: string, fileName: string, value: string | Record<string, unknown>): void {
  const filePath = join(pageDir, fileName);
  if (typeof value === "string") {
    // Keep raw text artifacts unchanged.
    writeFileSync(filePath, value, "utf8");
    return;
  }
  writeJsonFile(filePath, value);
}

export function writeCaseStudySiteMetadata(input: {
  repoRoot: string;
  siteSlug: string;
  metadata: CaseStudySiteMetadata;
}): string {
  const siteDir = resolveCaseStudySiteDir(input.repoRoot, input.siteSlug);
  ensureDir(siteDir);
  writeArtifactFile(siteDir, "site.json", input.metadata);
  return siteDir;
}

export function writeCaseStudyPageArtifacts(input: {
  repoRoot: string;
  siteSlug: string;
  pageSlug: string;
  files: CaseStudyPageArtifacts;
}): string {
  const pageDir = resolveCaseStudyPageDir(input.repoRoot, input.siteSlug, input.pageSlug);
  ensureDir(pageDir);

  for (const [fileName, value] of Object.entries(input.files)) {
    if (value === undefined) {
      continue;
    }
    writeArtifactFile(pageDir, fileName, value);
  }

  return pageDir;
}
