# Source Re-crawl Memory Design

## Goal

Keep the existing "same source already saved" check, but make follow-up messages like "继续抓取" reuse the prior source from chat memory so the user can explicitly re-crawl without pasting the URL again.

## Recommended Approach

### Option A: Reuse existing chat memory plus LLM intent check

- Keep the current source-level duplicate check in the graph.
- When a request hits an existing source, reply with a short prompt telling the user they can say "继续抓取" to re-crawl.
- Store that exchange in the existing session memory.
- On the next message without a URL, ask the model whether the user is referring to the most recent URL in memory and wants to continue anyway.
- If yes, reuse the last URL found in recent memory and set `forceRecrawl=true`.

Why this is the best fit:

- Minimal code.
- No dedicated confirmation state machine.
- Preserves the current "LLM decides from context" behavior the user asked for.
- Reuses the memory module that already exists instead of inventing another persistence layer.

### Option B: Explicit pending-confirmation state

- Persist a dedicated `pendingRecrawl` flag and source URL per session.

Trade-off:

- More deterministic, but more code and more state transitions than needed.

### Option C: Persist confirmation state in history/database

- Record a durable pending action keyed by user/session.

Trade-off:

- Strongest durability, but unnecessary complexity for a conversational follow-up.

## Accepted Design

- Use Option A.
- Add a small helper in the graph to infer a follow-up recrawl from recent conversation history.
- Use the most recent URL from memory as the reusable source.
- Keep the existing explicit override phrases like `重新抓取` working as they do today.
- Update the duplicate reply so it tells the user they can continue with a follow-up message.

## Markdown Formatting Fix

- Keep save-time behavior simple and avoid post-processing markdown.
- Tighten the transcript-generation prompt so the model must leave a blank line between a chapter heading and the following paragraph.
- Let LLM output quality, not save-time normalization, enforce the formatting rule.

## Testing

- Add a failing `run-agent` test that:
  - first sends a URL that resolves to an existing record,
  - then sends a follow-up like `继续抓取`,
  - and expects the previous source to be re-crawled and saved.
- Add a failing `save-to-obsidian` test that verifies a blank line is inserted between an opening heading and body text.
