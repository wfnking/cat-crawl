import { normalizePublishedDateWithFallback } from "./dates.js";
import { stripLeadingSourceLine, toMarkdown } from "./markdown.js";
import { resolveSourceUrl } from "./urls.js";
import type { IngestContentResult } from "../types.js";

type DefuddleParsedResult = {
  title?: string;
  author?: string;
  published?: string;
  content?: string;
  contentMarkdown?: string;
};

type DefuddleParser = (
  html: string,
  url: string,
) => Promise<DefuddleParsedResult>;

async function defaultDefuddleParser(
  html: string,
  url: string,
): Promise<DefuddleParsedResult> {
  const { Defuddle } = await import("defuddle/node");
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const [firstArg] = args;
    if (typeof firstArg === "string" && firstArg.startsWith("Failed to parse URL:")) {
      return;
    }
    originalWarn(...args);
  };
  try {
    return await Defuddle(html, url, {
      markdown: true,
      separateMarkdown: true,
      useAsync: false,
    });
  } finally {
    console.warn = originalWarn;
  }
}

export async function extractWithDefuddle(
  html: string,
  url: string,
  parser: DefuddleParser = defaultDefuddleParser,
): Promise<IngestContentResult | null> {
  try {
    const parsed = await parser(html, url);
    const title = parsed.title?.trim();
    const contentBody = stripLeadingSourceLine(
      (parsed.contentMarkdown || parsed.content || "").trim(),
    );
    if (!title || !contentBody) {
      return null;
    }

    const sourceUrl = resolveSourceUrl(url, null);
    const published = normalizePublishedDateWithFallback(parsed.published ?? null, null);

    return {
      title,
      author: parsed.author?.trim() || null,
      published,
      source_url: sourceUrl,
      content_markdown: toMarkdown({
        title,
        author: parsed.author?.trim() || null,
        published,
        sourceUrl,
        contentBody,
      }),
    };
  } catch {
    return null;
  }
}
