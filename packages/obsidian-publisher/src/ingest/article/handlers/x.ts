import { chromium } from "playwright";
import { loadEnv, type AppEnv } from "../../../config/env.js";
import { extractAudioFromVideo } from "../../video/media/extract-audio.js";
import { transcribeAudio } from "../../video/transcription/index.js";
import { resolveXVideoSource } from "../../video/handlers/x.js";
import { loadChromeCookiesForDomains } from "../../video/helpers/chrome-cookies.js";
import { buildTranscriptMarkdownWithModel } from "../../../workflows/tools/transcribe-video.js";
import { normalizePublishedDateWithFallback } from "../helpers/dates.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";

type FXTwitterTweet = {
  url?: string;
  text?: string;
  raw_text?: {
    text?: string;
  };
  created_at?: string;
  created_timestamp?: number;
  author?: {
    name?: string;
    screen_name?: string;
  };
};

type FXTwitterResponse = {
  code?: number;
  message?: string;
  tweet?: FXTwitterTweet;
};

type ParsedXPost = {
  title: string;
  author: string | null;
  authorName: string | null;
  published: string | null;
  sourceUrl: string;
  contentBody: string;
};

type XReply = {
  author: string | null;
  authorName: string | null;
  published: string | null;
  sourceUrl: string | null;
  text: string;
};

type XVideoTranscriptDeps = {
  loadEnv?: typeof loadEnv;
  resolveXVideoSource?: typeof resolveXVideoSource;
  extractAudioFromVideo?: typeof extractAudioFromVideo;
  transcribeAudio?: typeof transcribeAudio;
  buildTranscriptMarkdown?: typeof buildTranscriptMarkdownWithModel;
};

type AppendVideoTranscriptInput = {
  sourceUrl: string;
  title: string;
  author: string | null;
  published: string | null;
  contentBody: string;
};

type AppendVideoTranscriptResult = AppendVideoTranscriptInput;

type XHandlerDeps = {
  fetchPrimaryTweet?: (url: string) => Promise<FXTwitterResponse>;
  fetchReplies?: (url: string) => Promise<XReply[]>;
  appendVideoTranscript?: (input: AppendVideoTranscriptInput) => Promise<AppendVideoTranscriptResult | null>;
};

type BrowserReplyPayload = {
  author: string | null;
  authorName: string | null;
  publishedRaw: string | null;
  sourceUrl: string | null;
  text: string;
};

function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers")
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripListPrefix(line: string): string {
  return line.replace(/^\s*[-*•]\s+/, "").trim();
}

function normalizeXSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = "x.com";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildFXTwitterApiUrl(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) => part === "status");
  const handle = parts[0] || "";
  const tweetId = statusIndex >= 0 ? parts[statusIndex + 1] || "" : "";
  if (!handle || !tweetId) {
    throw new Error(`Unsupported X status URL: ${sourceUrl}`);
  }
  return `https://api.fxtwitter.com/${handle}/status/${tweetId}`;
}

