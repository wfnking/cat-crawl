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
  vault: z.string().min(1).optional().describe("Obsidian vault 名称"),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("笔记相对路径；不传时自动生成为 clippings/{tags}/YYYY-MM-DD {title}.md"),
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

function buildDefaultPath(title: string, tags: string[]): string {
  const date = formatLocalDate(new Date());
  const safeTitle = sanitizeFileName(title) || "untitled";
  const folder = sanitizeFileName(tags.join("-")) || "clippings";
  return `clippings/${folder}/${date} ${safeTitle}.md`;
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
      const vault = input.vault || env.obsidianVault;
      const tags = inferTags(input);
      const path = input.path || buildDefaultPath(input.title, tags);
      const content = buildNoteContent(input, tags);

      const args =
        input.mode === "append"
          ? [`vault=${vault}`, "append", `path=${path}`, `content=${content}`]
          : [`vault=${vault}`, "create", `path=${path}`, `content=${content}`];

      try {
        await execFileAsync("obsidian", args, { maxBuffer: 10 * 1024 * 1024 });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("ENOENT")) {
          throw new Error("Obsidian CLI not found. Please ensure `obsidian` is available in PATH.");
        }
        throw new Error(`Obsidian CLI failed: ${msg}`);
      }

      return {
        saved: true,
        vault,
        path,
        tags,
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
