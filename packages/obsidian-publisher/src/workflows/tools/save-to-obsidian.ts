import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger } from "@cat-crawl/core";
import { execFile } from "node:child_process";
import { appendFile, access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { loadEnv, type AppEnv, type ObsidianFolderOption } from "../../config/env.js";
import {
  generateTitleAndDescription,
  type TitleDescriptionResult,
} from "../llm/generate-title-description.js";
import { createModel } from "../llm/models/index.js";

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
  description_source: z.string().min(1).optional().describe("用于生成摘要的源文本"),
  source: z.string().min(1).optional().describe("来源名称（兼容字段，不用于 properties.source）"),
  tags: z.array(z.string().min(1)).optional().describe("标签数组"),
  vault: z.string().min(1).optional().describe("Obsidian vault 名称"),
  folder: z.string().min(1).optional().describe("保存目录；不传时使用配置中的基础目录"),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("笔记相对路径；不传时自动生成为 {folder}/YYYY-MM-DD {title}.md"),
  mode: z.enum(["create", "append"]).default("create"),
});

type SaveInput = z.infer<typeof inputSchema>;
type TitleDescriptionGenerator = (
  title: string,
  contentMarkdown: string,
  published: string,
) => Promise<TitleDescriptionResult>;
type ResolvedObsidianRouting = {
  env: AppEnv;
  baseFolder: string;
  candidates: ObsidianFolderOption[];
};
type FolderClassificationInput = {
  env: AppEnv;
  title: string;
  sourceUrl: string;
  description?: string;
  contentMarkdown: string;
  baseFolder: string;
  candidates: ObsidianFolderOption[];
};
type FolderClassificationDebugEntry = {
  title: string;
  sourceUrl: string;
  description?: string;
  baseFolder: string;
  candidates: ObsidianFolderOption[];
  contentPreview: string;
  rawResponse?: string;
  selectedFolder?: string | null;
  error?: string;
};
type SaveToObsidianDeps = {
  generateTitleAndDescription?: TitleDescriptionGenerator;
  loadCurrentEnv?: () => AppEnv;
  classifyConfiguredFolder?: (input: FolderClassificationInput) => Promise<string | null>;
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

function buildDefaultPath(title: string, folder: string): string {
  const date = formatLocalDate(new Date());
  const safeTitle = sanitizeFileName(title) || "untitled";
  const folderSegments = normalizePathSegments(folder.split("/"));
  const basePath = folderSegments.length > 0 ? folderSegments.join("/") : "clippings";
  return `${basePath}/${date} ${safeTitle}.md`;
}

function resolveTargetFolder(folder: string | undefined, baseFolder: string): string {
  const override = folder?.trim();
  if (override) {
    return override;
  }
  return baseFolder.trim() || "Clippings";
}

function buildFolderClassificationPreview(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 1500);
}

function isDevelopmentMode(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === "development";
}

function buildFolderClassificationDebugLogPath(
  now: Date,
  rootDir = process.cwd(),
): string {
  const dateDir = formatLocalDate(now);
  const timestamp = now.toISOString().replace(/[:]/g, "-");
  return join(rootDir, "log", dateDir, `folder-classification-${timestamp}.log`);
}

function buildFolderClassificationDebugLog(entry: FolderClassificationDebugEntry): string {
  return [
    `title: ${entry.title}`,
    `source_url: ${entry.sourceUrl}`,
    `base_folder: ${entry.baseFolder}`,
    `selected_folder: ${entry.selectedFolder ?? ""}`,
    `error: ${entry.error ?? ""}`,
    "",
    "[description]",
    entry.description || "",
    "",
    "[candidates]",
    ...entry.candidates.map((item) => `${item.folder} :: ${item.description || "(无描述)"}`),
    "",
    "[content_preview_sent_to_llm]",
    entry.contentPreview,
    "",
    "[raw_response]",
    entry.rawResponse || "",
    "",
  ].join("\n");
}

