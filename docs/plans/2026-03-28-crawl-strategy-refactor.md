# Crawl Strategy Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolithic web article crawler with a strategy-based crawler registry so each source is implemented in its own module behind a shared interface.

**Architecture:** Introduce a new `src/crawl/` layer with `types`, `context`, `registry`, shared helpers, and per-source crawler strategies. Keep the public `crawl-web-article` tool thin: it builds the crawl context, resolves the matching strategy, and returns the unified `CrawlResult`. Migrate sources incrementally, starting with `generic`, `wechat`, and `x`, while preserving existing behavior and tests.

**Tech Stack:** TypeScript, LangChain tool wrapper, Playwright, Turndown, Node test runner (`tsx --test`).

---

### Task 1: Create crawl core types and registry

**Files:**
- Create: `packages/obsidian-publisher/src/crawl/types.ts`
- Create: `packages/obsidian-publisher/src/crawl/context.ts`
- Create: `packages/obsidian-publisher/src/crawl/registry.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`

**Step 1: Write the failing test**

Add tests that assert:
- a crawler registry can select the first matching strategy for a URL
- the fallback strategy is used when no specific strategy matches

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: FAIL because the registry module and strategy types do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `CrawlResult`
- `CrawlContext`
- `ArticleCrawlerStrategy`
- `selectCrawlerStrategy(url, strategies, fallback)`

Keep this module free of source-specific logic.

**Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: PASS for new registry tests.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/crawl/types.ts \
  packages/obsidian-publisher/src/crawl/context.ts \
  packages/obsidian-publisher/src/crawl/registry.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
