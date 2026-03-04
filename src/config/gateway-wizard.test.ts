import assert from "node:assert/strict";
import test from "node:test";
import { buildGatewaySetupConfig, getGatewaySetupSteps } from "./gateway-wizard.js";

test("telegram gateway should expose required setup steps", () => {
  const steps = getGatewaySetupSteps("telegram");
  assert.deepEqual(
    steps.map((item) => item.key),
    [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_DM_POLICY",
      "TELEGRAM_GROUP_POLICY",
      "TELEGRAM_STREAM_MODE",
      "TELEGRAM_TYPING_MODE",
      "TELEGRAM_TYPING_INTERVAL_SECONDS",
    ],
  );
  assert.equal(steps[0]?.required, true);
  assert.equal(steps[1]?.required, true);
});

test("buildGatewaySetupConfig should output channel + env-style keys", () => {
  const config = buildGatewaySetupConfig("telegram", {
    TELEGRAM_BOT_TOKEN: "token-123",
    TELEGRAM_DM_POLICY: "pairing",
    TELEGRAM_GROUP_POLICY: "allowlist",
    TELEGRAM_STREAM_MODE: "partial",
    TELEGRAM_TYPING_MODE: "thinking",
    TELEGRAM_TYPING_INTERVAL_SECONDS: "6",
  });

  assert.equal(config.channel, "telegram");
  assert.equal(config.TELEGRAM_ENABLED, "true");
  assert.equal(config.TELEGRAM_BOT_TOKEN, "token-123");
  assert.equal(config.TELEGRAM_DM_POLICY, "pairing");
  assert.equal(config.TELEGRAM_GROUP_POLICY, "allowlist");
  assert.equal(config.TELEGRAM_STREAM_MODE, "partial");
  assert.equal(config.TELEGRAM_TYPING_MODE, "thinking");
  assert.equal(config.TELEGRAM_TYPING_INTERVAL_SECONDS, "6");
});

test("buildGatewaySetupConfig should set telegram policy defaults", () => {
  const config = buildGatewaySetupConfig("telegram", {
    TELEGRAM_BOT_TOKEN: "token-123",
  });

  assert.equal(config.TELEGRAM_DM_POLICY, "pairing");
  assert.equal(config.TELEGRAM_GROUP_POLICY, "allowlist");
  assert.equal(config.TELEGRAM_STREAM_MODE, "partial");
  assert.equal(config.TELEGRAM_TYPING_MODE, "thinking");
  assert.equal(config.TELEGRAM_TYPING_INTERVAL_SECONDS, "6");
});
