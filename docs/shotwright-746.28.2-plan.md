# E10.P — First external consumer adoption plan

**Bead:** `shotwright-746.28.2` · **Epic:** `shotwright-746.28` · **Phase:** Plan · **Date:** 2026-10-22

## 1. Goal

Ship one 0.2.0 migration that makes the first external consumer's ordered, authenticated capture flows, data artifacts, failure review, parity comparison, subdirectory CI, and run discovery work without consumer-side harness copies. The epic title is **“E10 Consumer-adoption gaps from the first external consumer”**. Preserve byte-equivalent screenshots for equivalent arguments, `latest` as last passed and fully published, self-contained gallery, peer-resolved Playwright, and artifacts-only CI by default.

**Epic acceptance, verbatim:** “Observable when closed: a consumer whose Playwright package lives in a subdirectory of an npm repo, with a globalSetup, ordered multi-test flows, generic shot names reused across specs, and data outputs, adopts shotwright via shotwright init plus the reusable workflow without spreading the config result, wrapping shot(), or shelling out to cmp/ImageMagick for parity. A failed run keeps its failure evidence, publishes a manifest carrying run and per-test status, and is reachable from shotwright runs / --last; the gallery and compare show that status. Every G1–G13 item is either shipped or recorded as considered-and-declined with a reason in the phase docs. Published as a new minor version with changesets.”

## 2. Settled inputs

Research line references are to `docs/shotwright-746.28.1-research.md`; experiment references override any earlier speculative wording there.

| Input | Source |
|---|---|
| G5 key is `(spec,name)`; duplicates only within a spec. | lines 33, 97–107 |
| G6 always computes; `--fail-on-change` opts into exit 1; states `identical`, `similar`, `changed`, `size-changed`, `added`, `removed`, `unreadable`; pixelmatch + pngjs. | lines 31, 109–118, 202, 239 |
| G3 writes manifest v2 with runner `status` and separate `publication`; v1 reader adapter. | lines 82–90, 204–208 |
| `onEnd` copies evidence, builds gallery from in-memory manifest, atomically publishes manifest, then conditionally flips `latest`. | lines 204–208 |
| Marker is `checked`, not `verified`; only callback completion. | lines 177–185, 215 |
| Trace routes depend on effective bind; CI `traces` controls recording. | lines 139–146, 216–217 |
| `runs` includes incomplete dirs; `--last` means newest manifest-bearing run. | lines 166–172, 218 |
| `run` emits `run-dir:` and honors `--run-dir-file` or `SHOTWRIGHT_RUN_DIR_FILE`. | lines 157–164, 218 |
| G10 inputs: `runs-on`, `working-directory`, `package-manager`, `playwright-args`, `traces`, `retention-days`; no `node-version` or `output-dir`. | lines 148–164, 245 |
| G13a strips only the final matched suffix for storage; canonical spec retains `.shots.ts`. | lines 174–176, 220 |
| G13e keeps `engines.node >=20`; document CJS load floor. | lines 187–195, 246 |
| Sidecars carry `retry`; assembly uses the final `onTestEnd` retry per `testId`, deleting superseded files. | lines 234–237; redteam F02 disposition |
| Release is 0.2.0 by pre-1.0 minor changeset. | lines 200–202, 242 |
| `9de261c` is the starting WIP for I-consumer-ci, never merged as-is. | lines 36, 230; code appendix G10 |
| **Experiment override:** top-level factory throw prevents Playwright cleanup; `process.argv` contains `--list`. | experiments E1, overriding research G8's unproved cleanup order |
| **Experiment override:** failure attachment is `error-context`, MIME `text/markdown`, and its printed `.pw` path dangles after sweep. | experiments E2, overriding research G4's inferred attachment/path |
| **Experiment override:** packed ESM package loads with CommonJS `require()` on Node 24, but fails with require(esm) disabled. | experiments E3, overriding research G13e's untested status |
| **Experiment override:** probe emits two listing lines; default `shot()` matches explicit `fullPage:true` byte for byte for the tested tall page. | experiments E4/E5, overriding research G13c/G13f's unmeasured behavior |

## 3. The contract — I-contract

### 3.1 Public schema and validation

Define in `src/manifest.ts`; `src/gallery/model.ts` validates unknown JSON and adapts v1. Required v2 fields are not nullable except where shown. `error` strings are concise diagnostics, never stack traces or host paths in committed fixtures.

```ts
export const MANIFEST_VERSION = 2 as const
export type RunnerStatus = 'passed' | 'failed' | 'timedout' | 'interrupted' | 'unknown'
export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
export interface Viewport { width: number; height: number }
export interface ShotEntry {
  name: string; spec: string; file: string
  viewport: Viewport | null; deviceScaleFactor: number | null
  fullPage: boolean; capturedAt: string; durationMs: number
  video: string | null; trace: string | null
  testId: string | null; checked: boolean; retry: number
}
export interface TestEntry {
  id: string; title: string; spec: string; project: string
  status: TestStatus; retry: number; durationMs: number
  error?: { message: string }
}
export interface ArtifactEntry {
  name: string; spec: string; file: string; contentType: string
  bytes: number; testId: string
}
export interface FailureEntry {
  testId: string
  files: Array<{ name: string; contentType: string; file: string }>
}
export interface PublicationResult { ok: boolean; error?: string }
export interface Manifest {
  manifestVersion: typeof MANIFEST_VERSION
  runId: string; startedAt: string; finishedAt: string
  shotwrightVersion: string; playwrightVersion: string
  flags: { only: string[]; video: boolean; trace: boolean }
  status: RunnerStatus
  publication: { gallery: PublicationResult; evidence: PublicationResult }
  tests: TestEntry[]; shots: ShotEntry[]
  artifacts: ArtifactEntry[]; failures: FailureEntry[]
}
```

