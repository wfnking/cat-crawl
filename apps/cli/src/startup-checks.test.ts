import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./startup-checks.js";

test("getObsidianVaultStartupError should error when vault is missing", () => {
  const message = __test__.getObsidianVaultStartupError({
    obsidianVault: undefined,
  } as never);

  assert.match(message || "", /Obsidian Vault 尚未配置/);
  assert.match(message || "", /obsidian\.vault/);
});

test("getObsidianVaultStartupError should accept absolute path", () => {
  const message = __test__.getObsidianVaultStartupError({
    obsidianVault: "/Users/alfwong/Documents/Obsidian",
  } as never);

  assert.equal(message, null);
});

test("getObsidianVaultStartupError should error for relative path", () => {
  const message = __test__.getObsidianVaultStartupError({
    obsidianVault: "知识库",
  } as never);

  assert.match(message || "", /不是绝对路径/);
  assert.match(message || "", /config set vault/);
});
