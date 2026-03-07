import assert from "node:assert/strict";
import test from "node:test";
import { resolveCaseStudyServeOptions } from "./serve.js";

test("resolveCaseStudyServeOptions returns defaults", () => {
  const result = resolveCaseStudyServeOptions();

  assert.equal(result.port, 4173);
  assert.equal(result.rootDir, process.cwd());
});

test("resolveCaseStudyServeOptions respects explicit values", () => {
  const result = resolveCaseStudyServeOptions({
    port: 9000,
    rootDir: "/tmp/repo",
  });

  assert.equal(result.port, 9000);
  assert.equal(result.rootDir, "/tmp/repo");
});