Runner writer emits only Playwright's four `FullResult.status` values; `unknown` is a v1 adapter value. A test's `id` is session-local linkage, not cross-run identity. Store one final test attempt per `id`; retries are integer attempt indices. `error` is absent when no error. `publication.*.ok=false` requires `error`; `ok=true` forbids it. Empty `tests`, `artifacts`, `failures`, or `shots` arrays are valid. `failures` has one row per failed final test attempt, including an empty `files` array if nothing was attached. Failure attachments include `error-context` and any other actual attachments, with safe names; video/trace are copied once and may be referenced in shots and failures. File references stay relative and are validated against traversal, symlinks, and missing files before serving.

**v1 adapter:** `validateManifest()` accepts versions 1 and 2; version 2 is strict. For v1, keep all existing run/shot fields unchanged, return normalized v2 in memory with `status:'unknown'`, `publication:{gallery:{ok:true},evidence:{ok:true}}` (legacy publication success is **unknown**, not inferred; these `ok:true` values mean no v2 publication failure was recorded and must not be displayed as proof), `tests:[]`, `artifacts:[]`, `failures:[]`, and each shot `testId:null`, `checked:false`, `retry:0`. Also expose `sourceManifestVersion: 1 | 2` on `GalleryModel` to label legacy unknowns. Never rewrite the v1 file; mixed v1/v2 compare pairs by canonical `(spec,name)` and displays unknown test status on the v1 side. Invalid v1 fields still fail validation. **Pin:** legacy publication must render “unrecorded,” not “passed,” even though normalized shape uses booleans.

**Sidecars:** `ShotSidecar = Omit<ShotEntry,'video'|'trace'|'testId'> & {kind:'shot';testId:string}` and `ArtifactSidecar = ArtifactEntry & {kind:'artifact';retry:number}`. Each is a distinct tagged JSON record in `.sidecar/` with random filename and atomic temp/rename write. `ShotSidecar.testId` is non-null. Both record `retry` from `test.info().retry`. For each `testId`, assembly takes final retry R from `onTestEnd` and keeps only sidecars with `retry === R`. If final attempt R produced no sidecar for a `(spec,name)` captured on an earlier attempt, exclude that shot or artifact from the manifest **and delete its file from the run layout**. If R recaptures, its bytes and sidecar win. A second different `testId` with the same `(spec,name)` is a duplicate error even if from another worker. A same-test duplicate at the same retry is also rejected rather than silently choosing a shot. Artifact sidecars use the same final-attempt rule and reject same-attempt duplicates. Sort shots by `(spec,capturedAt,name)`, artifacts by `(spec,name,testId)`, tests by `(spec,project,title,id)`, failures by `testId`; no cross-worker capture order is promised. On assembly error, report it, remove `.sidecar/` in `finally`, leave the run incomplete (no manifest/latest), and let the CLI still expose its run directory.

**Capture API in `src/capture.ts`:**

```ts
export interface ShotOptions {
  fullPage?: boolean
  clip?: { x:number; y:number; width:number; height:number }
  locator?: Locator
  check?: () => void | Promise<void>
}
export async function shot(page: Page, name: string, opts?: ShotOptions): Promise<void>
export type ArtifactOptions =
  | { body: string | Buffer; path?: never; contentType: string }
  | { path: string; body?: never; contentType: string }
export async function artifact(name: string, opts: ArtifactOptions): Promise<void>
```

`shot()` validates, applies `--only`, then runs `check`, then captures. Filtered shots skip the callback. A thrown callback writes neither PNG nor sidecar. `checked:true` records a resolved callback, including a no-op; it does not attest that an assertion occurred. `artifact()` accepts exactly one body/path, copies bytes into run storage, computes `bytes`, validates MIME and name, and records a sidecar. It uses the same current test context and canonical spec; filtering by `--only` does not suppress independently named artifacts. Reject absolute/traversing names and destination collisions. `contentType` is explicit; string bodies are UTF-8. Preserve current full-page default; E5 proves its byte equivalence for the tested fixture.

**Layout and slug:** For matched `sub/a.shots.ts`, storage spec is `sub/a`; manifest `spec` remains `sub/a.shots.ts`. `shots/sub/a/<name>.png`; `data/sub/a/<name>` (safe single-segment name, including extension); `failures/sub/a/<test-slug>-<shortId>/<safe-attachment-name>`; `video/sub/a/<test-slug>-<shortId>.webm`; `trace/sub/a/<test-slug>-<shortId>.zip`. A slug lowercases Unicode NFKD text, replaces runs of non-ASCII alphanumerics with `-`, trims `-`, uses `test` if empty, and truncates to 48 chars. `shortId` is the first 12 hex chars of SHA-256 of the full Playwright `testId` plus project; use the full digest if a collision is detected within a run. Attachment basename is sanitized with the same rule while retaining a safe extension, and duplicate names get `-2`, `-3` in attachment order. The manifest records actual paths. Do not use raw test IDs as path segments. A fixture forces title slug and digest-prefix collisions. Canonical spec suffix stripping is injective for matched `.shots.ts` paths; explicitly reject any future match pattern that violates this premise.

### 3.2 Shared signatures and ownership