function normalizeXText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeForDedup(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

function deriveXTitle(text: string): string {
  const paragraphs = normalizeXText(text)
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const preferredParagraph =
    paragraphs.find((paragraph) =>
      paragraph
        .split(/\n/g)
        .map((line) => line.trim())
        .some((line) => line && !/^\s*[-*•]\s+/.test(line)),
    ) || paragraphs[0] || "";

  const normalizedParagraph = preferredParagraph
    .split(/\n/g)
    .map((line) => stripListPrefix(line))
    .filter(Boolean)
    .join(" ");
  const sentenceMatch = normalizedParagraph.match(/^(.+?[。！？.!?])(?:\s|$)/u);
  const rawTitle = normalizeWhitespace(sentenceMatch?.[1] || normalizedParagraph);
  return rawTitle.slice(0, 120).trim() || "Untitled";
}

function formatPublishedDate(raw: string | number | undefined): string | null {
  if (!raw) {
    return null;
  }
  return normalizePublishedDateWithFallback(String(raw), typeof raw === "number" ? raw : null);
}

async function fetchPrimaryTweetDefault(url: string): Promise<FXTwitterResponse> {
  const response = await fetch(buildFXTwitterApiUrl(url), {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`x fxtwitter request failed with ${response.status}`);
  }
  return (await response.json()) as FXTwitterResponse;
}

export class XHandler extends BaseArticleHandler {
  readonly name = "x";

  constructor(private readonly deps: XHandlerDeps = {}) {
    super();
  }

  canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("x.com") || host.includes("twitter.com");
  }

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    try {
      const primaryPayload = await (this.deps.fetchPrimaryTweet || fetchPrimaryTweetDefault)(url.toString());
      const primary = this.parseFXTwitterResponse(primaryPayload, url.toString());
      if (!primary) {
        throw new Error("empty primary tweet payload");
      }

      let replies: XReply[] = [];
      try {
        replies = await (this.deps.fetchReplies || this.fetchRepliesViaBrowser.bind(this))(primary.sourceUrl);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        context.logger?.warn?.(`[tool:crawl_web_article] x replies fetch failed: ${detail}`);
      }

      const baseContentBody = this.buildThreadContentBody(primary, replies);
      const enriched =
        (await (this.deps.appendVideoTranscript || this.maybeAppendVideoTranscript.bind(this))({
          sourceUrl: primary.sourceUrl,
          title: primary.title,
          author: primary.author,
          published: primary.published,
          contentBody: baseContentBody,
        })) || {
          sourceUrl: primary.sourceUrl,
          title: primary.title,
          author: primary.author,
          published: primary.published,
          contentBody: baseContentBody,
        };

      return {
        title: enriched.title,
        author: enriched.author,
        published: enriched.published,
        source_url: enriched.sourceUrl,
        content_markdown: enriched.contentBody,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.logger?.warn?.(`[tool:crawl_web_article] x primary fetch failed: ${detail}`);
      return context.crawlWithBrowserAdapter(url.toString(), "x");
    }
  }

  parseFXTwitterResponse(payload: FXTwitterResponse, fallbackUrl = ""): ParsedXPost | null {
    const tweet = payload.tweet;
    if (!tweet) {
      return null;
    }
    const contentBody = normalizeXText(tweet.raw_text?.text || tweet.text || "");
    if (!contentBody) {
      return null;
    }
    const authorHandle = normalizeWhitespace(tweet.author?.screen_name || "");
    const authorName = normalizeWhitespace(tweet.author?.name || "");

    return {
      title: deriveXTitle(contentBody),
      author: authorHandle ? `@${authorHandle.replace(/^@+/, "")}` : null,
      authorName: authorName || null,
      published: formatPublishedDate(tweet.created_timestamp ?? tweet.created_at),
      sourceUrl: normalizeXSourceUrl(tweet.url?.trim() || fallbackUrl),
      contentBody,
    };
  }

  buildXPostContentBody(input: {
    tweetBody: string;
    videoSummaryMarkdown?: string;
    transcriptText?: string;
  }): string {
    const sections: string[] = ["## Tweet", "", input.tweetBody.trim()];
    const videoSummary = normalizeXText(input.videoSummaryMarkdown?.trim() || "");
    if (videoSummary) sections.push("", "## Video Summary", "", videoSummary);
    const transcriptText = normalizeXText(input.transcriptText?.trim() || "");
    if (transcriptText) sections.push("", "## Transcript", "", transcriptText);
    return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async maybeAppendVideoTranscript(
    input: AppendVideoTranscriptInput,
    deps: XVideoTranscriptDeps = {},
  ): Promise<AppendVideoTranscriptResult | null> {
    const envLoader = deps.loadEnv || loadEnv;
    const resolveVideo = deps.resolveXVideoSource || resolveXVideoSource;
    const extractAudio = deps.extractAudioFromVideo || extractAudioFromVideo;
    const transcribe = deps.transcribeAudio || transcribeAudio;
    const buildTranscriptMarkdown = deps.buildTranscriptMarkdown || buildTranscriptMarkdownWithModel;

    const env = envLoader() as AppEnv;
    const resolved = await resolveVideo(input.sourceUrl, { outputDir: "/tmp/cat-crawl-x-video" });
    if (!resolved) return null;

    const audioPath = await extractAudio(resolved.mediaPath, { outputDir: "/tmp/cat-crawl-audio" });
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
      sourceUrl: resolved.sourceUrl,
      title: input.title,
      author: resolved.author || input.author,
      published: resolved.published || input.published,
      contentBody: this.buildXPostContentBody({
        tweetBody: input.contentBody,
        videoSummaryMarkdown: transcriptMarkdown.markdown,
        transcriptText: transcription.text,
      }),
    };
  }

  private formatPostSection(post: {
    author: string | null;
    authorName: string | null;
    published: string | null;
    sourceUrl: string | null;
    text: string;
  }): string {
    const displayName = post.authorName || post.author || "Unknown";
    const handle = post.author && post.author !== displayName ? ` ${post.author}` : "";
    const linkedDate = post.published
      ? post.sourceUrl
        ? ` [${post.published}](${post.sourceUrl})`
        : ` ${post.published}`
      : post.sourceUrl
        ? ` [link](${post.sourceUrl})`
        : "";
    const header = `**${displayName}**${handle}${linkedDate}`.trim();
    return [header, "", normalizeXText(post.text)].join("\n").trim();
  }

  private buildThreadContentBody(primary: ParsedXPost, replies: XReply[]): string {
    const sections = [
      this.formatPostSection({
        author: primary.author,
        authorName: primary.authorName,
        published: primary.published,
        sourceUrl: primary.sourceUrl,
        text: primary.contentBody,
      }),
    ];

    const primaryText = normalizeForDedup(primary.contentBody);
    const primaryUrl = normalizeXSourceUrl(primary.sourceUrl);
    const uniqueReplies: XReply[] = [];
    const seen = new Set<string>();
    for (const reply of replies) {
      const normalizedText = normalizeForDedup(reply.text);
      const normalizedUrl = normalizeXSourceUrl(reply.sourceUrl || "");
      if (!normalizedText) {
        continue;
      }
      if (normalizedText === primaryText) {
        continue;
      }
      if (normalizedUrl && normalizedUrl === primaryUrl) {
        continue;
      }
      const key = `${reply.author || ""}\t${normalizedUrl}\t${normalizedText}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      uniqueReplies.push(reply);
      if (uniqueReplies.length >= 3) {
        break;
      }
    }

    for (const reply of uniqueReplies) {
      sections.push(this.formatPostSection(reply));
    }

    return sections.join("\n\n---\n\n").trim();
  }

  private async fetchRepliesViaBrowser(url: string): Promise<XReply[]> {
    const launchOptions = { headless: true as const, args: ["--disable-blink-features=AutomationControlled"] };
    let browser;
    try {
      browser = await chromium.launch(launchOptions);
    } catch (error) {
      if (!isMissingPlaywrightBrowserError(error)) {
        throw error;
      }
      browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
    }

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      locale: "en-US",
      extraHTTPHeaders: {
        "accept-language": "en-US,en;q=0.9",
      },
    });

    try {
      const cookies = loadChromeCookiesForDomains([".x.com", ".twitter.com"]);
      if (cookies.length > 0) {
        await context.addCookies(
          cookies.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            expires: cookie.expires,
            sameSite: cookie.sameSite,
          })),
        );
      }
    } catch {
      // Best effort only. Missing local Chrome cookies should not fail the crawl.
    }

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(5000);
      const scraped = await page.evaluate(() => {
        const tweets = Array.from(document.querySelectorAll("article[data-testid='tweet']"));
        return tweets
          .map((tweet) => {
            const userNameText =
              tweet.querySelector("[data-testid='User-Name']")?.textContent?.replace(/\s+/g, " ").trim() || "";
            const handleMatch = userNameText.match(/@[A-Za-z0-9_]+/);
            const author = handleMatch?.[0]?.trim() || null;
            const authorName = userNameText.replace(/@[A-Za-z0-9_]+/, "").trim() || null;
            const timeEl = tweet.querySelector("time");
            const sourceUrl =
              (timeEl?.closest("a") as HTMLAnchorElement | null)?.href?.trim() ||
              (timeEl as HTMLTimeElement | null)?.dateTime ||
              null;
            const publishedRaw = timeEl?.getAttribute("datetime")?.trim() || timeEl?.textContent?.trim() || null;
            const text = Array.from(tweet.querySelectorAll("[data-testid='tweetText']"))
              .map((node) => node.textContent?.trim() || "")
              .filter(Boolean)
              .join("\n\n")
              .replace(/[ \t]+\n/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
            return { author, authorName, publishedRaw, sourceUrl, text };
          })
          .filter((item) => item.text);
      });

      return (scraped as BrowserReplyPayload[]).map((item) => ({
        author: item.author,
        authorName: item.authorName,
        published: item.publishedRaw ? normalizePublishedDateWithFallback(item.publishedRaw, null) : null,
        sourceUrl: item.sourceUrl ? normalizeXSourceUrl(item.sourceUrl) : null,
        text: normalizeXText(item.text),
      }));
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}
