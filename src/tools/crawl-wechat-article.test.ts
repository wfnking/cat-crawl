import assert from "node:assert/strict";
import test from "node:test";
import { resolveWechatImageSrc } from "./crawl-wechat-article.js";

test("resolveWechatImageSrc should prefer data-src when src is data uri placeholder", () => {
  const resolved = resolveWechatImageSrc({
    src: "data:image/svg+xml,%3Csvg%20width%3D%221%22%20height%3D%221%22%3E%3C/svg%3E",
    dataSrc: "https://mmbiz.qpic.cn/real-image.jpg",
  });
  assert.equal(resolved, "https://mmbiz.qpic.cn/real-image.jpg");
});

test("resolveWechatImageSrc should fallback to src when src is regular http url", () => {
  const resolved = resolveWechatImageSrc({
    src: "https://mmbiz.qpic.cn/cover.jpg",
    dataSrc: "",
  });
  assert.equal(resolved, "https://mmbiz.qpic.cn/cover.jpg");
});

test("resolveWechatImageSrc should normalize protocol-relative url", () => {
  const resolved = resolveWechatImageSrc({
    dataSrc: "//mmbiz.qpic.cn/real-image.jpg",
  });
  assert.equal(resolved, "https://mmbiz.qpic.cn/real-image.jpg");
});
