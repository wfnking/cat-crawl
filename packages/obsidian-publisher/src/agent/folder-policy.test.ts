import assert from "node:assert/strict";
import test from "node:test";
import { pickPolicyFolder } from "./folder-policy.js";

test("pickPolicyFolder should map startup topic to OPC", () => {
  const picked = pickPolicyFolder({
    title: "用 AI 做一人公司创业，从 0 到 1",
    summary: "聚焦变现与公司经营。",
    options: ["AI", "OPC", "English"],
  });
  assert.equal(picked, "OPC");
});

test("pickPolicyFolder should support One Person Company option name", () => {
  const picked = pickPolicyFolder({
    title: "Startup playbook for solo founder",
    summary: "How to run a one person company",
    options: ["AI", "One Person Company"],
  });
  assert.equal(picked, "One Person Company");
});

test("pickPolicyFolder should return empty when topic is not startup", () => {
  const picked = pickPolicyFolder({
    title: "深度学习模型结构解析",
    summary: "Transformer 训练技巧",
    options: ["AI", "OPC", "English"],
  });
  assert.equal(picked, "");
});
