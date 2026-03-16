import process from "node:process";
import { getLocalConfigStore } from "@cat-crawl/core";

try {
  process.loadEnvFile?.();
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") {
    throw error;
  }
}

export type AppEnv = {
  agent: "deepseek" | "codex";
  deepseekApiKey?: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  codexModel: string;
  codexBin: string;
  transcriptionProvider: "whisper_cpp" | "gemini";
  transcriptionFallbackProvider?: "whisper_cpp" | "gemini";
  whisperCppBin: string;
  whisperCppModelPath?: string;
  whisperCppLanguage?: string;
  geminiApiKey?: string;
  geminiModel: string;
  douyinCookie?: string;
  feishuEnabled: boolean;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuDomain: "feishu" | "lark";
  telegramEnabled: boolean;
  telegramDmPolicy: string;
  telegramBotToken?: string;
  telegramTypingMode: "never" | "instant" | "thinking" | "message";
  telegramTypingIntervalSeconds: number;
  discordEnabled: boolean;
  discordBotToken?: string;
  obsidianVault?: string;
  obsidianFolder: string;
  obsidianDynamicFolders: string[];
  maxToolSteps: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readFromPath(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    const obj = asObject(current);
    if (!obj) {
      return undefined;
    }
    current = obj[segment];
  }
  return current;
}

