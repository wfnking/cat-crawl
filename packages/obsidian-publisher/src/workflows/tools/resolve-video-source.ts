import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { resolveDouyinVideoSource } from "../../ingest/video/handlers/douyin.js";
import { resolveFileVideoSource } from "../../ingest/video/handlers/file.js";
import { selectVideoHandler } from "../../ingest/video/registry.js";
import { resolveYouTubeVideoSource } from "../../ingest/video/handlers/youtube.js";
import { resolveVideoSource } from "./transcribe-video.js";

const inputSchema = z.object({
  source: z.string().min(1).describe("视频 URL 或本地文件路径"),
});

type ResolveVideoSourceInput = z.infer<typeof inputSchema>;

type ResolveVideoSourceDeps = {
  selectVideoHandler?: typeof selectVideoHandler;
  resolveFileVideoSource?: typeof resolveFileVideoSource;
  resolveYouTubeVideoSource?: typeof resolveYouTubeVideoSource;
  resolveDouyinVideoSource?: typeof resolveDouyinVideoSource;
};

export function createResolveVideoSourceTool(
  env: AppEnv,
  deps: ResolveVideoSourceDeps = {},
) {
  return tool(
    async (input: ResolveVideoSourceInput) => resolveVideoSource(env, input.source, deps),
    {
      name: "resolve_video_source",
      description: "解析视频最终来源链接与本地媒体路径，供后续重复检查与转写使用",
      schema: inputSchema,
    },
  );
}
