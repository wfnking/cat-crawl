const GENERIC_FAILURE_MESSAGE = "处理失败，请稍后重试。";

const OBSIDIAN_CLI_INSTALL_MESSAGE = [
  "处理失败：未检测到 Obsidian CLI（命令：obsidian）。",
  "请在运行 cat-crawl 的机器上完成以下步骤：",
  "1. 安装 Obsidian Desktop：https://obsidian.md/download",
  "2. 终端验证：command -v obsidian",
  "3. 若无输出（macOS），执行：",
  "sudo ln -sf /Applications/Obsidian.app/Contents/MacOS/obsidian /usr/local/bin/obsidian",
  "Apple Silicon 也可改为 /opt/homebrew/bin/obsidian",
  "4. 完成后重试本次请求。",
].join("\n");

function isObsidianCliNotFoundError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const text = detail.toLowerCase();
  if (text.includes("obsidian cli not found")) {
    return true;
  }
  if (text.includes("spawn obsidian") && text.includes("enoent")) {
    return true;
  }
  return false;
}

export function toUserFacingErrorMessage(error: unknown): string {
  if (isObsidianCliNotFoundError(error)) {
    return OBSIDIAN_CLI_INSTALL_MESSAGE;
  }
  return GENERIC_FAILURE_MESSAGE;
}
