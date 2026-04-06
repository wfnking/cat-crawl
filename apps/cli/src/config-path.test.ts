import assert from "node:assert/strict";
import test from "node:test";
import { formatConfigValue, getConfigValueByPath } from "./config-path.js";

test("getConfigValueByPath should read nested object arrays", () => {
  const value = getConfigValueByPath(
    {
      obsidian: {
        folders: [
          {
            folder: "Clippings/AI/ai-coding",
            description: "",
          },
        ],
      },
    },
    "obsidian.folders",
  );

  assert.deepEqual(value, [
    {
      folder: "Clippings/AI/ai-coding",
      description: "",
    },
  ]);
});

test("getConfigValueByPath should read nested array item field", () => {
  const value = getConfigValueByPath(
    {
      obsidian: {
        folders: [
          {
            folder: "Clippings/AI/ai-coding",
            description: "",
          },
        ],
      },
    },
    "obsidian.folders.0.folder",
  );

  assert.equal(value, "Clippings/AI/ai-coding");
});

test("formatConfigValue should print objects as pretty json", () => {
  const output = formatConfigValue([
    {
      folder: "Clippings/AI/ai-coding",
      description: "",
    },
  ]);

  assert.equal(
    output,
    JSON.stringify(
      [
        {
          folder: "Clippings/AI/ai-coding",
          description: "",
        },
      ],
      null,
      2,
    ),
  );
});
