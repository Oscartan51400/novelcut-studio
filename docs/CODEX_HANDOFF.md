# Codex Handoff

## Current State

NovelCut Studio can import both ordinary storyboard Markdown and a composite
production package containing character, scene, prop, effect, shot, voice, BGM,
sound-effect, grading, and title-card sections.

The composite-package implementation has these invariants:

- Markdown section parsers stay within their heading boundary.
- `镜号1（...）` headings are recognized, including full-width punctuation.
- A declared shot count mismatch returns HTTP 422 instead of creating a partial
  project.
- Identity assets and per-shot visual assets are counted separately in import
  preview.
- Character association is based on the shot subject block. Names mentioned only
  in other prompt sections do not create a visual-character binding.
- `editDuration` is the authored cut length. `duration` is the normalized
  Seedance generation length. Timeline, rough cut, and final assembly use the
  former.
- `postOnly` shots cannot enter the Seedance generation path.
- Project production metadata is persisted and shown per shot in the inspector.
- Local title cards are stored as successful preferred takes and participate in
  rough cut and assembly.
- Title-card background, three text colors, alignment, and title scale are
  editable. The normalized style is persisted in shot generation metadata and
  is applied by both the FFmpeg and macOS AppKit renderer paths.

## Local Title Cards

Some FFmpeg builds do not include `drawtext`. The server checks filter support at
runtime. When `drawtext` is unavailable on macOS, it runs
`scripts/render-title-card.swift` to render a Chinese PNG with AppKit, then uses
FFmpeg to encode H.264 video plus silent AAC audio. Other platforms need either a
`drawtext`-enabled FFmpeg or another explicit renderer implementation.

The endpoint is:

```text
POST /api/shots/:shotId/render-post
```

It is valid only for a shot whose generation metadata contains
`postOnly: true`.

## Regression Fixture

`tests/fixtures/composite-production.md` is the small committed regression
fixture. `tests/composite-source.js` verifies section boundaries, visual identity
matching, production metadata, separate durations, post-only behavior, and
declared-shot-count rejection.

On this workstation, the larger acceptance source used during development is:

```text
/Users/tanhao/WorkBuddy/2026-09-19-14-46-28/AI短剧第一集-Seedance完整执行包.md
```

Expected acceptance summary for that file:

```text
17 shots; 2 character identities; 3 scene identities; 5 prop identities;
13 character views; 16 scene views; 5 BGM segments; 10 SFX entries;
3 grading groups; 5 grading parameters; 8 effects; 3 voice roles;
14 voice-line records; shot 17 postOnly; total edit duration 56 seconds.
```

The source currently contains 14 Unicode replacement characters; preview should
warn about them rather than silently dropping content.

## Resume Checklist

1. Read this file and `AGENTS.md`.
2. Check local changes before editing and preserve `data/` and `outputs/`.
3. Back up `data/novelcut.db` before running a modified server on real data.
4. Run `npm run verify`.
5. Start `npm run dev`, then run the focused test commands from `AGENTS.md`.
6. Preview the large acceptance Markdown and confirm the counts above.
7. Browser-check import preview, total duration, shot 17, local title-card
   playback, and the per-shot production list.
8. Keep smoke tests read-only with respect to paid generation providers.

## Likely Next Work

- Add local application of BGM, SFX, voice, and grading during final assembly;
  these are currently parsed, persisted, and displayed, but not mixed/rendered.
- Add a platform-independent fallback renderer if Linux or Windows support is
  required.
- Split `server.js` only when doing so reduces risk around parser, persistence,
  job, or media-processing boundaries; avoid unrelated rewrites.
