import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCaseStudyComponents,
  extractCaseStudyCopy,
  extractCaseStudyTokens,
} from "./extract.js";

const SAMPLE_HTML = `
  <main style="background:#000;color:#fff;font-family:Inter;font-size:16px;">
    <section style="padding:64px;border-radius:24px;">
      <h1>Your AI creative department</h1>
      <p>Get production-ready ad creatives every morning.</p>
      <a href="/signup" style="background:#f5c400;color:#000;border-radius:12px;">Start Free</a>
    </section>
    <section>
      <h2>What the community is saying</h2>
      <article style="box-shadow:0 0 20px rgba(245,196,0,.2)">
        <p>These workflows are worth 10x the price.</p>
      </article>
    </section>
    <section>
      <h2>Pricing</h2>
      <div>
        <h3>Starter</h3>
        <p>$49/mo</p>
        <button>Get Started</button>
      </div>
    </section>
  </main>
`;

test("extractCaseStudyTokens pulls core visual tokens from html", () => {
  const result = extractCaseStudyTokens(SAMPLE_HTML);

  assert.deepEqual(result.colors, ["#000", "#fff", "#f5c400", "rgba(245,196,0,.2)"]);
  assert.deepEqual(result.fontFamilies, ["Inter"]);
  assert.deepEqual(result.fontSizes, ["16px"]);
  assert.deepEqual(result.radii, ["24px", "12px"]);
  assert.deepEqual(result.spacing, ["64px"]);
});

test("extractCaseStudyComponents identifies major page blocks", () => {
  const result = extractCaseStudyComponents(SAMPLE_HTML);

  assert.equal(result[0]?.kind, "hero");
  assert.equal(result[1]?.kind, "testimonials");
  assert.equal(result[2]?.kind, "pricing");
});

test("extractCaseStudyCopy groups copy into hero proof pricing and cta", () => {
  const result = extractCaseStudyCopy("Daily Ads", SAMPLE_HTML);

  assert.match(result.hero, /Your AI creative department/);
  assert.match(result.proof, /community/);
  assert.match(result.pricing, /Starter/);
  assert.deepEqual(result.cta, ["Start Free", "Get Started"]);
});
