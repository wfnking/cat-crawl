import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import { execFile } from "node:child_process";
import { appendFile, access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import {
  generateTitleAndDescription,
  type TitleDescriptionResult,
} from "../llm/generate-title-description.js";

const execFileAsync = promisify(execFile);
const logger = createLogger();
const OBSIDIAN_CLI_TIMEOUT_MS = 30_000;
const PROJECT_TAG = "cat-crawl";

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
type TitleDescriptionGenerator = (
  title: string,
  contentMarkdown: string,
) => Promise<TitleDescriptionResult>;
type SaveToObsidianDeps = {
  generateTitleAndDescription?: TitleDescriptionGenerator;
};

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferTags(input: SaveInput): string[] {
  const rawTags = input.tags?.map((t) => t.trim()).filter(Boolean) ?? [];
  const normalizedTags = [...normalizeObsidianTags(rawTags)];
  const host = new URL(input.source_url).hostname.toLowerCase();
  if (host.includes("weixin.qq.com")) {
    normalizedTags.push("wechat");
  }
  if (host.includes("x.com") || host.includes("twitter.com")) {
    normalizedTags.push("x");
  }
  if (host.includes("reddit.com")) {
    normalizedTags.push("reddit");
  }
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    normalizedTags.push("youtube");
  }
  normalizedTags.push(PROJECT_TAG);
  return normalizeObsidianTags(normalizedTags);
}

function normalizeObsidianTag(rawTag: string): string {
  const trimmed = rawTag.trim().replace(/^#+/g, "");
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed
    .replace(/\s+/g, "-")
    .replace(/[，,]/g, "-")
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^0-9A-Za-z\u3400-\u9fff/_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-_/]+|[-_/]+$/g, "");
  return normalized;
}

function normalizeObsidianTags(rawTags: string[]): string[] {
  const unique = new Map<string, string>();
  for (const rawTag of rawTags) {
    const normalized = normalizeObsidianTag(rawTag);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, normalized);
    }
  }
  return Array.from(unique.values());
}

function sanitizeFileName(input: string): string {
  return input
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\s*-\s*|\s*-\s*$/g, "")
    .slice(0, 80);
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

