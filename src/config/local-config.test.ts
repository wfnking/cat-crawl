import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalConfigStore, parseChannelConfig } from "./local-config.js";

function createTempHome(): { homeDir: string; cleanup: () => void } {
  const homeDir = mkdtempSync(join(tmpdir(), "cat-crawl-config-home-"));
  return {
    homeDir,
    cleanup: () => rmSync(homeDir, { recursive: true, force: true }),
  };
}

test("set/get channel config in ~/.cat-crawl", () => {
  const { homeDir, cleanup } = createTempHome();
  const store = createLocalConfigStore({ homeDir });

  try {
    store.set("channel", "telegram");
    assert.equal(store.get("channel"), "telegram");
  } finally {
    cleanup();
  }
});

test("config should persist after re-open", () => {
  const { homeDir, cleanup } = createTempHome();

  try {
    const store1 = createLocalConfigStore({ homeDir });
    store1.set("channel", "discord");

    const store2 = createLocalConfigStore({ homeDir });
    assert.equal(store2.get("channel"), "discord");
  } finally {
    cleanup();
  }
});

test("parseChannelConfig should validate supported values", () => {
  assert.equal(parseChannelConfig("telegram"), "telegram");
  assert.equal(parseChannelConfig("  all "), "all");
  assert.equal(parseChannelConfig("unknown"), null);
});

test("remove should delete existing key", () => {
  const { homeDir, cleanup } = createTempHome();
  const store = createLocalConfigStore({ homeDir });
  try {
    store.set("gateway", "telegram");
    store.remove("gateway");
    assert.equal(store.get("gateway"), undefined);
  } finally {
    cleanup();
  }
});
