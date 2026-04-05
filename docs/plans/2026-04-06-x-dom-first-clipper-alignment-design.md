# X DOM-First Clipper Alignment Design

## Background

`cat-crawl` currently handles X posts with a split pipeline:

- Main post content comes from `fxtwitter`
- Replies come from Playwright DOM scraping

This makes the output inconsistent. The main post looks like API text converted into Markdown, while replies look like browser-extracted page content. The result differs from Obsidian Web Clipper, which is built around Defuddle and site-specific DOM extraction with async fallback when DOM content is incomplete.

## Goal

Make X extraction in `cat-crawl` feel closer to Obsidian Web Clipper by preferring the rendered page DOM for thread content and only using `fxtwitter` as a fallback or metadata patch source.

## Non-goals

- Reproducing Obsidian Web Clipper output byte-for-byte
- Importing Defuddle wholesale into `cat-crawl`
- Expanding reply depth beyond the current practical limit

## Chosen Approach

Use a DOM-first extraction pipeline for X:

1. Open the post page in Playwright with the existing cookie-loading logic.
2. Extract the main post, quoted post, media, and a small number of replies from the rendered DOM.
3. Build a normalized thread representation from DOM data.
4. If the DOM result is incomplete or empty, fall back to `fxtwitter`.
5. If DOM succeeds but key metadata is missing, patch those specific fields from `fxtwitter`.

## Why This Approach

- It aligns with Web Clipper and Defuddle, which are page-first and use async extractors as fallback.
- It keeps the best part of the current implementation: `fxtwitter` is still available for resilience.
- It avoids a large dependency or architecture transplant.
- It gives us one dominant source of truth for main post, quoted post, replies, and media.

## Extraction Rules

### Main content

- Prefer the conversation timeline DOM.
- Use the first `article[data-testid="tweet"]` as the main post when the timeline is present.
- Fall back to the first tweet article on the page when timeline markup is absent.

### Tweet text

- Preserve paragraph breaks.
- Preserve inline links as links where possible.
- Convert emoji images into plain text.
- Avoid duplicate text when the same post appears in multiple page regions.

### Metadata

- Prefer DOM author, handle, permalink, and timestamp.
- Use `fxtwitter` to patch only missing fields.

### Media

- Include photo media from the main tweet.
- Skip quoted-tweet media when it would duplicate nested quoted content.

### Replies

- Keep the current reply limit at three.
- Deduplicate by normalized permalink and normalized text.
- Stop before recommendation or “discover more” regions if identifiable.

### Fallback

- If DOM extraction yields no usable main post text, use the existing `fxtwitter` flow.
- If both DOM and `fxtwitter` fail, keep the existing browser adapter fallback.

## Testing Strategy

- Add tests for DOM-first behavior using stubbed browser results.
- Verify that DOM content wins over `fxtwitter` when present.
- Verify that `fxtwitter` still fills missing author or published fields.
- Verify that empty DOM results still fall back to `fxtwitter`.
- Keep existing reply-limit behavior covered.

## Files Expected To Change

- `packages/obsidian-publisher/src/ingest/article/handlers/x.ts`
- `packages/obsidian-publisher/src/ingest/article/handlers/x.test.ts`
- `docs/plans/2026-04-06-x-dom-first-clipper-alignment-design.md`
- `docs/plans/2026-04-06-x-dom-first-clipper-alignment.md`
