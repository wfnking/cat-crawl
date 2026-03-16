import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeFileName } from "./text.js";

test("sanitizeFileName should preserve spaces while replacing invalid path characters", () => {
  assert.equal(
    sanitizeFileName("AI changes *Nothing* — Dax Raad, OpenCode"),
    "AI changes -Nothing- — Dax Raad, OpenCode",
  );
});
