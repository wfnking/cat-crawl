export type VideoHandlerName = "file" | "youtube" | "douyin";

export type VideoHandler = {
  name: VideoHandlerName;
};

export type ResolvedVideoSource = {
  adapter: VideoHandlerName;
  sourceUrl: string;
  mediaPath: string;
  transcriptPath?: string;
  title?: string;
  published?: string;
  author?: string;
};
