import assert from "node:assert/strict";
import test from "node:test";
import {
  asObject,
  createLogger,
  ensureDir,
  ensureObject,
  readJsonFile,
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
});
