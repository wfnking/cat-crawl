import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import TurndownService from "turndown";
import { z } from "zod";
import { loadEnv, type AppEnv } from "../config/env.js";
import { extractAudioFromVideo } from "../services/media/extract-audio.js";
import { transcribeAudio } from "../services/transcription/index.js";
import { resolveXVideoSource } from "../services/video-sources/x.js";
import {
  BROWSER_SCRAPE_FUNCTION_SOURCE,
  createBrowserScrapeFunction,
} from "../crawl/helpers/browser.js";
import {
  formatUnixSecondsDate,
  normalizePublishedDateWithFallback,
} from "../crawl/helpers/dates.js";
import {
  normalizeUrl,
  resolveArticleImageSrc,
  resolveSourceUrl,
} from "../crawl/helpers/urls.js";
import { fallbackCrawler, sourceCrawlers } from "../crawl/crawlers/index.js";
import { selectCrawlerStrategy } from "../crawl/registry.js";
import { buildTranscriptMarkdownWithModel } from "./transcribe-video.js";
import { extractArticleUrl } from "../utils/text.js";

export type ArticleAdapterName =
  | "wechat"
  | "huxiu"
  | "x"
  | "reddit"
  | "chatgpt"
  | "baidu"
  | "zhihu"
  | "tencent"
  | "csdn"
  | "generic";

type CrawlResult = {
  title: string;
  author: string | null;
  published: string | null;
  source_url: string;
  content_markdown: string;
};

type BrowserScrapeResult = {
  title: string;
  author: string | null;
  published: string | null;
  publishedTimestamp: number | null;
  contentHtml: string;
  xContentMarkdown: string;
  carouselImages: string[];
  canonical: string | null;
};

type XOEmbedResponse = {
  url?: string;
  author_name?: string;
  author_url?: string;
  html?: string;
};

type ParsedXOEmbedResult = {
  title: string;
  author: string | null;
  published: string | null;
  sourceUrl: string;
  contentBody: string;
};

type XVideoTranscriptDeps = {
  loadEnv?: typeof loadEnv;
  resolveXVideoSource?: typeof resolveXVideoSource;
  extractAudioFromVideo?: typeof extractAudioFromVideo;
  transcribeAudio?: typeof transcribeAudio;
  buildTranscriptMarkdown?: typeof buildTranscriptMarkdownWithModel;
};

type ChatGPTShareMessage = {
  author?: {
    role?: string | null;
  } | null;
  content?: {
    parts?: unknown[];
  } | null;
};

type ChatGPTSharePost = {
  text?: string | null;
  posted_at?: number | string | null;
  messages?: ChatGPTShareMessage[] | null;
};

const inputSchema = z.object({
  url: z.string().url().describe("文章链接"),
});

const logger = createLogger();

function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers")
  );
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, " - ");
}

function stripHtmlTags(input: string): string {
  return decodeHtmlEntities(input)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeXOEmbedSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildXOEmbedLookupUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === "x.com") {
    parsed.hostname = "twitter.com";
  }
  const endpoint = new URL("https://publish.twitter.com/oembed");
  endpoint.searchParams.set("omit_script", "1");
  endpoint.searchParams.set("url", parsed.toString());
  return endpoint.toString();
}

function normalizeRedditSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = "www.reddit.com";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildRedditEmbedUrl(url: string): string {
  const parsed = new URL(normalizeRedditSourceUrl(url));
  parsed.hostname = "embed.reddit.com";
  return parsed.toString();
}

function parseXOEmbedResponse(payload: XOEmbedResponse): ParsedXOEmbedResult | null {
  const html = payload.html?.trim() || "";
  if (!html) {
    return null;
  }

  const textMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const contentBody = stripHtmlTags(textMatch?.[1] || "");
  if (!contentBody) {
    return null;
  }

  const linkMatches = Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
  const publishedRaw = stripHtmlTags(linkMatches.at(-1)?.[2] || "");
  const sourceUrl = normalizeXOEmbedSourceUrl(linkMatches.at(-1)?.[1] || payload.url || "");
  const authorHandle = payload.author_url
    ? new URL(payload.author_url).pathname.split("/").filter(Boolean)[0] || ""
    : "";
  const normalizedAuthorName = payload.author_name?.trim().replace(/^@+/, "") || "";
  const author = authorHandle
    ? `@${authorHandle}`
    : normalizedAuthorName
      ? `@${normalizedAuthorName}`
      : null;

  return {
    title: contentBody.slice(0, 80),
    author,
    published: normalizePublishedDateWithFallback(publishedRaw, null),
    sourceUrl,
    contentBody,
  };
}