function readFromStructuredConfig(name: string): string | undefined {
  const raw = getLocalConfigStore().readRaw();
  const mappings: Record<string, string[]> = {
    agent: ["agent", "provider"],
    channel: ["channel"],
    DEEPSEEK_API_KEY: ["agent", "deepseek", "apiKey"],
    DEEPSEEK_BASE_URL: ["agent", "deepseek", "baseUrl"],
    DEEPSEEK_MODEL: ["agent", "deepseek", "model"],
    CODEX_MODEL: ["agent", "codex", "model"],
    CODEX_BIN: ["agent", "codex", "bin"],
    TRANSCRIPTION_PROVIDER: ["transcription", "provider"],
    TRANSCRIPTION_FALLBACK_PROVIDER: ["transcription", "fallbackProvider"],
    WHISPER_CPP_BIN: ["transcription", "whisperCpp", "bin"],
    WHISPER_CPP_MODEL_PATH: ["transcription", "whisperCpp", "modelPath"],
    WHISPER_CPP_LANGUAGE: ["transcription", "whisperCpp", "language"],
    DOUYIN_COOKIE: ["videoSources", "douyin", "cookie"],
    GEMINI_API_KEY: ["transcription", "gemini", "apiKey"],
    GEMINI_MODEL: ["transcription", "gemini", "model"],
    TELEGRAM_BOT_TOKEN: ["channels", "telegram", "botToken"],
    TELEGRAM_DM_POLICY: ["channels", "telegram", "dmPolicy"],
    TELEGRAM_TYPING_MODE: ["channels", "telegram", "typingMode"],
    DISCORD_BOT_TOKEN: ["channels", "discord", "token"],
    FEISHU_APP_ID: ["channels", "feishu", "accounts", "main", "appId"],
    FEISHU_APP_SECRET: ["channels", "feishu", "accounts", "main", "appSecret"],
    FEISHU_DOMAIN: ["channels", "feishu", "accounts", "main", "domain"],
  };
  const boolMappings: Record<string, string[]> = {
    TELEGRAM_ENABLED: ["channels", "telegram", "enabled"],
    DISCORD_ENABLED: ["channels", "discord", "enabled"],
    FEISHU_ENABLED: ["channels", "feishu", "accounts", "main", "enabled"],
  };
  const numberMappings: Record<string, string[]> = {
    TELEGRAM_TYPING_INTERVAL_SECONDS: ["channels", "telegram", "typingIntervalSeconds"],
  };

  const path = mappings[name];
  if (path) {
    const value = readFromPath(raw, path);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  const boolPath = boolMappings[name];
  if (boolPath) {
    const value = readFromPath(raw, boolPath);
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
  }

  const numberPath = numberMappings[name];
  if (numberPath) {
    const value = readFromPath(raw, numberPath);
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readRaw(name: string): string | undefined {
  const structuredValue = readFromStructuredConfig(name);
  if (structuredValue) {
    return structuredValue;
  }
  const localValue = getLocalConfigStore().get(name)?.trim();
  if (localValue) {
    return localValue;
  }
  const envValue = process.env[name]?.trim();
  if (envValue) {
    return envValue;
  }
  return undefined;
}

function mustGet(name: string): string {
  const value = readRaw(name);
  if (!value) {
    throw new Error(`Missing required config: ${name}`);
  }
  return value;
}

function getNumber(name: string, defaultValue: number): number {
  const raw = readRaw(name);
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
  const raw = readRaw(name);
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getBoolean(name: string, defaultValue: boolean): boolean {
  const raw = readRaw(name);
  if (!raw) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function getTelegramTypingMode(): "never" | "instant" | "thinking" | "message" {
  const raw = readRaw("TELEGRAM_TYPING_MODE")?.toLowerCase();
  if (!raw) {
    return "thinking";
  }
  if (raw === "never" || raw === "instant" || raw === "thinking" || raw === "message") {
    return raw;
  }
  throw new Error(`Invalid TELEGRAM_TYPING_MODE: ${raw}`);
}

function getTranscriptionProvider(
  name: "TRANSCRIPTION_PROVIDER" | "TRANSCRIPTION_FALLBACK_PROVIDER",
  defaultValue?: "whisper_cpp" | "gemini",
): "whisper_cpp" | "gemini" | undefined {
  const raw = readRaw(name)?.toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (raw === "whisper_cpp" || raw === "gemini") {
    return raw;
  }
  throw new Error(`Invalid ${name}: ${raw}`);
}

export function loadEnv(): AppEnv {
  const agent = readRaw("agent")?.toLowerCase() === "codex" ? "codex" : "deepseek";
  return {
    agent,
    deepseekApiKey: agent === "deepseek" ? mustGet("DEEPSEEK_API_KEY") : undefined,
    deepseekBaseUrl: readRaw("DEEPSEEK_BASE_URL") || "https://api.deepseek.com",
    deepseekModel: readRaw("DEEPSEEK_MODEL") || "deepseek-chat",
    codexModel: readRaw("CODEX_MODEL") || "gpt-5-codex",
    codexBin: readRaw("CODEX_BIN") || "codex",
    transcriptionProvider: getTranscriptionProvider("TRANSCRIPTION_PROVIDER", "whisper_cpp") || "whisper_cpp",
    transcriptionFallbackProvider: getTranscriptionProvider(
      "TRANSCRIPTION_FALLBACK_PROVIDER",
      "gemini",
    ),
    whisperCppBin: readRaw("WHISPER_CPP_BIN") || "whisper-cli",
    whisperCppModelPath: readRaw("WHISPER_CPP_MODEL_PATH") || undefined,
    whisperCppLanguage: readRaw("WHISPER_CPP_LANGUAGE") || undefined,
    geminiApiKey: readRaw("GEMINI_API_KEY") || undefined,
    geminiModel: readRaw("GEMINI_MODEL") || "gemini-3-flash-preview",
    douyinCookie: readRaw("DOUYIN_COOKIE") || undefined,
    feishuEnabled: getBoolean("FEISHU_ENABLED", false),
    feishuAppId: readRaw("FEISHU_APP_ID") || undefined,
    feishuAppSecret: readRaw("FEISHU_APP_SECRET") || undefined,
    feishuDomain: readRaw("FEISHU_DOMAIN")?.toLowerCase() === "lark" ? "lark" : "feishu",
    telegramEnabled: getBoolean("TELEGRAM_ENABLED", false),
    telegramDmPolicy: readRaw("TELEGRAM_DM_POLICY") || "pairing",
    telegramBotToken: readRaw("TELEGRAM_BOT_TOKEN") || undefined,
    telegramTypingMode: getTelegramTypingMode(),
    telegramTypingIntervalSeconds: getNumber("TELEGRAM_TYPING_INTERVAL_SECONDS", 6),
    discordEnabled: getBoolean("DISCORD_ENABLED", false),
    discordBotToken: readRaw("DISCORD_BOT_TOKEN") || undefined,
    obsidianVault: readRaw("OBSIDIAN_VAULT") || undefined,
    obsidianFolder: readRaw("OBSIDIAN_FOLDER") || "Clippings",
    obsidianDynamicFolders: getList("OBSIDIAN_DYNAMIC_FOLDERS"),
    maxToolSteps: getNumber("MAX_TOOL_STEPS", 4),
  };
}
