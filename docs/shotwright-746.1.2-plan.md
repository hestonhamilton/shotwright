# shotwright-746.1.2 — E1.P Plan: core package implementation plan

- **Doc:** plan (P phase)
- **Bead:** shotwright-746.1.2 · parent epic shotwright-746.1 (E1 Core capture package)
- **Date:** 2026-07-29
- **Inputs:** [research](shotwright-746.1.1-research.md) ·
  [ADR 0002](adr/0002-playwright-peer-dependency.md) (peer dep) ·
  [ADR 0003](adr/0003-tsc-only-build.md) (tsc-only)
- **Status:** signed off (owner, 2026-07-29); `latest`-symlink Windows behavior
  explicitly deferred (POSIX-only v1)

## Goal

Land the E1 core: `defineShotsConfig()`, `shot()`/`walkthrough()`, the run output
layout + manifest v1, and the `shotwright run [--only|--video|--trace]` CLI — built
tsc-only ESM, unit-tested with Vitest, smoke-tested against the in-repo demo page.

## Module layout

```
src/
  index.ts       # defineShotsConfig + ShotsConfigOptions (public: 'shotwright')
  capture.ts     # shot(), walkthrough(), filter logic (public: 'shotwright/capture')
  reporter.ts    # shotwright reporter — sidecar collect → manifest assemble (internal, wired by the factory)
  runs.ts        # run-id generator, run-dir creation, latest symlink, atomic publish
  manifest.ts    # manifest v1 types, sidecar read/write, assemble + validate
  cli.ts         # bin entry: `shotwright run` (gallery/compare/trace/init are E3+/E6)
```

package.json: `exports: { ".": …, "./capture": … }`, `bin.shotwright`, peer dep per
ADR 0002, devDeps `@playwright/test@1.62.x` (pinned), `typescript`, `vitest@^4.1`,
`eslint@^9` + `typescript-eslint`, `publint`.

## Public API signatures

```ts
// 'shotwright'
export interface ShotsConfigOptions {
  shotsDir?: string                                   // default 'shots'
  outputDir?: string                                  // default 'shots-output'
  viewport?: { width: number; height: number }        // default { 1440, 960 }
  deviceScaleFactor?: number                          // default 2
  use?: PlaywrightTestConfig['use']                   // passthrough, merged last
  webServer?: PlaywrightTestConfig['webServer']       // passthrough, untouched
  projects?: PlaywrightTestConfig['projects']         // replaces the default single 'shots' project
}
export function defineShotsConfig(opts?: ShotsConfigOptions): PlaywrightTestConfig

// 'shotwright/capture'
export interface ShotOptions {
  fullPage?: boolean                                  // default true
  clip?: { x: number; y: number; width: number; height: number }
  locator?: Locator                                   // element shot instead of page
}
export function shot(page: Page, name: string, opts?: ShotOptions): Promise<void>
export const walkthrough: typeof test                 // re-export of the consumer's test (naming alias)
```

Factory invariants (not options): `testMatch: '**/*.shots.ts'`, `retries: 0`,
`reporter: [['list'], [<shotwright reporter>]]`, Playwright failure-artifacts off;
`--video`/`--trace` re-enable `use.video`/`use.trace` at config-eval time via env
(config evaluates in the spawned process, so CLI-set env is visible).

## CLI surface

```
shotwright run [--only a,b] [--video] [--trace] [--config <path>] [-- <passthrough to playwright test>]
```

Env handoff (CLI → config eval → workers): `SHOTWRIGHT_RUN_DIR` (absolute run dir),
`SHOTWRIGHT_ONLY`, `SHOTWRIGHT_VIDEO`, `SHOTWRIGHT_TRACE`. `SHOTWRIGHT_ONLY` is also
honored when set by hand (same comma-separated substring semantics as the original consumer's
`SHOTS_ONLY`; CLI flag wins over ambient env).

**Runner invocation (resolves R open question 1):** the CLI resolves the consumer's
`@playwright/test` package from `process.cwd()` (`createRequire`), locates its `cli.js`
bin, and spawns `node <cli.js> test -c <config>`. No `npx` — npx would silently fetch a
mismatched version when the peer isn't installed; instead a missing peer produces an
actionable install hint.

**Bare `playwright test -c shots.config.ts` (no CLI):** unsupported for capture in v1 —
`shot()` throws an actionable error when `SHOTWRIGHT_RUN_DIR` is unset. Revisit only if
a consumer needs it.

## Manifest v1 (final — as researched, semantics unchanged)

Schema and edge-case semantics are fixed per the research doc Axis 2: versioned
(`manifestVersion: 1`), `video`/`trace` keys always present (`null` when off),
duplicate shot names fail the run at assembly, `shots[]` sorted by `(spec, capturedAt)`.

Concurrency model: `shot()` writes `<run>/.sidecar/<uuid>.json` per capture; the
reporter assembles `manifest.json` in `onEnd`, writes temp + rename (atomic publish),
then flips the `latest` symlink. **A run directory without `manifest.json` is by
definition incomplete** (crashed run): tooling ignores it, and assembly is the only
writer of `manifest.json`. Video is per-test, not per-shot: shots from the same test
share their test's video path (recorded on each entry).

