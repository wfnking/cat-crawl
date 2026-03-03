import process from "node:process";

try {
  process.loadEnvFile?.();
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") {
    throw error;
  }
}

export type AppEnv = {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  feishuEnabled: boolean;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuDomain: "feishu" | "lark";
  obsidianVault?: string;
  obsidianFolder: string;
  obsidianDynamicFolders: string[];
  maxToolSteps: number;
};

function mustGet(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getNumber(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid numeric env var ${name}: ${raw}`);
  }
  return n;
}

function getList(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadEnv(): AppEnv {
  return {
    deepseekApiKey: mustGet("DEEPSEEK_API_KEY"),
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    feishuEnabled: getBoolean("FEISHU_ENABLED", false),
    feishuAppId: process.env.FEISHU_APP_ID?.trim() || undefined,
    feishuAppSecret: process.env.FEISHU_APP_SECRET?.trim() || undefined,
    feishuDomain: process.env.FEISHU_DOMAIN?.trim().toLowerCase() === "lark" ? "lark" : "feishu",
    obsidianVault: process.env.OBSIDIAN_VAULT?.trim() || undefined,
    obsidianFolder: process.env.OBSIDIAN_FOLDER?.trim() || "Clippings",
    obsidianDynamicFolders: getList("OBSIDIAN_DYNAMIC_FOLDERS"),
    maxToolSteps: getNumber("MAX_TOOL_STEPS", 4),
  };
}
