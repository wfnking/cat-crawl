import { loadEnv, type AppEnv } from "../../../config/env.js";
import { extractAudioFromVideo } from "../../video/media/extract-audio.js";
import { transcribeAudio } from "../../video/transcription/index.js";
import { resolveXVideoSource } from "../../video/handlers/x.js";
import { buildTranscriptMarkdownWithModel } from "../../../workflows/tools/transcribe-video.js";
import { normalizePublishedDateWithFallback } from "../helpers/dates.js";
import { stripHtmlTags } from "../helpers/html.js";
import { stripLeadingSourceLine, toMarkdown } from "../helpers/markdown.js";
import { BaseArticleHandler, type CrawlContext, type IngestContentResult } from "../types.js";

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

export class XHandler extends BaseArticleHandler {
  readonly name = "x";

  canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("x.com") || host.includes("twitter.com");
  }

  async handle(url: URL, context: CrawlContext): Promise<IngestContentResult> {
    try {
      const xResult = await this.crawlViaOEmbed(url.toString(), context);
      if (xResult) {
        context.logger?.info?.("[tool:crawl_web_article] x oembed fallback succeeded");
        return xResult;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.logger?.warn?.(`[tool:crawl_web_article] x oembed fallback failed: ${detail}`);
    }

    return context.crawlWithBrowserAdapter(url.toString(), "x");
  }

  private normalizeSourceUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private buildLookupUrl(url: string): string {
    const parsed = new URL(url);
    if (parsed.hostname === "x.com") {
      parsed.hostname = "twitter.com";
    }
    const endpoint = new URL("https://publish.twitter.com/oembed");
    endpoint.searchParams.set("omit_script", "1");
    endpoint.searchParams.set("url", parsed.toString());
    return endpoint.toString();
  }

  parseXOEmbedResponse(payload: XOEmbedResponse): ParsedXOEmbedResult | null {
    const html = payload.html?.trim() || "";
    if (!html) return null;

    const textMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const contentBody = stripHtmlTags(textMatch?.[1] || "");
    if (!contentBody) return null;

    const linkMatches = Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
    const publishedRaw = stripHtmlTags(linkMatches.at(-1)?.[2] || "");
    const sourceUrl = this.normalizeSourceUrl(linkMatches.at(-1)?.[1] || payload.url || "");
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

  buildXPostContentBody(input: {
    tweetBody: string;
    videoSummaryMarkdown?: string;
    transcriptText?: string;
  }): string {
    const sections: string[] = ["## Tweet", "", input.tweetBody.trim()];
    const videoSummary = stripLeadingSourceLine(input.videoSummaryMarkdown?.trim() || "");
    if (videoSummary) sections.push("", "## Video Summary", "", videoSummary);
    const transcriptText = input.transcriptText?.trim() || "";
    if (transcriptText) sections.push("", "## Transcript", "", transcriptText);
    return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async maybeAppendVideoTranscript(
    input: { url: string; tweetBody: string },
    deps: XVideoTranscriptDeps = {},
  ): Promise<{ contentBody: string; author?: string; published?: string; sourceUrl?: string } | null> {
    const envLoader = deps.loadEnv || loadEnv;
    const resolveVideo = deps.resolveXVideoSource || resolveXVideoSource;
    const extractAudio = deps.extractAudioFromVideo || extractAudioFromVideo;
    const transcribe = deps.transcribeAudio || transcribeAudio;
    const buildTranscriptMarkdown = deps.buildTranscriptMarkdown || buildTranscriptMarkdownWithModel;

    const env = envLoader() as AppEnv;
    const resolved = await resolveVideo(input.url, { outputDir: "/tmp/cat-crawl-x-video" });
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
      contentBody: this.buildXPostContentBody({
        tweetBody: input.tweetBody,
        videoSummaryMarkdown: transcriptMarkdown.markdown,
        transcriptText: transcription.text,
      }),
      author: resolved.author,
      published: resolved.published,
      sourceUrl: resolved.sourceUrl,
    };
  }

  private async crawlViaOEmbed(url: string, context: CrawlContext): Promise<IngestContentResult | null> {
    const response = await fetch(this.buildLookupUrl(url));
    if (!response.ok) {
      throw new Error(`x oembed request failed with ${response.status}`);
    }

    const payload = (await response.json()) as XOEmbedResponse;
    const parsed = this.parseXOEmbedResponse(payload);
    if (!parsed) return null;

    let author = parsed.author;
    let published = parsed.published;
    let sourceUrl = parsed.sourceUrl || url;
    let contentBody = parsed.contentBody;
    try {
      const videoResult = await this.maybeAppendVideoTranscript({
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
      context.logger?.warn?.(`[tool:crawl_web_article] x video transcript append failed: ${detail}`);
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
}