async function writeFolderClassificationDebugLog(
  entry: FolderClassificationDebugEntry,
  now = new Date(),
): Promise<void> {
  if (!isDevelopmentMode()) {
    return;
  }

  const logPath = buildFolderClassificationDebugLogPath(now);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, buildFolderClassificationDebugLog(entry), "utf8");
}

function parseFolderClassifierOutput(
  text: string,
  allowedFolders: Set<string>,
): string | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as { folder?: unknown };
    if (typeof parsed.folder === "string") {
      const folder = parsed.folder.trim();
      return folder && allowedFolders.has(folder) ? folder : null;
    }
  } catch {
    // Fall through to plain-text matching.
  }

  return allowedFolders.has(normalized) ? normalized : null;
}

function resolveObsidianRouting(currentEnv: AppEnv | undefined, fallbackEnv: AppEnv): ResolvedObsidianRouting {
  const effectiveEnv = currentEnv || fallbackEnv;
  return {
    env: effectiveEnv,
    baseFolder: effectiveEnv.obsidianFolder?.trim() || fallbackEnv.obsidianFolder.trim() || "Clippings",
    candidates: effectiveEnv.obsidianFolders ?? fallbackEnv.obsidianFolders ?? [],
  };
}

async function classifyConfiguredFolder(input: FolderClassificationInput): Promise<string | null> {
  if (input.candidates.length === 0) {
    return null;
  }

  const classifyModel = createModel(input.env, {
    task: "classify",
    maxTokens: 200,
    timeout: 20000,
    temperature: 0,
  });
  const allowedFolders = new Set(input.candidates.map((item) => item.folder));
  const candidateText = input.candidates
    .map((item, index) => `${index + 1}. ${item.folder} :: ${item.description || "(无描述)"}`)
    .join("\n");
  const contentPreview = buildFolderClassificationPreview(input.contentMarkdown);

  try {
    const message = await classifyModel.invoke([
      new SystemMessage(
        [
          "你是 Obsidian 目录分类器，只返回 JSON。",
          "你的任务是从候选目录中选出最合适的一个保存目录。",
          "只能返回候选列表中的 folder，禁止自造路径。",
          '如果没把握，请返回 {"folder":""}。',
          '输出格式：{"folder":"候选目录或空字符串"}',
        ].join("\n"),
      ),
      new HumanMessage(
        [
          `Base Folder: ${input.baseFolder}`,
          "",
          "Candidates:",
          candidateText,
          "",
          `Title: ${input.title}`,
          `Source: ${input.sourceUrl}`,
          input.description ? `Description: ${input.description}` : "",
          "",
          "Content Preview:",
          contentPreview,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ]);

    const content = Array.isArray(message.content)
      ? message.content
          .map((part) =>
            typeof part === "string"
              ? part
              : part && typeof part === "object" && "text" in part
                ? String((part as { text: unknown }).text)
                : "",
          )
          .join("")
      : String(message.content ?? "");
    const selectedFolder = parseFolderClassifierOutput(content, allowedFolders);
    await writeFolderClassificationDebugLog({
      title: input.title,
      sourceUrl: input.sourceUrl,
      description: input.description,
      baseFolder: input.baseFolder,
      candidates: input.candidates,
      contentPreview,
      rawResponse: content,
      selectedFolder,
    });
    return selectedFolder;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await writeFolderClassificationDebugLog({
      title: input.title,
      sourceUrl: input.sourceUrl,
      description: input.description,
      baseFolder: input.baseFolder,
      candidates: input.candidates,
      contentPreview,
      error: detail,
    });
    logger.warn(`[tool:save_to_obsidian] folder classify failed, fallback to base folder: ${detail}`);
    return null;
  }
}

async function determineTargetFolder(
  input: {
    folder?: string;
    title: string;
    source_url: string;
    description?: string;
    content_markdown: string;
  },
  routing: ResolvedObsidianRouting,
  classifyFolder: (input: FolderClassificationInput) => Promise<string | null>,
): Promise<string> {
  const override = input.folder?.trim();
  if (override) {
    return override;
  }
  if (routing.candidates.length === 0) {
    return routing.baseFolder;
  }

  const classifiedFolder = await classifyFolder({
    env: routing.env,
    title: input.title,
    sourceUrl: input.source_url,
    description: input.description,
    contentMarkdown: input.content_markdown,
    baseFolder: routing.baseFolder,
    candidates: routing.candidates,
  });

  return resolveTargetFolder(classifiedFolder || undefined, routing.baseFolder);
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
  overrides: { title?: string; description?: string; published?: string } = {},
): string {
  const effectiveTitle = overrides.title || input.title;
  const effectiveDescription = overrides.description || input.description || "";
  const safeTitle = normalizeSingleLineText(effectiveTitle);
  const safeAuthor = normalizeSingleLineText(input.author?.trim() || "Unknown");
  const created = formatLocalDate(new Date());
  const effectivePublished = overrides.published || input.published?.trim() || created;
  const published = normalizeDateString(
    normalizeSingleLineText(effectivePublished),
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
  const loadCurrentEnv = deps.loadCurrentEnv || loadEnv;
  const classifyFolder = deps.classifyConfiguredFolder || classifyConfiguredFolder;
  const resolveTitleAndDescription =
    deps.generateTitleAndDescription ||
    (async (title: string, contentMarkdown: string, published: string) => {
      const startedAt = Date.now();
      const timeoutMs = 60_000;
      const provider = env.aiSummarizeProvider || env.aiProvider || env.agent;
      const model = provider === "openai" ? env.openaiModel : env.geminiModel;
      logger.info(
        `[tool:save_to_obsidian] title_desc_model=${provider} model=${model} timeout_ms=${timeoutMs}`,
      );
      try {
        const result = await generateTitleAndDescription(title, contentMarkdown, published, {
          env,
          provider,
          model,
          timeoutMs,
        });
        logger.info(
          `[tool:save_to_obsidian] title_desc_done original_title="${title}" resolved_title="${result.title}" desc_chars=${result.description.length} published="${result.published}" elapsed_ms=${Date.now() - startedAt}`,
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
      const currentEnv = loadCurrentEnv();
      const routing = resolveObsidianRouting(currentEnv, env);
      const configuredVault = input.vault?.trim() || currentEnv.obsidianVault?.trim() || env.obsidianVault?.trim() || "";
      const tags = inferTags(input);

      // Use LLM to resolve title, description, and published
      let resolvedTitle = input.title;
      let resolvedDescription = input.description || "";
      let resolvedPublished = input.published || "";
      try {
        const result = await resolveTitleAndDescription(
          input.title,
          input.content_markdown,
          input.published || "",
        );
        resolvedTitle = result.title;
        resolvedDescription = result.description;
        if (result.published) {
          resolvedPublished = result.published;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[tool:save_to_obsidian] title_desc generation failed, using original: ${msg}`);
      }

      const targetFolder = await determineTargetFolder(
        {
          folder: input.folder,
          title: resolvedTitle,
          source_url: input.source_url,
          description: resolvedDescription || undefined,
          content_markdown: input.content_markdown,
        },
        routing,
        classifyFolder,
      );
      const initialPath = input.path || buildDefaultPath(resolvedTitle, targetFolder);
      const content = buildNoteContent(input, tags, {
        title: resolvedTitle,
        description: resolvedDescription,
        published: resolvedPublished,
      });
      logger.info(
        `[tool:save_to_obsidian] start mode=${input.mode} vault=${configuredVault || "<active>"} path=${initialPath}`,
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
  buildFolderClassificationDebugLog,
  buildFolderClassificationDebugLogPath,
  buildFolderClassificationPreview,
  buildNoteContent,
  buildDefaultPath,
  determineTargetFolder,
  inferTags,
  isDevelopmentMode,
  normalizeObsidianTag,
  normalizeObsidianTags,
  formatObsidianCommandForLog,
  hasObsidianOutputError,
  normalizeDateString,
  parseVaultsVerbose,
  findVaultPathFromDesktopConfig,
  parseFolderClassifierOutput,
  resolveObsidianRouting,
  resolveTargetFolder,
  resolveAvailableNotePath,
  resolveVaultNotePath,
  sanitizeVaultName,
};
