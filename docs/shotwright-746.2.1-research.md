# shotwright-746.2.1 — E2.R Research: demo app shape

- **Doc:** research (R phase)
- **Bead:** shotwright-746.2.1 · parent epic shotwright-746.2 (E2 Demo app)
- **Date:** 2026-07-29
- **Status:** signed off (owner decisions 2026-07-29, amended post-redteam) —
  serving/toolchain decision recorded in [ADR 0004](adr/0004-demo-vite-toolchain.md)
- **Provenance:** researched and redteamed by delegated agents;
  synthesized and verified by the reviewer. Raw reports archived outside the repo.

## Context

E2 replaces the two-page smoke stub with the package's own test bed and CI proving
ground: a tiny static multi-page demo whose example `*.shots.ts` specs double as
living documentation. Epic acceptance: *shotwright run against the demo produces a
full capture set from a fresh clone with only pnpm install + browser install;
example specs double as living documentation.*

### Premise corrections (verified against the code)

1. The "two-page stub" framing is accurate (`demo/index.html`, `demo/about.html`),
   but the demo is **not currently Vite-served** — a zero-dependency Node static
   server serves `demo/` on `127.0.0.1:4173` (`demo/serve.mjs:1-37`).
2. A literal fresh clone cannot run the demo today: the config and specs import
   built `dist/` (`demo/shots.config.ts:4`, `demo/shots/home.shots.ts:1`), which
   only the explicit build/smoke scripts create (`package.json:36-42`).

### Owner decisions (2026-07-29)

| Question | Decision |
|---|---|
| Vite adoption | **Vite 8.1.x as a direct root devDependency** |
| Public Node floor | **Unchanged at `>=20`** — Vite 8's Node 20.19+ requirement is a contributor/demo-tooling floor, documented in ADR 0004, not a published `engines` change. (Amended post-redteam: the original raise-the-floor choice answered a false dichotomy — a dev-only tool does not constrain the package's runtime. Consumers on node 20.0–20.18 keep installing cleanly.) |
| Fresh-clone contract | **`pnpm run demo:shots`** is the sanctioned entry point; it builds `dist/` internally then invokes the CLI. No postinstall hooks, no committed `dist/`. |

### Ecosystem grounding (web-searched 2026-07-29, not from memory)

