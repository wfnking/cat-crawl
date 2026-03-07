import assert from "node:assert/strict";
import test from "node:test";
import { createLogger } from "./index.js";

test("createLogger prefixes string messages when scope is provided", () => {
  const calls: Array<{ level: string; args: unknown[] }> = [];
  const sink = {
    log: (...args: unknown[]) => calls.push({ level: "log", args }),
    info: (...args: unknown[]) => calls.push({ level: "info", args }),
    warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
    error: (...args: unknown[]) => calls.push({ level: "error", args }),
  };

  const logger = createLogger("case-study", sink);
  logger.info("build started");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    level: "info",
    args: ["[case-study] build started"],
  });
});

test("createLogger keeps non-string first argument and adds scope token", () => {
  const calls: Array<{ level: string; args: unknown[] }> = [];
  const sink = {
    log: (...args: unknown[]) => calls.push({ level: "log", args }),
    info: (...args: unknown[]) => calls.push({ level: "info", args }),
    warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
    error: (...args: unknown[]) => calls.push({ level: "error", args }),
  };

  const logger = createLogger("agent", sink);
  logger.warn({ reason: "fallback" });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    level: "warn",
    args: ["[agent]", { reason: "fallback" }],
  });
});
