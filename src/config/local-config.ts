import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LocalConfigStore = {
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
  setMany: (values: Record<string, string>) => void;
  all: () => Record<string, string>;
  readRaw: () => Record<string, unknown>;
  writeRaw: (value: Record<string, unknown>) => void;
};

type LocalConfig = Record<string, unknown>;

function safeParseConfig(raw: string): LocalConfig {
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return { ...parsed };
  } catch {
    return {};
  }
}

export function createLocalConfigStore(options?: { homeDir?: string }): LocalConfigStore {
  const homeDir = options?.homeDir || homedir();
  const configDir = join(homeDir, ".cat-crawl");
  const configPath = join(configDir, "config.json");

  function ensureDir(): void {
    mkdirSync(configDir, { recursive: true });
  }

  function load(): LocalConfig {
    if (!existsSync(configPath)) {
      return {};
    }
    const raw = readFileSync(configPath, "utf8");
    return safeParseConfig(raw);
  }

  function save(data: LocalConfig): void {
    ensureDir();
    writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  return {
    get(key) {
      const value = load()[key];
      return typeof value === "string" ? value : undefined;
    },
    set(key, value) {
      const k = key.trim();
      const v = value.trim();
      if (!k) {
        throw new Error("Config key cannot be empty.");
      }
      const data = load();
      data[k] = v;
      save(data);
    },
    remove(key) {
      const k = key.trim();
      if (!k) {
        return;
      }
      const data = load();
      if (!(k in data)) {
        return;
      }
      delete data[k];
      save(data);
    },
    setMany(values) {
      const data = load();
      for (const [key, value] of Object.entries(values)) {
        const k = key.trim();
        const v = value.trim();
        if (!k) {
          continue;
        }
        data[k] = v;
      }
      save(data);
    },
    all() {
      const data = load();
      const output: Record<string, string> = {};
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "string") {
          output[key] = value;
        }
      }
      return output;
    },
    readRaw() {
      return load();
    },
    writeRaw(value) {
      save(value);
    },
  };
}

let singletonStore: LocalConfigStore | null = null;

export function getLocalConfigStore(): LocalConfigStore {
  if (!singletonStore) {
    singletonStore = createLocalConfigStore();
  }
  return singletonStore;
}

export function setLocalConfigStoreForTest(store: LocalConfigStore | null): void {
  singletonStore = store;
}

export type ChannelConfigValue = "feishu" | "telegram" | "discord" | "all";
export type AgentConfigValue = "deepseek";

export function parseChannelConfig(input: string | undefined): ChannelConfigValue | null {
  const value = input?.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "feishu" || value === "telegram" || value === "discord" || value === "all") {
    return value;
  }
  return null;
}

export function parseAgentConfig(input: string | undefined): AgentConfigValue | null {
  const value = input?.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "deepseek") {
    return value;
  }
  return null;
}
