import { cwd } from "node:process";
import {
  captureCaseStudyPage,
  normalizeCaseStudyCaptureRequest,
  type CaseStudyCapturedPage,
  type CaseStudyCaptureRequest,
  type NormalizedCaseStudyCaptureRequest,
} from "./capture.js";
import {
  extractCaseStudyComponents,
  extractCaseStudyCopy,
  extractCaseStudyTokens,
} from "./extract.js";
import {
  resolveCaseStudyPageDir,
  resolveCaseStudySiteDir,
  writeCaseStudyPageArtifacts,
  writeCaseStudySiteMetadata,
} from "./store.js";
import { existsSync, readFileSync } from "node:fs";

function inferPageType(request: NormalizedCaseStudyCaptureRequest, page: CaseStudyCapturedPage): string {
  const url = new URL(page.finalUrl);
  const pathname = url.pathname.toLowerCase();

  if (request.pageSlug === "home" || pathname === "/" || pathname === "") {
    return "marketing-home";
  }
  if (pathname.includes("billing")) {
    return "billing";
  }
  if (pathname.includes("dashboard")) {
    return "dashboard";
  }
  if (pathname.includes("pricing")) {
    return "pricing";
  }
  return "product-landing";
}

function inferSiteTitle(input: {
  siteSlug: string;
  pageSlug: string;
  pageTitle: string;
  existingTitle?: string;
}): string {
  if (input.pageSlug === "home") {
    return input.pageTitle;
  }
  if (input.existingTitle) {
    return input.existingTitle;
  }
  return input.siteSlug;
}

export async function runCaseStudyCrawl(
  request: CaseStudyCaptureRequest,
  options?: {
    repoRoot?: string;
    capture?: (input: {
      request: NormalizedCaseStudyCaptureRequest;
      screenshotPath: string;
    }) => Promise<CaseStudyCapturedPage>;
  },
): Promise<string> {
  const normalized = normalizeCaseStudyCaptureRequest(request);
  const repoRoot = options?.repoRoot || cwd();
  const pageDir = resolveCaseStudyPageDir(repoRoot, normalized.siteSlug, normalized.pageSlug);
  const screenshotPath = `${pageDir}/screenshot.png`;
  const capture = options?.capture || captureCaseStudyPage;
  const page = await capture({
    request: normalized,
    screenshotPath,
  });

  const tokens = extractCaseStudyTokens(page.html);
  const components = extractCaseStudyComponents(page.html);
  const copy = extractCaseStudyCopy(page.title, page.html);
  const summary = copy.hero || page.title;
  const capturedAt = new Date().toISOString();
  const siteDir = resolveCaseStudySiteDir(repoRoot, normalized.siteSlug);
  const siteMetadataPath = `${siteDir}/site.json`;
  const existingSiteMetadata = existsSync(siteMetadataPath)
    ? (JSON.parse(readFileSync(siteMetadataPath, "utf8")) as {
        title?: string;
        pageSlugs?: string[];
      })
    : undefined;
  const pageSlugs = Array.from(
    new Set([...(existingSiteMetadata?.pageSlugs || []), normalized.pageSlug]),
  ).sort();

  writeCaseStudySiteMetadata({
    repoRoot,
    siteSlug: normalized.siteSlug,
    metadata: {
      slug: normalized.siteSlug,
      title: inferSiteTitle({
        siteSlug: normalized.siteSlug,
        pageSlug: normalized.pageSlug,
        pageTitle: page.title,
        existingTitle: existingSiteMetadata?.title,
      }),
      updatedAt: capturedAt,
      pageSlugs,
    },
  });

  return writeCaseStudyPageArtifacts({
    repoRoot,
    siteSlug: normalized.siteSlug,
    pageSlug: normalized.pageSlug,
    files: {
      "page.json": {
        url: page.finalUrl,
        title: page.title,
        pageType: inferPageType(normalized, page),
        auth: normalized.auth,
        capturedAt,
        summary,
        screenshots: ["screenshot.png"],
      },
      "tokens.json": tokens,
      "components.json": {
        items: components,
      },
      "copy.json": copy,
      "html.html": page.html,
    },
  });
}
