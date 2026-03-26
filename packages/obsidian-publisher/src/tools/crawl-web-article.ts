import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import TurndownService from "turndown";
import { z } from "zod";
import { extractArticleUrl } from "../utils/text.js";

export type ArticleAdapterName =
  | "wechat"
  | "huxiu"
  | "x"
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

type ArticleImageAttrs = {
  src?: string | null;
  dataSrc?: string | null;
  dataOriginal?: string | null;
  dataOriginalSrc?: string | null;
  dataLazySrc?: string | null;
  srcset?: string | null;
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

function normalizeUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

function resolveSourceUrl(baseUrl: string, candidate: string | null | undefined): string {
  const value = candidate?.trim() || "";
  if (!value) {
    return baseUrl;
  }
  try {
    return new URL(normalizeUrl(value), baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function isInlineDataImage(url: string): boolean {
  return url.toLowerCase().startsWith("data:image/");
}

function firstSrcFromSrcset(raw: string): string {
  return raw
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0] || "")
    .filter(Boolean)[0] || "";
}

export function resolveArticleImageSrc(attrs: ArticleImageAttrs): string {
  const values = [
    attrs.dataSrc,
    attrs.dataOriginal,
    attrs.dataOriginalSrc,
    attrs.dataLazySrc,
    attrs.src,
    attrs.srcset ? firstSrcFromSrcset(attrs.srcset) : "",
  ]
    .map((item) => item?.trim() || "")
    .filter(Boolean);

  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (isInlineDataImage(normalized)) {
      continue;
    }
    return normalized;
  }

  return "";
}

function normalizePublishedDate(raw: string | null): string | null {
  const text = raw?.trim() || "";
  const fullDate = text.match(/(\d{4})[./\-年](\d{1,2})[./\-月](\d{1,2})/);
  if (fullDate) {
    return `${fullDate[1]}-${fullDate[2].padStart(2, "0")}-${fullDate[3].padStart(2, "0")}`;
  }
  const englishMonth = text.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})$/i,
  );
  if (englishMonth) {
    const monthMap: Record<string, string> = {
      january: "01",
      february: "02",
      march: "03",
      april: "04",
      may: "05",
      june: "06",
      july: "07",
      august: "08",
      september: "09",
      october: "10",
      november: "11",
      december: "12",
    };
    const month = monthMap[englishMonth[1].toLowerCase()];
    const day = englishMonth[2].padStart(2, "0");
    return `${englishMonth[3]}-${month}-${day}`;
  }
  return null;
}

function formatUnixSecondsDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const numeric = Number(String(raw).trim());
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const seconds = numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  if (seconds <= 0) {
    return null;
  }
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePublishedDateWithFallback(
  raw: string | null,
  fallbackTimestampSeconds: number | null,
): string | null {
  const normalized = normalizePublishedDate(raw);
  if (normalized) {
    return normalized;
  }

  const fallback = formatUnixSecondsDate(fallbackTimestampSeconds);
  const text = raw?.trim() || "";
  const monthDay = text.match(/(\d{1,2})[./\-月](\d{1,2})(?:日)?(?:\s+\d{1,2}:\d{2})?/);
  if (monthDay && fallback) {
    const year = fallback.slice(0, 4);
    const month = monthDay[1].padStart(2, "0");
    const day = monthDay[2].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return fallback;
}

const BROWSER_SCRAPE_FUNCTION_SOURCE = String.raw`function(currentAdapter) {
  const meta = (name, attr = 'name') =>
    document.querySelector('meta[' + attr + '="' + name + '"]')?.getAttribute('content')?.trim() || null;
  const text = (selectors) => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value) {
        return value;
      }
    }
    return null;
  };
  const html = (selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) {
        return node;
      }
    }
    return null;
  };

  const selectorMap = {
    wechat: ['#js_content', '.rich_media_content', 'article'],
    huxiu: [
      '.article-content',
      '.article__content',
      '.detail-content',
      '.article-wrap',
      'article',
      'main article',
      'main',
    ],
    csdn: ['#content_views', '#article_content', '.blog-content-box', 'main'],
    tencent: ['.mod-content__markdown', '.mod-content', '.cdc-article__body', 'main'],
    zhihu: ['.QuestionAnswer-content', '.RichContent-inner', 'article', 'main'],
    x: ['article[data-testid="tweet"]', 'main'],
    generic: [
      'article',
      "[itemprop='articleBody']",
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      'main',
    ],
  };

  const title =
    meta('og:title', 'property') ||
    meta('twitter:title', 'name') ||
    text(['#activity-name', 'h1', '.QuestionHeader-title', '.article-title', '.title']) ||
    document.title ||
    'Untitled';

  let author =
    text([
      '#js_name',
      '.account_nickname_inner',
      '.AuthorInfo-name .UserLink-link',
      '.author-info__username',
      '.follow-nickName',
      '.mod-article-source__name',
      '.AuthorInfo-name',
      '.UserLink-link',
      '.author-name',
      '.author',
      "[rel='author']",
      '.rich_media_meta_nickname',
      '.rich_media_meta_link',
      '.rich_media_meta_text.nickname',
      '.rich_media_meta_text',
    ]) || meta('author', 'name');

  const anyWindow = window;
  const authorLooksLikeDate = /^(\d{1,4}[./\-年]\d{1,2}([./\-月]\d{1,2})?)(\s+\d{1,2}:\d{2})?$/.test(
    (author || '').trim(),
  );

  if (currentAdapter === 'wechat' && (!author || authorLooksLikeDate)) {
    const authorFromWindow = anyWindow.cgiDataNew?.nick_name?.trim() || anyWindow.nickname?.trim() || null;
    if (authorFromWindow) {
      author = authorFromWindow;
    }
  }

  if (currentAdapter === 'zhihu') {
    const zhihuAuthor =
      document.querySelector('.AuthorInfo-name .UserLink-link')?.textContent?.trim() ||
      document.querySelector('.AuthorInfo-name')?.textContent?.trim() ||
      '';
    if (zhihuAuthor) {
      author = zhihuAuthor;
    }
  }

  const publishedRaw =
    text([
      '#publish_time',
      '.publish_time',
      '.rich_media_meta_text#publish_time',
      ".rich_media_meta_text[id*='publish']",
      'time',
      '.article-time',
      '.publish-time',
      '.article-time-box',
      '.mod-header__detail',
      '.ContentItem-time',
      '.ContentItem-time span',
      '.time',
      "[data-role='publish-time']",
    ]) ||
    meta('article:published_time', 'property') ||
    meta('dateCreated', 'itemprop') ||
    meta('dateModified', 'itemprop') ||
    meta('publishdate', 'name') ||
    meta('pubdate', 'name');

  const buildXMarkdown = () => {
    const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    if (tweets.length === 0) {
      return {
        markdown: '',
        author: null,
        publishedRaw: null,
      };
    }

    const sections = [];
    let firstAuthor = null;
    let firstPublishedRaw = null;

    for (let index = 0; index < tweets.length; index += 1) {
      const tweet = tweets[index];
      const userNameText =
        tweet.querySelector('[data-testid="User-Name"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const handleMatch = userNameText.match(/@[A-Za-z0-9_]+/);
      const tweetAuthor = (handleMatch?.[0] || userNameText || '').trim();
      if (!firstAuthor && tweetAuthor) {
        firstAuthor = tweetAuthor;
      }

      const timeEl = tweet.querySelector('time');
      const tweetTime = timeEl?.getAttribute('datetime')?.trim() || timeEl?.textContent?.trim() || '';
      if (!firstPublishedRaw && tweetTime) {
        firstPublishedRaw = tweetTime;
      }

      const tweetText = Array.from(tweet.querySelectorAll('[data-testid="tweetText"]'))
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean)
        .join('\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (!tweetText) {
        continue;
      }

      const mediaUrls = Array.from(tweet.querySelectorAll('img'))
        .map((node) => node.getAttribute('src')?.trim() || '')
        .filter((src) => /twimg\.com\/media\//i.test(src));
      const uniqueMediaUrls = Array.from(new Set(mediaUrls));
      const mediaMarkdown = uniqueMediaUrls
        .map((src, mediaIndex) => '![Image ' + (mediaIndex + 1) + '](' + src + ')')
        .join('\n\n');

      const titleParts = [tweetAuthor, tweetTime].filter(Boolean);
      const sectionTitle = titleParts.join(' · ') || 'Tweet ' + (index + 1);
      sections.push(['## ' + sectionTitle, '', tweetText, mediaMarkdown].filter(Boolean).join('\n').trim());
    }

    return {
      markdown: sections.join('\n\n').trim(),
      author: firstAuthor,
      publishedRaw: firstPublishedRaw,
    };
  };

  const timestampCandidates = [
    anyWindow.ct,
    anyWindow.createTime,
    anyWindow.msg_publish_time,
    anyWindow.ori_create_time,
    anyWindow.appmsgpublishtime,
    anyWindow.cgiDataNew?.create_time,
  ];
  let publishedTimestamp = null;
  for (const candidate of timestampCandidates) {
    const numeric = Number(String(candidate ?? '').trim());
    if (!Number.isFinite(numeric)) {
      continue;
    }
    const seconds = numeric > 1000000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    if (seconds > 0) {
      publishedTimestamp = seconds;
      break;
    }
  }

  const xStructured = currentAdapter === 'x' ? buildXMarkdown() : null;
  if (currentAdapter === 'x') {
    author = xStructured?.author || author;
  }

  let contentHtml = '';
  if (currentAdapter === 'chatgpt') {
    const messages = Array.from(document.querySelectorAll('[data-message-author-role]'));
    const seen = new Set();
    const sections = [];
    for (const message of messages) {
      const role = (message.getAttribute('data-message-author-role') || '').trim().toLowerCase();
      const messageId = message.getAttribute('data-message-id')?.trim() || '';
      const dedupeKey = messageId || role + ':' + (message.textContent || '').trim().slice(0, 120);
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const markdownNode = message.querySelector('.markdown');
      const messageHtml = markdownNode instanceof HTMLElement ? markdownNode.innerHTML.trim() : '';
      if (!messageHtml) {
        continue;
      }

      const sectionTitle = role === 'assistant' ? 'Assistant' : role === 'user' ? 'User' : role || 'Message';
      sections.push(
        '<section data-role="' +
          sectionTitle.toLowerCase() +
          '"><h2>' +
          sectionTitle +
          '</h2>' +
          messageHtml +
          '</section>',
      );
    }
    contentHtml = sections.join('\n\n').trim();
    if (!author) {
      author = 'ChatGPT';
    }
  } else {
    const contentNode = html(selectorMap[currentAdapter] || selectorMap.generic);
    if (contentNode) {
      const clone = contentNode.cloneNode(true);
      clone
        .querySelectorAll(
          'script,style,noscript,iframe,svg,form,button,.advertisement,.ad,.related-article,.recommend-wrap,.m-player-wrap',
        )
        .forEach((el) => el.remove());

      clone.querySelectorAll('*').forEach((el) => {
        const style = (el.getAttribute('style') || '').toLowerCase();
        if (style.includes('display:none') || style.includes('visibility:hidden')) {
          el.remove();
          return;
        }

        if (el.tagName.toLowerCase() === 'img') {
          const preferred =
            el.getAttribute('data-src') ||
            el.getAttribute('data-original') ||
            el.getAttribute('data-original-src') ||
            el.getAttribute('data-lazy-src') ||
            el.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
          const src = el.getAttribute('src');
          const isDataImage = (src || '').toLowerCase().startsWith('data:image/');
          if ((!src || isDataImage) && preferred) {
            el.setAttribute('src', preferred);
          }
        }

        if (el.tagName.toLowerCase() === 'a') {
          const href = el.getAttribute('href');
          if (href?.startsWith('//')) {
            el.setAttribute('href', 'https:' + href);
          }
        }
      });

      contentHtml = clone.innerHTML;
    }
  }

  const carouselImages =
    currentAdapter === 'wechat'
      ? Array.from(document.querySelectorAll('#img_swiper img, .share_media_swiper img, #js_share_content_page_hd img'))
          .map((img) => {
            const src =
              img.getAttribute('data-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('data-original-src') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('src') ||
              '';
            return src.trim();
          })
          .filter(Boolean)
      : [];

  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || null;

  return {
    title,
    author: author || null,
    published: xStructured?.publishedRaw || publishedRaw || null,
    publishedTimestamp,
    contentHtml,
    xContentMarkdown: xStructured?.markdown || '',
    carouselImages: Array.from(new Set(carouselImages)),
    canonical,
  };
}`;

function createBrowserScrapeFunction(): (currentAdapter: ArticleAdapterName) => BrowserScrapeResult {
  return Function(`return (${BROWSER_SCRAPE_FUNCTION_SOURCE});`)() as (
    currentAdapter: ArticleAdapterName,
  ) => BrowserScrapeResult;
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

  return {
    title: parsed.title,
    author: parsed.author,
    published: parsed.published,
    source_url: parsed.sourceUrl || url,
    content_markdown: toMarkdown({
      title: parsed.title,
      author: parsed.author,
      published: parsed.published,
      sourceUrl: parsed.sourceUrl || url,
      contentBody: parsed.contentBody,
    }),
  };
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

export const crawlWebArticleTool = tool(
  async ({ url }): Promise<CrawlResult> => {
    const adapter = pickArticleAdapter(url);
    logger.info(`[tool:crawl_web_article] start url=${url} adapter=${adapter}`);

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

      const scraped = await page.evaluate(createBrowserScrapeFunction(), adapter);

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
    description: "抓取通用网页文章，支持微信、虎嗅、百度百家号、X/Twitter、ChatGPT 分享页和普通文章页，返回标题、作者、来源和正文 markdown 内容",
    schema: inputSchema,
  },
);

export const __test__ = {
  extractArticleUrl,
  pickArticleAdapter,
  resolveArticleImageSrc,
  normalizePublishedDateWithFallback,
  formatUnixSecondsDate,
  createBrowserScrapeFunction,
  parseXOEmbedResponse,
  parseChatGPTSharePost,
  parseChatGPTShareHtml,
  parseBaiduShareHtml,
  resolveSourceUrl,
};
