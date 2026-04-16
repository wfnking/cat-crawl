import assert from "node:assert/strict";
import test from "node:test";
import { getObsidianVaultStartupError } from "./startup-checks.js";

test("getObsidianVaultStartupError should error when vault is missing", () => {
  const message = getObsidianVaultStartupError({
    obsidianVault: undefined,
  } as never);

  assert.match(message || "", /Obsidian Vault 尚未配置/);
  assert.match(message || "", /obsidian\.vault/);
});

test("getObsidianVaultStartupError should accept absolute path", () => {
  const message = getObsidianVaultStartupError({
    obsidianVault: "/Users/alfwong/Documents/Obsidian",
  } as never);

  assert.equal(message, null);
});

test("getObsidianVaultStartupError should error for relative path", () => {
  const message = getObsidianVaultStartupError({
    obsidianVault: "知识库",
  } as never);

  assert.match(message || "", /不是绝对路径/);
  assert.match(message || "", /config set vault/);
});
