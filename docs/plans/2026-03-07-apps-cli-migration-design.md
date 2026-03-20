# Apps CLI Migration Design

## Goal

Complete the monorepo shape by moving the executable CLI shell out of the repository root and into `apps/cli`.

## Scope

Included:
- add `apps/*` to the workspace
- move the current CLI entrypoint into `apps/cli/src/index.ts`
- create `apps/cli/package.json`
- update root scripts to invoke the app entrypoint
- update build output paths to `dist/apps/cli/src/index.js`

Not included:
- converting relative imports to workspace package-name imports
- extracting `core`
- changing CLI command semantics

## Options

### Option 1: Keep root CLI shell forever

Pros:
- no more work

Cons:
- monorepo shape remains incomplete
- root stays overloaded

### Option 2: Move only the executable shell to `apps/cli`

Pros:
- completes the monorepo shape cleanly
- low risk
- preserves existing package boundaries

Cons:
- still uses relative imports into `packages/*`

### Option 3: Move CLI and also switch all imports to workspace package names

Pros:
- cleanest end state

Cons:
- larger TypeScript/package-resolution change
- unnecessary risk in the same step

## Decision

Use Option 2.

This finishes the structural monorepo migration without mixing in package-resolution infrastructure changes.
