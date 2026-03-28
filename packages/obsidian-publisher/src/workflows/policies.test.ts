import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHistoryIntentFromText,
  pickPolicyFolder,
  shouldForceRecrawlFromText,
} from "./policies.js";

test("detect all history query", () => {
  const intent = parseHistoryIntentFromText("查看历史成功记录");
  assert.equal(intent.shouldQuery, true);
  assert.equal(intent.scope, "all");
  assert.equal(intent.tag, undefined);
});

test("detect today history query", () => {
  const intent = parseHistoryIntentFromText("查看今天的成功记录");
  assert.equal(intent.shouldQuery, true);
  assert.equal(intent.scope, "today");
});

test("detect tag query", () => {
  const intent = parseHistoryIntentFromText("根据标签 ai 查询");
  assert.equal(intent.shouldQuery, true);
  assert.equal(intent.scope, "all");
  assert.equal(intent.tag, "ai");
});

test("non history text should not query", () => {
  const intent = parseHistoryIntentFromText("你好，你会做什么");
  assert.equal(intent.shouldQuery, false);
});

test("detect explicit recrawl request", () => {
  assert.equal(shouldForceRecrawlFromText("重新爬这个链接 https://example.com/a"), true);
  assert.equal(shouldForceRecrawlFromText("这个之前爬过也没关系，强制重抓"), true);
  assert.equal(shouldForceRecrawlFromText("忽略历史记录，重新处理一下"), true);
});

test("non recrawl text should not force recrawl", () => {
  assert.equal(shouldForceRecrawlFromText("看看这个 https://example.com/a"), false);
  assert.equal(shouldForceRecrawlFromText("查看历史成功记录"), false);
});

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

test("pickPolicyFolder should map entrepreneurship inspiration topic to OPC", () => {
  const picked = pickPolicyFolder({
    title: "一个大学生做的小游戏网站，月入15K美元，卖了12万",
    summary: "独立开发与副业增长复盘。",
    options: ["AI", "OPC", "English"],
  });
  assert.equal(picked, "OPC");
});

test("pickPolicyFolder should map ai topic to AI", () => {
  const picked = pickPolicyFolder({
    title: "A Practical Guide To Becoming An AI Engineer",
    summary: "Today we talk about AI agents, LLM workflows and prompt engineering.",
    options: ["AI", "English"],
  });
  assert.equal(picked, "AI");
});