- **Vite stable is 8.1** (8.1.5 on npm); Vite 8 is Rolldown-based and requires Node
  `^20.19.0 || >=22.12.0` ([releases](https://vite.dev/releases),
  [announcement](https://vite.dev/blog/announcing-vite8)). Already in our lockfile
  transitively via Vitest 4 (`pnpm-lock.yaml:35-37`) — adopting it directly adds no
  new resolution.
- **`build.rolldownOptions` is the Vite 8 spelling**; `build.rollupOptions` survives
  only as a deprecated alias ([migration guide](https://vite.dev/guide/migration.html)).
  New config must not copy older examples.
- **Playwright `webServer`**: command runs with cwd defaulting to the config
  directory, 60 s default readiness timeout, and `reuseExistingServer: !process.env.CI`
  is the documented recommendation ([docs](https://playwright.dev/docs/test-webserver)).
- **`@playwright/test` 1.62.0** remains current, matching our pin (`package.json:46-49`).

## Current state: what exists and what must survive

| File | Today | E2 treatment |
|---|---|---|
| `demo/index.html` | Placeholder home | Becomes form + modal + theme-toggle page |
| `demo/about.html` | Second page (exists to give smoke two specs) | Becomes the responsive-layout page |
| `demo/serve.mjs` | Custom static server | **Deleted** — replaced by Vite dev server |
| `demo/shots.config.ts` | Imports `../dist/index.js`, sets baseURL + webServer | Same location/role; server command changes; reuse becomes `!process.env.CI` |
| `demo/shots/*.shots.ts` | One walkthrough each, 3 shots total | Expand to the 5-state matrix below; imports become bare package names |
| `test/smoke/cli.test.ts` | Runs built CLI, checks manifest v1, PNGs, symlink, staging cleanup (`test/smoke/cli.test.ts:22-77`) | Retained as integration proving ground; inventory + flag matrix extended |

Invariants preserved: two independent spec files (manifest multi-worker assembly),
`/` and `/about.html` routes, testing against built `dist/` not `src/`,
`127.0.0.1:4173`, at least one locator shot, and all existing manifest/PNG/symlink/
cleanup assertions.

## Recommendation

### Pages and states — two pages, five captures

| Page / spec | State | Demonstrates |
|---|---|---|
| `/` · home | `form-filled` | Semantic form fill + default full-page `shot()` |
| `/` · home | `modal-open` | State transition + `{ locator: getByRole('dialog') }` element capture |
| `/` · home | `theme-dark` | Deterministic dark-mode toggle |
| `/about.html` · about | `about-desktop` | Second entry, desktop baseline for the mobile comparison |
| `/about.html` · about | `mobile-layout` | `setViewportSize(390×844)` responsive capture |

Framework-free implementation: `index.html`, `about.html`, shared `styles.css`,
small `demo.js`. No network, persistence, router, or fixtures.

**Constraint (verified):** do **not** model mobile as a second Playwright project —
shot names are globally unique per run (`src/manifest.ts:91-101`) and output paths
derive only from spec + shot name (`src/capture.ts:41-45`); duplicate projects
would collide at manifest assembly. In-walkthrough viewport change is the
compatible design; multi-device is a future manifest-schema feature.

### Serving: Vite dev server for capture, `vite build` as a separate gate

`webServer.command` runs `vite dev` pinned to `127.0.0.1:4173` with `strictPort`
(pinned once, in `demo/vite.config.ts`, not repeated in the command), with
`reuseExistingServer: !process.env.CI`.

The research initially recommended chained `vite build && vite preview`. The
redteam broke it (finding A1): `preview` serves an immutable build and
`reuseExistingServer` skips the command entirely when the port is occupied — so a
stale preview from an earlier session silently yields **captures of old code
presented as current evidence**. That is false reporting, our fix-now bar.
`vite dev` serves current sources by construction, so server reuse stays safe and
convenient locally. The multi-page **production** build is still proven — both HTML
entries declared under `build.rolldownOptions.input` — by a standalone
`pnpm run demo:build` quality gate wired into verification, without inserting a
build stage into every capture invocation. This also matches the design doc, which
treats consumer boot as stack-agnostic with `vite dev` as a normal server command
(`docs/design.md:57-61`).

### Example specs as living documentation

Specs and config import **bare package names** (`shotwright`,
`shotwright/capture`) via Node package self-reference — verified to resolve
through our exports map (`package.json:19-31`) both under `tsc` and through the
CLI's Playwright config loading. Copy-paste then means copy-paste.

Redteam finding B1 (accepted, plan pin): `demo/**/*.ts` is outside every current
type gate — `tsconfig.json` includes only `src`/`test`, the build emits only
`src`, and Playwright transpiles without typechecking. The plan must add demo
files to a no-emit typecheck target, or the "living documentation" can be
type-broken while all gates stay green.

Specs demonstrate: `walkthrough` naming, semantic locators, baseURL-relative
navigation, default full-page + locator captures, stable `--only`-friendly names,
sequential states without pixel assertions. They must **not** demonstrate
app-specific helpers, mocking, snapshot expectations, manual output paths, or raw
`page.screenshot()`.

### Layout and fresh clone

`demo/` stays root-integrated (no workspace package; not in `templates/` — that is
E6's consumer-scaffold surface). Vite is a root devDependency; the published
artifact remains `dist` + `templates` only (`package.json:15-18`), so nothing here
ships to consumers. ADR 0002 (peer Playwright) and ADR 0003 (tsc-only package
build) are untouched — Vite builds the demo, never the package.

Fresh-clone contract:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm run demo:shots   # builds dist/, then node dist/cli.js run --config demo/shots.config.ts
```

### Smoke/test matrix (redteam-hardened)

Redteam finding A2 (accepted): a single combined `--only --video --trace` run
cannot prove any flag independently — it passes under swapped video/trace wiring,
flags coupling, or second-spec artifact loss, all real independent contracts in
the code (`src/cli.ts:32-39`, `src/index.ts:50-55`, `src/reporter.ts:47-75`).
Required runs:

| Run | Pins |
|---|---|
| Unfiltered, `--workers=2` | 5 shots, both specs, sorted valid manifest v1, `latest` moved, staging cleaned |
| `--only` standalone | Filter semantics: walkthroughs still run, only matching shots written |
| `--video` only, selection spanning both specs | Video wiring + per-spec artifact association independently |
| `--trace` only, selection spanning both specs | Trace wiring + association independently |

Finding B4 (accepted, honestly scoped): the current smoke never passes a worker
count (`test/smoke/cli.test.ts:22-28`), so "multi-worker assembly" is currently
asserted by vibes. The plan pins `--workers=2` and asserts Playwright's
`using 2 workers` output — which proves capacity, not interleaving; genuine
overlap evidence (e.g. worker-id in sidecars) is noted as a possible follow-up,
not smuggled into acceptance.

## Redteam ledger

Gate run 2026-07-29, one pass (per convention). Fix-now findings **A1** (stale
preview reuse → serving model changed) and **A2** (combined flag run → matrix
split) absorbed above, with **B1** (demo typecheck gap), **B2** (engines false
dichotomy → public floor kept), **B3** (build-per-capture scaffolding → build
became a gate), **B4** (worker-count honesty) as plan pins.

Considered and declined:

- **Drop `about-desktop` (4-shot minimum).** Declined: the fifth shot costs one
  capture, provides the desktop/mobile comparison a reviewer actually wants, and
  gives the about spec two shots — which the video/trace independence runs need
  for their "selection spanning both specs" requirement.

## Open questions for P

1. Exact `demo:*` script names and composition (`demo:shots`, `demo:build`, CI
   variants) and where `demo:build` sits in the verification pipeline.
2. Demo typecheck mechanics: extend root `tsconfig.json` include vs a
   `tsconfig.demo.json` — pick whichever keeps `pnpm run typecheck` one command.
3. Smoke runtime budget: four CLI runs replace one; measure and, if needed, scope
   video/trace runs to `--only` selections to keep the suite fast.
4. Cold `vite dev` readiness vs Playwright's 60 s default timeout in CI: measure,
   don't assume.
