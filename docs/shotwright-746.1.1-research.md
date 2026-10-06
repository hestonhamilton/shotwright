# shotwright-746.1.1 — E1.R Research: engine + packaging groundwork

- **Doc:** research (R phase)
- **Bead:** shotwright-746.1.1 · parent epic shotwright-746.1 (E1 Core capture package)
- **Date:** 2026-07-29
- **Status:** signed off (owner, 2026-07-29) — decisions recorded in
  [ADR 0002](adr/0002-playwright-peer-dependency.md) and
  [ADR 0003](adr/0003-tsc-only-build.md)

## Context

E1 builds the core package: `defineShotsConfig()`, `shot()`, output layout + manifest,
the `run`/`--only` CLI, and the build toolchain. ADR 0001 already fixed the engine
(Playwright test-runner) and distribution (npm package, git dependency). This research
settles the four axes the bead names: **dependency policy**, **manifest v1 schema**,
**build toolchain**, and the **config-factory API sketch** with the reference-consumer
mapping.

### Kickoff answers (owner, 2026-07-29)

| Question | Answer |
|---|---|
| Playwright coupling constraint | **No prior constraint** — research recommends freely |
| Module format | **ESM-only**, Node ≥20 (matches `type: module` in package.json) |
| Browser CDN blocked? | **Rare edge case** — document the escape hatch, don't design around it |

### Ecosystem grounding (web-searched 2026-07-29, not from memory)

