# Apps CLI Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the repository CLI shell into `apps/cli` and make the root act purely as the workspace coordinator.

**Architecture:** Keep feature logic in `packages/obsidian-publisher` and `packages/case-study`. Create an `apps/cli` package with the executable entrypoint and update root scripts and build output to target it.

**Tech Stack:** pnpm workspace, TypeScript, tsx, Node.js.

---

### Task 1: Extend workspace/root config for `apps/cli`

**Files:**
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/pnpm-workspace.yaml`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/package.json`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/tsconfig.json`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/src/workspace-layout.test.ts`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/apps/cli/package.json`

### Task 2: Move CLI entrypoint into `apps/cli`

**Files:**
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/index.ts`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/apps/cli/src/index.ts`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/apps/cli/src/index.test.ts`

### Task 3: Verify source and built CLI entrypoints

**Run:**
- `pnpm test`
- `pnpm build`
- `pnpm tsx apps/cli/src/index.ts case-study build`
- `node dist/apps/cli/src/index.js case-study build`
