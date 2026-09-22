# Codex Handoff

## Current State

NovelCut Studio can import ordinary storyboard text, Markdown production
packages, and native DOCX series bibles containing character, scene, prop,
effect, shot, transition, voice, BGM, sound-effect, grading, and title-card
sections.

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

The series-bible DOCX path adds these invariants:

- DOCX paragraphs, tables, and one-cell prompt boxes are extracted locally and
  normalized without requiring a manual Markdown conversion.
- Series, episode, source shot, and parent-shot lineage are preserved.
- Editing transitions are stored separately from payable video shots. S/M
  transitions are classified as generated visual material; F/E and the other
  editorial transitions remain audio, local-effect, or edit instructions.
- Source IDs such as `LIN-01`, `LOC-01`, and `PROP-01` remain stable asset IDs;
  audio-only roles such as `CALL-01` do not become visual character assets.
- Serious count mismatches, prompt timeline overflow, and replacement
  characters require explicit confirmation before project create/append.
- An overflowing split-shot prompt keeps its authored source and receives a
  duration-matched execution prompt, so a 4-second child shot no longer sends a
  14-second action plan to Seedance.

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

The current real DOCX acceptance source is:

```text
/Users/tanhao/WorkBuddy/2026-09-19-14-46-28/江城妖话_第一季创作圣经_v3_拆分转场与1-4集Seedance分镜.docx
```

Expected parser result for this exact file:

```text
4 episodes; 104 payable/story shots; 50 transition relationships;
11 visual character assets; 9 scene assets; 9 prop assets;
episode shots 27/26/25/26; episode transitions 12/13/12/13;
97 overflowing prompt timelines repaired; 8 replacement characters;
CALL-01 retained as voice-only; no unresolved asset references.
```

The document itself claims 109 child shots and 24 transitions, contains both
v3.0 and v2.0 labels, and contains conflicting duration rules. Those are source
health findings, not parser counts; preview must show them and require an
explicit risk acknowledgement.

## Resume Checklist

1. Read this file and `AGENTS.md`.
2. Check local changes before editing and preserve `data/` and `outputs/`.
3. Back up `data/novelcut.db` before running a modified server on real data.
4. Run `npm run verify`.
5. Start `npm run dev`, then run the focused test commands from `AGENTS.md`.
6. Preview both acceptance sources and confirm their respective counts above.
7. Browser-check DOCX upload/path import, episode cards, transition count,
   health findings, and the required risk acknowledgement.
8. Browser-check the Markdown total duration, shot 17, local title-card
   playback, and the per-shot production list.
9. Run `npm run test:series` with the focused regression tests.
10. Keep smoke tests read-only with respect to paid generation providers.

## Likely Next Work

- Add local application of BGM, SFX, voice, and grading during final assembly;
  these are currently parsed, persisted, and displayed, but not mixed/rendered.
- Add a season/episode navigator and a dedicated transition-production queue.
  The data is already parsed, but the current workspace still groups episodes
  into sequence names and only previews transition execution classes.
- Add a platform-independent fallback renderer if Linux or Windows support is
  required.
- Split `server.js` only when doing so reduces risk around parser, persistence,
  job, or media-processing boundaries; avoid unrelated rewrites.