I-contract owns all cross-bead declarations in `src/gallery/model.ts`: `CompareOptions {threshold:number;includeAA:boolean}`, `CompareVerdict {state:'identical'|'similar'|'changed'|'size-changed'|'unreadable'; differentPixels:number|null; totalPixels:number|null; ratio:number|null; aSize:Viewport|null; bSize:Viewport|null; diffPng:Buffer|null; error?:string}`, and a typed `compareImages(aPng:Buffer,bPng:Buffer,opts:CompareOptions):CompareVerdict` stub throwing `new Error('not implemented')`. The stub is a compile-time seam, not called by production compare. I-gallery owns `src/gallery/pixels.ts`, exports the real `compareImages` satisfying `typeof import('./model.js').compareImages`, and makes `src/gallery/compare-model.ts` call that implementation. `ComparePairState` (all seven states), `CompareModel`, and composite `shotKey(spec,name)` (length-prefixed components, no delimiter ambiguity) also live in C-owned `model.ts`; I-gallery implements pairing in its own `compare-model.ts`. C declares `CompareGenerationResult { outputFile: string; counts: Record<ComparePairState, number>; gate: { nonParity: number; failOnChange: boolean } }` there. Every shot **or artifact** pair with state other than `identical` or `similar` contributes one to `nonParity`. G changes its production export to `generateCompareGallery(aRun, bRun, opts: { outputFile?: string; threshold?: number; includeAA?: boolean }): CompareGenerationResult` and adds `includeTraces: boolean` (default `false`) to `startGalleryServer` options. Its server builds the allowlist from **every** manifest reference: shot `trace` and `failures[].files` with contentType `application/zip` or name `trace` use one predicate, allowing a trace route only for a loopback bind or when `includeTraces` is true. L3 consumes both G-owned production exports only after G merges. `src/runs.ts` belongs to I-cli; I-contract makes **no edit** there. I-cli defines and implements `RunListing {runId:string;runDir:string;status:RunnerStatus|'incomplete';shotCount:number|null;startedAt:string|null}` and `listRuns(outputDir:string):RunListing[]` in that file. `src/gallery/resolve.ts` belongs to I-cli; its path/last signatures are entirely that bead's responsibility. `src/gallery/generate.ts` belongs to I-contract because reporter needs `generateGallery(runDir:string, manifest?:Manifest):GalleryGenerationResult`; optional in-memory manifest is a real implementation. `src/gallery/model.ts` adds `buildGalleryModel(runDir,manifest)` for that path. I-contract's fixture exercises it.

### 3.3 Factory and finalization

`type HarnessOwnedKeys = 'testDir' | 'testMatch' | 'retries' | 'reporter' | 'outputDir'`; `type ShotsConfigOptions = Omit<PlaywrightTestConfig,HarnessOwnedKeys> & {shotsDir?:string; outputDir?:string; viewport?:Viewport; deviceScaleFactor?:number; use?: Omit<NonNullable<PlaywrightTestConfig['use']>, 'screenshot'|'video'|'trace'>}`. The app's `use` keeps all other fields. Spread caller config first; enforce owned keys after; `fullyParallel` defaults false but caller can set it. `projects` and `webServer` pass through, with default project only when absent. `testDir` is harness-owned through `shotsDir`. `outputDir` option means shotwright run root, never Playwright staging path. Runtime-owned `use` capture toggles override caller values, including nested project `use`; type and runtime tests cover both. Harness reporter cannot be removed by caller or passthrough; Playwright CLI override via `--reporter` is documented as unsupported because it can remove the writer.

**G8 guard:** outside `SHOTWRIGHT_RUN==='1'`, allow only `SHOTWRIGHT_CONFIG_PROBE_FILE` or `process.argv.includes('--list')`; otherwise throw from `defineShotsConfig()` before creating any run directory. E1 proves that this throw precedes Playwright's `test-results/` cleanup in the tested runner and that `--list` is visible in argv. `--list` does not create a run directory; the probe still writes only its output-dir file.

When the factory creates a run directory, it atomically writes its run path to `SHOTWRIGHT_RUN_DIR_FILE` if set, before tests launch. Before spawning, I-cli atomically unlinks any existing caller `--run-dir-file`/`SHOTWRIGHT_RUN_DIR_FILE` destination; if it is a directory or symlink, refuse and exit 2. I-cli supplies a fresh private run-dir-file to the child, then writes the caller's file only after the child exits **and** the private file exists, and prints `run-dir: <path>` as its final stdout line. If config fails before directory creation, the caller's file is absent and no line is produced, even when a previous invocation used that path. This is the C/L seam for failed-run CI upload; no scan of `latest` is involved.

`onEnd` order (one reporter process; independent workers have already finished):

1. Snapshot final `onTestEnd` result per test ID using highest retry; read only matching final-retry sidecars, remove earlier-attempt capture files only where no final-attempt sidecar owns the reused path, and validate composite identity and path layout.
2. Copy final-attempt failure attachments, video, trace, and data evidence from `.pw`/sidecars into contract paths. Record `publication.evidence`; accumulate per-file failures without aborting the rest. Ensure copied `error-context` survives `.pw` removal; print its new path in the reporter diagnostic since Playwright's earlier path will dangle (E2).
3. Remove `.sidecar/` after copying evidence; `publication.evidence` covers both evidence copying and `.sidecar/` removal, and any failure sets `{ok:false,error}` and blocks `latest`. `.pw` removal is best-effort in `onExit`, **outside publication**, including `.pw/.last-run.json` that Playwright may write after `onEnd`; a removal failure is logged only and never changes `publication` or `latest`. Never delete copied failure evidence. Assemble the in-memory manifest with `status=result.status`, final tests, shots, artifacts, failures, and the settled evidence result; `publication.gallery` is private/pending.
4. Generate self-contained gallery atomically from **the in-memory manifest**, without loading `manifest.json`; include statuses, evidence and diagnostics. Set `publication.gallery` success/failure, delete a stale or partial gallery on failure. A gallery diagnostic counts as failure. Rendered gallery may show a pending publication label only internally; after success its content must show the final success value (regenerate if required).
5. Atomically publish final `manifest.json` by temp/rename, including both final publication results. If the temp write or rename fails, delete `gallery.html` and any compare/diagnostic HTML written by this step so no artifact claims a completed publication; leave no manifest and classify the directory `incomplete`. Do not claim `latest`.
6. Update `latest` only if runner status is `passed`, both publication booleans are true, and manifest publication succeeded. Latest flip is atomic. Failed runs still have manifest/gallery when possible.