- **Playwright stable is 1.62** (Chromium 151 / Firefox 153 / WebKit 26.5). Since 1.57
  Playwright runs on **Chrome for Testing** builds rather than Chromium (Arm64 Linux
  still Chromium). ([release notes](https://playwright.dev/docs/release-notes))
- Consumer pins today: all sit within one or two minors of stable; some consume
  `@playwright/test`, others the `playwright` library (not the test runner) — they
  migrate at E8.
- **Duplicate `@playwright/test` copies break the runner** — the classic
  `Playwright Test did not expect test() to be called here` failure; wrapper packages
  avoid it by declaring `@playwright/test` a **peer dependency**
  ([playwright#22599](https://github.com/microsoft/playwright/issues/22599),
  [playwright-bdd#171](https://github.com/vitalets/playwright-bdd/issues/171)).
  Precedent: [playwright-bdd](https://github.com/vitalets/playwright-bdd/blob/main/package.json)
  declares `peerDependencies: { "@playwright/test": ">=1.44" }`.
- **tsup is no longer actively maintained**; its npm page recommends
  [tsdown](https://tsdown.dev/guide/migrate-from-tsup) (Rolldown-based successor,
  ~500k weekly downloads and growing vs tsup's ~6–9M legacy base — *reported by
  [PkgPulse](https://www.pkgpulse.com/guides/tsup-vs-tsdown-vs-unbuild-typescript-library-bundling-2026)
  and [tsup#1391](https://github.com/egoist/tsup/issues/1391), not independently measured*).
  `tsc --noEmit` remains the only real type-checker regardless of bundler.
- **ESLint 9 flat config** (`eslint.config.mjs`) with
  [typescript-eslint](https://typescript-eslint.io/getting-started/)'s
  `tseslint.configs.recommended` is the current standard setup.
- **Vitest stable is 4.1.x** (v5 in beta) ([vitest.dev](https://vitest.dev/blog/vitest-4-1.html)).

## Options

### Axis 1 — Playwright dependency policy

| Option | Pros | Cons | |
|---|---|---|---|
| **Peer dependency** `@playwright/test: ">=1.60 <2"` (+ devDependency for self-testing) | Single copy guaranteed → no dup-runner breakage; consumer controls its version (all three consumers keep their pins); ecosystem precedent (playwright-bdd) | Consumer must install it (pnpm ≥8 auto-installs peers by default, so friction is near-zero); skew across consumers must stay within the declared range | ✅ **recommended** |
| Bundled (direct dependency) | Zero consumer setup; shotwright tests exactly one version | Two `@playwright/test` copies whenever the consumer has its own e2e suite → the exact fixture/`test()` breakage documented upstream; browser builds duplicated per version | rejected |
| Optional peer + runtime probe | Works standalone | Complexity without a consumer that needs it; all three target consumers already have Playwright | rejected |

**Browser-install story:** with a peer dep the browsers belong to the consumer's
Playwright: `init` adds a `shots:install` script → `playwright install chromium`. CI
workflow runs the same. The CDN-blocked escape hatch (a consumer-specific
browser-path variable → `use.executablePath`) is **documented, not designed-in** (kickoff
answer). Floor `1.60` = lowest current consumer pin at the time; ceiling `<2` because Playwright 2.0
would be an untested major.

### Axis 2 — Manifest v1 schema

The manifest is the public contract (ADR 0001: breaking it is a major version). Draft:

```jsonc
// shots-output/<run-id>/manifest.json
{
  "manifestVersion": 1,
  "runId": "2026-07-29T14-02_a1b2",          // timestamp-slug, also the dir name
  "startedAt": "2026-07-29T14:02:11.000Z",    // ISO 8601 UTC
  "finishedAt": "2026-07-29T14:03:40.000Z",
  "shotwrightVersion": "0.1.0",
  "playwrightVersion": "1.62.0",              // resolved from the peer at runtime
  "flags": { "only": ["checkout"], "video": false, "trace": false },
  "shots": [
    {
      "name": "checkout-empty",                  // unique within the run (see semantics)
      "spec": "checkout.shots.ts",                // relative to the shots dir
      "file": "shots/checkout.shots.ts/checkout-empty.png",  // relative to the run dir
      "viewport": { "width": 1440, "height": 960 },
      "deviceScaleFactor": 2,
      "fullPage": true,
      "capturedAt": "2026-07-29T14:02:31.000Z",
      "durationMs": 240,
      "video": null,                          // relative path when enabled, else null
      "trace": null
    }
  ]
}
```

**Semantics (the edge cases, not just the happy path):**

- **Empty run** → `shots: []`, manifest still written (a filtered-to-nothing `--only`
  run is valid and the gallery renders an empty state).
- **`video`/`trace`** are always-present keys, `null` when disabled — consumers branch
  on value, never on key presence.
- **Duplicate shot names** within a run: last-write-wins on disk is silent corruption;
  v1 makes it a **run-level error** (fail loud at manifest assembly).
- **Ordering:** `shots` is sorted by `(spec, capturedAt)` at assembly time. Capture
  order across parallel workers is nondeterministic, so order is *derived*, never
  observed insertion order.
- **Concurrency (flagged for P):** Playwright runs specs in parallel worker
  *processes*, so `shot()` cannot append to a shared manifest safely. v1 approach:
  each `shot()` writes a per-shot JSON sidecar (or attachment); a custom **reporter
  assembles `manifest.json` once in `onEnd`** and publishes atomically
  (write temp + rename). The `latest` symlink flips only after a successful assembly.

Alternative considered: no manifest, tooling globs the output tree — rejected in the
design doc already (globbing loses metadata: viewport, timing, spec attribution).

### Axis 3 — Build toolchain

The bead framed this "tsup-vs-tsc"; the web grounding voids that frame — tsup is
unmaintained, so the real contest is **tsc-only vs tsdown** (tsup only as legacy).

| Option | Pros | Cons | |
|---|---|---|---|
| **tsc-only** (`tsc` emits ESM + `.d.ts` straight to `dist/`) | Zero extra tooling; maximal maturity/docs (the hard R criterion); ESM-only + Node ≥20 needs no bundling, tree-shaking, or CJS interop; `dist` mirrors `src` so stack traces and jump-to-def stay honest | No minification (irrelevant for a dev-tool); multi-entry `exports` map maintained by hand (trivial at this size) | ✅ **recommended** |
| tsdown | Fast; actively maintained tsup successor; single-file bundles | Young ecosystem, thinner docs — fails the maturity bar for a package this small; adds a Rust toolchain dep for no measured need | fallback if bundling needs emerge |
| tsup | Familiar, huge install base | **Not actively maintained** (confirmed above) — disqualified for a new package | rejected |

Companion choices (no real contest, current-standard picks):
- **Type-check:** `tsc --noEmit` in `pnpm run typecheck` (build emit and check can share the same tsc).
- **Lint:** ESLint flat config (`eslint.config.mjs`) + `tseslint.configs.recommended` — matches the CLAUDE.md lint-on-edit hook. *(Amended at I: adopted ESLint 10 — released 2026-02, supported by typescript-eslint `^10` peer range; this repo has no plugins pinned to 9.)*
- **Unit tests:** Vitest 4.1.x for pure logic (manifest assembly, run-id/slug utils, `--only` filtering). The Playwright-driven self-test against the demo app is E2/E7 scope.

### Axis 4 — Config-factory API sketch + reference-consumer mapping

```ts
// consumer's shots.config.ts
import { defineShotsConfig } from 'shotwright'
export default defineShotsConfig({
  shotsDir: 'shots',                    // default 'shots/'  (reference consumer: e2e/shots)
  outputDir: 'shots-output',            // default; run dirs created beneath
  use: { /* passthrough, e.g. executablePath escape hatch */ },
  viewport: { width: 1440, height: 960 },  // default; DSF defaults to 2
  webServer: { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: true },
  projects: [ /* optional override; default single "shots" Desktop Chrome project */ ],
})
```

`defineShotsConfig` wraps the **consumer's** `defineConfig` (peer resolution guarantees
it's the same instance the runner uses) and hard-sets the harness invariants:
`testMatch: '**/*.shots.ts'`, `retries: 0`, `reporter: [['list'], [shotwrightReporter]]`,
`screenshot/trace/video: 'off'` at the Playwright level (artifact toggles are run-level
shotwright flags, not Playwright's failure-artifact machinery).

**Reference consumer `playwright.shots.config.ts` → `defineShotsConfig` mapping:**

| Reference consumer today | shotwright equivalent |
|---|---|
| `...base` spread of `playwright.config.ts` | not needed — factory owns the invariants; consumer passes only `webServer` + `use` deltas |
| `testDir: './e2e/shots'` | `shotsDir: 'e2e/shots'` |
| `testMatch: '**/*.shots.ts'` | factory invariant (default) |
| `retries: 0`, `reporter: [['list']]` | factory invariants |
| `screenshot/trace/video: 'off'` | factory invariant; re-enabled per run via `--video`/`--trace` |
| `deviceScaleFactor: 2` | factory default |
| browser-path variable → `use.executablePath` | consumer passthrough via `use` (documented escape hatch) |
| `projects: [{ name: 'shots', Desktop Chrome, 1440×960, DSF 2 }]` | factory default project |
| reuses the consumer's existing `webServer` setup | `webServer` passthrough, untouched |
| `e2e/shots/capture.ts` (`shot()`, `SHOTS_DIR`, `SHOTS_ONLY`) | `shotwright/capture` — `shot()` gains manifest recording; `--only` replaces `SHOTS_ONLY` (same substring semantics, CLI-flag + env both honored) |

Everything in the consumer file today either disappears into a factory invariant or
survives as an explicit option — no consumer-side loss of capability.

## Recommendation

1. **Dependency policy:** `@playwright/test` as **peerDependency `">=1.60 <2"`**, plus a
   pinned devDependency for shotwright's own demo/self-tests. Browser install stays
   consumer-side (`shots:install` → `playwright install chromium`); executablePath
   escape hatch documented only. *(Foundational → ADR on sign-off.)*
2. **Manifest v1** as drafted above, with sidecar-collect + reporter-assemble +
   atomic-rename as the concurrency model. *(Contract-defining → ADR on sign-off.)*
3. **Build toolchain:** **tsc-only** ESM emit, ESLint 9 flat config +
   typescript-eslint, Vitest 4.1 for unit tests. tsdown is the named fallback if a
   bundling need is ever measured. *(Foundational → ADR on sign-off.)*
4. **Config factory** per the sketch; the reference-consumer mapping is complete with no
   capability loss.

## Open questions

1. **CLI → runner invocation:** `shotwright run` must execute the *consumer's*
   `playwright test` binary (peer). Spawn `npx playwright test` vs resolve the peer's
   CLI entry programmatically — decide in P (affects error UX, not the contract).
2. **Run-id collision** (two runs in the same minute): slug suffix is random-enough?
   Define the generator precisely in P.
3. **`latest` symlink on non-POSIX hosts:** all current consumers are Linux; v1 may
   declare POSIX-only and revisit if a Windows consumer appears. Confirm in P.
4. **`--only` transport:** CLI flag → env var handoff to worker processes (workers
   don't see argv). P pins the mechanism.

## Self-review rubric

| Lens | Verdict | Note |
|---|---|---|
| Measured-or-flagged | **pass** | Version claims sourced (searched 2026-07-29); download counts explicitly tagged as reported-not-measured. |
| Derived-value semantics | **pass** | Manifest defines empty-run, null-vs-absent, duplicate-name, and ordering semantics, not just the happy path. |
| Emergent structure | **flag → carried to P** | `shots[]` ordering defined as derived (sorted), but the sidecar-merge structure's failure modes (orphan sidecars from a crashed worker) need a pin in P. |
| Batch/concurrency | **flag → carried to P** | Parallel-worker manifest writes identified; sidecar + reporter-`onEnd` + atomic rename proposed. P must pin it with a test (concurrent capture → single valid manifest). |
| Inherited-constraints-grounded | **pass** | reference-consumer mapping built from the real file; ESM-only verified against package.json; peer floor verified against actual consumer pins. |
