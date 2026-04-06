import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@cat-crawl/core";
import type { AppEnv } from "../config/env.js";

const execFileAsync = promisify(execFile);
const logger = createLogger();

type CacheRecord = {
  at: number;
  key: string;
  folders: string[];
};

const CACHE_TTL_MS = 60_000;
let cache: CacheRecord | null = null;

function normalizeFolders(folders: string[]): string[] {
  return Array.from(new Set(folders.map((f) => f.trim()).filter(Boolean)));
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
    .filter((item) => item.name && item.path);
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
  return lines[lines.length - 1] || "";
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
      const entries = parseVaultsVerbose([stdout, stderr].filter(Boolean).join("\n"));
      return entries.find((item) => item.name === vaultName)?.path;
    } catch {
      return undefined;
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync("obsidian", ["vault", "info=path"], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const out = parseObsidianPlainOutput(stdout, stderr);
    if (!out || out.toLowerCase().startsWith("error:")) {
      return undefined;
    }
    return out;
  } catch {
    return undefined;
  }
}

export function describeDynamicFolder(name: string): string {
  const key = name.trim().toLowerCase();
  const hints: Record<string, string> = {
    ai: "人工智能、大模型、LLM、Agent、提示词、AI工程实践",
    dsa: "数据结构、算法、LeetCode、复杂度分析",
    english: "英语学习、口语、写作、词汇、语法",
    go: "Go语言/Golang、并发、工程实践、生态库",
    job: "求职、面试、简历、职业发展",
    opc: "一人公司、创业、独立开发、商业化与变现",
    procrastination: "拖延、自律、习惯、效率与专注",
    writing: "写作方法、文案、表达与叙事",
  };
  return hints[key] || `与「${name}」主题相关内容`;
}

export async function resolveDynamicFolderOptions(env: AppEnv): Promise<string[]> {
  const configured = normalizeFolders([env.obsidianFolder]);
  if (configured.length > 0) {
    return configured;
  }

  const baseFolder = (env.obsidianFolder || "Clippings").trim() || "Clippings";
  const cacheKey = `${env.obsidianVault || "<active>"}::${baseFolder}`;
  const now = Date.now();
  if (cache && cache.key === cacheKey && now - cache.at < CACHE_TTL_MS) {
    return cache.folders;
  }

  const vaultPath = await resolveVaultPath(env.obsidianVault);
  if (!vaultPath) {
    return [];
  }

  const folderPath = join(vaultPath, baseFolder);

  try {
    const entries = await readdir(folderPath, { withFileTypes: true });
    const folders = normalizeFolders(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith(".")),
    );
    cache = {
      at: now,
      key: cacheKey,
      folders,
    };
    logger.info(
      `[dynamic-folder] auto-discovered from ${folderPath} count=${folders.length}`,
    );
    return folders;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[dynamic-folder] discover failed path=${folderPath} msg=${msg}`);
    return [];
  }
}
