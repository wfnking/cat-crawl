import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import { execFile } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { sanitizeFileName } from "../utils/text.js";

const execFileAsync = promisify(execFile);
const logger = createLogger();
const OBSIDIAN_CLI_TIMEOUT_MS = 30_000;

const inputSchema = z.object({
  title: z.string().min(1).describe("文章标题"),
  source_url: z.string().url().describe("文章来源链接（url）"),
  content_markdown: z.string().min(1).describe("正文 markdown"),
  author: z.string().min(1).optional().describe("作者"),
  published: z.string().min(1).optional().describe("文章发布日期，优先 YYYY-MM-DD"),
  description: z.string().min(1).optional().describe("摘要描述，未传时自动从正文提取"),
  source: z.string().min(1).optional().describe("来源名称（兼容字段，不用于 properties.source）"),
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
  if (host.includes("x.com") || host.includes("twitter.com")) {
    return ["x", "clippings"];
  }
  return ["clippings"];
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

function extractDescription(markdown: string): string {
  const text = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith("#") &&
        !line.startsWith("- Source:") &&
        !line.startsWith("- Author:") &&
        !line.startsWith("- Published:"),
    )
    .map((line) =>
      line
        .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[`*_>#-]/g, " "),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  return text.slice(0, 200);
}

function normalizeDateString(value: string): string {
  const text = value.trim();
  if (!text) {
    return text;
  }
  const matched = text.match(/(\d{4})[./\-年](\d{1,2})[./\-月](\d{1,2})/);
  if (!matched) {
    return text;
  }
  return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
}

function buildNoteContent(input: SaveInput, tags: string[]): string {
  const safeAuthor = input.author?.trim() || "Unknown";
  const created = formatLocalDate(new Date());
  const published = normalizeDateString(input.published?.trim() || created);
  const description = input.description?.trim() || extractDescription(input.content_markdown);
  const tagInline = tags.map((t) => quoteYamlValue(t)).join(", ");

  const frontmatter = [
    "---",
    `title: ${quoteYamlValue(input.title.trim())}`,
    `source: ${quoteYamlValue(input.source_url)}`,
    `author: ${quoteYamlValue(safeAuthor)}`,
    `published: ${quoteYamlValue(published)}`,
    `created: ${quoteYamlValue(created)}`,
    `description: ${quoteYamlValue(description)}`,
    `tags: [${tagInline}]`,
    "---",
    "",
  ];

  return `${frontmatter.join("\n")}${input.content_markdown.trim()}`.trim();
}

function parseObsidianPlainOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!combined) {
    return "";
  }
  const lines = combined
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }
  return lines[lines.length - 1] || "";
}

function formatObsidianCommandForLog(args: string[]): string {
  const rendered = args.map((arg) => {
    if (!arg.startsWith("content=")) {
      return arg;
    }
    const content = arg.slice("content=".length);
    return `content=<${content.length} chars>`;
  });
  return `obsidian ${rendered.join(" ")}`.trim();
}

function sanitizeVaultName(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (lower.startsWith("error:")) {
    return undefined;
  }
  if (lower.includes("vault not found")) {
    return undefined;
  }
  if (lower.includes("no vault")) {
    return undefined;
  }
  if (lower === "not found") {
    return undefined;
  }
  return value;
}

function parseVaultsVerbose(output: string): Array<{ name: string; path: string }> {
  return output
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      name: parts[0]?.trim() || "",
      path: parts.slice(1).join("\t").trim(),
    }))
    .filter((entry) => entry.name && entry.path);
}

function hasObsidianOutputError(output: string): boolean {
  const lower = output.toLowerCase();
  if (!lower) {
    return false;
  }
  return lower.includes("vault not found") || lower.includes("no vault") || lower.includes("error:");
}

async function resolveActiveVaultName(): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync("obsidian", ["vault", "info=name"], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = sanitizeVaultName(parseObsidianPlainOutput(stdout, stderr));
    if (output) {
      return output;
    }
  } catch {
    // fallback below
  }

  try {
    const { stdout, stderr } = await execFileAsync("obsidian", ["vault", "info=path"], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = parseObsidianPlainOutput(stdout, stderr).trim();
    if (!output || output.toLowerCase().startsWith("error:")) {
      return undefined;
    }
    if (output.includes("vault not found")) {
      return undefined;
    }
    const name = basename(output);
    const normalized = sanitizeVaultName(name);
    if (!normalized) {
      return undefined;
    }
    return normalized;
  } catch {
    return undefined;
  }
}

async function resolveVaultPath(vaultName?: string): Promise<string | undefined> {
  if (vaultName) {
    try {
      const { stdout, stderr } = await execFileAsync("obsidian", ["vaults", "verbose"], {
        maxBuffer: 2 * 1024 * 1024,
      });
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      const entries = parseVaultsVerbose(combined);
      const matched = entries.find((entry) => entry.name === vaultName);
      if (matched) {
        return matched.path;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  try {
    const { stdout, stderr } = await execFileAsync("obsidian", ["vault", "info=path"], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = parseObsidianPlainOutput(stdout, stderr).trim();
    if (!output || hasObsidianOutputError(output)) {
      return undefined;
    }
    return output;
  } catch {
    return undefined;
  }
}

function resolveVaultNotePath(vaultPath: string, notePath: string): string {
  if (!notePath.trim()) {
    throw new Error("Obsidian note path cannot be empty.");
  }
  if (isAbsolute(notePath)) {
    throw new Error(`Obsidian note path must be relative: ${notePath}`);
  }
  const normalizedRelative = normalize(notePath);
  const parts = normalizedRelative.split(/[\\/]+/g).filter(Boolean);
  if (parts.includes("..")) {
    throw new Error(`Obsidian note path cannot escape the vault: ${notePath}`);
  }
  return join(vaultPath, normalizedRelative);
}

export function createSaveToObsidianTool(env: AppEnv) {
  return tool(
    async (input) => {
      const configuredVault = input.vault?.trim() || env.obsidianVault?.trim() || "";
      const tags = inferTags(input);
      const dynamicFolder = resolveDynamicFolder(input, env.obsidianDynamicFolders);
      const path = input.path || buildDefaultPath(input.title, env.obsidianFolder, dynamicFolder);
      const content = buildNoteContent(input, tags);
      logger.info(
        `[tool:save_to_obsidian] start mode=${input.mode} vault=${configuredVault || "<active>"} path=${path} dynamic_folder=${dynamicFolder}`,
      );
      logger.info(`[tool:save_to_obsidian] content_length=${content.length}`);
      const startedAt = Date.now();

      let vaultPath = "";
      try {
        logger.info(
          `[tool:save_to_obsidian] command=obsidian ${configuredVault ? "vaults verbose" : "vault info=path"}`,
        );
        vaultPath = (await resolveVaultPath(configuredVault)) || "";
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`[tool:save_to_obsidian] failed resolving_vault_path msg=${msg}`);
      }

      if (!vaultPath) {
        throw new Error(
          configuredVault
            ? `Obsidian vault not found: ${configuredVault}`
            : "Obsidian active vault not found. Open a vault in Obsidian or set OBSIDIAN_VAULT.",
        );
      }

      const absolutePath = resolveVaultNotePath(vaultPath, path);
      logger.info(`[tool:save_to_obsidian] write_path=${absolutePath}`);
      try {
        await mkdir(dirname(absolutePath), { recursive: true });
        if (input.mode === "append") {
          await appendFile(absolutePath, content, "utf8");
        } else {
          await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`[tool:save_to_obsidian] failed msg=${msg}`);
        if (msg.includes("EEXIST")) {
          throw new Error(`Obsidian note already exists: ${path}`);
        }
        throw new Error(`Failed to write Obsidian note: ${msg}`);
      }
      const effectiveVault = configuredVault || (await resolveActiveVaultName()) || "";
      logger.info(
        `[tool:save_to_obsidian] success vault=${effectiveVault || "<active>"} path=${path} elapsed_ms=${Date.now() - startedAt}`,
      );

      return {
        saved: true,
        vault: effectiveVault || undefined,
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

export const __test__ = {
  buildNoteContent,
  formatObsidianCommandForLog,
  hasObsidianOutputError,
  extractDescription,
  normalizeDateString,
  parseVaultsVerbose,
  resolveVaultNotePath,
  sanitizeVaultName,
};
