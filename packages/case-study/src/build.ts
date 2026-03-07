import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cwd } from "node:process";
import { join } from "node:path";

type PageRecord = {
  slug: string;
  title: string;
  url: string;
  pageType: string;
  auth: string;
  summary: string;
  screenshots: string[];
  tokenSummary: {
    colors: string[];
    fontFamilies: string[];
  };
  componentSummary: string[];
  copySummary: {
    hero?: string;
    proof?: string;
    mechanism?: string;
    pricing?: string;
  };
  cta: string[];
};

type SiteMetadata = {
  slug?: string;
  title?: string;
  updatedAt?: string;
  pageSlugs?: string[];
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function listDirectories(rootDir: string): string[] {
  try {
    return readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function loadSiteMetadata(siteDir: string, siteSlug: string): SiteMetadata {
  try {
    return readJsonFile<SiteMetadata>(join(siteDir, "site.json"));
  } catch {
    return {
      slug: siteSlug,
      title: siteSlug,
    };
  }
}

function loadPageRecord(siteDir: string, pageSlug: string): PageRecord {
  const pageDir = join(siteDir, "pages", pageSlug);
  const page = readJsonFile<{
    title: string;
    url: string;
    pageType: string;
    auth: string;
    summary?: string;
    screenshots?: string[];
  }>(join(pageDir, "page.json"));
  const tokens = readJsonFile<{
    colors?: string[];
    fontFamilies?: string[];
  }>(join(pageDir, "tokens.json"));
  const components = readJsonFile<{
    items?: Array<{ kind?: string }>;
  }>(join(pageDir, "components.json"));
  const copy = readJsonFile<{
    hero?: string;
    proof?: string;
    mechanism?: string;
    pricing?: string;
    cta?: string[];
  }>(join(pageDir, "copy.json"));

  return {
    slug: pageSlug,
    title: page.title,
    url: page.url,
    pageType: page.pageType,
    auth: page.auth,
    summary: page.summary || "",
    screenshots: page.screenshots || [],
    tokenSummary: {
      colors: tokens.colors || [],
      fontFamilies: tokens.fontFamilies || [],
    },
    componentSummary: (components.items || []).map((item) => item.kind || "section"),
    copySummary: {
      hero: copy.hero,
      proof: copy.proof,
      mechanism: copy.mechanism,
      pricing: copy.pricing,
    },
    cta: copy.cta || [],
  };
}

export function buildCaseStudyIndexes(options?: { repoRoot?: string }): string {
  const repoRoot = options?.repoRoot || cwd();
  const sitesRoot = join(repoRoot, "case-studies", "sites");
  const generatedRoot = join(repoRoot, "case-studies", "generated");
  mkdirSync(generatedRoot, { recursive: true });

  const sites = listDirectories(sitesRoot).map((siteSlug) => {
    const siteDir = join(sitesRoot, siteSlug);
    const metadata = loadSiteMetadata(siteDir, siteSlug);
    const pages = listDirectories(join(siteDir, "pages")).map((pageSlug) =>
      loadPageRecord(siteDir, pageSlug),
    );

    return {
      slug: siteSlug,
      title: metadata.title || siteSlug,
      updatedAt: metadata.updatedAt || null,
      pageCount: pages.length,
      pages,
    };
  });

  const searchPages = sites.flatMap((site) =>
    site.pages.map((page) => ({
      siteSlug: site.slug,
      pageSlug: page.slug,
      title: page.title,
      pageType: page.pageType,
      summary: page.summary,
      url: page.url,
    })),
  );

  writeFileSync(join(generatedRoot, "index.json"), `${JSON.stringify({ sites }, null, 2)}\n`, "utf8");
  writeFileSync(
    join(generatedRoot, "search.json"),
    `${JSON.stringify({ pages: searchPages }, null, 2)}\n`,
    "utf8",
  );

  return generatedRoot;
}
