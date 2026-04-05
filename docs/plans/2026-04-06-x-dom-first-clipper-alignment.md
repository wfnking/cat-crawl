# X DOM-First Clipper Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make X post extraction prefer rendered DOM content so the output is closer to Obsidian Web Clipper, while preserving `fxtwitter` as a fallback.

**Architecture:** Keep `XHandler` as the integration point. Introduce a DOM-first thread extraction path that returns structured tweet data, then merge or patch missing metadata from `fxtwitter` only when needed. Preserve the current browser adapter as the final fallback.

**Tech Stack:** TypeScript, Playwright, Node test runner, existing `cat-crawl` article ingestion helpers

---

### Task 1: Document the approved design

**Files:**
- Create: `docs/plans/2026-04-06-x-dom-first-clipper-alignment-design.md`
- Create: `docs/plans/2026-04-06-x-dom-first-clipper-alignment.md`

**Step 1: Save the approved design**

Write the design summary and implementation plan into the two docs above.

**Step 2: Verify docs exist**

Run: `ls docs/plans/2026-04-06-x-dom-first-clipper-alignment*`

Expected: both files are listed.

### Task 2: Write failing X handler tests

**Files:**
- Modify: `packages/obsidian-publisher/src/ingest/article/handlers/x.test.ts`

**Step 1: Write the failing test**

Add tests for:

- DOM thread content is preferred over `fxtwitter` main text when DOM data exists
- `fxtwitter` patches missing metadata when DOM content exists but metadata is partial
- Empty DOM result falls back to `fxtwitter`

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/obsidian-publisher/src/ingest/article/handlers/x.test.ts`

Expected: FAIL because the current handler does not support DOM-first structured extraction.

### Task 3: Implement DOM-first thread extraction

**Files:**
- Modify: `packages/obsidian-publisher/src/ingest/article/handlers/x.ts`

**Step 1: Add structured DOM types**

Define a browser-thread result type for:

- main post
- replies
- metadata
- media

**Step 2: Add a browser-thread fetcher**

Implement a Playwright-driven extractor that returns structured DOM content instead of reply text only.

**Step 3: Merge DOM and API results**

Update `handle()` so it:

- tries DOM thread extraction first
- falls back to `fxtwitter` for missing main content
- patches missing DOM metadata from `fxtwitter`

**Step 4: Keep video enrichment behavior**

Ensure the existing X video transcript enrichment still runs against the final chosen content body.

### Task 4: Make tests pass

**Files:**
- Modify: `packages/obsidian-publisher/src/ingest/article/handlers/x.ts`
- Modify: `packages/obsidian-publisher/src/ingest/article/handlers/x.test.ts`

**Step 1: Run the X handler tests**

Run: `pnpm test packages/obsidian-publisher/src/ingest/article/handlers/x.test.ts`

Expected: PASS

**Step 2: Run one broader adjacent test if needed**

Run: `pnpm test packages/obsidian-publisher/src/ingest/article/handlers/x.test.ts packages/obsidian-publisher/src/workflows/run-agent.test.ts`

Expected: PASS

### Task 5: Final verification

**Files:**
- Modify: `packages/obsidian-publisher/src/ingest/article/handlers/x.ts`
- Modify: `packages/obsidian-publisher/src/ingest/article/handlers/x.test.ts`

**Step 1: Re-run targeted tests**

Run: `pnpm test packages/obsidian-publisher/src/ingest/article/handlers/x.test.ts`

Expected: PASS

**Step 2: Inspect working tree**

Run: `git status --short`

Expected: only the intended X-related files and new docs are added or modified.
