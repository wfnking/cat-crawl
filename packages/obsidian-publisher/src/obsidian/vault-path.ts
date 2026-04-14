import { access, readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

function sanitizeVaultName(value: string): string {
  return value.trim();
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}

export function normalizeConfiguredVaultPath(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^[A-Za-z0-9_.-]+(?:\\[A-Za-z0-9_.-]+)*::/, "");
}

export function findVaultPathFromDesktopConfig(
  configText: string,
  vaultName?: string,
): string | undefined {
  const parsed = JSON.parse(configText) as {
    vaults?: Record<string, { path?: string; open?: boolean }>;
  };
  const vaults = parsed.vaults;
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

export function getObsidianDesktopConfigPaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const appData = process.env.APPDATA || "";
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || "";

  if (process.platform === "darwin") {
    return uniquePaths([join(home, "Library", "Application Support", "obsidian", "obsidian.json")]);
  }

  if (process.platform === "win32") {
    return uniquePaths([
      join(appData, "obsidian", "obsidian.json"),
      join(home, "AppData", "Roaming", "obsidian", "obsidian.json"),
    ]);
  }

  return uniquePaths([
    join(xdgConfigHome || join(home, ".config"), "obsidian", "obsidian.json"),
  ]);
}

async function readDesktopConfigText(): Promise<string | undefined> {
  for (const configPath of getObsidianDesktopConfigPaths()) {
    try {
      return await readFile(configPath, "utf8");
    } catch {
      // try next path
    }
  }
  return undefined;
}

async function resolveVaultPathFromICloud(vaultName?: string): Promise<string | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }

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

export async function resolveVaultPath(configuredVault?: string): Promise<string | undefined> {
  const normalized = normalizeConfiguredVaultPath(configuredVault);
  if (normalized && isAbsolute(normalized)) {
    return normalized;
  }

  const configText = await readDesktopConfigText();
  if (configText) {
    const fromDesktopConfig = findVaultPathFromDesktopConfig(configText, normalized);
    if (fromDesktopConfig) {
      return fromDesktopConfig;
    }
  }

  return resolveVaultPathFromICloud(normalized);
}

export async function resolveActiveVaultName(): Promise<string | undefined> {
  const vaultPath = await resolveVaultPath();
  return vaultPath ? sanitizeVaultName(basename(vaultPath)) : undefined;
}

export const __test__ = {
  findVaultPathFromDesktopConfig,
  getObsidianDesktopConfigPaths,
  normalizeConfiguredVaultPath,
};
