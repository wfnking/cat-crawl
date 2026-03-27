# X Video Post Transcription Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let X/Twitter posts with one native video produce merged markdown containing tweet text, a video summary, and the full transcript.

**Architecture:** Keep `crawl_web_article` as the public entry point. Extend the X adapter to first fetch tweet text using the existing oEmbed flow, then opportunistically resolve a native video, transcribe it through the existing media/transcription helpers, and append the result to the markdown body. If video handling fails, return the tweet-only result.

**Tech Stack:** TypeScript, Playwright, existing X crawler code, `ffmpeg`, local `whisper.cpp`, existing chapter summarization helpers.

---

### Task 1: Add a failing crawl test for X posts with video

**Files:**
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
- Test: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`

**Step 1: Write the failing test**

Add a targeted test that proves X post markdown should include:
- `## Tweet`
- `## Video Summary`
- `## Transcript`

Use dependency injection or a small exported helper so the test does not depend on live X pages.

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
```

Expected: FAIL because X posts do not yet append transcript content.

**Step 3: Write minimal implementation**

Add only the test hook needed to express the behavior clearly.

**Step 4: Run test to verify it passes**

Run the same command and confirm the new test passes.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/tools/crawl-web-article.test.ts packages/obsidian-publisher/src/tools/crawl-web-article.ts
git commit -m "test(x): cover native video post markdown"
```

### Task 2: Add X native video source resolution

**Files:**
- Create: `packages/obsidian-publisher/src/services/video-sources/x.ts`
- Test: `packages/obsidian-publisher/src/services/video-sources/x.test.ts`

**Step 1: Write the failing test**

Cover:
- selecting the first usable native video candidate
- returning normalized tweet source URL and downloaded media path
- ignoring non-video or empty candidates

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm exec tsx --test packages/obsidian-publisher/src/services/video-sources/x.test.ts
```

Expected: FAIL because the resolver does not exist yet.

**Step 3: Write minimal implementation**

Create an X-specific resolver that inspects the status page and downloads the first native video candidate to a temp file.

**Step 4: Run test to verify it passes**

Run the same command and confirm PASS.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/services/video-sources/x.ts packages/obsidian-publisher/src/services/video-sources/x.test.ts
git commit -m "feat(x): add native video resolver"
```

### Task 3: Reuse transcription helpers inside the X crawl path

**Files:**
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.ts`
- Test: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`

**Step 1: Write the failing test**

Add a focused test proving that when the X resolver returns a media file and transcription result, the crawler appends both summary and transcript sections after the tweet body.

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm exec tsx --test packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
```

Expected: FAIL because the merge logic is absent.

**Step 3: Write minimal implementation**

Wire the X path to:
- resolve native video
- extract audio
- transcribe audio
- generate readable chapter markdown
- append `## Tweet`, `## Video Summary`, and `## Transcript`

Keep all failures non-fatal after tweet text is available.

**Step 4: Run test to verify it passes**

Run the same command and confirm PASS.

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/tools/crawl-web-article.ts packages/obsidian-publisher/src/tools/crawl-web-article.test.ts
git commit -m "feat(x): append transcript to native video posts"
```

### Task 4: Verify regression safety and live smoke behavior

**Files:**
- Modify only if verification reveals a defect

**Step 1: Run targeted tests**

Run:
```bash
pnpm exec tsx --test \
  packages/obsidian-publisher/src/tools/crawl-web-article.test.ts \
  packages/obsidian-publisher/src/services/video-sources/x.test.ts
```

Expected: PASS.

**Step 2: Run full package tests**

Run:
```bash
pnpm test
```

Expected: PASS with no new failures.

**Step 3: Run a live smoke test**

Run a one-off invocation against the provided X post URL and confirm the result contains tweet text plus transcript sections.

**Step 4: Commit final polish if needed**

```bash
git add <relevant files>
git commit -m "fix(x): polish native video transcript flow"
```