**C merge gate:** `test/smoke/contract-consumer.test.ts` drives `test/fixtures/contract-consumer/` through real Playwright. `pnpm run smoke` builds then runs `vitest run test/smoke`. Assertions: v2 writer and v1 adapter read; same name across specs allowed, duplicate within a spec rejected; failed test keeps copied `error-context` with newly printed path; no `.pw`/`.sidecar` after normal exit; `latest` unchanged on failed run and injected gallery failure, then promoted on success; bare-runner sentinel survives; `--list` succeeds; retry-0 capture followed by retry-1 no capture removes the old file/manifest entry, while retry-1 recapture supplies its own bytes and sidecar. `test/unit/reporter-gallery.test.ts` changes its old “publish before gallery” expectation and injects an `onExit` cleanup failure (manifest, gallery, latest unchanged) and manifest rename failure (no manifest/gallery, latest unchanged). C merges only after `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run smoke`.

## 4. Step list

Each bead is one PR except I-cli: PR 1 contains L1+L2 and merges in parallel with G and W against C; PR 2 contains only L3 and merges after G. Numbered steps are review checkpoints within those PRs. `C` merges first; `D` follows G, both L PRs, and W. Source fixtures are owned by the bead that creates them.

### I-contract (C) — schema, writer, capture, factory

**Exclusive files:** `src/manifest.ts`, `src/reporter.ts`, `src/capture.ts`, `src/index.ts`, `src/gallery/model.ts`, `src/gallery/generate.ts`, `package.json`, `pnpm-lock.yaml`, `test/unit/factory.test.ts`, `capture.test.ts`, `manifest.test.ts`, `reporter-gallery.test.ts`, `gallery-model.test.ts`, `test/smoke/contract-consumer.test.ts`, `test/fixtures/contract-consumer/**`, `docs/adr/0021-shot-identity-and-manifest-v2.md`, `.changeset/e10-contract.md`.

1. **C1 schema and ADR.** Implement v2 interfaces, strict v2/v1 adapter, composite identity, final-`onTestEnd` retry rule and atomic writer. Test: `manifest.test.ts`, `gallery-model.test.ts`, contract smoke v1/mixed schema. Done when same name across specs works, duplicate within spec fails, retry-0 files are removed when retry 1 omits capture, retry-1 recapture wins, and all missing v1 fields normalize. ADR 0021 uses template's Status/Date/Bead/Phase, Context, Decision, Alternatives weighed, Consequences, Reversal; compare global-name/v1-additive alternatives, explain public contract change.
2. **C2 capture and factory.** Implement `artifact`, `check`, suffix layout, typed config passthrough and guard. Tests: `capture.test.ts`, `factory.test.ts`, bare-run sentinel fixture. Done when passthrough and owned keys have type/runtime pins, filtered/thrown/no-op callbacks behave, and screenshot bytes remain equal for matching arguments.
3. **C3 reporter publication.** Copy evidence, record final attempts/tests/status, generate gallery in memory, then atomic manifest/latest; change `generate.ts` and `model.ts`. Tests: `reporter-gallery.test.ts` and contract smoke with gallery, manifest-rename, and `onExit` cleanup failures. Done when failed run has inspectable manifest and copied `error-context`, no incorrect latest, successful run promotes, manifest failure removes gallery, and late `.pw` cleanup failure only logs.
4. **C4 shared interfaces and dependency gate.** Add pixelmatch/pngjs plus types, land the typed declarations in C-owned `model.ts`. Run `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run smoke`. Done when G, L PR 1, and W compile from the contract commit and the real Playwright contract smoke passes; changeset requests a minor release.

**Merge prerequisite:** none; C must merge before G/L/W branch.

### I-gallery (G) — verdicts, review UI, safe serving

**Exclusive files:** `src/gallery/pixels.ts` and `compare-model.ts`, `src/gallery/render.ts`, `render-compare.ts`, `generate-compare.ts`, `server.ts`, `test/unit/gallery-render.test.ts`, `gallery-browser.test.ts`, `gallery-compare-model.test.ts`, `gallery-compare-render.test.ts`, `gallery-compare-generate.test.ts`, `gallery-server.test.ts`, `test/fixtures/compare-250-pairs.mjs`, `test/fixtures/compare-corpus/**`, `docs/adr/0022-compare-verdicts-are-review-aid.md`, `.changeset/e10-gallery.md`.

