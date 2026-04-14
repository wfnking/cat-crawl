const GENERIC_FAILURE_MESSAGE = "处理失败，请稍后重试。";

const OBSIDIAN_VAULT_CONFIG_MESSAGE = [
  "处理失败：未找到可写入的 Obsidian Vault。",
  "请在配置中设置 `obsidian.vault` 为 vault 的绝对路径。",
  "例如：`C:\\\\Users\\\\alfwong\\\\Documents\\\\Obsidian` 或 `/Users/alfwong/Library/Mobile Documents/iCloud~md~obsidian/Documents/知识库`。",
  "完成后重试本次请求。",
].join("\n");

function isObsidianVaultConfigError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const text = detail.toLowerCase();
  if (text.includes("obsidian active vault not found")) {
    return true;
  }
  if (text.includes("obsidian vault not found")) {
    return true;
  }
  return false;
}

function extractErrorSummary(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  const firstLine = text.split("\n")[0]?.trim() || "";
  if (!firstLine) {
    return "";
  }
  return firstLine
    .replace(/^fatal error:\s*/i, "")
    .replace(/(key=)[^&\s]+/gi, "$1***")
    .replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1***")
    .slice(0, 240);
}

export function toUserFacingErrorMessage(error: unknown): string {
  if (isObsidianVaultConfigError(error)) {
    return OBSIDIAN_VAULT_CONFIG_MESSAGE;
  }
  const detail = extractErrorSummary(error);
  if (!detail) {
    return GENERIC_FAILURE_MESSAGE;
  }
  return `处理失败：${detail}`;
}
