import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCaseStudyCaptureRequest } from "./capture.js";

test("normalizeCaseStudyCaptureRequest defaults to public mode and infers slugs", () => {
  const result = normalizeCaseStudyCaptureRequest({
    url: "https://www.thevibemarketer.com/",
  });

  assert.deepEqual(result, {
    url: "https://www.thevibemarketer.com/",
    auth: "public",
    sessionPath: undefined,
    siteSlug: "thevibemarketer",
    pageSlug: "home",
  });
});

test("normalizeCaseStudyCaptureRequest uses provided session and explicit slugs", () => {
  const result = normalizeCaseStudyCaptureRequest({
    url: "https://ads.thevibemarketer.com/daily-ads/billing",
    session: ".case-study/thevibemarketer.session.json",
    site: "thevibemarketer",
    page: "billing",
  });

  assert.deepEqual(result, {
    url: "https://ads.thevibemarketer.com/daily-ads/billing",
    auth: "session",
    sessionPath: ".case-study/thevibemarketer.session.json",
    siteSlug: "thevibemarketer",
    pageSlug: "billing",
  });
});

test("normalizeCaseStudyCaptureRequest infers page slug from pathname", () => {
  const result = normalizeCaseStudyCaptureRequest({
    url: "https://ads.thevibemarketer.com/daily-ads",
  });

  assert.deepEqual(result, {
    url: "https://ads.thevibemarketer.com/daily-ads",
    auth: "public",
    sessionPath: undefined,
    siteSlug: "thevibemarketer",
    pageSlug: "daily-ads",
  });
});