git commit -m "refactor(obsidian-publisher): add crawl strategy registry"
```

### Task 2: Extract shared crawl helpers out of the monolithic tool

**Files:**
- Create: `packages/obsidian-publisher/src/crawl/helpers/urls.ts`
- Create: `packages/obsidian-publisher/src/crawl/helpers/dates.ts`
- Create: `packages/obsidian-publisher/src/crawl/helpers/markdown.ts`
- Create: `packages/obsidian-publisher/src/crawl/helpers/browser.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.ts`

**Step 1: Write the failing test**

Move existing low-level behavior coverage to helper-oriented tests for:
- `resolveSourceUrl`
- `normalizePublishedDateWithFallback`
- `resolveArticleImageSrc`
- browser evaluate wrapper behavior

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: FAIL because helper exports are not available from the new modules.

**Step 3: Write minimal implementation**

Extract pure functions and browser helper builders into `src/crawl/helpers/*`. Do not change behavior. Keep `crawl-web-article.ts` importing these helpers.

**Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: PASS with behavior unchanged.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/crawl/helpers \
  packages/obsidian-publisher/src/tools/crawl-web-article.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
git commit -m "refactor(obsidian-publisher): extract shared crawl helpers"
```

### Task 3: Extract `generic` and `wechat` crawlers into strategy modules

**Files:**
- Create: `packages/obsidian-publisher/src/crawl/crawlers/generic.ts`
- Create: `packages/obsidian-publisher/src/crawl/crawlers/wechat.ts`
- Create: `packages/obsidian-publisher/src/crawl/crawlers/index.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`

**Step 1: Write the failing test**

Add tests that verify:
- the registry resolves `wechat` for WeChat URLs
- the fallback generic crawler handles unknown hosts
- tool output remains identical for representative WeChat and generic fixtures

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: FAIL until the new strategies are wired in.

**Step 3: Write minimal implementation**

Move the current `wechat` and `generic` logic into dedicated strategy objects with `canHandle` and `crawl`. Register them through `crawlers/index.ts`.

**Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: PASS with no behavior regressions.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/crawl/crawlers/generic.ts \
  packages/obsidian-publisher/src/crawl/crawlers/wechat.ts \
  packages/obsidian-publisher/src/crawl/crawlers/index.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
git commit -m "refactor(obsidian-publisher): extract generic and wechat crawlers"
```

### Task 4: Extract `x` crawler behind the new strategy interface

**Files:**
- Create: `packages/obsidian-publisher/src/crawl/crawlers/x.ts`
- Modify: `packages/obsidian-publisher/src/crawl/crawlers/index.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
- Reference: `packages/obsidian-publisher/src/services/video-sources/x.ts`

**Step 1: Write the failing test**

Add or preserve tests for:
- full note tweet parsing
- title generation from the first sentence
- video transcript append behavior
- reply section append behavior

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: FAIL until the X logic is exported from the new strategy module.

**Step 3: Write minimal implementation**

Move all X-specific HTTP parsing, oEmbed/status API resolution, reply scraping, and optional video transcript assembly into `src/crawl/crawlers/x.ts`. Keep helper functions local to that module unless they are shared elsewhere.

**Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: PASS with previous X behavior unchanged.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/crawl/crawlers/x.ts \
  packages/obsidian-publisher/src/crawl/crawlers/index.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
git commit -m "refactor(obsidian-publisher): extract x crawler strategy"
```

### Task 5: Make the tool use the registry end-to-end

**Files:**
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
- Optional create: `packages/obsidian-publisher/src/crawl/index.ts`

**Step 1: Write the failing test**

Add a tool-level test that stubs the registry and asserts:
- the tool selects the matching strategy
- the tool logs the selected strategy name
- the tool still returns the unified result shape

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: FAIL until the tool delegates through the registry.

**Step 3: Write minimal implementation**

Refactor `crawl-web-article.ts` into a thin composition layer:
- build `CrawlContext`
- select strategy from registry
- invoke `strategy.crawl`
- keep schema and tool export here only

**Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/tools/crawl-web-article.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.test.ts \
  packages/obsidian-publisher/src/crawl/index.ts
git commit -m "refactor(obsidian-publisher): delegate crawl tool through registry"
```

### Task 6: Migrate the remaining source-specific crawlers

**Files:**
- Create: `packages/obsidian-publisher/src/crawl/crawlers/reddit.ts`
- Create: `packages/obsidian-publisher/src/crawl/crawlers/chatgpt.ts`
- Create: `packages/obsidian-publisher/src/crawl/crawlers/baidu.ts`
- Create: `packages/obsidian-publisher/src/crawl/crawlers/zhihu.ts`
- Create: `packages/obsidian-publisher/src/crawl/crawlers/tencent.ts`
- Create: `packages/obsidian-publisher/src/crawl/crawlers/csdn.ts`
- Modify: `packages/obsidian-publisher/src/crawl/crawlers/index.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`

**Step 1: Write the failing test**

Preserve or add tests for each source's key extraction path before moving it.

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: FAIL until the remaining strategies are registered.

**Step 3: Write minimal implementation**

Move one source at a time from the monolithic file into its own strategy module. Keep each strategy focused on source-specific fetch and parse logic only.

**Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: PASS after each migrated source.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/crawl/crawlers \
  packages/obsidian-publisher/src/tools/crawl-web-article.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
git commit -m "refactor(obsidian-publisher): split source-specific crawlers"
```

### Task 7: Final verification and cleanup

**Files:**
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
- Optional: `docs/plans/2026-03-28-crawl-strategy-refactor.md`

**Step 1: Remove dead code**

Delete any no-longer-used helper functions or source-specific branches left in the original tool file.

**Step 2: Run focused tests**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
Expected: PASS.

**Step 3: Run full verification**

Run: `pnpm build && pnpm test`
Expected: PASS with no regressions.

**Step 4: Inspect diff**

Run: `git diff --stat`
Expected: new crawl modules plus a much thinner `crawl-web-article.ts`.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/crawl \
  packages/obsidian-publisher/src/tools/crawl-web-article.ts \
  packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
git commit -m "refactor(obsidian-publisher): modularize article crawl strategies"
```