async function crawlXPostViaOEmbed(url: string): Promise<CrawlResult | null> {
  const response = await fetch(buildXOEmbedLookupUrl(url));
  if (!response.ok) {
    throw new Error(`x oembed request failed with ${response.status}`);
  }

  const payload = (await response.json()) as XOEmbedResponse;
  const parsed = parseXOEmbedResponse(payload);
  if (!parsed) {
    return null;
  }

  let author = parsed.author;
  let published = parsed.published;
  let sourceUrl = parsed.sourceUrl || url;
  let contentBody = parsed.contentBody;
  try {
    const videoResult = await maybeAppendXVideoTranscript({
      url: sourceUrl,
      tweetBody: parsed.contentBody,
    });
    if (videoResult) {
      author = videoResult.author || author;
      published = videoResult.published || published;
      sourceUrl = videoResult.sourceUrl || sourceUrl;
      contentBody = videoResult.contentBody;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(`[tool:crawl_web_article] x video transcript append failed: ${detail}`);
  }

  return {
    title: parsed.title,
    author,
    published,
    source_url: sourceUrl,
    content_markdown: toMarkdown({
      title: parsed.title,
      author,
      published,
      sourceUrl,
      contentBody,
    }),
  };
}

async function resolveRedditSourceUrl(url: string): Promise<string | null> {
  const parsed = new URL(url);
  if (parsed.pathname.includes("/comments/")) {
    return normalizeRedditSourceUrl(parsed.toString());
  }
  if (!parsed.pathname.includes("/s/")) {
    return null;
  }

  const redirectLookupUrl = new URL(parsed.pathname + parsed.search, "https://rxddit.com");
  const response = await fetch(redirectLookupUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
    redirect: "manual",
  });
  const location = response.headers.get("location")?.trim() || "";
  if (!location) {
    return null;
  }
  return normalizeRedditSourceUrl(location);
}

function parseRedditEmbedHtml(html: string, sourceUrl: string): CrawlResult | null {
  const title = decodeHtmlEntities(
    html.match(/<shreddit-embed-title>([\s\S]*?)<\/shreddit-embed-title>/i)?.[1]?.trim() || "",
  );
  const author = decodeHtmlEntities(
    html.match(/href="https:\/\/www\.reddit\.com\/user\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i)?.[1]?.trim() || "",
  );
  const published = normalizePublishedDateWithFallback(
    html.match(/<faceplate-timeago[^>]*ts="([^"]+)"/i)?.[1]?.trim() || null,
    null,
  );
  const contentHtml =
    html.match(/<div id="t3_[^"]+-post-rtjson-content"[^>]*>([\s\S]*?)<\/div>/i)?.[1]?.trim() || "";
  if (!title || !contentHtml) {
    return null;
  }

  const markdownBody = createTurndownService().turndown(contentHtml).replace(/\n{3,}/g, "\n\n").trim();
  if (!markdownBody) {
    return null;
  }

  const embeddedSourceUrl =
    html.match(/<a id="embed-title"[^>]*href="([^"]+)"/i)?.[1]?.trim().replace(/&amp;/g, "&") || "";
  const finalSourceUrl = normalizeRedditSourceUrl(embeddedSourceUrl || sourceUrl);

  return {
    title,
    author: author || null,
    published,
    source_url: finalSourceUrl,
    content_markdown: toMarkdown({
      title,
      author: author || null,
      published,
      sourceUrl: finalSourceUrl,
      contentBody: markdownBody,
    }),
  };
}

