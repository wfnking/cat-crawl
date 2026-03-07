import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseStudyPageArtifacts } from "./schema.js";

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
    writeFileSync(filePath, value, "utf8");
    return;
  }
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeCaseStudyPageArtifacts(input: {
  repoRoot: string;
  siteSlug: string;
  pageSlug: string;
  files: CaseStudyPageArtifacts;
}): string {
  const pageDir = resolveCaseStudyPageDir(input.repoRoot, input.siteSlug, input.pageSlug);
  mkdirSync(pageDir, { recursive: true });

  for (const [fileName, value] of Object.entries(input.files)) {
    if (value === undefined) {
      continue;
    }
    writeArtifactFile(pageDir, fileName, value);
  }

  return pageDir;
}
