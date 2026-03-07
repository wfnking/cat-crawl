import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentSetupConfig, getAgentSetupSteps } from "./agent-wizard.js";

test("deepseek agent should expose required setup steps", () => {
  const steps = getAgentSetupSteps("deepseek");
  assert.deepEqual(steps.map((item) => item.key), ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"]);
  assert.equal(steps[0]?.required, true);
  assert.equal(steps[1]?.defaultValue, "deepseek-chat");
});

test("buildAgentSetupConfig should include selected agent", () => {
  const config = buildAgentSetupConfig("deepseek", {
    DEEPSEEK_API_KEY: "sk-demo",
    DEEPSEEK_MODEL: "deepseek-chat",
  });

  assert.equal(config.agent, "deepseek");
  assert.equal(config.DEEPSEEK_MODEL, "deepseek-chat");
});
