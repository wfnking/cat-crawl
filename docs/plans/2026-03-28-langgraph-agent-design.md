# LangGraph Agent Design

**Scope:** `packages/obsidian-publisher/src/agent`

**Problem**

`run-wechat-agent.ts` currently mixes:

- input normalization
- history query intent detection
- recrawl policy
- article vs video routing
- dynamic folder classification
- save orchestration
- user reply formatting
- status update emission

This is no longer a good fit for a single function. The code still works, but the control flow is now the real complexity. Adding more features in the current shape will keep pushing branch logic and LLM calls into the same file.

**Decision**

Adopt `LangGraph` for agent orchestration, while keeping article crawling, video transcription, and Obsidian save logic outside the graph as existing tool and handler modules.

The graph will own:

- state
- branching
- retries/fallback boundaries
- node-level LLM usage

The graph will not own:

- article handler implementations
- video handler implementations
- save tool internals
- history store internals

## Architecture

### Directory Layout

```text
packages/obsidian-publisher/src/agent/
  graph.ts
  state.ts
  types.ts
  prompts/
    classify-input.ts
    classify-folder.ts
    build-reply.ts
  nodes/
    parse-input.ts
    query-history.ts
    check-existing-save.ts
    route-content.ts
    crawl-article.ts
    transcribe-video.ts
    classify-folder.ts
    save-note.ts
    build-reply.ts
  policies/
    history-intent.ts
    recrawl.ts
  services/
    status.ts
    memory.ts
  run-wechat-agent.ts
```

### Graph State

The graph state should be explicit and serializable. Minimum state:

```ts
type AgentGraphState = {
  userInput: string;
  context?: AgentRequestContext;
  usedTools: string[];
  mode: "history_query" | "small_chat" | "content_request";
  contentType?: "article" | "video";
  sourceUrl?: string;
  forceRecrawl: boolean;
  existingRecord?: ExistingSavedRecord | null;
  historyQuery?: HistoryIntent;
  crawlResult?: CrawlToolResult;
  transcribeResult?: TranscribeVideoToolResult;
  dynamicFolder?: string;
  saveResult?: SaveToolResult;
  reply?: string;
  error?: string;
};
```

### Nodes

#### `parse-input`

Responsibilities:

- normalize input
- detect capability/help requests
- detect history query
- detect force recrawl
- extract URL
- detect content type

Rules:

- deterministic first
- LLM only used when regex/policy result is ambiguous

#### `query-history`

Responsibilities:

- call `query_success_history`
- return a formatted result payload

#### `check-existing-save`

Responsibilities:

- call `findExistingSavedRecordByUrl`
- short-circuit only when `forceRecrawl === false`

#### `route-content`

Responsibilities:

- choose `article` or `video`
- no LLM

#### `crawl-article`

Responsibilities:

- call `crawl_web_article`
- store structured result

#### `transcribe-video`

Responsibilities:

- call `transcribe_video`
- store structured result

#### `classify-folder`

Responsibilities:

- call LLM only if dynamic folder options are configured
- classify based on content summary, not raw user input

#### `save-note`

Responsibilities:

- call `save_to_obsidian`
- persist history only after successful save

#### `build-reply`

Responsibilities:

- generate the final user-facing response
- deterministic skeleton first
- optional LLM polish later

## Routing

```text
START
  -> parse-input
  -> mode branch
     - history_query -> query-history -> build-reply -> END
     - small_chat -> build-reply -> END
     - content_request -> check-existing-save
  -> cache branch
     - cached -> build-reply -> END
     - continue -> route-content
  -> content branch
     - article -> crawl-article
     - video -> transcribe-video
  -> classify-folder
  -> save-note
  -> build-reply
  -> END
```

## LLM Boundaries

The graph should not treat LLM as the primary controller.

Use LLM for:

- ambiguous intent normalization
- dynamic folder classification
- optional final reply wording

Do not use LLM for:

- duplicate detection
- tool routing
- save policy
- cache lookup
- URL extraction

## Migration Strategy

### Phase 1

Rebuild the current `run-wechat-agent` behavior inside LangGraph without changing business behavior.

### Phase 2

Move hardcoded prompts and formatting into `prompts/` and `nodes/`.

### Phase 3

Clean up remaining regex/prompt duplication and add graph-level tests.

## Testing Strategy

Add tests at three levels:

1. unit tests for node helpers
2. graph tests for branch behavior
3. keep current `run-wechat-agent.test.ts` as compatibility coverage during migration

Critical scenarios:

- help/capability request
- history query all
- history query by tag
- article URL normal crawl
- article URL cache hit
- article URL force recrawl
- video URL route
- dynamic folder classification skipped when no options exist
- save failure reply path

## Non-Goals

- changing article handler behavior
- changing video handler behavior
- changing save-to-obsidian schema
- adding thread/reply extraction
- replacing all deterministic logic with LLM

## Recommendation

Use `LangGraph` now, but keep the graph thin. The graph should express orchestration, not replace deterministic business policies.
