import { tool } from "@langchain/core/tools";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { sanitizeFileName } from "../utils/text.js";

const execFileAsync = promisify(execFile);

const inputSchema = z.object({
  title: z.string().min(1).describe("文章标题"),
  source_url: z.string().url().describe("文章来源链接（url）"),
  content_markdown: z.string().min(1).describe("正文 markdown"),
  author: z.string().min(1).optional().describe("作者"),
  source: z.string().min(1).optional().describe("来源名称，如 WeChat"),
  tags: z.array(z.string().min(1)).optional().describe("标签数组"),
  dynamic_folder: z
    .string()
    .optional()
    .describe("动态目录（从全局配置中选择一个）；不传或空字符串时仅使用基础目录"),
  vault: z.string().min(1).optional().describe("Obsidian vault 名称"),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("笔记相对路径；不传时自动生成为 {folder}/{dynamicFolder}/YYYY-MM-DD {title}.md"),
  mode: z.enum(["create", "append"]).default("create"),
});

type SaveInput = z.infer<typeof inputSchema>;

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferTags(input: SaveInput): string[] {
  const rawTags = input.tags?.map((t) => t.trim()).filter(Boolean) ?? [];
  if (rawTags.length > 0) {
    return rawTags;
  }
  const host = new URL(input.source_url).hostname.toLowerCase();
  if (host.includes("weixin.qq.com")) {
    return ["wechat", "clippings"];
  }
  return ["clippings"];
}

function inferSource(input: SaveInput): string {
  if (input.source?.trim()) {
    return input.source.trim();
  }
  const host = new URL(input.source_url).hostname.toLowerCase();
  if (host.includes("weixin.qq.com")) {
    return "WeChat";
  }
  return host;
}

function normalizePathSegments(segments: string[]): string[] {
  return segments.map((item) => sanitizeFileName(item)).filter(Boolean);
}

function resolveDynamicFolder(input: SaveInput, allowedFolders: string[]): string {
  const selected = input.dynamic_folder?.trim() ?? "";
  if (!selected) {
    return "";
  }
  if (allowedFolders.length > 0 && !allowedFolders.includes(selected)) {
    throw new Error(
      `Invalid dynamic_folder: "${selected}". Allowed values: ${allowedFolders.join(", ")}. Or pass empty string.`,
    );
  }
  return selected;
}

function buildDefaultPath(title: string, folder: string, dynamicFolder: string): string {
  const date = formatLocalDate(new Date());
  const safeTitle = sanitizeFileName(title) || "untitled";
  const folderSegments = normalizePathSegments(folder.split("/"));
  const dynamicSegments = dynamicFolder ? normalizePathSegments(dynamicFolder.split("/")) : [];
  const allSegments = [...folderSegments, ...dynamicSegments];
  const basePath = allSegments.length > 0 ? allSegments.join("/") : "clippings";
  return `${basePath}/${date} ${safeTitle}.md`;
}

function quoteYamlValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildNoteContent(input: SaveInput, tags: string[]): string {
  const source = inferSource(input);
  const safeAuthor = input.author?.trim() || "Unknown";
  const created = new Date().toISOString();
  const tagInline = tags.map((t) => quoteYamlValue(t)).join(", ");

  const frontmatter = [
    "---",
    `title: ${quoteYamlValue(input.title.trim())}`,
    `tags: [${tagInline}]`,
    `source: ${quoteYamlValue(source)}`,
    `url: ${quoteYamlValue(input.source_url)}`,
    `author: ${quoteYamlValue(safeAuthor)}`,
    `created: ${quoteYamlValue(created)}`,
    "---",
    "",
  ];

  return `${frontmatter.join("\n")}${input.content_markdown.trim()}`.trim();
}

export function createSaveToObsidianTool(env: AppEnv) {
  return tool(
    async (input) => {
      const vault = input.vault?.trim() || env.obsidianVault;
      if (!vault) {
        throw new Error(
          "Missing Obsidian vault. Set OBSIDIAN_VAULT in env or pass `vault` in tool input.",
        );
      }
      const tags = inferTags(input);
      const dynamicFolder = resolveDynamicFolder(input, env.obsidianDynamicFolders);
      const path = input.path || buildDefaultPath(input.title, env.obsidianFolder, dynamicFolder);
      const content = buildNoteContent(input, tags);

      const args =
        input.mode === "append"
          ? [`vault=${vault}`, "append", `path=${path}`, `content=${content}`]
          : [`vault=${vault}`, "create", `path=${path}`, `content=${content}`];
      console.info(
        `[tool:save_to_obsidian] start mode=${input.mode} vault=${vault} path=${path} dynamic_folder=${dynamicFolder}`,
      );

      try {
        await execFileAsync("obsidian", args, { maxBuffer: 10 * 1024 * 1024 });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const stderr =
          typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        console.error(`[tool:save_to_obsidian] failed msg=${msg}`);
        if (stderr.trim()) {
          console.error(`[tool:save_to_obsidian] stderr=${stderr.trim()}`);
        }
        if (msg.includes("ENOENT")) {
          throw new Error("Obsidian CLI not found. Please ensure `obsidian` is available in PATH.");
        }
        throw new Error(`Obsidian CLI failed: ${msg}`);
      }
      console.info(`[tool:save_to_obsidian] success path=${path}`);

      return {
        saved: true,
        vault,
        path,
        tags,
        dynamic_folder: dynamicFolder,
        mode: input.mode,
      };
    },
    {
      name: "save_to_obsidian",
      description: "把抓取结果保存到 Obsidian 笔记",
      schema: inputSchema,
    },
  );
}
