import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalConfigStore, setLocalConfigStoreForTest } from "@cat-crawl/core";
import { loadEnv } from "./env.js";

function createTempHome(): { homeDir: string; cleanup: () => void } {
  const homeDir = mkdtempSync(join(tmpdir(), "cat-crawl-obsidian-env-"));
  return {
    homeDir,
    cleanup: () => rmSync(homeDir, { recursive: true, force: true }),
  };
}

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("loadEnv should expose default transcription config", () => {
  const { homeDir, cleanup } = createTempHome();
  const store = createLocalConfigStore({ homeDir });

  setLocalConfigStoreForTest(store);
  try {
    const env = withEnv({ agent: "codex" }, () => loadEnv());
    assert.equal(env.transcriptionProvider, "whisper_cpp");
    assert.equal(env.transcriptionFallbackProvider, "gemini");
    assert.equal(env.whisperCppBin, "whisper-cli");
    assert.equal(env.whisperCppLanguage, undefined);
    assert.equal(env.geminiModel, "gemini-3-flash-preview");
  } finally {
    setLocalConfigStoreForTest(null);
    cleanup();
  }
});

test("loadEnv should read transcription config from structured config", () => {
  const { homeDir, cleanup } = createTempHome();
  const store = createLocalConfigStore({ homeDir });
  store.writeRaw({
    agent: {
      provider: "codex",
      codex: {
        model: "gpt-5-codex",
        bin: "codex",
      },
    },
    transcription: {
      provider: "gemini",
      fallbackProvider: "whisper_cpp",
      whisperCpp: {
        bin: "/opt/homebrew/bin/whisper-cli",
        modelPath: "/models/ggml-large-v3.bin",
        language: "en",
      },
      gemini: {
        apiKey: "gemini-demo-key",
        model: "gemini-3-flash-preview",
      },
    },
  });

  setLocalConfigStoreForTest(store);
  try {
    const env = loadEnv();
    assert.equal(env.transcriptionProvider, "gemini");
    assert.equal(env.transcriptionFallbackProvider, "whisper_cpp");
    assert.equal(env.whisperCppBin, "/opt/homebrew/bin/whisper-cli");
    assert.equal(env.whisperCppModelPath, "/models/ggml-large-v3.bin");
    assert.equal(env.whisperCppLanguage, "en");
    assert.equal(env.geminiApiKey, "gemini-demo-key");
    assert.equal(env.geminiModel, "gemini-3-flash-preview");
  } finally {
    setLocalConfigStoreForTest(null);
    cleanup();
  }
});
