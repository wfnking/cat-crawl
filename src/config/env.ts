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
  obsidianVault: string;
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

export function loadEnv(): AppEnv {
  return {
    deepseekApiKey: mustGet("DEEPSEEK_API_KEY"),
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    obsidianVault: mustGet("OBSIDIAN_VAULT"),
    maxToolSteps: getNumber("MAX_TOOL_STEPS", 4),
  };
}
