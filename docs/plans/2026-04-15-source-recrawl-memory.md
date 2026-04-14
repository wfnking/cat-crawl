# Source Re-crawl Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the agent reuse the last source from conversation memory when the user replies with a follow-up like "继续抓取", while also making transcript markdown require a blank line between headings and body text at generation time.

**Architecture:** Extend the graph's input parsing with a memory-aware follow-up URL resolver that asks the model whether the latest follow-up should reuse the most recent source from memory. Keep duplicate detection source-based, and make the duplicate reply explicitly invite a re-crawl. Separately, tighten the transcript-generation prompt so heading spacing is produced by the model instead of save-time normalization.

**Tech Stack:** TypeScript, LangGraph, node:test, existing chat memory utilities.

---

### Task 1: Add failing tests for follow-up re-crawl from memory

**Files:**
- Modify: `packages/obsidian-publisher/src/workflows/run-agent.test.ts`

**Step 1: Write the failing test**

- Add a test that runs `runAgent` twice with the same session context.
- First call: send a URL that matches an existing record and expect the duplicate reply.
- Second call: send `继续抓取`.
- Expect the crawler to receive the original URL and the save tool to run.

**Step 2: Run test to verify it fails**

Run: `rtk pnpm test packages/obsidian-publisher/src/workflows/run-agent.test.ts`
Expected: FAIL because the follow-up message currently has no URL and falls back to small chat.

### Task 2: Add failing tests for heading/body spacing instructions

**Files:**
- Modify: `packages/obsidian-publisher/src/workflows/tools/transcribe-video.test.ts`

**Step 1: Write the failing test**

- Add a prompt test asserting the transcript-generation system prompt explicitly forbids putting body text directly after a heading.

**Step 2: Run test to verify it fails**

Run: `rtk pnpm test packages/obsidian-publisher/src/workflows/tools/transcribe-video.test.ts`
Expected: FAIL until the prompt text is tightened.

### Task 3: Implement minimal graph changes

**Files:**
- Modify: `packages/obsidian-publisher/src/workflows/graph.ts`

**Step 1: Add a small memory URL extractor**

- Scan recent conversation messages from newest to oldest and return the most recent URL.

**Step 2: Add a model-backed follow-up detector**

- When the current input has no URL, recent memory exists, and a recent URL is available, ask the classify model whether the new message is requesting continuation/re-crawl of that recent source.

**Step 3: Route follow-up reuse through existing graph behavior**

- If the model says yes, return `mode: "content_request"`, `url: lastUrl`, and `forceRecrawl: true`.
- Update the duplicate reply text to tell the user they can reply `继续抓取`.
- Append final replies into chat memory for all paths so the duplicate exchange is available to the next turn.

### Task 4: Implement prompt-side heading spacing constraint

**Files:**
- Modify: `packages/obsidian-publisher/src/workflows/tools/transcribe-video.ts`

**Step 1: Tighten the transcript-generation prompt**

- Explicitly require a blank line after chapter headings and forbid placing body text directly after `## 标题`.

**Step 2: Keep save-time behavior simple**

- Leave `buildNoteContent` as a plain frontmatter + markdown join without formatting repair.

### Task 5: Verify

**Files:**
- None

**Step 1: Run targeted tests**

Run:
- `rtk pnpm test packages/obsidian-publisher/src/workflows/run-agent.test.ts`
- `rtk pnpm test packages/obsidian-publisher/src/workflows/tools/save-to-obsidian.test.ts`
- `rtk pnpm test packages/obsidian-publisher/src/workflows/tools/transcribe-video.test.ts`

Expected: PASS