1. **G1 comparator and ADR.** Implement decoded raw equality, pixelmatch threshold/AA semantics, size and unreadable states, diff PNG, composite shot/artifact pairing and the `CompareGenerationResult` production return. `test/fixtures/compare-corpus/` contains identical/changed pairs for HTML body 10 KiB and 600 KiB, JSON 2 KiB, JSONL 300 KiB, and xlsx-like binary 50 KiB. Assert text-diff states for `text/*` and JSON and byte-equality state for binary, plus deterministic PNG states and mixed v1/v2. Done when `compare.json` records tool versions, threshold, includeAA, dimensions, counts/ratio, seven states and non-parity counts for shot and artifact pairs. ADR 0022 uses every template section, amends `docs/design.md` no-verdict language conceptually; I-docs edits design text in its owned phase after merge, while ADR lands with implementation.
2. **G2 render and serve.** Show run/test status and failure evidence, text/JSON previews with 256 KiB **ESTIMATE** cap, escaped HTML source, truncation/full download, artifact diffs, changed-first sorting. Build the allowlist with the single trace predicate in §3.2, covering shot and failure trace references for effective loopback/non-loopback binds and override. Tests: render/browser/server fixtures, MIME/path traversal, 256 KiB boundary, corpus escaped preview, truncation notice above cap, full download link, and GET/HEAD trace routes. Done when `pnpm run smoke` passes, UI is visually viewed in local and compare galleries, links work, and all trace route cases in §7 pass.
3. **G3 performance/artifact publication.** Atomically write HTML, `compare.json`, and diff PNGs under ADR 0009 `compare/` stem; measure elapsed time and peak RSS on 250 representative pairs and record fixture output in PR. Test: `gallery-compare-generate.test.ts` and measurement script. Done when generated artifacts are self-contained and recover from partial write; performance is measured, no unmeasured target promised.

**Merge prerequisite:** C only. G may merge before or after L PR 1 and W; L PR 2 follows G.

### I-cli (L) — run discovery, selectors, flags

**Exclusive files:** `src/cli.ts`, `src/runs.ts`, `src/gallery/resolve.ts`, `test/unit/cli.test.ts`, `runs.test.ts`, `gallery-resolve.test.ts`, `test/smoke/cli.test.ts`, `test/fixtures/cli-runs/**`, `.changeset/e10-cli.md`.

1. **L1 invocation path and probe (PR 1).** Add `--run-dir-file`/env fallback, invalidate the caller file before spawn with atomic unlink (directory/symlink exits 2), print final `run-dir: <path>` even on failed test once created, capture probe stdout/stderr and replay on failure only. Tests: `cli.test.ts`, `pnpm run smoke` invocation, E4 two-line-noise fixture. Done when the file points to this invocation only after child exit and private-file creation; a second config-failing invocation sharing the file leaves it absent and prints no run-dir line.
2. **L2 listing and selectors (PR 1).** Implement `listRuns` and `shotwright runs`, incomplete directory rows with status `incomplete` and null count/time, `--last` newest manifest-bearing by run-directory timestamp/id (tie by basename), explicit IDs and paths, compare paths. Reject symlink escapes and same canonical dir; ADR 0009 remains default output root. For external runs with colliding `runId`s, default filename appends a stable short digest of each canonical run path; `--output <file>` overrides. Tests: `runs.test.ts`, `gallery-resolve.test.ts`, `pnpm run smoke`. Done when `latest` unchanged and incomplete never masquerades as failed/zero.
3. **L3 compare and serve flags (PR 2, after G).** Wire `--fail-on-change` to G's production `CompareGenerationResult.gate.nonParity`, `--include-traces` to G's `startGalleryServer` option, and usage/selection labels. Test: `cli.test.ts` and `pnpm run smoke` against merged G. Done when default compare exits 0 for rendered changes and opt-in exits 1 for every non-parity shot or artifact state.

**Merge prerequisites:** L PR 1: C only. L PR 2: merged L PR 1 and G. L owns no G source file; the two-PR split is the explicit exception to one PR per bead.

### I-consumer-ci (W) — reusable workflow and init

**Exclusive files:** `.github/workflows/shotwright.yml`, `templates/github/shotwright.yml`, `src/init.ts`, `templates/init/shots.config.ts`, `templates/skills/shots-harness/SKILL.md`, `scripts/ci/shots.sh`, `test/unit/init.test.ts`, `template-pin.test.ts`, `test/fixtures/actions-proof/**`, `proof/**` on its branch only, `.changeset/e10-consumer-ci.md`.

1. **W1 WIP integration.** Start from `git show 9de261c` (working-directory precheck, package check, cache path, proof fixtures), port deliberately into W branch; replace pnpm-only assumptions. Tests: init/template tests and Actions proof fixture. Done when both root self mode and nested npm consumer work; proof workflow stays branch-only and is excluded from PR merge tree.
2. **W2 input and failed-run contract.** Implement exactly G10 inputs; `runs-on` JSON array through `fromJSON`, manager choice/lockfile detection, Node 24, `playwright-args` as a JSON string array (default `["--workers=1"]`, parsed without shell evaluation), `traces:false` recording default, `retention-days`, `!cancelled()` upload of CLI run-dir-file even after failed run, existing `if-no-files-found:error`. Reject passthrough `--trace`, `--reporter`, and `--output` overrides that would bypass recording/publication invariants; map caller credentials through documented `secrets: inherit`/explicit secrets, not an assumed env handoff. Tests: workflow static checks, `pnpm run smoke`, real branch Actions proof of passed/failed uploads and nested npm consumer, plus one recorded advisory forge self-mode run proving the invocation run-dir-file upload path. Done when artifact includes only current invocation, no default trace, and all three proof lanes are recorded.
3. **W3 init.** Find containing git root for workflow/skill, package dir for config/spec/package scripts; detect explicit manager then package-local metadata then lockfile then launch user agent; ambiguous metadata errors. Preserve no-overwrite. Tests: temp nested repos, npm/pnpm/yarn variants, symlink/outside-root and conflicting files. Done when generated caller sets `working-directory`, pin matches release tag policy, and commands fit selected manager.

**Merge prerequisite:** C only. Real GitHub Actions and an advisory forge self-mode run are required evidence. The proof workflow from `9de261c` runs only on W branch and is never merged.