Resolved details (R open questions 2–4):
- **Run id:** `<UTC YYYY-MM-DDTHH-mm-ss>_<4 hex from crypto>`; on the (unlikely)
  existing-dir collision, regenerate the suffix in a loop.
- **`latest` symlink:** POSIX-only in v1 (all consumers are Linux) — **deferred**, not
  designed: a Windows consumer would get a documented no-symlink fallback decision then.
- **`--only` transport:** env var as above.

## Step list (each ≤1 PR)

| # | Step | Lands | Pins landed |
|---|---|---|---|
| 1 | **Toolchain scaffold** — tsconfig (+`tsconfig.build.json`), `eslint.config.mjs` (flat + tseslint), vitest config, package.json (peer dep, exports map, bin, `build`/`typecheck`/`lint`/`test` scripts), CI-less local gates green | ADR 0002/0003 in code | `publint` clean = exports-map pin (P-flag: hand-maintained exports) |
| 2 | **runs.ts + manifest.ts** — run-id gen, run-dir creation, sidecar write/read, assemble + validate, atomic publish, latest symlink | output layout + manifest contract | unit: run-id format + collision retry; assemble sorts `(spec, capturedAt)`; duplicate names throw; empty run → `shots: []`; publish is temp+rename; missing-manifest dir treated incomplete |
| 3 | **capture.ts** — `shot()` (fullPage/clip/locator, sidecar emit), `walkthrough`, `--only` filter | in-spec API | unit: filter substring semantics (incl. empty/whitespace); `shot()` without `SHOTWRIGHT_RUN_DIR` → actionable error |
| 4 | **reporter.ts** — collect sidecars in `onEnd`, map per-test video/trace paths into the run dir, assemble via step 2 | manifest actually produced | unit: orphan sidecars from a crashed worker still assemble; video path shared across same-test shots |
| 5 | **index.ts factory** — invariants + passthrough merge, env-driven video/trace toggles | public config API | unit: invariants not overridable by `use` passthrough; webServer passes through byte-identical; env toggles flip `use.video`/`use.trace` |
| 6 | **cli.ts** — arg parsing, peer resolution + spawn, env handoff, exit-code propagation | `shotwright run` | **integration (the concurrency pin):** run against `demo/index.html` (static `webServer`) with 2 parallel specs → exactly one valid sorted manifest, PNGs on disk, `latest` flipped; missing-peer error message test |

Steps 2→6 are sequential by dependency; 1 is independent and first.

## Test matrix

| Surface | Kind | What proves it |
|---|---|---|
| run-id, filter, manifest assemble/validate, atomic publish | Vitest unit | step 2/3 pins above |
| reporter assembly incl. crash-orphans | Vitest unit (fake sidecar trees) | step 4 |
| factory invariants + passthrough | Vitest unit (inspect returned config object) | step 5 |
| CLI end-to-end, parallel workers | Playwright smoke vs `demo/` | step 6 — the load-bearing concurrency assumption's pin |
| exports map / types | `publint` in `lint` script | step 1 |

Verification command (CLAUDE.md): `pnpm run typecheck && pnpm run lint && pnpm run test`
becomes real at step 1 and stays green through 6.

## Risks + rollback

- **Peer resolution vs pnpm hoisting** (the cwd-resolve in step 6): if `createRequire`
  resolution proves fragile in a consumer layout, fallback is documented
  `npx playwright test` guidance; the contract (env handoff) is unchanged. Caught by
  step 6's missing-peer test and the E8 reference-consumer migration.
- **tsc-only exports drift**: `publint` gates it; rollback to tsdown is a build-internal
  swap per ADR 0003.
- **Playwright config-eval assumptions** (env visible at eval; reporter `onEnd` timing):
  validated immediately by step 6's smoke; if wrong, the reporter falls back to
  assembling from a `globalTeardown` — same contract, different hook.
- Any step is revertable in isolation (docs/tests-first, no consumer exists yet).

## Acceptance mapping

| Bead acceptance bullet | Satisfied by |
|---|---|
| API signatures | §Public API + steps 3/5/6 |
| Manifest v1 final | §Manifest v1 + step 2 (schema fixed, semantics from research) |
| Test matrix (vitest units + demo smoke) | §Test matrix; smoke = step 6 |
| Open questions resolved or explicitly deferred with sign-off | R-OQ 1/2/4 resolved above; R-OQ 3 (`latest` on Windows) **deferred** — sign-off requested at exit |

## Self-review rubric

| Lens | Verdict | Note |
|---|---|---|
| Measured-or-flagged | **pass** | No new quantitative claims; version pins inherited from R (sourced there). |
| Derived-value semantics | **pass** | Incomplete-run definition (no manifest.json), shared per-test video paths, empty-run and duplicate-name semantics all explicit. |
| Emergent structure | **pass** | R's orphan-sidecar flag pinned (step 4 unit test); sidecar dir is flat uuid-named, no ordering assumed. |
| Batch/concurrency | **pass** | R's parallel-worker flag pinned (step 6 integration test); single-writer + atomic rename + symlink-after-publish stated. |
| Inherited-constraints-grounded | **pass** | Steps implement against real repo state (demo/index.html exists; package.json ESM; ADR ranges); no constraint accepted untested — config-eval/env assumption gets step 6's smoke, with a named fallback. |