async function crawlRedditPostViaEmbed(url: string): Promise<CrawlResult | null> {
  const sourceUrl = await resolveRedditSourceUrl(url);
  if (!sourceUrl) {
    return null;
  }

  const response = await fetch(buildRedditEmbedUrl(sourceUrl), {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) {
    throw new Error(`reddit embed request failed with ${response.status}`);
  }

  const html = await response.text();
  return parseRedditEmbedHtml(html, sourceUrl);
}

function parseChatGPTSharePost(
  post: ChatGPTSharePost | null | undefined,
  sourceUrl: string,
): CrawlResult | null {
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

function decodeEscapedJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

function extractHtmlMetaContent(
  html: string,
  key: string,
  attr: "name" | "property" = "property",
): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]+${attr}=["']${escapedKey}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return html.match(pattern)?.[1]?.trim() || null;
}

function extractCanonicalUrl(html: string): string | null {
  return html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]?.trim() || null;
}

function extractHtmlTitle(html: string): string | null {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
  if (!title) {
    return null;
  }
  return title.replace(/^ChatGPT\s*-\s*/i, "").trim();
}

function extractInnerHtmlByDataTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    return "";
  }

  const startIndex = html.lastIndexOf("<div", markerIndex);
  if (startIndex < 0) {
    return "";
  }

  const contentStart = html.indexOf(">", markerIndex);
  if (contentStart < 0) {
    return "";
  }

  let depth = 0;
  let cursor = startIndex;
  while (cursor < html.length) {
    const nextOpen = html.indexOf("<div", cursor);
    const nextClose = html.indexOf("</div>", cursor);
    if (nextClose < 0) {
      return "";
    }

    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + 4;
      continue;
    }

    depth -= 1;
    cursor = nextClose + 6;
    if (depth === 0) {
      return html.slice(contentStart + 1, nextClose).trim();
    }
  }

  return "";
}

function extractTextByDataTestId(html: string, testId: string): string | null {
  const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`data-testid=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/`, "i"));
  const text = stripHtmlTags(match?.[1] || "");
  return text || null;
}

