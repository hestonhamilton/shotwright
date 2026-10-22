# shotwright — design

- **Doc:** project design (source of truth)
- **Date:** 2026-07-29
- **Status:** committed
- **Decisions record:** [ADR 0001](adr/0001-package-on-test-runner.md)

## 1 · Why this exists

Three sibling projects independently grew a "playwright shots harness" — a scripted
walkthrough of the real UI that writes screenshots for a human to eyeball. Each solved
the same problem a different way, and each rebuild re-paid the same costs (output
layout, stack boot, filtering, delivery to a phone, docs for the next agent).

| Project | Style | What it taught |
|---|---|---|
| **Consumer A** | Single-page app: single script over a dev-gated mock-API shim | Deterministic fixtures need no backend; a `?mock=` scenario registry; typed fixtures catch API drift. |
| **Consumer B** | Frontend in a monorepo: per-flow scripts against the real dev stack | Real-stack captures are the honest review artifact ("unviewed UI change does not ship"); scripts multiply fast without shared structure. |
| **Consumer C** | Framework app at the workspace root: Playwright *test-runner* with its own runner config and shot specs | The most evolved: webServer auto-boots the stack, `SHOTS_ONLY` filtering, video config, gate-safe spec directory, a proper skill doc. |

**shotwright** centralizes the pattern: one npm package carrying the harness,
review-artifact tooling, CI workflow, and agent-facing skill — so a consuming project
keeps only thin config and its own specs.

## 2 · Decisions

Settled 2026-07-29 with the owner; alternatives and rationale in
[ADR 0001](adr/0001-package-on-test-runner.md).

| Axis | Decision |
|---|---|
| Distribution | **npm package**, published to the npm registry. Projects install it; fixes flow by upgrading the dep. |
| Engine | **Playwright test-runner** — `*.shots.ts` specs run via `playwright test` with a shotwright-provided config. Videos, traces, and reporting come free; specs live outside the consumer's e2e gate. |
| Philosophy | **Review artifacts, not assertions.** Output is throwaway, regenerated, gitignored. Compare computes verdicts for review; `--fail-on-change` makes parity gating opt-in ([ADR 0022](adr/0022-compare-verdicts-are-review-aid.md)). |
| Local tooling | Gallery, run comparison, trace/video helpers, and an agent skill — all in scope (§4). |
| CI | **Artifacts only by default**: a reusable GitHub Actions workflow uploads the current run directory, including failed-run evidence when available; compare's optional gate is a separate caller choice. |
| Self-testing | A tiny static demo app in-repo; shotwright's own example specs and CI run against it. |
| Repo | Public (`hestonhamilton/shotwright`): no host paths, LAN IPs, or personal data committed. **AGPL-3.0-or-later** (ADR 0018). |

## 3 · Architecture

### 3.1 · Package surface

```ts
import { defineShotsConfig } from 'shotwright'          // playwright config factory
import { shot, walkthrough } from 'shotwright/capture'  // in-spec helpers
```

```
shotwright run [--only checkout,cart] [--video] [--trace]   # drive a shots run
shotwright runs                     # list run status, including incomplete runs
shotwright gallery [run-id|--last]  # (re)generate + serve the gallery
shotwright compare A B [--fail-on-change] # verdicts, diff and optional exit gate
shotwright trace <shot-name>       # PLANNED (E5, not yet implemented) — open the trace
shotwright init                    # scaffold config/spec/skill/CI into a project
```

- **`defineShotsConfig(opts)`** wraps `defineConfig`: sets the spec directory (default
  `shots/`), output layout, viewport/DSF defaults and capture toggles, while passing
  Playwright options such as `globalSetup` and `webServer` through. It owns
  `testDir`, `testMatch`, `retries`, `reporter`, Playwright staging `outputDir`,
  and `use` capture toggles. `fullyParallel` defaults to false.
