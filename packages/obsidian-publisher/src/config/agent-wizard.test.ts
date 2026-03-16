import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentSetupConfig, getAgentSetupSteps } from "./agent-wizard.js";

test("deepseek agent should expose required setup steps", () => {
  const steps = getAgentSetupSteps("deepseek");
  assert.deepEqual(steps.map((item) => item.key), ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"]);
  assert.equal(steps[0]?.required, true);
  assert.equal(steps[1]?.defaultValue, "deepseek-chat");
});

test("gemini agent should expose required api key and model steps", () => {
  const steps = getAgentSetupSteps("gemini");
  assert.deepEqual(steps.map((item) => item.key), ["GEMINI_API_KEY", "GEMINI_MODEL"]);
  assert.equal(steps[0]?.required, true);
  assert.equal(steps[1]?.defaultValue, "gemini-3-flash-preview");
});

test("buildAgentSetupConfig should include selected agent", () => {
  const config = buildAgentSetupConfig("deepseek", {
    DEEPSEEK_API_KEY: "sk-demo",
    DEEPSEEK_MODEL: "deepseek-chat",
  });

  assert.equal(config.agent, "deepseek");
  assert.equal(config.DEEPSEEK_MODEL, "deepseek-chat");
});

test("buildAgentSetupConfig should include gemini values", () => {
  const config = buildAgentSetupConfig("gemini", {
    GEMINI_API_KEY: "gemini-demo-key",
    GEMINI_MODEL: "gemini-3-flash-preview",
  });

  assert.equal(config.agent, "gemini");
  assert.equal(config.GEMINI_API_KEY, "gemini-demo-key");
  assert.equal(config.GEMINI_MODEL, "gemini-3-flash-preview");
});
