import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseStudyIndexes, parseCaseStudyCommand, runCaseStudyCrawl } from "./index.js";

test("case-study package exports public api", () => {
  assert.equal(typeof parseCaseStudyCommand, "function");
  assert.equal(typeof runCaseStudyCrawl, "function");
  assert.equal(typeof buildCaseStudyIndexes, "function");
});
