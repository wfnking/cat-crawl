# Case Study Crawler Design

## Goal

Build a reusable case-study crawler and local reading site for design analysis. The system should capture public and authenticated pages, extract structured design data, and present it as a browsable local case-study library for OPC research.

## Scope

The first target is The Vibe Marketer ecosystem:

- `https://www.thevibemarketer.com/`
- `https://ads.thevibemarketer.com/daily-ads`
- authenticated SaaS pages such as billing, dashboard, settings, gallery

The design must support future sites without changing the viewer structure.

## Product Direction

This is not a generic website downloader. It is a structured design reference system.

The desired output is:

- page summaries
- component breakdowns
- color, type, spacing, radius, border and shadow tokens
- copywriting framework extraction
- screenshots
- raw HTML snapshots for audit

The system should be readable and reusable over time, not just a one-off crawl artifact dump.

## Chosen Architecture

Use a `CLI + static viewer` model.

- The CLI handles crawling, extraction, build, and serve commands.
- Crawl artifacts are stored as files in the repo.
- The viewer reads generated JSON and renders a local case-study library.

This approach was chosen because it keeps data versionable in git, keeps the viewer simple, and allows future sites to be added without changing storage strategy.

## Storage Model

Use file-based storage rather than a database.

Reasons:

- diffs are readable
- manual correction is easy
- git history works well for evolving research notes
- static site generation becomes straightforward

## Directory Layout

```text
case-studies/
  sites/
    thevibemarketer/
      site.json
      pages/
        home/
          page.json
          screenshot.png
          html.html
          tokens.json
          components.json
          copy.json
        daily-ads-landing/
        billing/
  generated/
    index.json
    search.json
  viewer/
    ...
```

### Directory Intent

- `sites/<slug>/site.json`
  Site-level metadata and page registry.
- `sites/<slug>/pages/<page-slug>/`
  Per-page structured outputs and screenshots.
- `generated/`
  Build-time aggregated indexes for the viewer.
- `viewer/`
  Static UI source or templates for local reading.

## CLI Commands

Proposed command surface:

```bash
cat-crawl case-study crawl <url>
cat-crawl case-study crawl <url> --site <slug> --page <page-slug>
cat-crawl case-study crawl <url> --session .case-study/thevibemarketer.session.json
cat-crawl case-study build
cat-crawl case-study serve
```

### Command Roles

- `crawl`
  Capture one page and write structured outputs.
- `build`
  Aggregate all sites/pages into viewer-ready indexes.
- `serve`
  Start a local static server for browsing the library.

## Data Model

Each page should produce these files:

### `page.json`

Top-level page metadata:

- `url`
- `title`
- `pageType`
- `auth`
- `capturedAt`
- `summary`
- `designNotes`
- `screenshots`
- `linkedPages`

### `tokens.json`

Extracted design tokens:

- colors
- font families
- font sizes
- font weights
- radii
- shadows
- border styles
- spacing

### `components.json`

Component inventory, each entry containing:

- `name`
- `kind`
- `selector`
- `purpose`
- `contentStructure`
- `styleTraits`

### `copy.json`

Copy framework, split into sections like:

- hero
- proof
- mechanism
- pricing
- CTA
- objection handling

### `html.html`

Sanitized HTML snapshot for manual review.

### `screenshot.png`

Primary screenshot. Future expansion can add:

- `mobile.png`
- `component-*.png`

## Crawl Pipeline

The crawler should run in three phases:

1. `capture`
   Open page with Playwright, collect screenshot, DOM, metadata, and style samples.
2. `extract`
   Derive tokens, components, copy blocks, and summary JSON.
3. `build`
   Aggregate page/site outputs into the local viewer indexes.

This separation keeps crawling deterministic and makes extractor logic easier to refine later without rethinking the whole system.

## Authenticated Pages

Authenticated pages should use session files, not embedded login automation.

Supported modes:

- `public`
  Crawl without credentials.
- `session`
  Use a locally exported Playwright `storageState` file.

This avoids hardcoding login steps, reduces fragility, and keeps account handling outside the crawler.

## Viewer Experience

The viewer should behave like a design reference browser, not a blog.

### Main Views

- home
  List case-study sites with filtering
- site page
  Show site summary, page list, common tokens, shared components
- page page
  Show structured analysis and screenshot side-by-side
- token view
  Surface colors, fonts, spacing, buttons, cards
- copy view
  Surface persuasion structure and CTA rhythm

### Page Tabs

Each page should support:

- `Overview`
- `Components`
- `Tokens`
- `Copy`
- `Raw`

## Extensibility

Future sites should fit the same system by configuration, not by reworking the viewer.

The design should include:

- site-level config via `site.json`
- normalized `pageType` values such as:
  - `marketing-home`
  - `product-landing`
  - `pricing`
  - `dashboard`
  - `billing`
  - `settings`
  - `gallery`
  - `locked-state`
- generic extractors first
- optional site-specific extraction rules later
- manual annotations via fields like `designNotes` and `whyItWorks`

## Non-Goals

The first version should not try to:

- automate credentials or MFA flows
- clone private API responses into a full product mirror
- infer pixel-perfect design tokens from every element on the page
- build a production-grade multi-user CMS

## Success Criteria

The first version is successful if it can:

- crawl public pages and session-backed authenticated pages
- produce screenshot, HTML, summary, token, component, and copy outputs
- build a readable local static site
- support adding a new case-study site without changing the viewer architecture
