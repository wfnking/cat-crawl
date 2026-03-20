# Video Transcription Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Build a general video transcription flow for Douyin URLs, YouTube URLs, and local media
files using `whisper.cpp` first and Gemini fallback.

**Architecture:** Introduce a new `transcribe_video` tool that resolves a source adapter, produces a
local media file, extracts audio with `ffmpeg`, and then sends the audio through a provider
abstraction. The first provider is local `whisper.cpp`, with Gemini as optional fallback. The
transcript output then reuses the existing Obsidian save pipeline.

**Tech Stack:** TypeScript, Playwright, `ffmpeg`, `yt-dlp`, local `whisper.cpp`, Gemini API,
existing `cat-crawl` config store and Obsidian publisher package.

---

### Task 1: Extend transcription configuration

**Files:**

- Modify: `packages/obsidian-publisher/src/config/env.ts`
- Modify: `.env.example`
- Test: `packages/obsidian-publisher/src/config/env.test.ts` or new targeted config test file

**Step 1: Write the failing test**

Add tests for:

- `TRANSCRIPTION_PROVIDER`
- `TRANSCRIPTION_FALLBACK_PROVIDER`
- `WHISPER_CPP_BIN`
- `WHISPER_CPP_MODEL_PATH`
- optional `WHISPER_CPP_LANGUAGE`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/config/*.test.ts
```

Expected: FAIL because transcription config is not exposed yet.

**Step 3: Write minimal implementation**

Update `AppEnv`, structured config path mappings, and `loadEnv()` to expose transcription config.

Default values:

- `transcriptionProvider = whisper_cpp`
- `transcriptionFallbackProvider = gemini`
- `geminiModel = gemini-3.1-flash-lite-preview`
- `whisperCppLanguage` optional

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/config/*.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/config/env.ts .env.example
git commit -m "feat(transcription): add provider config"
```

### Task 2: Add source adapter selection

**Files:**

- Create: `packages/obsidian-publisher/src/services/video-sources/index.ts`
- Create: `packages/obsidian-publisher/src/services/video-sources/file.ts`
- Create: `packages/obsidian-publisher/src/services/video-sources/youtube.ts`
- Create: `packages/obsidian-publisher/src/services/video-sources/douyin.ts`
- Test: `packages/obsidian-publisher/src/services/video-sources/index.test.ts`

**Step 1: Write the failing test**

Cover:

- local path selects `file`
- YouTube URL selects `youtube`
- Douyin URL selects `douyin`
- unsupported URL throws

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/video-sources/index.test.ts
```

Expected: FAIL because selector does not exist.

**Step 3: Write minimal implementation**

Create a small adapter registry with explicit hostname checks. Do not implement full download logic
yet.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/video-sources/index.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/services/video-sources
git commit -m "feat(transcription): add video source adapter selection"
```

### Task 3: Implement YouTube file resolution with `yt-dlp`

**Files:**

- Modify: `packages/obsidian-publisher/src/services/video-sources/youtube.ts`
- Test: `packages/obsidian-publisher/src/services/video-sources/youtube.test.ts`

**Step 1: Write the failing test**

Mock command execution and cover:

- successful local media file output
- missing `yt-dlp`
- command failure

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/video-sources/youtube.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Wrap `yt-dlp` in a small helper that downloads to a temporary path and returns metadata plus local
file path.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/video-sources/youtube.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/services/video-sources/youtube.ts packages/obsidian-publisher/src/services/video-sources/youtube.test.ts
git commit -m "feat(transcription): add youtube downloader"
```

### Task 4: Implement Douyin file resolution with Playwright

**Files:**

- Modify: `packages/obsidian-publisher/src/services/video-sources/douyin.ts`
- Test: `packages/obsidian-publisher/src/services/video-sources/douyin.test.ts`

**Step 1: Write the failing test**

Mock Playwright behavior and cover:

- redirect/share URL resolution
- successful media URL extraction
- page loads but no downloadable video found

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/video-sources/douyin.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Launch Playwright, load the Douyin page, inspect network responses or DOM-driven media URLs, then
download the selected media file to temp storage.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/video-sources/douyin.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/services/video-sources/douyin.ts packages/obsidian-publisher/src/services/video-sources/douyin.test.ts
git commit -m "feat(transcription): add douyin downloader"
```

### Task 5: Add audio extraction helper

**Files:**

- Create: `packages/obsidian-publisher/src/services/media/extract-audio.ts`
- Test: `packages/obsidian-publisher/src/services/media/extract-audio.test.ts`

**Step 1: Write the failing test**

Cover:

- successful audio extraction command generation
- missing `ffmpeg`
- empty output file handling

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/media/extract-audio.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Use `ffmpeg` to generate a deterministic audio file path in temp storage and validate that the
output exists and is non-empty.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/media/extract-audio.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/services/media/extract-audio.ts packages/obsidian-publisher/src/services/media/extract-audio.test.ts
git commit -m "feat(transcription): add audio extraction helper"
```

### Task 6: Add `whisper.cpp` provider

**Files:**

- Create: `packages/obsidian-publisher/src/services/transcription/whisper-cpp.ts`
- Test: `packages/obsidian-publisher/src/services/transcription/whisper-cpp.test.ts`

**Step 1: Write the failing test**

Cover:

- command generation with required model path
- optional language flag omitted by default
- language flag included when configured
- command failure returns a structured provider error

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/transcription/whisper-cpp.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Wrap `whisper.cpp` CLI execution and parse transcript output into a normalized string result.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/transcription/whisper-cpp.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/services/transcription/whisper-cpp.ts packages/obsidian-publisher/src/services/transcription/whisper-cpp.test.ts
git commit -m "feat(transcription): add whisper cpp provider"
```

### Task 7: Add Gemini transcription provider

**Files:**

- Create: `packages/obsidian-publisher/src/services/transcription/gemini.ts`
- Test: `packages/obsidian-publisher/src/services/transcription/gemini.test.ts`

**Step 1: Write the failing test**

Cover:

- upload + generate flow using configured API key
- default model `gemini-3.1-flash-lite-preview`
- provider error normalization

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/transcription/gemini.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Create a small Gemini client wrapper that uploads the audio file and requests a transcript.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/transcription/gemini.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/services/transcription/gemini.ts packages/obsidian-publisher/src/services/transcription/gemini.test.ts
git commit -m "feat(transcription): add gemini fallback provider"
```

### Task 8: Compose providers with fallback rules

**Files:**

- Create: `packages/obsidian-publisher/src/services/transcription/index.ts`
- Test: `packages/obsidian-publisher/src/services/transcription/index.test.ts`

**Step 1: Write the failing test**

Cover:

- default provider selection from config
- fallback from `whisper.cpp` to Gemini
- explicit provider disables fallback
- Gemini not configured returns explicit error

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/transcription/index.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Compose the provider wrappers and return a normalized result with `providerUsed` and optional
fallback metadata.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/services/transcription/index.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/services/transcription/index.ts packages/obsidian-publisher/src/services/transcription/index.test.ts
git commit -m "feat(transcription): add provider fallback orchestration"
```

### Task 9: Add `transcribe_video` tool

**Files:**

- Create: `packages/obsidian-publisher/src/tools/transcribe-video.ts`
- Test: `packages/obsidian-publisher/src/tools/transcribe-video.test.ts`

**Step 1: Write the failing test**

Cover:

- local file source path
- adapter invocation
- transcript markdown formatting
- save disabled path

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/tools/transcribe-video.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Wire source adapter + audio extraction + provider selection into a single tool with normalized
output.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/tools/transcribe-video.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/tools/transcribe-video.ts packages/obsidian-publisher/src/tools/transcribe-video.test.ts
git commit -m "feat(transcription): add transcribe video tool"
```

### Task 10: Integrate transcript saving with the agent flow

**Files:**

- Modify: `packages/obsidian-publisher/src/agent/run-wechat-agent.ts`
- Modify: `packages/obsidian-publisher/src/utils/text.ts`
- Test: `packages/obsidian-publisher/src/agent/run-wechat-agent.test.ts` or new targeted tests

**Step 1: Write the failing test**

Cover:

- video URL triggers `transcribe_video`
- transcript result is saved with existing Obsidian save tool
- unsupported URL still follows existing non-article behavior

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/agent/*.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Extend URL detection logic and branch video sources into the new tool path without disturbing
article flow.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- packages/obsidian-publisher/src/agent/*.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/obsidian-publisher/src/agent/run-wechat-agent.ts packages/obsidian-publisher/src/utils/text.ts
git commit -m "feat(transcription): connect video transcripts to agent flow"
```

### Task 11: Run full verification and document setup

**Files:**

- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Add setup documentation**

Document:

- required local tools: `ffmpeg`, `whisper.cpp`, `yt-dlp`
- Douyin uses Playwright
- Gemini fallback config

**Step 2: Run focused and full verification**

Run:

```bash
pnpm build
pnpm test
```

Expected: PASS

**Step 3: Final commit**

```bash
git add README.md .env.example
git commit -m "docs(transcription): document video transcription setup"
```
