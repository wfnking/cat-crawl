import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./startup-checks.js";

test("getObsidianVaultStartupWarning should prompt when vault is missing", () => {
  const message = __test__.getObsidianVaultStartupWarning({
    obsidianVault: undefined,
  } as never);

  assert.match(message || "", /Obsidian Vault 尚未配置/);
  assert.match(message || "", /obsidian\.vault/);
});

test("getObsidianVaultStartupWarning should accept absolute path", () => {
  const message = __test__.getObsidianVaultStartupWarning({
    obsidianVault: "/Users/alfwong/Documents/Obsidian",
  } as never);

  assert.equal(message, null);
});

test("getObsidianVaultStartupWarning should warn for relative path", () => {
  const message = __test__.getObsidianVaultStartupError({
    obsidianVault: "知识库",
  } as never);

  assert.match(message || "", /不是绝对路径/);
  assert.match(message || "", /config set vault/);
});