### I-docs (D) — migration and release

**Exclusive files:** `README.md`, `docs/design.md`, `docs/shotwright-746.28-migration.md`, `.changeset/shotwright-746-28.md`. The four wave changesets remain owned by their original beads; Changesets combines their minor requests into one 0.2.0 release. No package or lockfile edits.

1. **D1 public guidance.** Document G1 owned keys, ordering/serial semantics, `checked` meaning, artifact MIME/preview, statuses and v1 adapter, capture paths, compare states/gate, run selectors, trace disclosure for all evidence, npm/yarn/pnpm init, CJS floor `^20.19 || >=22.12`, and fullPage difference. Test: link/command smoke against built CLI and packed Node 24 CJS require of root and capture exports. Done when commands match actual flags and no host path appears.
2. **D2 release notes.** Add the migration overview changeset, verify the combined pre-1.0 minor requests produce 0.2.0, and cover v1/mixed-run and path changes; update design's “no verdict” text to reflect opt-in gate and link ADR 0022. Test: changeset status/dry version check, leak gate. Done when 0.2.0 is requested without editing `package.json` version by hand; V records the owner-authorized publication as the new minor version before epic closure.

**Merge prerequisite:** C, G, L, W. D is last implementation PR; V begins after it.

## 5. Parallel-safety check

| File or disjoint glob | C | G | L | W | D |
|---|:---:|:---:|:---:|:---:|:---:|
| `src/manifest.ts`, `reporter.ts`, `capture.ts`, `index.ts`, `src/gallery/model.ts`, `generate.ts` | ✓ | | | | |
| `src/gallery/pixels.ts`, `compare-model.ts` | | ✓ | | | |
| `src/gallery/render.ts`, `render-compare.ts`, `generate-compare.ts`, `server.ts` | | ✓ | | | |
| `src/cli.ts`, `runs.ts`, `src/gallery/resolve.ts` | | | ✓ | | |
| `.github/workflows/shotwright.yml`, `templates/github/shotwright.yml`, `src/init.ts`, `scripts/ci/shots.sh`, `templates/init/**`, `templates/skills/**` | | | | ✓ | |
| `package.json`, `pnpm-lock.yaml` | ✓ | | | | |
| `README.md`, `docs/design.md`, migration doc | | | | | ✓ |
| `test/unit/{factory,capture,manifest,reporter-gallery,gallery-model}.test.ts`, `test/smoke/contract-consumer.test.ts`, `test/fixtures/contract-consumer/**` | ✓ | | | | |
| `test/unit/gallery-{render,browser,compare-model,compare-render,compare-generate,server}.test.ts`, `test/fixtures/compare-*/**` | | ✓ | | | |
| `test/unit/{cli,runs,gallery-resolve}.test.ts`, `test/smoke/cli.test.ts`, `test/fixtures/cli-runs/**` | | | ✓ | | |
| `test/unit/{init,template-pin}.test.ts`, `test/fixtures/actions-proof/**`, branch-only `proof/**` | | | | ✓ | |
| `docs/adr/0021-*`, `0022-*` | ✓ | ✓ (different files) | | | |
| `.changeset/e10-*.md`, `.changeset/shotwright-746-28.md` | one distinct file | one distinct file | one distinct file | one distinct file | one distinct file |

**README:** D alone edits it; wave delegates place release-facing user text in their own `.changeset/<bead-slug>.md`. **Lockfile:** C alone changes `pnpm-lock.yaml`. C's shared signatures remain in its owned `src/gallery/model.ts`; G's implementations live in G-owned files. D does not edit wave changesets. No delegate modifies shared `test/fixtures/png.ts`, `demo/`, or workflow wrappers without a plan amendment; tests add disjoint fixture directories instead.

## 6. Risks and rollback

| Bead | Risk and deterministic check | Rollback |
|---|---|---|
| C | v1 adapter may imply false publication success; source-version label and mixed compare test prevent that. Finalization can leave inconsistent manifest/gallery on generation or cleanup failure; injected failures and real fixture pin order. Duplicate/retry sidecars can race; deterministic assembly and final-attempt fixture pin it. | Revert C PR before wave; existing v1 files remain readable by 0.1.1. Once wave merges, revert whole 0.2.0 wave rather than partially downgrading schema. |
| G | Inline gallery size and 250-pair decode cost are **ESTIMATE (unverified)** until G3 records HTML bytes, elapsed time, and peak RSS. 256 KiB cap is **ESTIMATE**; boundary fixture checks UX. PNG decoder may reject previously accepted malformed bytes; unreadable state keeps review available. | Revert G PR; C manifests remain valid, CLI gate must be disabled/reverted with it. |
| L | External path selectors can escape or collide; canonical path checks and collision fixture. CLI file may be absent after pre-config failure; CI treats that as no invocation artifact. | Revert L and W together if workflow already depends on run-dir-file; `latest` semantics never change. |
| W | Actions contexts/runner labels and failed upload need a real GitHub run; static YAML tests are insufficient. `9de261c` proof workflow is branch-only and never merged. Self mode vs nested npm mode may diverge; prove both. | Revert W workflow/template/init PR and use prior release-tag caller; no public 0.2.0 tag until proof passes. |
| D | Migration may overpromise CJS versions or gate behavior; packed Node 24 smoke and actual CLI command review. | Revert D PR; retain wave changesets until corrected docs are ready. |

Publication is atomic at each file rename but the gallery/manifest pair is not one filesystem transaction; manifest is authoritative and `latest` only moves after all required files exist. Failed manifest publication removes gallery and leaves the run incomplete. `.pw` cleanup in `onExit` is best-effort and outside publication. Distinct run directories isolate concurrent invocations. Compare output overwrites one pair stem atomically; concurrent compares of the same pair need unique temp names and last-writer-wins. Run listing is a read-only snapshot and may show a just-created incomplete dir.

