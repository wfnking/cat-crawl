import assert from "node:assert/strict";
import test from "node:test";
import { parseDownloadCommand } from "./download-command.js";

test("parseDownloadCommand parses url only", () => {
  const cmd = parseDownloadCommand(["download", "https://youtu.be/abc"]);
  assert.deepEqual(cmd, {
    action: "download",
    input: "https://youtu.be/abc",
  });
});

test("parseDownloadCommand parses --data-dir", () => {
  const cmd = parseDownloadCommand([
    "download",
    "--data-dir",
    "/var/tmp/cc",
    "https://youtu.be/abc",
  ]);
  assert.deepEqual(cmd, {
    action: "download",
    input: "https://youtu.be/abc",
    tempRootDir: "/var/tmp/cc",
  });
});

test("parseDownloadCommand parses -d", () => {
  const cmd = parseDownloadCommand(["download", "-d", "/data", "https://x.test/v"]);
  assert.deepEqual(cmd, {
    action: "download",
    input: "https://x.test/v",
    tempRootDir: "/data",
  });
});

test("parseDownloadCommand returns null for other commands", () => {
  assert.equal(parseDownloadCommand(["obsidian", "run", "x"]), null);
});
