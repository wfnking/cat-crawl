import { isAbsolute } from "node:path";

type StartupEnv = {
  obsidianVault?: string;
};

function normalizeConfiguredVaultPath(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^[A-Za-z0-9_.-]+(?:\\[A-Za-z0-9_.-]+)*::/, "");
}

function isConfiguredVaultAbsolute(path: string): boolean {
  return isAbsolute(path);
}

export function getObsidianVaultStartupWarning(env: StartupEnv): string | null {
  const configured = normalizeConfiguredVaultPath(env.obsidianVault);

  if (!configured) {
    return [
      "Obsidian Vault 尚未配置。",
      "建议设置 `obsidian.vault` 为绝对路径，避免运行时再去猜测 Vault 地址。",
      '可执行：`cat-crawl obsidian config set vault "vault的绝对地址"`',
    ].join(" ");
  }

  return null;
}

export function getObsidianVaultStartupError(env: StartupEnv): string | null {
  const configured = normalizeConfiguredVaultPath(env.obsidianVault);

  if (!configured) {
    return null;
  }

  if (!isConfiguredVaultAbsolute(configured)) {
    return [
      `当前 obsidian.vault="${configured}" 不是绝对路径。`,
      "请改成绝对路径后再启动。",
      '可执行：`cat-crawl obsidian config set vault "vault的绝对地址"`',
    ].join(" ");
  }

  return null;
}

export const __test__ = {
  getObsidianVaultStartupError,
  getObsidianVaultStartupWarning,
  isConfiguredVaultAbsolute,
};
