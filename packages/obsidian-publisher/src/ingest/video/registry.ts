import { existsSync } from "node:fs";
import { douyinVideoHandler } from "./handlers/douyin.js";
import { fileVideoHandler } from "./handlers/file.js";
import { youtubeVideoHandler } from "./handlers/youtube.js";
import type { VideoHandler } from "./types.js";

function isYoutubeUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
}

function isDouyinUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "douyin.com" || host.endsWith(".douyin.com") || host === "v.douyin.com";
}

export function selectVideoHandler(source: string): VideoHandler {
  const input = source.trim();
  if (!input) {
    throw new Error("Video source cannot be empty.");
  }

  if (existsSync(input)) {
    return fileVideoHandler;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Unsupported video source: ${source}`);
  }

  if (isYoutubeUrl(url)) {
    return youtubeVideoHandler;
  }
  if (isDouyinUrl(url)) {
    return douyinVideoHandler;
  }

  throw new Error(`Unsupported video source: ${source}`);
}
