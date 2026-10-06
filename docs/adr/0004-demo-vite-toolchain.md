# ADR 0004 — Demo toolchain: Vite 8 dev-server capture, production build as a gate

- **Status:** accepted
- **Date:** 2026-07-29
- **Bead:** `shotwright-746.2.1`
- **Phase the decision landed in:** R

## Context

E2 makes the demo the package's own test bed; the epic fixes "vite-served". Today a
custom static server (`demo/serve.mjs`) serves the two-page stub. Two tensions
surfaced in research (2026-07-29): Vite 8 (current stable) requires Node
`^20.19.0 || >=22.12.0` while the published package declares `engines: >=20`; and
the obvious `vite build && vite preview` webServer command interacts unsafely with
Playwright's recommended `reuseExistingServer` (a stale preview on the pinned port
silently serves old code to a "successful" capture run). Details:
[shotwright-746.2.1-research.md](../shotwright-746.2.1-research.md).

## Decision

- **Vite 8.1.x becomes a direct root `devDependency`.** It builds and serves the
  demo only; the package build stays plain `tsc` (ADR 0003 untouched).
- **Capture runs are served by `vite dev`**, pinned to `127.0.0.1:4173` with
  `strictPort` in `demo/vite.config.ts` (single source of truth), with
  `reuseExistingServer: !process.env.CI`. Dev serves current sources by
  construction, so local server reuse cannot capture stale code.
- **The multi-page production build is a separate quality gate** (`demo:build`,
  both HTML entries under `build.rolldownOptions.input` — the Vite 8 spelling),
  run in verification, not inside every capture invocation.
- **The public `engines` field stays `>=20`.** Node 20.19+ is a
  contributor/demo-tooling floor (this repo's dev environment and CI), documented
  here — a dev-only tool does not constrain the published package's runtime.
- **The demo stays repository-only**: root-integrated `demo/`, excluded from the
  npm artifact (`files: ["dist", "templates"]`); consumer scaffolding remains
  `templates/` (E6).

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| `vite dev` + build gate (chosen) | No stale-serve window; reuse stays safe locally; build still proven | Captures dev-transformed output, not the production bundle | — |
| `vite build && vite preview` as webServer | Captures the real production bundle | `reuseExistingServer` can skip the build entirely → stale captures presented as evidence; unmeasured build stage on every run | redteam A1: false-reporting risk |
| Keep `serve.mjs` | Proven, zero-dependency | Epic explicitly says vite-served; never exercises a real build pipeline | scope |
| Raise `engines` to `>=20.19` | Honest single floor | Excludes consumers for repo-tooling reasons — Vite never ships to them | false dichotomy |

## Consequences

- `demo/serve.mjs` is deleted in E2.I; `demo/vite.config.ts` appears.
- Verification pipelines gain `demo:build`; captures do not pay a build stage.
- Anyone developing this repo needs Node ≥20.19 even though consumers do not; CI
  images must satisfy it.
- If a future need arises to capture the production bundle itself (e.g. a bundler
  bug only visible post-build), that run must disable server reuse — revisit this
  ADR then.

## Reversal

None.
