# LLM Folder Classification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the default Obsidian save location at `Clippings` while letting the model choose a configured subfolder when it is confident.

**Architecture:** Treat `obsidian.folder` or the default `Clippings` value as the base save directory. Parse `obsidian.folders` into structured classification options and run a constrained classifier that can only return one configured folder or an empty result. Save into the selected folder when present; otherwise fall back to the base folder.

**Tech Stack:** TypeScript, LangGraph, LangChain model invocation, node:test

---

### Task 1: Restore config separation between base folder and classification candidates

**Files:**
- Modify: `packages/obsidian-publisher/src/config/env.ts`
- Test: `packages/obsidian-publisher/src/config/env.test.ts`

**Step 1: Write failing tests**

Add assertions that `obsidianFolder` falls back to `Clippings` when only `obsidian.folders` is configured, and that structured folder candidates are preserved separately.

**Step 2: Run targeted env tests to verify failure**

Run: `rtk pnpm exec tsx --test packages/obsidian-publisher/src/config/env.test.ts`

**Step 3: Write minimal implementation**

Add a structured `obsidianFolders` field to `AppEnv` and parse `obsidian.folders` into `{ folder, description }[]` without using the first item as the default save folder.

**Step 4: Run env tests to verify pass**

Run: `rtk pnpm exec tsx --test packages/obsidian-publisher/src/config/env.test.ts`

### Task 2: Add constrained folder classification to the agent graph

**Files:**
- Modify: `packages/obsidian-publisher/src/workflows/types.ts`
- Modify: `packages/obsidian-publisher/src/workflows/graph.ts`
- Test: `packages/obsidian-publisher/src/workflows/run-agent.test.ts`

**Step 1: Write failing tests**

Add run-agent tests that verify:
- the classifier can select a configured subfolder and save into it
- uncertain classification falls back to `Clippings`
- the classifier never passes arbitrary folders outside the configured candidates

**Step 2: Run targeted agent tests to verify failure**

Run: `rtk pnpm exec tsx --test packages/obsidian-publisher/src/workflows/run-agent.test.ts`

**Step 3: Write minimal implementation**

Add an injectable folder-classification dependency, capture the selected folder in graph state, and only accept configured candidate folders or empty output.

**Step 4: Run agent tests to verify pass**

Run: `rtk pnpm exec tsx --test packages/obsidian-publisher/src/workflows/run-agent.test.ts`

### Task 3: Save to the selected folder with Clippings fallback

**Files:**
- Modify: `packages/obsidian-publisher/src/workflows/tools/save-to-obsidian.ts`
- Test: `packages/obsidian-publisher/src/workflows/tools/save-to-obsidian.test.ts`

**Step 1: Write failing tests**

Add save-tool tests that verify a provided folder override is used, and that an empty override still falls back to the base folder.

**Step 2: Run targeted save-tool tests to verify failure**

Run: `rtk pnpm exec tsx --test packages/obsidian-publisher/src/workflows/tools/save-to-obsidian.test.ts`

**Step 3: Write minimal implementation**

Add an optional `folder` input to the save tool and use it for default path generation when present.

**Step 4: Run targeted tests and build**

Run:
- `rtk pnpm exec tsx --test packages/obsidian-publisher/src/config/env.test.ts packages/obsidian-publisher/src/workflows/run-agent.test.ts packages/obsidian-publisher/src/workflows/tools/save-to-obsidian.test.ts`
- `rtk pnpm build`
