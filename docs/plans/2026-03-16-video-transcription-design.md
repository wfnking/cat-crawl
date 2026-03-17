# Video Transcription Design

**Date:** 2026-03-16

**Goal:** Add a general video transcription pipeline to `cat-crawl` that can accept Douyin URLs,
YouTube URLs, and local media files, then transcribe speech and save the result into Obsidian.

## Scope

This design adds a new transcription capability without changing the existing article crawling flow.

First version scope:

- Support three input types:
  - Douyin video URL
  - YouTube video URL
  - Local media file path
- Normalize all inputs into a local media file before transcription
- Extract audio with `ffmpeg`
- Use local `whisper.cpp` first
- Fallback to Gemini transcription when local transcription is unavailable or fails
- Reuse the existing Obsidian saving flow

Out of scope for first version:

- OCR of burned-in subtitles
- Livestream or realtime transcription
- Generic support for arbitrary video websites
- Full subtitle editing or SRT export

## Product Decisions

### Unified Entry Point

Add one new tool: `transcribe_video`.

The tool should accept a single `source` input and decide internally how to handle it:

- Douyin URL -> Douyin adapter
- YouTube URL -> YouTube adapter
- Local path -> local file adapter

This keeps the public interface stable while allowing source-specific extraction logic under the
hood.

### Provider Strategy

The default transcription strategy is:

1. `whisper.cpp`
2. Gemini fallback

If the caller explicitly chooses a provider, automatic fallback should be disabled.

Reasoning:

- Local `whisper.cpp` is effectively free after setup
- Gemini is useful as a recovery path when local binaries, models, or output quality fail
- Silent fallback should only happen when the user did not force a provider

### Language Handling

`WHISPER_CPP_LANGUAGE` should be optional.

- If not configured, `whisper.cpp` should auto-detect language
- If configured, it should force that language
- Tool input may override config for one-off cases

Reasoning:

- Video language is not stable across sources
- Auto-detection is the right default
- Explicit override remains valuable for short or mixed-language clips

## Source Adapter Design

### Douyin

Douyin should not use `yt-dlp` as the default path.

Instead:

- Open the share URL in Playwright
- Resolve redirects and wait for the real page state
- Capture the actual video resource URL or API response used by the page
- Download the media file locally

Reasoning:

- Douyin anti-bot behavior changes frequently
- Browser state is often necessary
- The project already depends on Playwright, so this is a good fit

### YouTube

YouTube should use `yt-dlp` in the first version.

Reasoning:

- It is the shortest path to a reliable downloadable file
- It avoids spending implementation time on a site we do not need browser-level control for yet

### Local File

If the source is a local file path, skip download and use it directly.

Reasoning:

- This gives us a stable testing path
- It reduces coupling between transcription and network scraping

## Pipeline Design

The internal pipeline should be:

1. Resolve source adapter
2. Produce local media file
3. Extract audio to local temp file with `ffmpeg`
4. Run transcription provider
5. Normalize transcript output
6. Save to Obsidian when requested

Standard output shape:

```json
{
  "title": "Video title",
  "source_url": "https://example.com/video",
  "provider_used": "whisper_cpp",
  "language": "zh",
  "transcript_markdown": "# Video title\n\nTranscript..."
}
```

## Configuration Design

Continue using the current config hierarchy:

- `~/.cat-crawl/config.json`
- `.env` as override

New config group:

```json
{
  "transcription": {
    "provider": "whisper_cpp",
    "fallbackProvider": "gemini",
    "whisperCpp": {
      "bin": "whisper-cli",
      "modelPath": "/path/to/model.bin"
    },
    "gemini": {
      "apiKey": "AIza...",
      "model": "gemini-3.1-flash-lite-preview"
    }
  }
}
```

Suggested env keys:

- `TRANSCRIPTION_PROVIDER`
- `TRANSCRIPTION_FALLBACK_PROVIDER`
- `WHISPER_CPP_BIN`
- `WHISPER_CPP_MODEL_PATH`
- `WHISPER_CPP_LANGUAGE`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

## Failure Handling

### Source Resolution Failures

- Unsupported source -> explicit error
- Douyin page loads but no video URL found -> explicit error
- `yt-dlp` missing for YouTube -> explicit error

### Audio Extraction Failures

- `ffmpeg` missing -> explicit error with install guidance
- extracted audio file empty -> fail fast

### Provider Failures

Fallback to Gemini only when:

- `whisper.cpp` binary missing
- model file missing
- command exits non-zero
- command produces empty transcript

Do not fallback when:

- user explicitly selected `whisper_cpp`
- Gemini is not configured

### Logging

Logs should include:

- source type selected
- download path
- audio extraction path
- provider chosen
- whether fallback happened

Logs must not include:

- raw API keys
- large transcript payloads

## Code Placement

Planned files:

- Modify: `packages/obsidian-publisher/src/config/env.ts`
- Create: `packages/obsidian-publisher/src/tools/transcribe-video.ts`
- Create: `packages/obsidian-publisher/src/services/video-sources/douyin.ts`
- Create: `packages/obsidian-publisher/src/services/video-sources/youtube.ts`
- Create: `packages/obsidian-publisher/src/services/video-sources/file.ts`
- Create: `packages/obsidian-publisher/src/services/transcription/whisper-cpp.ts`
- Create: `packages/obsidian-publisher/src/services/transcription/gemini.ts`
- Modify: `packages/obsidian-publisher/src/agent/run-wechat-agent.ts`

## Testing Strategy

First version test focus:

- config parsing for transcription provider settings
- source adapter selection
- fallback behavior from `whisper.cpp` to Gemini
- transcript normalization
- save-to-obsidian integration path

Use mocks for:

- Playwright network/video extraction
- `yt-dlp`
- `ffmpeg`
- external Gemini requests

Keep at least one local-file path test as the simplest end-to-end entry point.