- **`shot(page, name, opts)`** captures a PNG into the run's output layout and records a
  manifest entry (spec/name identity, viewport, fullPage vs clipped, timing, test
  linkage, `checked`, retry). An optional `check` callback runs before capture;
  `artifact()` stores MIME-tagged data. Learned capture gotchas live here or in
  documented helpers, not in every consumer's specs.
- **Filtering**: `--only` substring filtering à la consumer C's `SHOTS_ONLY` (the
  walkthrough still runs; only writes are filtered).

### 3.2 · Output layout + manifest

```
shots-output/
  <run-id>/                  # timestamp-slug, e.g. 2026-07-29T14-02_a1b2
    manifest.json            # v2 run/test/publication status, shots, data and failures
    shots/<spec>/<name>.png
    data/  failures/          # data artifacts and retained failure evidence
    video/  trace/           # when enabled
    gallery.html             # self-contained, servable, phone-friendly
  latest -> <run-id>         # symlink
```

The **manifest is the contract**: gallery and compare consume it rather than
globbing. Trace tooling is planned (E5). New runs write v2; readers adapt v1 in
memory and label its outcome unrecorded. `latest` moves only after a passed run
is fully published. Everything under `shots-output/` is gitignored; specs are committed.

### 3.3 · Consumption story (per project)

```
pnpm add -D shotwright @playwright/test
pnpm exec shotwright init                       # package config/specs and Git-root skill/workflow
pnpm shots                                     # package.json script → shotwright run
```

A consumer owns: its specs, its `webServer`/boot config, any app-specific driver helpers
(navigation, login flows). shotwright owns everything a second project would otherwise
copy-paste.

### 3.4 · Agent skill glue

`templates/` ships a `shots-harness` SKILL.md (consumer C's skill, generalized) that
`init` copies into the consumer. It teaches an agent to run the harness, add specs
additively, and **deliver captures as files** or via a served gallery URL — making
the "an unviewed UI change does not ship" gate cheap. The skill is a template, not a
runtime dependency: projects may append app-specific gotchas below a marked line that
upgrades preserve.

### 3.5 · CI

A reusable workflow (`workflow_call`) + a template the `init` drops in: install
the selected npm, pnpm or yarn package in `working-directory`, run shotwright,
and upload the current invocation's directory, including failed-run evidence
when present. Traces default off. Compare writes verdicts and JSON by default;
only a caller choosing `--fail-on-change` turns non-parity into an exit gate.

## 4 · Epic map

Tracked in beads under the `shotwright` umbrella; each epic grows R/P/I/V children when
it unblocks.

| Epic | Delivers | Depends on |
|---|---|---|
| **E1 · Core capture** | `defineShotsConfig`, `shot()`, output layout + manifest, `run`/`--only` CLI, package build/tooling | — |
| **E2 · Demo app** | Static multi-page demo + example specs; the package's own test bed | E1 |
| **E3 · Gallery** | Self-contained `gallery.html` + LAN serve command | E1 |
| **E4 · Run comparison** | `compare A B` paired gallery | E3 |
| **E5 · Trace/video helpers** | `trace` command, video toggles, frame-picking | E1 |
| **E6 · init + agent skill** | `shotwright init`, templates, generalized skill | E1–E3 |
| **E7 · CI workflow** | Reusable artifacts-only workflow, proven on the demo app | E2 |
| **E8 · Migrations** | Consumers A, B and C onto shotwright (one child each; consumer C first — it's closest to the target shape) | E6 |

## 5 · Open questions

> **Monorepo pressure.** If the gallery grows real UI, does it stay inline-HTML
> generation (lean, current default) or become a built asset? Revisit at E3 planning,
> not before.

> **Mock-api pattern.** Consumer A's dev-gated fetch shim is app code, not harness code.
> Decide at E8 (consumer A) whether shotwright documents the pattern (likely) or ships helpers
> for it (only if a second project wants one).

> **Playwright version coupling** — *resolved 2026-07-29*: peer dependency
> `>=1.60 <2`, consumer-side browser install. See
> [ADR 0002](adr/0002-playwright-peer-dependency.md).
