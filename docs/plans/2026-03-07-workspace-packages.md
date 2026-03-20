# Workspace Package Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the repo to a pnpm workspace with dedicated `obsidian-publisher` and `case-study` packages while keeping the existing CLI behavior.

**Architecture:** Keep the root package as the CLI shell for this phase. Move feature code into `packages/obsidian-publisher` and `packages/case-study`, then repoint the root CLI and root build/test scripts to the new package locations.

**Tech Stack:** pnpm workspace, TypeScript, tsx, Node.js.

---

### Task 1: Add workspace manifests and root build/test plumbing

**Files:**
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/package.json`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/pnpm-workspace.yaml`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/tsconfig.json`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/packages/case-study/package.json`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/packages/obsidian-publisher/package.json`

**Step 1: Write the failing test**

Add a test that asserts the root test glob includes `packages/**/*.test.ts` and the workspace file includes `packages/*`.

**Step 2: Run test to verify it fails**

Run: `pnpm test src/workspace-layout.test.ts`

Expected: FAIL because the workspace/package wiring does not exist yet.

**Step 3: Write minimal implementation**

Update root manifests and add package manifests.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/workspace-layout.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.json src/workspace-layout.test.ts packages/case-study/package.json packages/obsidian-publisher/package.json
git commit -m "chore(workspace): add feature package manifests"
```

### Task 2: Move case-study code into `packages/case-study`

**Files:**
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/case-study/*`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/packages/case-study/src/index.ts`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/src/index.ts`
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/case-studies/viewer/*` only if the package needs local ownership metadata, otherwise leave assets in place for now

**Step 1: Write the failing test**

Add a small import test that loads the case-study package barrel and asserts the public functions exist.

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/case-study/src/index.test.ts`

Expected: FAIL because the package barrel does not exist.

**Step 3: Write minimal implementation**

Move the case-study source directory and export the public API through `packages/case-study/src/index.ts`. Update root CLI imports.

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/case-study/src/index.test.ts packages/case-study/src/**/*.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/case-study src/index.ts
git commit -m "refactor(case-study): move feature into workspace package"
```

### Task 3: Move Obsidian publishing flow into `packages/obsidian-publisher`

**Files:**
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/agent/*`
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/channels/*`
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/config/*`
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/history/*`
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/services/*`
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/tools/*`
- Move: `/Users/alfwong/codes/ai-coding/cat-crawl/src/utils/*`
- Create: `/Users/alfwong/codes/ai-coding/cat-crawl/packages/obsidian-publisher/src/index.ts`
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/src/index.ts`

**Step 1: Write the failing test**

Add a package-barrel test that asserts the root CLI imports it successfully.

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/obsidian-publisher/src/index.test.ts`

Expected: FAIL because the package barrel does not exist.

**Step 3: Write minimal implementation**

Move the domain directories into the package, add a package barrel, and update root CLI imports.

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/obsidian-publisher/src/index.test.ts packages/obsidian-publisher/src/**/*.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher src/index.ts
git commit -m "refactor(obsidian): move publishing flow into workspace package"
```

### Task 4: Verify root CLI, build, and tests with workspace layout

**Files:**
- Modify: `/Users/alfwong/codes/ai-coding/cat-crawl/src/index.ts` only if needed for final import cleanup

**Step 1: Write the failing test**

If needed, add a focused smoke test for the root CLI argument parsing path.

**Step 2: Run targeted verification**

Run:
- `pnpm test`
- `pnpm build`
- `pnpm tsx src/index.ts case-study build`

Expected: PASS.

**Step 3: Commit**

```bash
git add src/index.ts package.json tsconfig.json pnpm-workspace.yaml packages
git commit -m "refactor(workspace): wire root cli to feature packages"
```
