# NovelCut Studio Agent Guide

## Scope

These instructions apply to the entire project. Read `README.md` and
`docs/CODEX_HANDOFF.md` before changing import, generation, asset, timeline, or
post-production behavior.

## Project Map

- `server.js`: Node HTTP server, SQLite schema/migrations, Markdown parsing,
  generation jobs, local media processing, and API routes.
- `public/`: dependency-free browser UI.
- `lib/prompt-knowledge.js` and `knowledge/`: prompt review and enrichment.
- `tests/`: executable Node integration and regression checks.
- `scripts/render-title-card.swift`: macOS text renderer used when FFmpeg lacks
  `drawtext`.
- `data/` and `outputs/`: local runtime state; never replace or commit them.

## Working Rules

- Preserve the dependency-free Node/browser architecture unless a dependency is
  clearly necessary.
- Keep imported edit duration (`editDuration`) separate from provider generation
  duration (`duration`). Timeline and assembly use edit duration; Seedance uses
  generation duration.
- Treat `postOnly` shots as local post-production. They must never be sent to
  Seedance.
- Count identity assets separately from per-shot view assets. A visual character
  match must come from the prompt's subject description, not incidental mentions
  in action, environment, or continuity notes.
- Reject composite packages when their declared shot count differs from the
  parsed count. Silent partial imports are not acceptable.
- Back up `data/novelcut.db` before starting a changed server against real data.
- Do not call paid image or video generation APIs during tests unless the user
  explicitly requests it.

## Verification

Run static checks first:

```bash
npm run verify
```

With the service running on port 5188, run the focused suites:

```bash
npm run test:source
npm run test:composite
npm run test:assets
npm run test:consistency
npm run test:knowledge
```

For an alternate test service, set `NOVELCUT_TEST_URL`. After UI changes, inspect
project import, the asset page, a normal shot, a `postOnly` shot, and rough cut in
a browser. Do not create paid generation jobs as part of a smoke test.

