# X Video Post Transcription Design

**Date:** 2026-03-27

**Goal:** Extend X/Twitter post crawling so a post with one native video can produce a single note containing the tweet text, a chapterized video summary, and the full transcript.

## Scope

This change only covers X posts that contain one native video.

In scope:
- `x.com` / `twitter.com` status URLs
- native video attached to the post
- transcript generation through the existing local transcription pipeline
- merged markdown output in one saved note

Out of scope:
- Spaces
- GIF posts
- external video links
- multi-video posts beyond selecting the first usable video
- OCR of burned-in subtitles

## Product Decisions

### Unified Output

The saved markdown should remain a single article-style note. For X posts with video, the content order should be:

1. tweet text
2. video summary in the existing chapterized style
3. full transcript

Reasoning:
- users asked for one note, not separate tweet and transcript files
- current save flow already expects one markdown payload
- chapterized output should stay consistent with YouTube and Douyin notes

### Fallback Behavior

If the tweet body is available but video extraction or transcription fails, the crawl should still succeed as a normal X post.

Reasoning:
- tweet text is still useful on its own
- media extraction is the unstable part of the pipeline
- we should not regress the current X article crawler

## Architecture

### Crawl Layer

Keep `crawl_web_article` as the entry point.

For adapter `x`:
- keep the current oEmbed-based text extraction for tweet body
- add a second step that inspects the status page for native video metadata only when needed
- if a video is found, download the media, extract audio, transcribe it, and append the result to the existing markdown body

This keeps X-specific behavior encapsulated inside the X crawler path and avoids adding new agent branching.

### Media Resolution

Add a small X video resolver under `packages/obsidian-publisher/src/services/video-sources/`.

Responsibilities:
- open the status page with Playwright
- detect native video URLs from DOM or structured page data
- choose the first usable video candidate
- download it to a temporary local path
- return source URL, media path, and minimal metadata

This should reuse the same temporary directory and download conventions as other video adapters where practical.

### Transcription Reuse

Do not duplicate the transcription stack.

Reuse existing helpers for:
- audio extraction
- whisper.cpp invocation
- chapter summarization and readable markdown generation

The X integration should call those helpers directly rather than shelling back through a second public tool.

## Output Shape

For X posts with video, markdown should look like:

```md
# <tweet title>

- Source: <tweet url>
- Author: @handle
- Published: YYYY-MM-DD

## Tweet

<tweet body>

## Video Summary

<chapterized summary markdown>

## Transcript

<full transcript text>
```

If no video is detected, keep the current X output unchanged.

## Failure Handling

- Tweet text extraction fails: existing X crawl error path remains
- Video lookup fails: log and continue with tweet-only output
- Download fails: log and continue with tweet-only output
- Transcription fails: log and continue with tweet-only output

Logs should include:
- whether native video was detected
- media download path
- transcription provider used
- whether transcript append succeeded

Logs must not include:
- cookies
- raw large transcript payloads

## Code Placement

Planned files:
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.ts`
- Modify: `packages/obsidian-publisher/src/tools/crawl-web-article.test.ts`
- Create: `packages/obsidian-publisher/src/services/video-sources/x.ts`
- Create or modify tests under `packages/obsidian-publisher/src/services/video-sources/`
- Reuse: `packages/obsidian-publisher/src/services/media/extract-audio.ts`
- Reuse: `packages/obsidian-publisher/src/services/transcription/index.ts`
- Reuse: `packages/obsidian-publisher/src/services/video-chapters.ts`