**Redteam dispositions**

| Finding | Disposition | Plan change |
|---|---|---|
| F01 | Fix now | L1/L2 merge against C; L3 follows G and uses its exact production exports. |
| F02 | Fix now | Final `onTestEnd` retry selects sidecars and superseded files are removed. |
| F03 | Fix now | `.pw` cleanup is best-effort `onExit` work outside publication. |
| F04 | Fix now | Manifest write failure removes generated HTML and leaves an incomplete run. |
| F05 | Fix now | CLI invalidates the caller run-dir-file before child spawn. |
| F06 | Fix now | One allowlist predicate governs shot and failure trace routes. |
| F07 | Fix now | Named real-Playwright contract smoke gates C merge. |
| F08 | Plan item | G corpus covers representative text, JSON, JSONL, and binary pairs. |
| F09 | Plan item | W records advisory forge self-mode proof beside Actions and nested npm. |

## 7. Pins

| Load-bearing assumption | Deterministic pin | Bead.step |
|---|---|---|
| Finalization order and latest condition | Inject gallery throw/diagnostic and evidence failure; inspect manifest/latest/temporary files | C3 |
| Final-attempt selection | Retry 0 capture then retry 1 fails before `shot()`: no shot or artifact row and old file deleted; retry 1 recaptures: retry-1 bytes and sidecar win | C1 |
| Late `.pw` cleanup | Inject `onExit` failure in `reporter-gallery.test.ts`; manifest, gallery and latest stay untouched; failure logged only | C3 |
| Manifest rename failure | Inject temp/rename failure; no manifest or gallery, directory incomplete, latest unchanged | C3 |
| Duplicate within spec; across specs allowed | Multi-worker two-spec same name and same-spec two-test duplicate | C1/C3 |
| v1 adapter defaults and legacy label | Handwritten v1 fixture, strict v2 validator, “unrecorded” UI | C1/G2 |
| Mixed-version compare | v1 0.1.1 fixture versus v2 fixture with identical composite key | G1 |
| Similar versus identical | Decoded equal, raw pixel difference below threshold, visible difference above threshold corpus | G1 |
| Effective-bind trace policy | GET and HEAD of shot trace and failure-trace paths on `127.0.0.1`, `::1`, `0.0.0.0`, `::`, and a LAN address, with and without override | G2/L3 |
| Incomplete run listing | Manifestless dir and malformed manifest counts/status | L2 |
| Run-dir-file after failed run | Two runs with old latest; second fails after creation, file and final line point to second; second fails at config before creation, shared file absent and no line; directory/symlink exits 2 | L1/W2 |
| Contract smoke gate | `test/smoke/contract-consumer.test.ts` via `pnpm run smoke` builds and drives real Playwright; C merge runs typecheck, lint, test, smoke | C4 |
| G8 guard and cleanup order | Bare runner sentinel remains, `--list` succeeds, probe succeeds | C2 |
| CJS smoke at Node 24 | Packed package `require('shotwright')` and `/capture` in distinct CJS consumer | D1 |
| 250-pair measurement | Fixture records wall time, peak RSS, HTML bytes and representative image dimensions | G3 |
| Artifact compare corpus and cap | `test/fixtures/compare-corpus/`: HTML 10/600 KiB, JSON 2 KiB, JSONL 300 KiB, xlsx-like binary 50 KiB, each identical/changed; text-diff for `text/*` and JSON, byte-equality for binary, escaped preview, notice above 256 KiB **ESTIMATE** cap, full download | G1/G2 |
| Suffix stripping | Nested matched specs and canonical spec unchanged | C2 |
| Slug collisions | Equal titles, distinct IDs, forced 12-hex collision and duplicate attachment names | C3 |
| No-op check callback | Resolved no-op gives `checked:true`; thrown/filtered give no shot | C2 |
| Config passthrough/owned keys | Type test plus runtime test for setup/workers/expect/project use | C2 |
| Failure attachment name and path | Browser failure yields `error-context` `text/markdown`, copied path exists after sweep | C3 |
| Probe noise | Capture stdout/stderr; success silent, failure replays both | L1 |
| FullPage bytes | Tall-page fixture compares default `shot` to explicit full-page PNG | C2 |
| Data MIME, path, size | UTF-8/body/path fixtures, traversal and duplicate rejection | C2/G2 |
| CI inputs and failed artifact | Real branch Actions passed/failed and nested npm proofs; one recorded advisory forge self-mode run checks invocation run-dir-file upload path | W2 |
| Init root/manager ambiguity | Temp git roots, conflicting lockfiles, npm/pnpm/yarn | W3 |

## 8. Acceptance mapping

The clauses below are from the verbatim epic acceptance in §1. Each G1–G13 item is shipped or recorded as considered-and-declined with a reason in phase docs; V checks that ledger.

