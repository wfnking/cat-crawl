# Case Study Crawler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a reusable case-study crawler, file-based case-study store, and local static viewer for design analysis.

**Architecture:** Add a new `case-study` CLI subtree that captures pages with Playwright, extracts structured analysis into `case-studies/sites/*`, then builds viewer indexes and serves a local static site from generated JSON. Keep crawl, extract, build, and serve steps separate so authenticated pages and future sites can reuse the same flow.

**Tech Stack:** TypeScript, Node.js, Playwright, static JSON files, lightweight static viewer, existing CLI entrypoint.

---

### Task 1: Add CLI entrypoints and config plumbing

**Files:**
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/src/index.ts`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/commands.ts`
- Test: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/commands.test.ts`

**Step 1: Write the failing test**

Create tests that assert:

- `cat-crawl case-study crawl <url>` parses into a crawl command
- `cat-crawl case-study build` parses into a build command
- `cat-crawl case-study serve` parses into a serve command

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/commands.test.ts`

Expected: FAIL because the parser/module does not exist.

**Step 3: Write minimal implementation**

Add a small parser module and wire it into `src/index.ts` without implementing crawl logic yet.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/case-study/commands.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/index.ts src/case-study/commands.ts src/case-study/commands.test.ts
git commit -m "feat(case-study): add CLI command parsing"
```

### Task 2: Define case-study file schema and storage helpers

**Files:**
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/schema.ts`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/store.ts`
- Test: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/store.test.ts`

**Step 1: Write the failing test**

Write tests that verify:

- a site slug resolves to the correct `case-studies/sites/<slug>` path
- a page slug resolves to `pages/<page-slug>`
- writing a page artifact creates the expected files

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/store.test.ts`

Expected: FAIL because store helpers do not exist.

**Step 3: Write minimal implementation**

Create typed file-schema helpers and JSON/file write utilities.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/case-study/store.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/case-study/schema.ts src/case-study/store.ts src/case-study/store.test.ts
git commit -m "feat(case-study): add file-based artifact store"
```

### Task 3: Implement page capture with Playwright

**Files:**
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/capture.ts`
- Test: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/capture.test.ts`

**Step 1: Write the failing test**

Write a test around a pure helper that normalizes capture options:

- public crawl mode
- session-backed crawl mode
- inferred site/page slugs from URL

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/capture.test.ts`

Expected: FAIL because capture helpers do not exist.

**Step 3: Write minimal implementation**

Implement pure normalization helpers first, then add Playwright capture functions that produce:

- screenshot path
- sanitized HTML
- page metadata

**Step 4: Run test to verify it passes**

Run: `pnpm test src/case-study/capture.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/case-study/capture.ts src/case-study/capture.test.ts
git commit -m "feat(case-study): add page capture pipeline"
```

### Task 4: Extract tokens, components, and copy structure

**Files:**
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/extract.ts`
- Test: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/extract.test.ts`

**Step 1: Write the failing test**

Write tests for pure extraction helpers:

- token extraction from style samples
- component block extraction from simplified HTML markers
- copy block grouping into `hero`, `proof`, `mechanism`, `pricing`, `cta`

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/extract.test.ts`

Expected: FAIL because extractors do not exist.

**Step 3: Write minimal implementation**

Implement deterministic extractors before any site-specific heuristics.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/case-study/extract.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/case-study/extract.ts src/case-study/extract.test.ts
git commit -m "feat(case-study): add structured design extractors"
```

### Task 5: Implement `crawl` command end-to-end

**Files:**
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/src/index.ts`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/commands.ts`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/run-crawl.ts`
- Test: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/run-crawl.test.ts`

**Step 1: Write the failing test**

Write tests for the orchestration layer using temp directories and stubbed capture/extract functions. Assert it writes:

- `page.json`
- `tokens.json`
- `components.json`
- `copy.json`
- `html.html`

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/run-crawl.test.ts`

Expected: FAIL because crawl orchestration does not exist.

**Step 3: Write minimal implementation**

Wire capture + extract + store together behind the `crawl` command.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/case-study/run-crawl.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/index.ts src/case-study/commands.ts src/case-study/run-crawl.ts src/case-study/run-crawl.test.ts
git commit -m "feat(case-study): implement crawl command"
```

### Task 6: Build viewer indexes

**Files:**
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/build.ts`
- Test: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/build.test.ts`

**Step 1: Write the failing test**

Write tests that assert:

- site artifacts are aggregated into `case-studies/generated/index.json`
- page summaries are aggregated into `case-studies/generated/search.json`

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/build.test.ts`

Expected: FAIL because build logic does not exist.

**Step 3: Write minimal implementation**

Implement filesystem scans and JSON index generation.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/case-study/build.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/case-study/build.ts src/case-study/build.test.ts
git commit -m "feat(case-study): build viewer indexes"
```

### Task 7: Add a lightweight static viewer

**Files:**
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/case-studies/viewer/index.html`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/case-studies/viewer/app.js`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/case-studies/viewer/styles.css`
- Test: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/build.test.ts`

**Step 1: Write the failing test**

Extend build tests to assert the generated index shape required by the viewer:

- site list
- page list
- token summary
- copy section summary

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/build.test.ts`

Expected: FAIL because the viewer-required fields are missing.

**Step 3: Write minimal implementation**

Create a static viewer that:

- lists sites
- shows pages per site
- renders screenshot + structured analysis
- supports `Overview / Components / Tokens / Copy / Raw`

**Step 4: Run test to verify it passes**

Run: `pnpm test src/case-study/build.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add case-studies/viewer/index.html case-studies/viewer/app.js case-studies/viewer/styles.css src/case-study/build.test.ts
git commit -m "feat(case-study): add local viewer"
```

### Task 8: Add `serve` command

**Files:**
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/serve.ts`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/src/index.ts`
- Test: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/serve.test.ts`

**Step 1: Write the failing test**

Write tests for pure option parsing and path resolution:

- default serve directory
- custom port handling
- viewer root path resolution

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/serve.test.ts`

Expected: FAIL because serve helpers do not exist.

**Step 3: Write minimal implementation**

Implement a small static file server for the viewer and generated artifacts.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/case-study/serve.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/case-study/serve.ts src/index.ts src/case-study/serve.test.ts
git commit -m "feat(case-study): add local serve command"
```

### Task 9: Seed the first example site and document workflow

**Files:**
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/case-studies/sites/thevibemarketer/site.json`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/docs/plans/2026-03-07-case-study-seed-notes.md`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/README.md`

**Step 1: Write the failing test**

Add a test that ensures the generated index includes the seeded site metadata when present.

**Step 2: Run test to verify it fails**

Run: `pnpm test src/case-study/build.test.ts`

Expected: FAIL because seed metadata is not yet represented.

**Step 3: Write minimal implementation**

Add the site metadata file and document:

- how to export session state
- how to crawl public/auth pages
- how to build and serve the viewer

**Step 4: Run test to verify it passes**

Run: `pnpm test`

Expected: PASS.

**Step 5: Commit**

```bash
git add case-studies/sites/thevibemarketer/site.json README.md docs/plans/2026-03-07-case-study-seed-notes.md src/case-study/build.test.ts
git commit -m "docs(case-study): seed first site and document workflow"
```
