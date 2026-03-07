import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type CaseStudyCaptureRequest = {
  url: string;
  site?: string;
  page?: string;
  session?: string;
};

export type NormalizedCaseStudyCaptureRequest = {
  url: string;
  auth: "public" | "session";
  sessionPath?: string;
  siteSlug: string;
  pageSlug: string;
};

export type CaseStudyCapturedPage = {
  finalUrl: string;
  title: string;
  html: string;
  screenshotPath: string;
};

export function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers")
  );
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferSiteSlug(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (host.includes("thevibemarketer.com")) {
    return "thevibemarketer";
  }
  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 2) {
    return slugify(parts[parts.length - 2] || host) || "site";
  }
  return slugify(host) || "site";
}

function inferPageSlug(url: URL): string {
  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const last = segments[segments.length - 1];
  return slugify(last || "home") || "home";
}

export function normalizeCaseStudyCaptureRequest(
  input: CaseStudyCaptureRequest,
): NormalizedCaseStudyCaptureRequest {
  const url = new URL(input.url);
  const sessionPath = input.session?.trim() || undefined;

  return {
    url: input.url,
    auth: sessionPath ? "session" : "public",
    sessionPath,
    siteSlug: input.site?.trim() || inferSiteSlug(url),
    pageSlug: input.page?.trim() || inferPageSlug(url),
  };
}

export async function captureCaseStudyPage(input: {
  request: NormalizedCaseStudyCaptureRequest;
  screenshotPath: string;
}): Promise<CaseStudyCapturedPage> {
  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!isMissingPlaywrightBrowserError(error)) {
      throw error;
    }
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }

  try {
    const context = input.request.sessionPath
      ? await browser.newContext({ storageState: input.request.sessionPath })
      : await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(input.request.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1000);
      mkdirSync(dirname(input.screenshotPath), { recursive: true });
      await page.screenshot({ path: input.screenshotPath, fullPage: true });

      const html = await page.content();
      const title = await page.title();
      return {
        finalUrl: page.url(),
        title,
        html,
        screenshotPath: input.screenshotPath,
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