function appendNumericSuffix(notePath: string, index: number): string {
  const extension = extname(notePath);
  const suffixless = extension ? notePath.slice(0, -extension.length) : notePath;
  return `${suffixless} (${index})${extension || ""}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function resolveAvailableNotePath(
  vaultPath: string,
  relativePath: string,
  exists: (path: string) => Promise<boolean> = pathExists,
): Promise<string> {
  const preferredAbsolutePath = resolveVaultNotePath(vaultPath, relativePath);
  if (!(await exists(preferredAbsolutePath))) {
    return relativePath;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidatePath = appendNumericSuffix(relativePath, index);
    const candidateAbsolutePath = resolveVaultNotePath(vaultPath, candidatePath);
    if (!(await exists(candidateAbsolutePath))) {
      return candidatePath;
    }
  }

  throw new Error(`Failed to allocate unique Obsidian note path for: ${relativePath}`);
}

function quoteYamlValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function normalizeSingleLineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function buildNoteContent(
  input: SaveInput,
  tags: string[],
  overrides: { title?: string; description?: string } = {},
): string {
  const effectiveTitle = overrides.title || input.title;
  const effectiveDescription = overrides.description || input.description || "";
  const safeTitle = normalizeSingleLineText(effectiveTitle);
  const safeAuthor = normalizeSingleLineText(input.author?.trim() || "Unknown");
  const created = formatLocalDate(new Date());
  const published = normalizeDateString(
    normalizeSingleLineText(input.published?.trim() || created),
  );
  const safeDescription = normalizeSingleLineText(effectiveDescription).slice(0, 200);
  const tagInline = tags.map((t) => quoteYamlValue(t)).join(", ");

  const frontmatter = [
    "---",
    `title: ${quoteYamlValue(safeTitle)}`,
    `source: ${quoteYamlValue(input.source_url)}`,
    `author: ${quoteYamlValue(safeAuthor)}`,
    `published: ${quoteYamlValue(published)}`,
    `created: ${quoteYamlValue(created)}`,
    `description: ${quoteYamlValue(safeDescription)}`,
    `tags: [${tagInline}]`,
    "---",
    "",
  ];

  return `${frontmatter.join("\n")}${input.content_markdown.trim()}`.trim();
}

function parseObsidianPlainOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
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

function parseObsidianKeyValueOutput(stdout: string, stderr: string): Record<string, string> {
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (!combined) {
    return {};
  }
  const result: Record<string, string> = {};
  const lines = combined.split(/\r?\n/g);
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const key = parts[0]?.trim();
      const value = parts.slice(1).join("\t").trim();
      if (key && value) {
        result[key] = value;
      }
    }
  }
  return result;
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

function findVaultPathFromDesktopConfig(
  configText: string,
  vaultName?: string,
): string | undefined {
  if (!configText.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    return undefined;
  }

  const vaults = (parsed as { vaults?: Record<string, { path?: string; open?: boolean }> }).vaults;
  const entries = Object.values(vaults || {})
    .map((entry) => ({
      path: entry?.path?.trim() || "",
      open: Boolean(entry?.open),
    }))
    .filter((entry) => entry.path);
  if (entries.length === 0) {
    return undefined;
  }

  if (vaultName?.trim()) {
    const matched = entries.find((entry) => basename(entry.path) === vaultName.trim());
    return matched?.path;
  }

  return entries.find((entry) => entry.open)?.path || entries[0]?.path;
}

async function resolveVaultPathFromDesktopConfig(vaultName?: string): Promise<string | undefined> {
  const configPath = join(
    process.env.HOME || "",
    "Library",
    "Application Support",
    "obsidian",
    "obsidian.json",
  );
  try {
    const configText = await readFile(configPath, "utf8");
    return findVaultPathFromDesktopConfig(configText, vaultName);
  } catch {
    return undefined;
  }
}

async function resolveVaultPathFromICloud(vaultName?: string): Promise<string | undefined> {
  const name = vaultName?.trim();
  if (!name) {
    return undefined;
  }
  const candidate = join(
    process.env.HOME || "",
    "Library",
    "Mobile Documents",
    "iCloud~md~obsidian",
    "Documents",
    name,
  );
  try {
    await access(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

function hasObsidianOutputError(output: string): boolean {
  const lower = output.toLowerCase();
  if (!lower) {
    return false;
  }
  return (
    lower.includes("vault not found") || lower.includes("no vault") || lower.includes("error:")
  );
}

async function resolveActiveVaultName(): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync("obsidian", ["vault"], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const kv = parseObsidianKeyValueOutput(stdout, stderr);
    if (kv.name) {
      return sanitizeVaultName(kv.name);
    }
  } catch {
    // fallback below
  }

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
    const fallbackPath = await resolveVaultPathFromDesktopConfig();
    return fallbackPath ? sanitizeVaultName(basename(fallbackPath)) : undefined;
  }
}

async function resolveVaultPath(vaultName?: string): Promise<string | undefined> {
  if (vaultName && isAbsolute(vaultName)) {
    return vaultName;
  }

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
      const fallbackPath = await resolveVaultPathFromDesktopConfig(vaultName);
      if (fallbackPath) {
        return fallbackPath;
      }
      return resolveVaultPathFromICloud(vaultName);
    }
    const fallbackPath = await resolveVaultPathFromDesktopConfig(vaultName);
    if (fallbackPath) {
      return fallbackPath;
    }
    return resolveVaultPathFromICloud(vaultName);
  }

  try {
    const { stdout, stderr } = await execFileAsync("obsidian", ["vault"], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const kv = parseObsidianKeyValueOutput(stdout, stderr);
    if (kv.path) {
      return kv.path;
    }
  } catch {
    // fallback below
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
    return resolveVaultPathFromDesktopConfig();
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

export function createSaveToObsidianTool(env: AppEnv, deps: SaveToObsidianDeps = {}) {
  const resolveTitleAndDescription =
    deps.generateTitleAndDescription ||
    (async (title: string, contentMarkdown: string) => {
      const startedAt = Date.now();
      const timeoutMs = 60_000;
      const provider = env.aiSummarizeProvider || env.aiProvider || env.agent;
      const model = provider === "openai" ? env.openaiModel : env.geminiModel;
      logger.info(
        `[tool:save_to_obsidian] title_desc_model=${provider} model=${model} timeout_ms=${timeoutMs}`,
      );
      try {
        const result = await generateTitleAndDescription(title, contentMarkdown, {
          env,
          provider,
          model,
          timeoutMs,
        });
        logger.info(
          `[tool:save_to_obsidian] title_desc_done original_title="${title}" resolved_title="${result.title}" desc_chars=${result.description.length} elapsed_ms=${Date.now() - startedAt}`,
        );
        return result;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[tool:save_to_obsidian] title_desc_failed msg=${msg}`);
        throw error;
      }
    });

  return tool(
    async (input) => {
      const configuredVault = input.vault?.trim() || env.obsidianVault?.trim() || "";
      const tags = inferTags(input);
      const dynamicFolder = resolveDynamicFolder(input, env.obsidianDynamicFolders);

      // Use LLM to resolve title and description
      let resolvedTitle = input.title;
      let resolvedDescription = input.description || "";
      try {
        const result = await resolveTitleAndDescription(input.title, input.content_markdown);
        resolvedTitle = result.title;
        resolvedDescription = result.description;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[tool:save_to_obsidian] title_desc generation failed, using original: ${msg}`);
      }

      const initialPath =
        input.path || buildDefaultPath(resolvedTitle, env.obsidianFolder, dynamicFolder);
      const content = buildNoteContent(input, tags, {
        title: resolvedTitle,
        description: resolvedDescription,
      });
      logger.info(
        `[tool:save_to_obsidian] start mode=${input.mode} vault=${configuredVault || "<active>"} path=${initialPath} dynamic_folder=${dynamicFolder}`,
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

      const path =
        input.mode === "create"
          ? await resolveAvailableNotePath(vaultPath, initialPath)
          : initialPath;
      if (path !== initialPath) {
        logger.warn(`[tool:save_to_obsidian] path exists, using next available path=${path}`);
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
  inferTags,
  normalizeObsidianTag,
  normalizeObsidianTags,
  formatObsidianCommandForLog,
  hasObsidianOutputError,
  normalizeDateString,
  parseVaultsVerbose,
  findVaultPathFromDesktopConfig,
  resolveAvailableNotePath,
  resolveVaultNotePath,
  sanitizeVaultName,
};
