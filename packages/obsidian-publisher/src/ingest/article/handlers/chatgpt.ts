import { normalizePublishedDateWithFallback } from "../helpers/dates.js";
import {
  decodeEscapedJsonString,
  extractCanonicalUrl,
  extractHtmlMetaContent,
  extractHtmlTitle,
} from "../helpers/html.js";
import { toMarkdown } from "../helpers/markdown.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";

type ChatGPTShareMessage = {
  author?: { role?: string | null } | null;
  content?: { parts?: unknown[] } | null;
};

type ChatGPTSharePost = {
  text?: string | null;
  posted_at?: number | string | null;
  messages?: ChatGPTShareMessage[] | null;
};

export class ChatGPTHandler extends BaseArticleHandler {
  readonly name = "chatgpt";

  canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("chatgpt.com") || host.includes("chat.openai.com");
  }

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    try {
      const response = await fetch(url.toString());
      if (response.ok) {
        const html = await response.text();
        const parsed = this.parseShareHtml(html, url.toString());
        if (parsed) {
          context.logger?.info?.("[tool:crawl_web_article] chatgpt html parse succeeded");
          return parsed;
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.logger?.warn?.(`[tool:crawl_web_article] chatgpt direct fetch parse failed: ${detail}`);
    }

    return context.crawlWithBrowserAdapter(url.toString(), "chatgpt");
  }

  parseSharePost(post: ChatGPTSharePost | null | undefined, sourceUrl: string): IngestContentResult | null {
    if (!post) {
      return null;
    }
    const title = post.text?.trim() || "ChatGPT Share";
    const postedAtRaw = Number(post.posted_at ?? "");
    const postedAtSeconds = Number.isFinite(postedAtRaw) ? Math.floor(postedAtRaw) : null;
    const messages = Array.isArray(post.messages) ? post.messages : [];

    const sections = messages
      .map((message) => {
        const role = (message.author?.role || "").trim().toLowerCase();
        const parts = Array.isArray(message.content?.parts)
          ? message.content?.parts.filter((part): part is string => typeof part === "string")
          : [];
        const body = parts.join("\n\n").trim();
        if (!body) {
          return "";
        }
        const sectionTitle = role === "user" ? "User" : role === "assistant" ? "Assistant" : "Message";
        return `## ${sectionTitle}\n\n${body}`;
      })
      .filter(Boolean);

    if (sections.length === 0) {
      return null;
    }

    const published = normalizePublishedDateWithFallback(null, postedAtSeconds);
    return {
      title,
      author: "ChatGPT",
      published,
      source_url: sourceUrl,
      content_markdown: toMarkdown({
        title,
        author: "ChatGPT",
        published,
        sourceUrl,
        contentBody: sections.join("\n\n"),
      }),
    };
  }

  parseShareHtml(html: string, sourceUrl: string): IngestContentResult | null {
    const streamMatches = Array.from(html.matchAll(/streamController\.enqueue\(("(?:\\.|[^"])*")\)/g));
    if (streamMatches.length === 0) {
      return null;
    }

    const sections: string[] = [];
    let payloadTitle = "";
    let payloadPostedAt: number | null = null;
    let payloadSourceUrl = "";

    for (const match of streamMatches) {
      const encoded = match[1];
      if (!encoded) continue;
      let decoded = "";
      try {
        decoded = JSON.parse(encoded);
      } catch {
        continue;
      }

      if (!payloadTitle) {
        const titleMatch = decoded.match(/"text","((?:\\.|[^"])*)"/);
        if (titleMatch?.[1]) {
          payloadTitle = decodeEscapedJsonString(titleMatch[1]).trim();
        }
      }

      if (payloadPostedAt === null) {
        const postedAtMatch = decoded.match(/"posted_at",([0-9.]+)/);
        if (postedAtMatch?.[1]) {
          const postedAt = Number(postedAtMatch[1]);
          if (Number.isFinite(postedAt)) payloadPostedAt = Math.floor(postedAt);
        }
      }

      if (!payloadSourceUrl) {
        const permalinkMatch = decoded.match(/"permalink","((?:\\.|[^"])*)"/);
        if (permalinkMatch?.[1]) {
          payloadSourceUrl = decodeEscapedJsonString(permalinkMatch[1]).trim();
        }
      }

      const messageMatches = Array.from(
        decoded.matchAll(/"role","(assistant|user)"[\s\S]*?"parts",\[\d+\],"((?:\\.|[^"])*)"/g),
      );
      for (const messageMatch of messageMatches) {
        const role = messageMatch[1]?.trim().toLowerCase() || "";
        const body = decodeEscapedJsonString(messageMatch[2] || "").trim();
        if (!body) continue;
        const sectionTitle = role === "user" ? "User" : role === "assistant" ? "Assistant" : "Message";
        sections.push(`## ${sectionTitle}\n\n${body}`);
      }
    }

    if (sections.length === 0) {
      return null;
    }

    const title = payloadTitle || extractHtmlMetaContent(html, "og:title") || extractHtmlTitle(html) || "ChatGPT Share";
    const published =
      normalizePublishedDateWithFallback(extractHtmlMetaContent(html, "article:published_time"), payloadPostedAt) ||
      null;
    const finalSourceUrl = extractCanonicalUrl(html) || payloadSourceUrl || sourceUrl;

    return {
      title,
      author: "ChatGPT",
      published,
      source_url: finalSourceUrl,
      content_markdown: toMarkdown({
        title,
        author: "ChatGPT",
        published,
        sourceUrl: finalSourceUrl,
        contentBody: sections.join("\n\n"),
      }),
    };
  }
}
