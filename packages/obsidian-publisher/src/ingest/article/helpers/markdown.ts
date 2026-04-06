import TurndownService from "turndown";
import { normalizeUrl, resolveArticleImageSrc } from "./urls.js";

export function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.remove(["style", "script", "noscript", "iframe"]);

  turndown.addRule("normalizeLinks", {
    filter: "a",
    replacement(content, node) {
      const element = node as HTMLAnchorElement;
      const href = element.getAttribute("href")?.trim() || "";
      if (!href) {
        return content;
      }
      const normalized = normalizeUrl(href);
      return `[${content || normalized}](${normalized})`;
    },
  });

  turndown.addRule("normalizeImages", {
    filter: "img",
    replacement(_content, node) {
      const element = node as HTMLImageElement;
      const alt = (element.getAttribute("alt") || "Image").trim();
      const src = resolveArticleImageSrc({
        src: element.getAttribute("src"),
        dataSrc: element.getAttribute("data-src"),
        dataOriginal: element.getAttribute("data-original"),
        dataOriginalSrc: element.getAttribute("data-original-src"),
        dataLazySrc: element.getAttribute("data-lazy-src"),
        srcset: element.getAttribute("srcset"),
      });
      if (!src) {
        return "";
      }
      return `![${alt}](${src})`;
    },
  });

  return turndown;
}

export function toMarkdown(result: {
  title: string;
  author: string | null;
  published: string | null;
  sourceUrl: string;
  contentBody: string;
}): string {
  return result.contentBody.trim();
}

export function stripLeadingSourceLine(markdown: string): string {
  return markdown
    .replace(/^- Source:\s.*(?:\r?\n){1,2}/, "")
    .trim();
}
