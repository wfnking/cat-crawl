import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalConfigStore, setLocalConfigStoreForTest } from "./local-config.js";
import {
  approveTelegramPairingCode,
  ensureTelegramPairingCodeForUser,
  isTelegramUserApproved,
} from "./telegram-pairing.js";

function createTempHome(): { homeDir: string; cleanup: () => void } {
  const homeDir = mkdtempSync(join(tmpdir(), "cat-crawl-pairing-home-"));
  return {
    homeDir,
    cleanup: () => rmSync(homeDir, { recursive: true, force: true }),
  };
}

test("telegram pairing code can be created and approved", () => {
  const { homeDir, cleanup } = createTempHome();

  try {
    const store = createLocalConfigStore({ homeDir });
    setLocalConfigStoreForTest(store);

    const userId = "7157037564";
    assert.equal(isTelegramUserApproved(userId), false);

    const code = ensureTelegramPairingCodeForUser(userId);
    assert.equal(code.length, 8);

    const approved = approveTelegramPairingCode(code);
    assert.equal(approved.ok, true);
    if (approved.ok) {
      assert.equal(approved.userId, userId);
    }
    assert.equal(isTelegramUserApproved(userId), true);
  } finally {
    setLocalConfigStoreForTest(null);
    cleanup();
  }
});
