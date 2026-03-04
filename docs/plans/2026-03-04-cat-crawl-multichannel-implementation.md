# cat-crawl Multi-Channel + History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Telegram/Discord channel support, persist successful crawl history under `~/.cat-crawl`, and expose an agent tool to query success history.

**Architecture:** Keep one shared agent pipeline and add channel adapters (Feishu/Telegram/Discord/CLI). Persist success records in local SQLite and provide a dedicated `query_success_history` tool used by the agent for history intents.

**Tech Stack:** TypeScript, LangChain, Playwright, Discord.js, SQLite (`better-sqlite3`), Node HTTP server.

---

### Task 1: Add failing tests for history persistence and query behaviors

**Files:**
- Create: `src/history/history-store.test.ts`
- Create: `src/tools/query-success-history.test.ts`
- Modify: `package.json`

**Step 1: Write the failing tests**

```ts
// src/history/history-store.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("records successful save and can query today", () => {
  // TODO: call insert + query APIs, assert one record exists
});
```

```ts
// src/tools/query-success-history.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("query_success_history filters by tag", async () => {
  // TODO: seed records then invoke tool with tag and assert filtered result
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL due to missing modules/APIs.

**Step 3: Add minimal test runner wiring**

```json
{
  "scripts": {
    "test": "tsx --test src/**/*.test.ts"
  }
}
```

**Step 4: Re-run tests and confirm RED state**

Run: `pnpm test`
Expected: FAIL with implementation missing assertions or import errors.

### Task 2: Implement local history store in `~/.cat-crawl`

**Files:**
- Create: `src/history/history-store.ts`
- Modify: `src/config/env.ts`

**Step 1: Write minimal API to initialize DB and schema**

```ts
export function getHistoryStore() {
  // open ~/.cat-crawl/history.db and create table/indexes if needed
}
```

**Step 2: Implement insert + query methods**

```ts
insertSuccessRecord(record)
querySuccessRecords({ scope, tag, limit })
```

**Step 3: Run tests for Task 1 files**

Run: `pnpm test src/history/history-store.test.ts src/tools/query-success-history.test.ts`
Expected: PASS.

### Task 3: Implement `query_success_history` agent tool

**Files:**
- Create: `src/tools/query-success-history.ts`
- Modify: `src/agent/run-wechat-agent.ts`

**Step 1: Add tool schema and formatter**

```ts
scope: z.enum(["all", "today"])
tag: z.string().optional()
limit: z.number().int().min(1).max(100)
```

**Step 2: Add history intent detection in agent**

- Detect history intent via model-assisted JSON parse with regex fallback.
- On hit: invoke `query_success_history` and return formatted text reply.

**Step 3: Keep existing small chat fallback unchanged**

Run: `pnpm test`
Expected: PASS with new history tests.

### Task 4: Persist success records after Obsidian save

**Files:**
- Modify: `src/agent/run-wechat-agent.ts`

**Step 1: Build success record from crawl/save outputs**

- Include `created_at/source/channel/source_url/title/tags/vault/path/dynamic_folder`.

**Step 2: Insert record in non-blocking safe path**

- Log insert errors; never throw to user flow.

**Step 3: Add/adjust tests**

Run: `pnpm test`
Expected: PASS and coverage for persistence path.

### Task 5: Add Telegram webhook channel

**Files:**
- Create: `src/channels/telegram-webhook.ts`
- Modify: `src/index.ts`
- Modify: `src/config/env.ts`

**Step 1: Add env vars + parser**

- `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_PATH`, `TELEGRAM_WEBHOOK_SECRET`, `WEBHOOK_PORT`, `WEBHOOK_HOST`.

**Step 2: Implement HTTP webhook endpoint + reply**

- Parse Telegram update, extract text, call agent, send `sendMessage`.

**Step 3: Add basic tests for parsing utility (if extracted)**

Run: `pnpm test`
Expected: PASS.

### Task 6: Add Discord text channel via Gateway

**Files:**
- Create: `src/channels/discord-bridge.ts`
- Modify: `src/index.ts`
- Modify: `src/config/env.ts`
- Modify: `package.json`

**Step 1: Add `DISCORD_ENABLED` + `DISCORD_BOT_TOKEN`**

**Step 2: Implement `messageCreate` handling**

- Ignore bot messages; call agent with context channel `discord`; reply with chunked messages.

**Step 3: Validate typecheck and tests**

Run: `pnpm build && pnpm test`
Expected: PASS.

### Task 7: npm + brew release scaffolding

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create: `Formula/cat-crawl.rb`

**Step 1: Make package publishable**

- Add `bin`, `main`, `files`, `engines`, `prepublishOnly`; remove `private`.

**Step 2: Add release docs**

- npm publish steps and brew tap/formula usage.

**Step 3: Add formula template**

- Placeholder URL/SHA with clear replacement instructions.

**Step 4: Verify packaging**

Run: `pnpm build && npm pack --dry-run`
Expected: tarball includes dist + README + env template.

### Task 8: Final verification

**Files:**
- Modify: `.env.example`

**Step 1: Add all new env examples**

**Step 2: Run full verification**

Run: `pnpm build && pnpm test && npm pack --dry-run`
Expected: all pass.

**Step 3: Summarize changed files and usage commands**

