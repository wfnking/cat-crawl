import assert from "node:assert/strict";
import test from "node:test";
import { parseCaseStudyCommand } from "./commands.js";

test("parseCaseStudyCommand parses crawl command with url", () => {
  const command = parseCaseStudyCommand([
    "case-study",
    "crawl",
    "https://www.thevibemarketer.com/",
  ]);

  assert.deepEqual(command, {
    action: "crawl",
    url: "https://www.thevibemarketer.com/",
    site: undefined,
    page: undefined,
    session: undefined,
  });
});

test("parseCaseStudyCommand parses build command", () => {
  const command = parseCaseStudyCommand(["case-study", "build"]);

  assert.deepEqual(command, {
    action: "build",
  });
});

test("parseCaseStudyCommand parses serve command", () => {
  const command = parseCaseStudyCommand(["case-study", "serve"]);

  assert.deepEqual(command, {
    action: "serve",
  });
});
