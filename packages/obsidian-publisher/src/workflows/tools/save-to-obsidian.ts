import { tool } from "@langchain/core/tools";
import { createLogger } from "@cat-crawl/core";
import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import { loadEnv, type AppEnv, type ObsidianFolderOption } from "../../config/env.js";
import {
  findVaultPathFromDesktopConfig,
  normalizeConfiguredVaultPath,
  resolveActiveVaultName,
  resolveVaultPath,
} from "../../obsidian/vault-path.js";
import {
  generateTitleAndDescription,
  type TitleDescriptionResult,
} from "../llm/generate-title-description.js";
import { generateFolderClassification } from "../llm/generate-folder-classification.js";

const logger = createLogger();
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
  vault: z.string().min(1).optional().describe("Obsidian vault 绝对路径或名称"),
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

function resolveObsidianRouting(
  currentEnv: AppEnv | undefined,
  fallbackEnv: AppEnv,
): ResolvedObsidianRouting {
  const effectiveEnv = currentEnv || fallbackEnv;
  return {
    env: effectiveEnv,
    baseFolder:
      effectiveEnv.obsidianFolder?.trim() || fallbackEnv.obsidianFolder.trim() || "Clippings",
    candidates: effectiveEnv.obsidianFolders ?? fallbackEnv.obsidianFolders ?? [],
  };
}

function resolveConfiguredCandidateFolder(
  folder: string | undefined,
  candidates: ObsidianFolderOption[],
): string | null {
  const normalizedFolder = folder?.trim();
  if (!normalizedFolder) {
    return null;
  }

  const match = candidates.find((candidate) => candidate.folder.trim() === normalizedFolder);
  return match?.folder ?? null;
}

async function classifyConfiguredFolder(input: FolderClassificationInput): Promise<string | null> {
  if (input.candidates.length === 0) {
    return null;
  }

  const contentPreview = buildFolderClassificationPreview(input.contentMarkdown);

  try {
    const result = await generateFolderClassification({
      env: input.env,
      baseFolder: input.baseFolder,
      title: input.title,
      sourceUrl: input.sourceUrl,
      description: input.description,
      contentPreview,
      candidates: input.candidates,
    });
    const selectedFolder = resolveConfiguredCandidateFolder(result.folder, input.candidates);
    if (!selectedFolder && result.folder?.trim()) {
      logger.warn(
        `[tool:save_to_obsidian] folder classify returned non-candidate folder="${result.folder.trim()}", fallback to base folder`,
      );
    }
    return selectedFolder;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[tool:save_to_obsidian] folder classify failed, fallback to base folder: ${detail}`,
    );
    return null;
  }
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
  const published = normalizeDateString(normalizeSingleLineText(effectivePublished));
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
  const resolveTitleAndDescription = async (
    title: string,
    contentMarkdown: string,
    published: string,
  ) => {
    const startedAt = Date.now();
    const timeoutMs = 60_000;
    const provider = env.aiSummarizeProvider || env.aiProvider || env.agent;
    const model =
      provider === "gemini" || provider === "vertex" ? env.geminiModel : env.openaiModel;
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
  };

  return tool(
    async (input) => {
      const currentEnv = loadEnv();
      const routing = resolveObsidianRouting(currentEnv, env);
      const configuredVault =
        input.vault?.trim() || currentEnv.obsidianVault?.trim() || env.obsidianVault?.trim() || "";
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

      let targetFolder = resolveTargetFolder(input.folder, routing.baseFolder);
      if (!input.folder?.trim() && routing.candidates.length > 0) {
        const classifiedFolder = await classifyConfiguredFolder({
          env: routing.env,
          title: resolvedTitle,
          sourceUrl: input.source_url,
          description: resolvedDescription || undefined,
          contentMarkdown: input.content_markdown,
          baseFolder: routing.baseFolder,
          candidates: routing.candidates,
        });
        targetFolder = resolveTargetFolder(classifiedFolder || undefined, routing.baseFolder);
      }
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
          `[tool:save_to_obsidian] resolve_vault_path configured=${normalizeConfiguredVaultPath(configuredVault) || "<active>"}`,
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
  buildNoteContent,
  normalizeDateString,
  formatObsidianCommandForLog,
  findVaultPathFromDesktopConfig,
  normalizeConfiguredVaultPath,
  resolveVaultNotePath,
  resolveAvailableNotePath,
  resolveTargetFolder,
  resolveObsidianRouting,
  resolveConfiguredCandidateFolder,
  normalizeObsidianTag,
  inferTags,
};
