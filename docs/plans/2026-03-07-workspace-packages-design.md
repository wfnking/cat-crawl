# Workspace Package Refactor Design

## Goal

Convert the repository into a pnpm workspace that separates the two product lines into packages:

- `packages/obsidian-publisher`
- `packages/case-study`

while preserving the current CLI experience.

## Scope

This refactor is intentionally incremental.

Included in this phase:
- add real pnpm workspace package globs
- move case-study code into its own package
- move WeChat to Obsidian publishing logic into its own package
- keep the root CLI as the executable entrypoint for now
- keep tests and build working from the repo root

Explicitly deferred:
- extracting a separate `core` package
- publishing packages independently
- changing user-facing commands
- large config API redesign

## Recommended Approach

### Option 1: Full monorepo split with `apps/cli` and package-name imports

Pros:
- cleanest final architecture
- package boundaries enforced immediately

Cons:
- highest churn now
- TypeScript/project-reference setup is heavier
- likely to break build and local dev while importing workspace packages before full infra is in place

### Option 2: Workspace packages plus root CLI shell

Pros:
- gives package boundaries immediately
- lower migration risk
- preserves current build and runtime flow
- easy next step toward `apps/cli` later

Cons:
- root package still acts as CLI shell
- imports may remain relative for one phase

### Option 3: Keep current layout and only add package manifests

Pros:
- lowest immediate work

Cons:
- mostly cosmetic
- does not create real package boundaries

## Decision

Use Option 2.

The repo becomes a workspace with root CLI orchestration and two real feature packages. This captures the value of package separation now without paying the full project-reference cost in one change.

## Target Layout

```text
packages/
  obsidian-publisher/
    package.json
    src/
      agent/
      channels/
      config/
      history/
      services/
      tools/
      utils/
      index.ts
  case-study/
    package.json
    src/
      ...
      index.ts
src/
  index.ts
pnpm-workspace.yaml
```

## Data and Dependency Boundaries

### `packages/obsidian-publisher`

Owns:
- article crawling
- Obsidian save flow
- save history
- folder policy
- telegram/discord/feishu channel runtime
- agent execution
- local config and pairing logic

### `packages/case-study`

Owns:
- capture
- extract
- build
- serve
- file-backed case-study schema

### Root CLI

Owns:
- executable entrypoint
- command dispatch
- usage text
- composition of the two packages

## Build Strategy

Use a root TypeScript build for this phase.

Reason:
- lower migration risk
- keeps output layout deterministic
- avoids introducing project references and workspace package resolution changes in the same refactor

The build will compile:
- `src/**/*.ts`
- `packages/**/*.ts`

into a shared `dist/` tree.

## Testing Strategy

Root test command continues to be the source of truth.

It will run tests from:
- `src/**/*.test.ts`
- `packages/**/*.test.ts`

The refactor is acceptable only if root `pnpm test` and `pnpm build` stay green.

## Risks

### Import-path breakage

Moving modules changes deep relative imports. Mitigation:
- move by domain directories, not file-by-file random shuffling
- add package-level `src/index.ts` barrels where useful
- run targeted tests after each move

### User worktree changes

There are existing user changes in `agent` files. Mitigation:
- preserve file contents while moving
- do not reset or discard unrelated edits

### Over-scoping into `core`

Shared logic extraction is attractive but risky during a workspace move. Mitigation:
- defer `core`
- keep this phase focused on package boundaries only
