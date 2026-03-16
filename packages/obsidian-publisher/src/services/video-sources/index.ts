import { existsSync } from "node:fs";
import { douyinVideoSourceAdapter } from "./douyin.js";
import { fileVideoSourceAdapter } from "./file.js";
import { youtubeVideoSourceAdapter } from "./youtube.js";

export type VideoSourceAdapter =
  | typeof fileVideoSourceAdapter
  | typeof youtubeVideoSourceAdapter
  | typeof douyinVideoSourceAdapter;

function isYoutubeUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
}

function isDouyinUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "douyin.com" || host.endsWith(".douyin.com") || host === "v.douyin.com";
}

export function selectVideoSourceAdapter(source: string): VideoSourceAdapter {
  const input = source.trim();
  if (!input) {
    throw new Error("Video source cannot be empty.");
  }

  if (existsSync(input)) {
    return fileVideoSourceAdapter;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Unsupported video source: ${source}`);
  }

  if (isYoutubeUrl(url)) {
    return youtubeVideoSourceAdapter;
  }
  if (isDouyinUrl(url)) {
    return douyinVideoSourceAdapter;
  }

  throw new Error(`Unsupported video source: ${source}`);
}
