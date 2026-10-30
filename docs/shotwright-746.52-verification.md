# shotwright-746.52 — verification

- **Phase:** Verify
- **Date:** 2026-10-29
- **Implementation:** `fb30e22`
- **Verdict:** **PASS**

## Acceptance checklist

- [x] A consumer config can observe video and trace flag intent. The CLI assigns both indicators before launching the consumer's Playwright process (`src/cli.ts:666-683`); the README specifies their exact values and passthrough semantics (`README.md:301-308`). The scratch consumer observed all five requested combinations below.
- [x] A consumer can request one recorded video size. The public option is typed (`src/index.ts:24-32`), removed from Playwright's top-level config spread, and applied to global, default-project, and explicit-project video settings only when video is requested (`src/index.ts:77-115`). The scratch consumer's `--video` run produced a 320×240 VP9 WebM.
- [x] The default DSF story is explicit. The default project stays at DSF 2 (`src/index.ts:106-116`); README examples use a video-dependent DSF 1 for the default project and each explicit `project.use` (`README.md:287-327`). A scratch run produced a 320×240 PNG at DSF 1 with video and a 640×480 PNG at DSF 2 without video, for the same 320×240 viewport.
- [x] Tests cover the change. Factory tests cover sized/unsized on/off video in global, default, and two explicit project branches, ownership, default DSF, and the TypeScript shape (`test/unit/factory.test.ts:182-228`). The CLI smoke case covers config-time flag intent and conditional DSF (`test/smoke/cli.test.ts:1084-1158`); the full unit and smoke suites passed.

## Plan and amendment review

| Plan item | Evidence and result |
|---|---|
| Step 1: shared `videoSize` and config-shape pin | `src/index.ts:24-32,77-115` and `test/unit/factory.test.ts:182-228` match the on/off/omitted-size and project matrix. PASS. |
| Step 2: public indicators and DSF recipe | `README.md:287-327`, `src/cli.ts:125-192,669-683`, and `test/smoke/cli.test.ts:1084-1158` match the documented intent contract. The scratch consumer exercised the direct `--trace` case as well. PASS. |
| Step 3: minor changeset | `.changeset/video-config-size.md:1-5` has the specified frontmatter and wording; `.changeset/config.json:1-10` uses the expected Changesets configuration. PASS. |
| Amendment 1: config shape is the size pin; real video is optional | The factory matrix asserts `{ mode: 'on', size }` (`test/unit/factory.test.ts:182-211`). The separate scratch recording also confirmed the requested frame size. PASS. |
| Amendment 2: smoke claim is limited to the installed peer | The smoke run used the worktree's installed Playwright; the scratch consumer used the same peer version. No claim about the full supported peer range is made (`package.json:55-57`). PASS. |
| Amendment 3: run smoke explicitly | `pnpm run test` targets unit tests and `pnpm run smoke` targets smoke tests (`package.json:41-49`); both were run. PASS. |

The diff changes only the config factory, README, factory/smoke tests, plan/research docs, and changeset. It does not alter capture bytes (`src/capture.ts:188-205`), atomic manifest and `latest` publication (`src/runs.ts:116-133`; `src/reporter.ts:180-193`), gallery generation (`src/gallery/generate.ts:22-37`), or consumer Playwright resolution (`src/cli.ts:473-488`). The design keeps output as review artifacts with no default assertion gate (`docs/design.md:30-38`). No demo or gallery UI changed. The new committed diff contains no absolute host path, LAN address, or local username.

## Commands run

From the worktree root unless noted. Output is truncated to the decisive lines. `node_modules` was present, so installation was unnecessary.

```text
$ pnpm run typecheck && pnpm run lint && pnpm run test && npm_config_cache=local/npm-cache pnpm run smoke
typecheck: PASS
lint: attw --pack failed at npm pack (exit 3) with the default npm cache; chain stopped

$ npm_config_cache=local/npm-cache pnpm run lint
eslint, prettier, build, publint: PASS
attw: ESM and bundler resolutions green; exit 0

$ pnpm run test && npm_config_cache=local/npm-cache pnpm run smoke
unit: Test Files 23 passed; Tests 661 passed, 1 skipped
smoke: Test Files 3 passed; Tests 58 passed
smoke emitted a browser-install timeout notice and used the existing browser cache; exit 0

$ node_modules/.bin/tsc -p local/verify-74652/tsconfig.json
exit 0 (the README default-project and explicit-project examples compile against dist/index.d.ts)
```

From `local/verify-74652`, a scratch consumer with links to this worktree's built package and installed `@playwright/test`:

| Command suffix after `node ../../dist/cli.js run --config shots.config.ts` | Exit | Config saw `SHOTWRIGHT_VIDEO`, `SHOTWRIGHT_TRACE` |
|---|---:|---|
| *(none)* | 0 | `'0'`, `'0'` |
| `--video` | 0 | `'1'`, `'0'` |
| `--trace` | 0 | `'0'`, `'1'` |
| `-- --trace on` | 0 | `'0'`, `'0'` |
| `--trace -- --trace off` | 0 | `'0'`, `'1'` |

```text
$ ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of default=noprint_wrappers=1 runs/latest/video/example/*.webm
codec_name=vp9
width=320
height=240

$ node -e "const f=require('fs');const p=f.readFileSync('runs/latest/shots/example/frame.png');console.log('PNG '+p.readUInt32BE(16)+'x'+p.readUInt32BE(20))"
PNG 320x240
```

The nonvideo run's PNG header measured 640×480. The passed video run's manifest linked the WebM and recorded `deviceScaleFactor: 1`; `runs/latest` pointed to that passed run. Scratch artifacts remain under `local/verify-74652` and are gitignored.

## Observations

- The bead premise still matches the implementation baseline: shotwright already assigned the indicators (`src/cli.ts:669-683`) but the prior video setting was only on/off; this diff adds the size path (`src/index.ts:77-115`).
- The indicators mean shotwright flag intent, so Playwright's passthrough `--trace on` and override `--trace off` can disagree with the indicator (`src/cli.ts:175-192`; `README.md:301-308`). The README states this limit. The planned manifest trace-flag repair remains outside this bead (`docs/shotwright-746.52-plan.md:14-16`).
- The lint retry shows the first failure was the default npm pack cache environment, not a source finding. The complete gate set passed with `npm_config_cache=local/npm-cache` for commands that pack/install.

## Sign-off

**PASS.** All acceptance criteria and plan amendments have evidence above. No implementation changes were made during Verify.
