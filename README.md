# shotwright

Playwright-powered **UI walkthrough harness**: scripted flows that drive a real
(or mocked) app and produce **screenshots, videos, and traces** for a human to
review — plus the tooling to actually review them (a self-contained gallery, run
comparison, trace/video helpers) and to surface them from CI as build artifacts.

Extracted from three sibling harnesses that each solved the same problem a
different way; shotwright centralizes the pattern so a project keeps only thin
config and its own `*.shots.ts` specs.

> **Licensed AGPL-3.0-or-later.** Works that incorporate or modify shotwright
> carry its copyleft. Read [License](#license) before adopting it — this is a
> deliberate constraint, not an oversight.

## Philosophy

- **Review artifacts, not assertions.** Captures are throwaway output for human
  eyeballing ("does this actually render/fit?"), regenerated each run and never
  committed. Golden-diff visual regression is deliberately out of scope.
- **Specs are committed; output is gitignored.** The walkthrough scripts are
  durable project code; the PNGs/videos/traces are not.
- **Built on the Playwright test-runner.** Videos, traces, and reporting come for
  free; shot specs live outside the project's e2e gate so adding one never
  affects CI merge checks.
- **The reviewer might be on a phone.** The gallery is a single self-contained
  HTML file, servable over LAN, and the harness is designed so an AI coding agent
  can capture and deliver the artifacts at the end of a UI change.

## Install

Requires **Node ≥ 20**. `@playwright/test` is a peer dependency — you install it,
so you control the version.

```sh
pnpm add -D shotwright @playwright/test
pnpm exec shotwright init
```

`init` scaffolds, and tells you exactly what it will touch first if you pass
`--dry-run`:

```
shots.config.ts
shots/example.shots.ts
.github/workflows/shotwright.yml
.gitignore (+3 entries)
.claude/skills/shots-harness/SKILL.md
package.json (scripts)
```

Then:

```sh
# 1. edit shots.config.ts — set webServer for your app
pnpm shots:install      # download the browser, once
pnpm shots              # capture
pnpm shots:gallery      # review
pnpm shots:compare latest <run-id>   # once there is a second run to compare against
```

## Writing a walkthrough

A spec is a Playwright test that captures instead of asserting. `walkthrough` is
an alias of the runner's `test`, named so the file reads as what it is:

```ts
import { shot, walkthrough } from 'shotwright/capture'

walkthrough('checkout', async ({ page }) => {
  await page.goto('/cart')
  await shot(page, 'cart-full')

  await page.getByRole('button', { name: 'Check out' }).click()
  await shot(page, 'payment-step')

  // Capture one element rather than the page.
  await shot(page, 'order-summary', { locator: page.getByTestId('summary') })
})
```

`shot(page, name, opts?)` writes `<runDir>/shots/<spec>/<name>.png` and records a
manifest sidecar. Options: `fullPage` (default true), `clip`, `locator`.

## Commands

```
shotwright run      [--only a,b] [--video] [--trace] [--config <path>] [-- <playwright args>]
shotwright gallery  [run-id] [--config <path>] [--host <host>] [--port <port>] [--lan]
shotwright compare  <run-a|latest> <run-b|latest> [--config <path>]
shotwright init     [--dry-run]
```

- **`run`** captures. `--video`/`--trace` turn on the heavier artifacts. Anything
  after `--` is passed straight to `playwright test`.
  `--only` takes **substrings**, and filters *writes*, not execution — the whole
  walkthrough still runs, and only matching shots are saved. That is deliberate:
  a flow that half-runs produces screenshots of a state the app never reaches.
- **`gallery`** builds a single self-contained HTML file and serves it. `--lan`
  binds it so another device on the network can open it.
- **`compare`** puts two runs side by side and marks what changed.
  `latest` resolves to the **last fully passed run**, not simply the most recent
  one — comparing against a run that failed halfway is a comparison against
  nothing. (It is a POSIX symlink; Windows support is not in v1.)

## Configuration

`shots.config.ts` wraps a Playwright config. Everything not listed is passed
through untouched — shotwright is stack-agnostic and does not want to own your
server setup.

```ts
import { defineShotsConfig } from 'shotwright'

export default defineShotsConfig({
  shotsDir: 'shots',                              // spec directory
  outputDir: 'shots-output',                      // run directories
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
  webServer: { command: 'pnpm dev', url: 'http://localhost:5173' },
  use: { baseURL: 'http://localhost:5173' },      // harness invariants still win
  projects: [ /* replaces the default single 'shots' Desktop Chrome project */ ],
})
```

## CI

`init` writes `.github/workflows/shotwright.yml`, which calls a reusable workflow
that captures a run and uploads the gallery as a build artifact. It is
**artifacts-only and gates nothing** — that is the whole point. A walkthrough that
fails to render is something a human should look at, not something that should
block a merge at 2am.

## Package surface

| Entry point | What it gives you |
|---|---|
| `shotwright` | `defineShotsConfig`, and the `Manifest` / `ShotEntry` / `Viewport` types |
| `shotwright/capture` | `walkthrough`, `shot`, and the `--only` filter helpers |
| `shotwright/reporter` | The Playwright reporter that writes the run manifest |

## Layout

| Path | Purpose |
|---|---|
| `src/` | The package: config factory, `shot()` helpers, gallery/compare/CLI |
| `templates/` | Files `init` scaffolds into a consuming project |
| `demo/` | Tiny static demo app the harness self-tests against |
| `docs/` | Design doc, ADRs, release runbook |

## License

**AGPL-3.0-or-later.** See [`LICENSE`](LICENSE).

Two consequences worth knowing before you adopt it, both intended:

1. **Works that incorporate or modify shotwright carry the copyleft.** If you
   distribute such a work, it must be licensed under the AGPL. Using shotwright
   as a development tool against your application does not by itself change your
   application's license. This is not legal advice; take your own.
2. **Section 13 reaches network use.** Running a modified shotwright behind a
   network service does not exempt you from sharing the source, which is the gap
   plain GPL leaves open. The unmodified package carries no such duty; if you do
   modify it and serve the gallery to others, the usual way to comply is a
   visible link to your modified source.

The source for this package is at
<https://github.com/hestonhamilton/shotwright>; every version from 0.1.0 onward is built
from a tagged commit there, with npm provenance.

If those terms do not work for your project, that is a real answer — open an issue
rather than working around the license. The reasoning is recorded in
[ADR 0018](docs/adr/0018-license-is-agpl-3-0-or-later.md).

Contributions: see [`CONTRIBUTING.md`](CONTRIBUTING.md) — contributor terms matter
here, because they determine whether the license can ever change.