function extractBaiduSourceUrl(html: string, fallbackUrl: string): string {
  const canonical = extractCanonicalUrl(html)?.replace(/^http:\/\//i, "https://") || "";
  if (canonical) {
    return canonical;
  }
  const readsrcMatch = html.match(/"readsrc"\s*:\s*\{[\s\S]*?"link":"((?:\\.|[^"])*)"/i);
  const decoded = readsrcMatch?.[1] ? decodeEscapedJsonString(readsrcMatch[1]) : "";
  const normalized = decoded.trim().replace(/^http:\/\//i, "https://");
  return normalized || fallbackUrl;
}

function parseChatGPTShareHtml(html: string, sourceUrl: string): CrawlResult | null {
  const streamMatches = Array.from(
    html.matchAll(/streamController\.enqueue\(("(?:\\.|[^"])*")\)/g),
  );
  if (streamMatches.length === 0) {
    return null;
  }

  const sections: string[] = [];
  let payloadTitle = "";
  let payloadPostedAt: number | null = null;
  let payloadSourceUrl = "";

  for (const match of streamMatches) {
    const encoded = match[1];
    if (!encoded) {
      continue;
    }
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
        if (Number.isFinite(postedAt)) {
          payloadPostedAt = Math.floor(postedAt);
        }
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
      if (!body) {
        continue;
      }
      const sectionTitle = role === "user" ? "User" : role === "assistant" ? "Assistant" : "Message";
      sections.push(`## ${sectionTitle}\n\n${body}`);
    }
  }

  if (sections.length === 0) {
    return null;
  }

  const title = payloadTitle || extractHtmlMetaContent(html, "og:title") || extractHtmlTitle(html) || "ChatGPT Share";
  const published =
    normalizePublishedDateWithFallback(
      extractHtmlMetaContent(html, "article:published_time"),
      payloadPostedAt,
    ) || null;
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

function parseBaiduShareHtml(html: string, sourceUrl: string): CrawlResult | null {
  const title = extractHtmlTitle(html);
  const author = extractTextByDataTestId(html, "author-name");
  const published = normalizePublishedDateWithFallback(extractTextByDataTestId(html, "updatetime"), null);
  const contentHtml = extractInnerHtmlByDataTestId(html, "article");
  if (!title || !contentHtml) {
    return null;
  }

  const markdownBody = createTurndownService().turndown(contentHtml).replace(/\n{3,}/g, "\n\n").trim();
  if (!markdownBody) {
    return null;
  }

  const finalSourceUrl = extractBaiduSourceUrl(html, sourceUrl);
  return {
    title,
    author,
    published,
    source_url: finalSourceUrl,
    content_markdown: toMarkdown({
      title,
      author,
      published,
      sourceUrl: finalSourceUrl,
      contentBody: markdownBody,
    }),
  };
}

function createTurndownService(): TurndownService {
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

function toMarkdown(result: {
  title: string;
  author: string | null;
  published: string | null;
  sourceUrl: string;
  contentBody: string;
}): string {
  return [
    `# ${result.title}`,
    "",
    `- Source: ${result.sourceUrl}`,
    `- Author: ${result.author ?? "Unknown"}`,
    `- Published: ${result.published ?? "Unknown"}`,
    "",
    result.contentBody,
  ]
    .join("\n")
    .trim();
}

function stripLeadingSourceLine(markdown: string): string {
  return markdown
    .replace(/^- Source:\s.*(?:\r?\n){1,2}/, "")
    .trim();
}

function buildXPostContentBody(input: {
  tweetBody: string;
  videoSummaryMarkdown?: string;
  transcriptText?: string;
}): string {
  const sections: string[] = ["## Tweet", "", input.tweetBody.trim()];
  const videoSummary = stripLeadingSourceLine(input.videoSummaryMarkdown?.trim() || "");
  if (videoSummary) {
    sections.push("", "## Video Summary", "", videoSummary);
  }
  const transcriptText = input.transcriptText?.trim() || "";
  if (transcriptText) {
    sections.push("", "## Transcript", "", transcriptText);
  }
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function maybeAppendXVideoTranscript(
  input: {
    url: string;
    tweetBody: string;
  },
  deps: XVideoTranscriptDeps = {},
): Promise<{
  contentBody: string;
  author?: string;
  published?: string;
  sourceUrl?: string;
} | null> {
  const envLoader = deps.loadEnv || loadEnv;
  const resolveVideo = deps.resolveXVideoSource || resolveXVideoSource;
  const extractAudio = deps.extractAudioFromVideo || extractAudioFromVideo;
  const transcribe = deps.transcribeAudio || transcribeAudio;
  const buildTranscriptMarkdown = deps.buildTranscriptMarkdown || buildTranscriptMarkdownWithModel;

  const env = envLoader() as AppEnv;
  const resolved = await resolveVideo(input.url, {
    outputDir: "/tmp/cat-crawl-x-video",
  });
  if (!resolved) {
    return null;
  }

  const audioPath = await extractAudio(resolved.mediaPath, {
    outputDir: "/tmp/cat-crawl-audio",
  });
  const transcription = await transcribe(audioPath, {
    provider: "whisper_cpp",
    whisperCpp: {
      bin: env.whisperCppBin,
      modelPath: env.whisperCppModelPath,
      language: env.whisperCppLanguage,
      outputDir: "/tmp/cat-crawl-whisper",
    },
  });
  const transcriptMarkdown = await buildTranscriptMarkdown(env, {
    sourceUrl: resolved.sourceUrl,
    transcriptText: transcription.text,
    transcriptSrt: transcription.srt,
  });

  return {
    contentBody: buildXPostContentBody({
      tweetBody: input.tweetBody,
      videoSummaryMarkdown: transcriptMarkdown.markdown,
      transcriptText: transcription.text,
    }),
    author: resolved.author,
    published: resolved.published,
    sourceUrl: resolved.sourceUrl,
  };
}

export function pickArticleAdapter(url: string): ArticleAdapterName {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("mp.weixin.qq.com")) {
    return "wechat";
  }
  if (host.includes("huxiu.com")) {
    return "huxiu";
  }
  if (host.includes("x.com") || host.includes("twitter.com")) {
    return "x";
  }
  if (host.includes("reddit.com")) {
    return "reddit";
  }
  if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
    return "chatgpt";
  }
  if (host.includes("zhihu.com")) {
    return "zhihu";
  }
  if (host.includes("cloud.tencent.com")) {
    return "tencent";
  }
  if (host.includes("csdn.net")) {
    return "csdn";
  }
  if (host.includes("mo.mbd.baidu.com") || host.includes("mbd.baidu.com") || host.includes("baijiahao.baidu.com")) {
    return "baidu";
  }
  return "generic";
}

function isRegistryManagedAdapter(adapter: ArticleAdapterName): boolean {
  return adapter === "wechat" || adapter === "x" || adapter === "generic";
}

async function crawlBrowserAdapterArticle(
  url: string,
  adapter: "wechat" | "generic" | "x",
): Promise<CrawlResult> {
  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    logger.info("[tool:crawl_web_article] using bundled playwright chromium");
  } catch (error) {
    if (!isMissingPlaywrightBrowserError(error)) {
      throw error;
    }
    logger.warn("[tool:crawl_web_article] bundled chromium missing, fallback to local Chrome channel");
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    logger.info("[tool:crawl_web_article] using local chrome channel");
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(adapter === "wechat" ? 1500 : 2200);

    const scraped = await page.evaluate(
      createBrowserScrapeFunction<[ArticleAdapterName], BrowserScrapeResult>(
        BROWSER_SCRAPE_FUNCTION_SOURCE,
      ),
      adapter,
    );

    const turndown = createTurndownService();
    const markdownBody =
      adapter === "x" && scraped.xContentMarkdown
        ? scraped.xContentMarkdown
        : turndown.turndown(scraped.contentHtml || "");
    const carouselMarkdown = (scraped.carouselImages || [])
      .map((src: string, index: number) => `![Carousel ${index + 1}](${normalizeUrl(src)})`)
      .join("\n\n");
    const contentBody = [carouselMarkdown, markdownBody]
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 30000);
    if (!contentBody) {
      throw new Error("Failed to extract article content.");
    }

    const sourceUrl = resolveSourceUrl(url, scraped.canonical);
    const published = normalizePublishedDateWithFallback(
      scraped.published,
      scraped.publishedTimestamp ?? null,
    );
    return {
      title: scraped.title,
      author: scraped.author,
      published,
      source_url: sourceUrl,
      content_markdown: toMarkdown({
        title: scraped.title,
        author: scraped.author,
        published,
        sourceUrl,
        contentBody,
      }),
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export const crawlWebArticleTool = tool(
  async ({ url }): Promise<CrawlResult> => {
    const adapter = pickArticleAdapter(url);
    logger.info(`[tool:crawl_web_article] start url=${url} adapter=${adapter}`);

    if (isRegistryManagedAdapter(adapter)) {
      const strategy = selectCrawlerStrategy(new URL(url), sourceCrawlers, fallbackCrawler);
      return strategy.crawl(new URL(url), {
        env: loadEnv(),
        logger,
        crawlWithBrowserAdapter: crawlBrowserAdapterArticle,
        crawlXPost: async (sourceUrl) => {
          try {
            const xResult = await crawlXPostViaOEmbed(sourceUrl);
            if (xResult) {
              logger.info("[tool:crawl_web_article] x oembed fallback succeeded");
              return xResult;
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            logger.warn(`[tool:crawl_web_article] x oembed fallback failed: ${detail}`);
          }
          return crawlBrowserAdapterArticle(sourceUrl, "x");
        },
      });
    }

    if (adapter === "x") {
      try {
        const oembedResult = await crawlXPostViaOEmbed(url);
        if (oembedResult) {
          logger.info("[tool:crawl_web_article] x oembed fallback succeeded");
          return oembedResult;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(`[tool:crawl_web_article] x oembed fallback failed: ${detail}`);
      }
    }

    if (adapter === "reddit") {
      try {
        const redditResult = await crawlRedditPostViaEmbed(url);
        if (redditResult) {
          logger.info("[tool:crawl_web_article] reddit embed fallback succeeded");
          return redditResult;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(`[tool:crawl_web_article] reddit embed fallback failed: ${detail}`);
      }
    }

    if (adapter === "chatgpt") {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const html = await response.text();
          const parsed = parseChatGPTShareHtml(html, url);
          if (parsed) {
            logger.info("[tool:crawl_web_article] chatgpt html parse succeeded");
            return parsed;
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(`[tool:crawl_web_article] chatgpt direct fetch parse failed: ${detail}`);
      }
    }

    if (adapter === "baidu") {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const html = await response.text();
          const parsed = parseBaiduShareHtml(html, url);
          if (parsed) {
            logger.info("[tool:crawl_web_article] baidu html parse succeeded");
            return parsed;
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(`[tool:crawl_web_article] baidu direct fetch parse failed: ${detail}`);
      }
    }

    const { chromium } = await import("playwright");
    const needsStealthBrowser = adapter === "zhihu" || adapter === "csdn";
    const launchOptions =
      needsStealthBrowser
        ? { headless: true, args: ["--disable-blink-features=AutomationControlled"] }
        : { headless: true };
    let browser;
    try {
      browser = await chromium.launch(launchOptions);
      logger.info("[tool:crawl_web_article] using bundled playwright chromium");
    } catch (error) {
      if (!isMissingPlaywrightBrowserError(error)) {
        throw error;
      }
      logger.warn("[tool:crawl_web_article] bundled chromium missing, fallback to local Chrome channel");
      browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
      logger.info("[tool:crawl_web_article] using local chrome channel");
    }

    const context =
      needsStealthBrowser
        ? await browser.newContext({
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
            locale: "zh-CN",
            extraHTTPHeaders: {
              "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
          })
        : await browser.newContext();
    if (needsStealthBrowser) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });
    }
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(
        adapter === "wechat" ? 1500 : adapter === "zhihu" ? 4000 : adapter === "csdn" ? 9000 : 2200,
      );

      if (adapter === "chatgpt") {
        const pageHtml = await page.content();
        const chatgptResult = parseChatGPTShareHtml(pageHtml, url);
        if (chatgptResult) {
          logger.info("[tool:crawl_web_article] chatgpt page html parse succeeded");
          return chatgptResult;
        }
      }

      const scraped = await page.evaluate(
        createBrowserScrapeFunction<[ArticleAdapterName], BrowserScrapeResult>(
          BROWSER_SCRAPE_FUNCTION_SOURCE,
        ),
        adapter,
      );

      const turndown = createTurndownService();
      const markdownBody =
        adapter === "x" && scraped.xContentMarkdown
          ? scraped.xContentMarkdown
          : turndown.turndown(scraped.contentHtml || "");
      const carouselMarkdown = (scraped.carouselImages || [])
        .map((src: string, index: number) => `![Carousel ${index + 1}](${normalizeUrl(src)})`)
        .join("\n\n");
      const contentBody = [carouselMarkdown, markdownBody]
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 30000);
      if (!contentBody) {
        throw new Error("Failed to extract article content.");
      }

      const sourceUrl = resolveSourceUrl(url, scraped.canonical);
      const published = normalizePublishedDateWithFallback(
        scraped.published,
        scraped.publishedTimestamp ?? null,
      );
      return {
        title: scraped.title,
        author: scraped.author,
        published,
        source_url: sourceUrl,
        content_markdown: toMarkdown({
          title: scraped.title,
          author: scraped.author,
          published,
          sourceUrl,
          contentBody,
        }),
      };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  },
  {
    name: "crawl_web_article",
    description: "抓取通用网页文章，支持微信、虎嗅、百度百家号、Reddit、X/Twitter、ChatGPT 分享页和普通文章页，返回标题、作者、来源和正文 markdown 内容",
    schema: inputSchema,
  },
);

export const __test__ = {
  extractArticleUrl,
  isRegistryManagedAdapter,
  pickArticleAdapter,
  resolveArticleImageSrc,
  normalizePublishedDateWithFallback,
  formatUnixSecondsDate,
  createBrowserScrapeFunction,
  parseXOEmbedResponse,
  buildXPostContentBody,
  maybeAppendXVideoTranscript,
  parseRedditEmbedHtml,
  parseChatGPTSharePost,
  parseChatGPTShareHtml,
  parseBaiduShareHtml,
  resolveSourceUrl,
};