| Step | G-item(s) | Epic acceptance clause | Bead |
|---|---|---|---|
| C1 | G3,G5 | Generic shot names reused across specs; manifest with run/per-test status and final retry | I-contract |
| C2 | G1,G2,G7,G8,G13a,G13d,G13f | GlobalSetup and ordered multi-test flows without spreading config or wrapping `shot()`; data outputs | I-contract |
| C3 | G3,G4,G13b | Failed run retains evidence and publishes manifest; successful run promotes `latest` | I-contract |
| C4 | G6 | Comparator declarations and runnable browser contract gate | I-contract |
| G1 | G5,G6,G7 | Parity comparison without shelling out to cmp/ImageMagick; artifact pairs | I-gallery |
| G2 | G3,G4,G7,G9 | Gallery and compare show status and evidence; trace serving policy | I-gallery |
| G3 | G6 | Self-contained compare output and measured cost | I-gallery |
| L1 | G10,G13c | Failed-run invocation path for reusable workflow | I-cli PR 1 |
| L2 | G12 | Failed run reachable through `shotwright runs` / `--last`; path selectors | I-cli PR 1 |
| L3 | G6,G9 | Opt-in parity gate and trace override | I-cli PR 2 |
| W1/W2 | G9,G10 | Subdirectory npm repo adopts reusable workflow; failed upload | I-consumer-ci |
| W3 | G11 | Consumer adopts via `shotwright init` | I-consumer-ci |
| D1/D2/V | G1–G13 | Every item shipped or considered-and-declined with reason in phase docs; new minor version published with changesets before epic closure | I-docs/V |

## 9. Proposed bead records

The orchestrator creates these verbatim. “blocked-by” is bead dependency, not an approval request.

| Bead | Title | Labels | Blocked-by |
|---|---|---|---|
| I-contract | E10.I contract — manifest v2, capture and publication | `core`, `migration` | `shotwright-746.28.2` |
| I-gallery | E10.I gallery — verdicts and review surfaces | `gallery`, `compare` | I-contract |
| I-cli | E10.I CLI — run discovery and compare controls (two PRs) | `core`, `compare` | PR 1: I-contract; PR 2: I-gallery and merged PR 1 |
| I-consumer-ci | E10.I consumer CI — portable workflow and init | `ci`, `init` | I-contract |
| I-docs | E10.I docs — 0.2.0 migration guidance | `docs`, `migration` | I-gallery, I-cli, I-consumer-ci |
| V | E10.V verify first external consumer adoption | `core`, `gallery`, `compare`, `ci`, `init`, `docs`, `migration` | I-docs |

**I-contract description:** Implement the schema and capture contract in §3, including v1 reads, final-retry/duplicate assembly, failure evidence, in-memory gallery before atomic manifest, factory passthrough, guard, paths, and typed wave seams. Own dependency and lockfile updates. **Acceptance:** `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run smoke` green; v2 writer/v1 adapter, status/publication, checked/artifacts/failures, stable paths, late cleanup and latest invariants observed; ADR 0021 and minor changeset present.

**I-gallery description:** Implement seven-state PNG and artifact comparison on the C contract, generate diff/JSON/HTML, show statuses and failure/data evidence, and enforce effective-bind trace serving for shot and failure traces. Own comparator/render/server files and ADR 0022. **Acceptance:** representative corpus and mixed-version fixtures green, `CompareGenerationResult` available to CLI, 250-pair elapsed/RSS/HTML measurement recorded, `pnpm run smoke` green, gallery UI viewed, no unescaped HTML or LAN trace route by default.

**I-cli description:** PR 1 implements invocation run-dir reporting/file, quiet config probe, run listing, `--last`, external compare paths and `--output` against C; PR 2 implements only opt-in gate and trace override after G merges. This is the explicit two-PR exception for one bead. **Acceptance:** stale caller file is cleared before spawn; failed invocation points to its own run; incomplete listing is honest; external selectors remain contained; default compare returns zero after render and gate returns one for non-parity; `pnpm run smoke` passes for both PRs.

**I-consumer-ci description:** Incorporate the working-directory WIP into the expanded reusable workflow and root-aware, manager-aware init. Preserve both GitHub and forge self lanes while supporting nested npm consumers. **Acceptance:** exact input list, default traces off, failure upload uses current run-dir-file, real branch Actions proof for pass/fail and nested consumer, recorded advisory forge self-mode run, `pnpm run smoke` green, no proof workflow merged; generated caller and commands pass init fixtures.

**I-docs description:** Reconcile public documentation and the source design with the shipped 0.2.0 behavior, and verify the combined minor changesets. **Acceptance:** README and migration doc cover every changed contract, packed Node 24 CJS smoke passes, design links verdict ADR, changesets request 0.2.0, no host path leaks.

**V description:** Verify the merged E10 implementation against the verbatim epic acceptance in §1 and every pin in §7, recording commands and observed gallery/Actions/forge artifacts in `docs/<V-bead-id>-verification.md` without implementation edits. **Acceptance:** checklist maps each epic clause and G1–G13 disposition to evidence; typecheck, lint, unit/smoke, browser UI view, real Actions and forge proofs, leak gate, mixed v1/v2 compare, failed-run upload, 250-pair measurement, and owner-authorized 0.2.0 publication are recorded; discrepancies reopen an I bead.

## 10. Open questions

1. **Release timing:** the plan targets 0.2.0 via changesets; publishing/tagging is a separate owner action after V's checks and before epic closure. No implementation decision remains open. All empirical questions have pins in §7.

## 11. Self-review rubric

| Lens | Result | Reason |
|---|---|---|
| Measured-or-flagged | **Pass** | 250-pair cost, HTML size and 256 KiB cap are marked ESTIMATE until measurements. |
| Derived-value semantics | **Pass** | Status, publication, legacy defaults, retry, counts, checked and incomplete rows have edge-case meanings. |
| Emergent structure | **Pass** | Composite keys, sort order, slug collision, run selection and sidecar cardinality are explicit and pinned. |
| Batch/concurrency | **Pass** | Reporter publication/cleanup order, atomic files, parallel ownership and compare overwrite policy are explicit. |
| Inherited-constraints-grounded | **Pass** | §1 quotes epic acceptance verbatim; §8 maps its clauses and §7 pins inherited empirical claims. |
