import assert from "node:assert/strict";
import test from "node:test";
import {
  asObject,
  createLocalConfigStore,
  createLogger,
  ensureDir,
  ensureObject,
  getLocalConfigStore,
  parseAgentConfig,
  parseChannelConfig,
  readJsonFile,
  setLocalConfigStoreForTest,
  safeParseObject,
  writeJsonFile,
} from "./index.js";

test("core package exports shared helpers", () => {
  assert.equal(typeof ensureDir, "function");
  assert.equal(typeof createLogger, "function");
  assert.equal(typeof readJsonFile, "function");
  assert.equal(typeof writeJsonFile, "function");
  assert.equal(typeof safeParseObject, "function");
  assert.equal(typeof asObject, "function");
  assert.equal(typeof ensureObject, "function");
  assert.equal(typeof createLocalConfigStore, "function");
  assert.equal(typeof getLocalConfigStore, "function");
  assert.equal(typeof setLocalConfigStoreForTest, "function");
  assert.equal(typeof parseChannelConfig, "function");
  assert.equal(typeof parseAgentConfig, "function");
});
