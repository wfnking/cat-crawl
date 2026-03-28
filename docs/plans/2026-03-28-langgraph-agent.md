# LangGraph Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolithic `run-wechat-agent.ts` orchestration flow with a LangGraph-based agent while preserving current runtime behavior.

**Architecture:** Introduce an explicit graph state and a small set of agent nodes under `src/agent/`. Keep article crawling, video transcription, and Obsidian save logic in their existing modules. LangGraph owns branching and node sequencing, not low-level business logic.

**Tech Stack:** TypeScript, LangGraph, existing LangChain model wrappers, existing article/video/save tools, Node test runner via `tsx --test`

---

### Task 1: Add agent graph types and state

**Files:**
- Create: `packages/obsidian-publisher/src/agent/types.ts`
- Create: `packages/obsidian-publisher/src/agent/state.ts`
- Test: `packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`

**Step 1: Write the failing test**

Add a test case that imports the new graph state/types module through the agent entrypoint and verifies the file compiles with the existing test harness.

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`
Expected: FAIL because the new state/types modules do not exist yet.

**Step 3: Write minimal implementation**

Create:

- `AgentGraphMode`
- `AgentGraphContentType`
- `AgentGraphState`
- shared result aliases reused by nodes

Keep these types purely structural. Do not move behavior into them.

**Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`
Expected: PASS for the newly added type/import coverage.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/agent/types.ts packages/obsidian-publisher/src/agent/state.ts packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts
git commit -m "refactor(agent): add langgraph state types"
```

### Task 2: Extract deterministic policies into agent-local modules

**Files:**
- Create: `packages/obsidian-publisher/src/agent/policies/history-intent.ts`
- Create: `packages/obsidian-publisher/src/agent/policies/recrawl.ts`
- Modify: `packages/obsidian-publisher/src/agent/history-intent.ts`
- Modify: `packages/obsidian-publisher/src/agent/recrawl-intent.ts`
- Test: `packages/obsidian-publisher/src/agent/history-intent.test.ts`
- Test: `packages/obsidian-publisher/src/agent/recrawl-intent.test.ts`

**Step 1: Write the failing test**

Add tests that import the policy modules from `agent/policies/` and verify existing history and recrawl behavior still matches current expectations.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec tsx --test packages/obsidian-publisher/src/agent/history-intent.test.ts packages/obsidian-publisher/src/agent/recrawl-intent.test.ts
```

Expected: FAIL because the new policy module paths do not exist yet.

**Step 3: Write minimal implementation**

Move deterministic policy logic behind `agent/policies/`, and keep existing top-level files as compatibility re-exports only if still needed by other modules.

**Step 4: Run test to verify it passes**

Run the same command.
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/agent/policies packages/obsidian-publisher/src/agent/history-intent.ts packages/obsidian-publisher/src/agent/recrawl-intent.ts packages/obsidian-publisher/src/agent/history-intent.test.ts packages/obsidian-publisher/src/agent/recrawl-intent.test.ts
git commit -m "refactor(agent): extract agent policy modules"
```

### Task 3: Add LangGraph node modules

**Files:**
- Create: `packages/obsidian-publisher/src/agent/nodes/parse-input.ts`
- Create: `packages/obsidian-publisher/src/agent/nodes/query-history.ts`
- Create: `packages/obsidian-publisher/src/agent/nodes/check-existing-save.ts`
- Create: `packages/obsidian-publisher/src/agent/nodes/route-content.ts`
- Create: `packages/obsidian-publisher/src/agent/nodes/crawl-article.ts`
- Create: `packages/obsidian-publisher/src/agent/nodes/transcribe-video.ts`
- Create: `packages/obsidian-publisher/src/agent/nodes/classify-folder.ts`
- Create: `packages/obsidian-publisher/src/agent/nodes/save-note.ts`
- Create: `packages/obsidian-publisher/src/agent/nodes/build-reply.ts`
- Test: `packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`

**Step 1: Write the failing test**

Add a test for one concrete branch, for example:

- article URL with cache hit

and assert that the new node-driven path returns the same reply shape and tool usage as before.

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`
Expected: FAIL because the nodes do not exist yet.

**Step 3: Write minimal implementation**

Each node should:

- accept `AgentGraphState`
- return a partial state update
- call existing tools/policies/helpers only

Avoid moving article/video/save business logic into nodes.

**Step 4: Run test to verify it passes**

Run the same command.
Expected: PASS for the new branch coverage.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/agent/nodes packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts
git commit -m "refactor(agent): add langgraph node modules"
```

### Task 4: Build the LangGraph orchestration

**Files:**
- Create: `packages/obsidian-publisher/src/agent/graph.ts`
- Modify: `packages/obsidian-publisher/src/agent/run-wechat-agent.ts`
- Test: `packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`

**Step 1: Write the failing test**

Add end-to-end branch tests covering:

- history query
- article URL normal crawl
- video URL route
- force recrawl

with the expectation that they execute through the graph entrypoint.

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`
Expected: FAIL because `graph.ts` is not wired yet.

**Step 3: Write minimal implementation**

Implement a LangGraph state graph with:

- input mode branch
- cache branch
- content type branch
- save path
- reply path

Make `run-wechat-agent.ts` a thin wrapper around graph invocation.

**Step 4: Run test to verify it passes**

Run the same command.
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/agent/graph.ts packages/obsidian-publisher/src/agent/run-wechat-agent.ts packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts
git commit -m "refactor(agent): orchestrate agent flow with langgraph"
```

### Task 5: Move prompts and reply policy into agent-local modules

**Files:**
- Create: `packages/obsidian-publisher/src/agent/prompts/classify-input.ts`
- Create: `packages/obsidian-publisher/src/agent/prompts/classify-folder.ts`
- Create: `packages/obsidian-publisher/src/agent/prompts/build-reply.ts`
- Modify: `packages/obsidian-publisher/src/agent/nodes/parse-input.ts`
- Modify: `packages/obsidian-publisher/src/agent/nodes/classify-folder.ts`
- Modify: `packages/obsidian-publisher/src/agent/nodes/build-reply.ts`
- Test: `packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`

**Step 1: Write the failing test**

Add tests that verify prompt-backed nodes still return deterministic-compatible output when model calls are stubbed.

**Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts`
Expected: FAIL because the prompt modules do not exist yet.

**Step 3: Write minimal implementation**

Move hardcoded prompt text and reply templates out of `run-wechat-agent.ts` and node files into `agent/prompts/`.

**Step 4: Run test to verify it passes**

Run the same command.
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/agent/prompts packages/obsidian-publisher/src/agent/nodes packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts
git commit -m "refactor(agent): extract prompt modules"
```

### Task 6: Full verification and cleanup

**Files:**
- Modify: `packages/obsidian-publisher/src/agent/run-wechat-agent.ts`
- Modify: `packages/obsidian-publisher/src/agent/*.test.ts`

**Step 1: Run focused verification**

Run:

```bash
pnpm exec tsx --test packages/obsidian-publisher/src/agent/history-intent.test.ts packages/obsidian-publisher/src/agent/recrawl-intent.test.ts packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts
```

Expected: PASS.

**Step 2: Run build**

Run: `pnpm build`
Expected: PASS.

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: PASS.

**Step 4: Final cleanup**

Remove any now-unused helper code from `run-wechat-agent.ts`, but do not change public behavior in this task.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/agent
git commit -m "refactor(agent): finish langgraph migration"
```
