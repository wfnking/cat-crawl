import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import { execFile } from "node:child_process";
import { appendFile, access, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { generateDescriptionWithModel } from "../services/description/model.js";
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
type DescriptionGenerator = (markdown: string) => Promise<string>;
type SaveToObsidianDeps = {
  generateDescription?: DescriptionGenerator;
};

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

function cleanMarkdownParagraph(paragraph: string): string {
  return paragraph
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>]/g, " ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMetadataParagraph(paragraph: string): boolean {
  return /^(source|author|published|created|title|tags)\s*:/i.test(paragraph);
}

function isTimestampParagraph(paragraph: string): boolean {
  return /^\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?$/.test(paragraph);
}

function isNoiseParagraph(paragraph: string): boolean {
  if (!paragraph) {
    return true;
  }
  if (paragraph.startsWith("#")) {
    return true;
  }
  if (isMetadataParagraph(paragraph)) {
    return true;
  }
  if (isTimestampParagraph(paragraph)) {
    return true;
  }
  if (/^https?:\/\//i.test(paragraph)) {
    return true;
  }
  if (/^(sure!?|here(?:'|’)s)\b/i.test(paragraph)) {
    return true;
  }
  if (/^the following table provides/i.test(paragraph)) {
    return true;
  }
  if (/^(本文来自|文章来源|原文链接|题图来自|本文转载|微信公众号[:：]?)/u.test(paragraph)) {
    return true;
  }
  return false;
}

function extractLeadSentence(paragraph: string): string {
  const normalized = cleanMarkdownParagraph(paragraph);
  if (!normalized) {
    return "";
  }
  const matched = normalized.match(/^(.+?[。！？.!?])/u);
  const sentence = matched?.[1]?.trim() || normalized;
  return sentence.slice(0, 200).trim();
}

function extractDescriptionCandidate(markdown: string): string {
  const paragraphs = markdown
    .split(/\n\s*\n/g)
    .map((paragraph) => cleanMarkdownParagraph(paragraph))
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (isNoiseParagraph(paragraph)) {
      continue;
    }
    const leadSentence = extractLeadSentence(paragraph);
    if (leadSentence) {
      return leadSentence;
    }
  }

  return "";
}

function shouldFallbackToGeneratedDescription(candidate: string): boolean {
  const text = candidate.trim();
  if (!text) {
    return true;
  }
  if (text.length < 24) {
    return true;
  }
  if (/https?:\/\//i.test(text)) {
    return true;
  }
  if (/\b(source|author|published|created|title|tags)\s*:/i.test(text)) {
    return true;
  }
  if (/\b\d{1,2}:\d{2}\b/.test(text)) {
    return true;
  }
  if (/^(sure!?|here(?:'|’)s)\b/i.test(text)) {
    return true;
  }
  return false;
}

async function resolveDescription(
  input: Pick<SaveInput, "content_markdown" | "description">,
  generateDescription?: DescriptionGenerator,
): Promise<string> {
  const explicit = input.description?.trim();
  if (explicit) {
    return explicit.slice(0, 200);
  }

  const candidate = extractDescriptionCandidate(input.content_markdown);
  if (!generateDescription) {
    return candidate.slice(0, 200);
  }

  let generated = "";
  try {
    generated = (await generateDescription(input.content_markdown)).trim();
  } catch {
    return candidate.slice(0, 200);
  }
  if (!generated) {
    return candidate.slice(0, 200);
  }
  const cleaned = cleanMarkdownParagraph(generated).slice(0, 200);
  if (cleaned) {
    return cleaned;
  }
  return candidate.slice(0, 200);
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

function buildNoteContent(input: SaveInput, tags: string[], description?: string): string {
  const safeAuthor = input.author?.trim() || "Unknown";
  const created = formatLocalDate(new Date());
  const published = normalizeDateString(input.published?.trim() || created);
  const resolvedDescription = description?.trim() || input.description?.trim() || "";
  const tagInline = tags.map((t) => quoteYamlValue(t)).join(", ");

  const frontmatter = [
    "---",
    `title: ${quoteYamlValue(input.title.trim())}`,
    `source: ${quoteYamlValue(input.source_url)}`,
    `author: ${quoteYamlValue(safeAuthor)}`,
    `published: ${quoteYamlValue(published)}`,
    `created: ${quoteYamlValue(created)}`,
    `description: ${quoteYamlValue(resolvedDescription)}`,
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
    return undefined;
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
      return undefined;
    }
    return undefined;
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

export function createSaveToObsidianTool(env: AppEnv, deps: SaveToObsidianDeps = {}) {
  const generateDescription =
    deps.generateDescription ||
    (async (markdown: string) => {
      const startedAt = Date.now();
      const timeoutMs = 20_000;
      const provider = env.aiSummarizeProvider || env.aiProvider || env.agent;
      const model = provider === "deepseek" ? env.deepseekModel : env.geminiModel;
      logger.info(
        `[tool:save_to_obsidian] description_model=${provider} model=${model} timeout_ms=${timeoutMs}`,
      );
      try {
        const description = await generateDescriptionWithModel(markdown, {
          env,
          provider,
          model,
          timeoutMs,
        });
        logger.info(
          `[tool:save_to_obsidian] description_done chars=${description.length} elapsed_ms=${Date.now() - startedAt}`,
        );
        return description;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[tool:save_to_obsidian] description_failed msg=${msg}`);
        throw error;
      }
    });

  return tool(
    async (input) => {
      const configuredVault = input.vault?.trim() || env.obsidianVault?.trim() || "";
      const tags = inferTags(input);
      const dynamicFolder = resolveDynamicFolder(input, env.obsidianDynamicFolders);
      const initialPath =
        input.path || buildDefaultPath(input.title, env.obsidianFolder, dynamicFolder);
      const description = await resolveDescription(input, generateDescription);
      const content = buildNoteContent(input, tags, description);
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
  formatObsidianCommandForLog,
  hasObsidianOutputError,
  extractDescriptionCandidate,
  shouldFallbackToGeneratedDescription,
  resolveDescription,
  normalizeDateString,
  parseVaultsVerbose,
  resolveAvailableNotePath,
  resolveVaultNotePath,
  sanitizeVaultName,
};
