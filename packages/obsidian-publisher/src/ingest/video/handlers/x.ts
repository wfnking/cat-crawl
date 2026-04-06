import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const xVideoHandler = {
  name: "x",
} as const;

type FXTwitterFormat = {
  url?: string;
  bitrate?: number;
  container?: string;
  codec?: string;
};

type FXTwitterMedia = {
  type?: string;
  url?: string;
  thumbnail_url?: string;
  formats?: FXTwitterFormat[];
};

type FXTwitterTweet = {
  url?: string;
  text?: string;
  created_at?: string;
  created_timestamp?: number;
  author?: {
    name?: string;
    screen_name?: string;
  };
  media?: {
    all?: FXTwitterMedia[];
  };
};

type FXTwitterResponse = {
  code?: number;
  message?: string;
  tweet?: FXTwitterTweet;
};

type ParsedXVideo = {
  sourceUrl: string;
  mediaUrl: string;
  title?: string;
  author?: string;
  published?: string;
};

type ResolveXVideoSourceOptions = {
  outputDir: string;
  fetchJson?: (url: string) => Promise<FXTwitterResponse>;
  downloadVideo?: (mediaUrl: string, outputDir: string) => Promise<string>;
};

type ResolvedXVideoSource = {
  adapter: "x";
  sourceUrl: string;
  mediaPath: string;
  title?: string;
  author?: string;
  published?: string;
};

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

function formatPublishedDate(raw: string | number | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const date = typeof raw === "number" ? new Date(raw * 1000) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pickBestVideoUrl(media: FXTwitterMedia): string {
  const formats = Array.isArray(media.formats) ? media.formats : [];
  const mp4Formats = formats
    .filter((item) => item.container === "mp4" && item.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (mp4Formats[0]?.url) {
    return mp4Formats[0].url;
  }
  return media.url?.trim() || "";
}

function parseFXTwitterResponse(payload: FXTwitterResponse): ParsedXVideo | null {
  const tweet = payload.tweet;
  if (!tweet) {
    return null;
  }
  const mediaItems = Array.isArray(tweet.media?.all) ? tweet.media?.all : [];
  const video = mediaItems.find((item) => item.type === "video");
  if (!video) {
    return null;
  }
  const mediaUrl = pickBestVideoUrl(video);
  if (!mediaUrl) {
    return null;
  }

  return {
    sourceUrl: normalizeXSourceUrl(tweet.url?.trim() || ""),
    mediaUrl,
    title: tweet.text?.trim() || undefined,
    author: tweet.author?.screen_name?.trim() ? `@${tweet.author.screen_name.trim()}` : undefined,
    published: formatPublishedDate(tweet.created_timestamp ?? tweet.created_at),
  };
}

async function fetchJsonDefault(url: string): Promise<FXTwitterResponse> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`fxtwitter request failed with ${response.status}`);
  }
  return (await response.json()) as FXTwitterResponse;
}

async function downloadVideoDefault(mediaUrl: string, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const response = await fetch(mediaUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) {
    throw new Error(`video download failed with ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const outputPath = join(outputDir, "x-video.mp4");
  await writeFile(outputPath, bytes);
  return outputPath;
}

export async function resolveXVideoSource(
  sourceUrl: string,
  options: ResolveXVideoSourceOptions,
): Promise<ResolvedXVideoSource | null> {
  const fetchJson = options.fetchJson || fetchJsonDefault;
  const downloadVideo = options.downloadVideo || downloadVideoDefault;
  const payload = await fetchJson(buildFXTwitterApiUrl(sourceUrl));
  const parsed = parseFXTwitterResponse(payload);
  if (!parsed) {
    return null;
  }
  const mediaPath = await downloadVideo(parsed.mediaUrl, options.outputDir);
  return {
    adapter: "x",
    sourceUrl: parsed.sourceUrl || normalizeXSourceUrl(sourceUrl),
    mediaPath,
    title: parsed.title,
    author: parsed.author,
    published: parsed.published,
  };
}

export const __test__ = {
  parseFXTwitterResponse,
  normalizeXSourceUrl,
  buildFXTwitterApiUrl,
  formatPublishedDate,
  pickBestVideoUrl,
};
