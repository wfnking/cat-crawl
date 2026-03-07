import assert from "node:assert/strict";
import test from "node:test";
import { hasAnyChannelMode, parseObsidianCommand } from "./obsidian-command.js";

test("parseObsidianCommand parses start with explicit channel flag", () => {
  const command = parseObsidianCommand(["obsidian", "start", "--telegram"]);
  assert.deepEqual(command, {
    action: "start",
    modes: {
      feishu: false,
      telegram: true,
      discord: false,
    },
  });
});

test("parseObsidianCommand parses run command", () => {
  const command = parseObsidianCommand(["obsidian", "run", "hello", "world"]);
  assert.deepEqual(command, {
    action: "run",
    input: "hello world",
  });
});

test("parseObsidianCommand parses config set command", () => {
  const command = parseObsidianCommand(["obsidian", "config", "set", "channel", "telegram"]);
  assert.deepEqual(command, {
    action: "config",
    command: {
      action: "set",
      key: "channel",
      value: "telegram",
    },
  });
});

test("parseObsidianCommand parses pairing approve command", () => {
  const command = parseObsidianCommand(["obsidian", "pairing", "approve", "telegram", "ABCD1234"]);
  assert.deepEqual(command, {
    action: "pairingApprove",
    command: {
      channel: "telegram",
      code: "ABCD1234",
    },
  });
});

test("parseObsidianCommand returns null for non-obsidian command", () => {
  assert.equal(parseObsidianCommand(["case-study", "build"]), null);
});

test("hasAnyChannelMode reports false for empty modes", () => {
  assert.equal(
    hasAnyChannelMode({
      feishu: false,
      telegram: false,
      discord: false,
    }),
    false,
  );
});
