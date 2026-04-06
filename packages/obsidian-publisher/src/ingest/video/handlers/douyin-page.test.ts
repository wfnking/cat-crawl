import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./douyin.js";

test("extractDouyinVideoFromPage should retry when execution context is destroyed", async () => {
  let evaluateCalls = 0;
  const page = {
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    evaluate: async () => {
      evaluateCalls += 1;
      if (evaluateCalls === 1) {
        throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation");
      }
      return {
        pageUrl: "https://www.douyin.com/video/123456",
        mediaUrl: "https://video.example.com/demo.mp4",
        title: "Demo",
      };
    },
  };

  const result = await __test__.extractDouyinVideoFromPage(page as never);

  assert.equal(evaluateCalls, 2);
  assert.equal(result.pageUrl, "https://www.douyin.com/video/123456");
  assert.equal(result.mediaUrl, "https://video.example.com/demo.mp4");
});

test("extractDouyinVideoFromPage should not swallow non-navigation errors", async () => {
  const page = {
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    evaluate: async () => {
      throw new Error("unexpected selector failure");
    },
  };

  await assert.rejects(
    () => __test__.extractDouyinVideoFromPage(page as never),
    /unexpected selector failure/,
  );
});

test("extractDouyinVideoFromPage should keep polling until media url appears", async () => {
  let evaluateCalls = 0;
  let clickCalls = 0;
  const page = {
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    evaluate: async () => {
      evaluateCalls += 1;
      if (evaluateCalls < 3) {
        return {
          pageUrl: "https://www.douyin.com/video/123456",
          mediaUrl: "",
          title: "Demo",
        };
      }
      return {
        pageUrl: "https://www.douyin.com/video/123456",
        mediaUrl: "https://video.example.com/demo.mp4",
        title: "Demo",
      };
    },
    mouse: {
      click: async () => {
        clickCalls += 1;
      },
    },
  };

  const result = await __test__.extractDouyinVideoFromPage(page as never, {
    attempts: 4,
    intervalMs: 10,
    clickCenter: true,
  });

  assert.equal(evaluateCalls, 3);
  assert.equal(clickCalls, 3);
  assert.equal(result.mediaUrl, "https://video.example.com/demo.mp4");
});

test("extractDouyinVideoFromPage should pass browser-safe evaluate callback", async () => {
  let evaluateSource = "";
  const page = {
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    evaluate: async (fn: () => unknown) => {
      evaluateSource = String(fn);
      return {
        pageUrl: "https://www.douyin.com/video/123456",
        mediaUrl: "https://video.example.com/demo.mp4",
        title: "Demo",
      };
    },
  };

  await __test__.extractDouyinVideoFromPage(page as never, {
    attempts: 1,
    intervalMs: 0,
  });

  assert.ok(evaluateSource.length > 0);
  assert.equal(evaluateSource.includes("__name("), false);
});

test("toDouyinCookies should parse cookie header into douyin and iesdouyin domains", () => {
  const cookies = __test__.toDouyinCookies("ttwid=abc; passport_csrf_token=def");

  assert.equal(cookies.length, 4);
  assert.deepEqual(cookies[0], {
    name: "ttwid",
    value: "abc",
    domain: ".douyin.com",
    path: "/",
    secure: true,
    sameSite: "Lax",
  });
  assert.deepEqual(cookies[1], {
    name: "ttwid",
    value: "abc",
    domain: ".iesdouyin.com",
    path: "/",
    secure: true,
    sameSite: "Lax",
  });
});

test("applyDouyinCookies should ignore empty cookie header", async () => {
  let called = false;
  await __test__.applyDouyinCookies(
    {
      addCookies: async () => {
        called = true;
      },
    },
    "",
    () => [],
  );

  assert.equal(called, false);
});

test("applyDouyinCookies should load cookies from Chrome when header is absent", async () => {
  let cookiesCount = 0;
  await __test__.applyDouyinCookies(
    {
      addCookies: async (cookies) => {
        cookiesCount = cookies.length;
      },
    },
    undefined,
    () => [
      {
        name: "ttwid",
        value: "abc",
        domain: ".douyin.com",
        path: "/",
        secure: true,
      },
    ],
  );

  assert.equal(cookiesCount, 1);
});
