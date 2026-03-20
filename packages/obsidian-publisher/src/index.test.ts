import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentSetupConfig,
  buildChannelSetupConfig,
  loadEnv,
  parseChannelConfig,
  runAgent,
  runWechatAgent,
} from "./index.js";

test("obsidian publisher package exports public api", () => {
  assert.equal(typeof runAgent, "function");
  assert.equal(typeof runWechatAgent, "function");
  assert.equal(typeof loadEnv, "function");
  assert.equal(typeof parseChannelConfig, "function");
  assert.equal(typeof buildChannelSetupConfig, "function");
  assert.equal(typeof buildAgentSetupConfig, "function");
});
