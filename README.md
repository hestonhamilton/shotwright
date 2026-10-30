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
  committed. Compare two runs for review or opt into `--fail-on-change`;
  committed golden baselines and approval management are out of scope.
- **Specs are committed; output is gitignored.** The walkthrough scripts are
  durable project code; the PNGs/videos/traces are not.
- **Built on the Playwright test-runner.** Videos, traces, and reporting come for
  free; shot specs live outside the project's e2e gate so adding one never
  affects CI merge checks.
- **The reviewer might be on a phone.** The gallery is a single self-contained
  HTML file, servable over LAN, and the harness is designed so an AI coding agent
  can capture and deliver the artifacts at the end of a UI change.

## Install

Requires **Node ≥ 22.12.0**. Node 20 and Node 22.0–22.11 are no longer
supported; upgrade those runtimes before moving to 0.4.0. npm warns by default
when a dependency's `engines.node` does not match, and refuses installation only
with [`engine-strict`](https://docs.npmjs.com/cli/v11/using-npm/config/#engine-strict)
enabled. This remains an ESM package. Synchronous CommonJS `require()` can load
its ESM exports from Node 22.12.0 when the module graph has no top-level
`await`; a future top-level `await` would prevent that loading. `@playwright/test`
is a peer dependency — you install it, so you control the version.

```sh
pnpm add -D shotwright @playwright/test
pnpm exec shotwright init
```

For npm use `npm install -D shotwright @playwright/test` then
`npm exec -- shotwright init`; for yarn use `yarn add -D shotwright @playwright/test`
then `yarn shotwright init`. Run `init` from the package directory, including
when it is nested in a larger Git repository. It detects the package manager
from the package declaration or lockfile; use `--package-manager npm|pnpm|yarn`
when detection is ambiguous. It places config, specs and scripts in the package,
and the workflow and skill at the containing Git root. Review the generated
workflow's release tag before running it. See the [0.2.0 migration guide](docs/shotwright-746.28-migration.md).

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

`init` preserves existing scripts whose commands differ from shotwright's and
adds the free script names. It lists each conflicting name as skipped. If the
`shots` name conflicts, the generated skill is deferred because its capture
instructions use that name. Resolve the conflicting script and re-run
`pnpm exec shotwright init`; existing scaffold files and scripts are skipped
safely. Next steps list only commands that are already available or were added.

Exit code 0 means the planned or actual setup has no unresolved script
conflicts, even if user-owned files need review. Exit code 1 means a known
script conflict or an actual error. With `--dry-run`, exit 1 predicts a known
conflict; no write was attempted. A real exit 1 may follow successful partial
writes, so read the Created, Updated, and Skipped sections before resolving the
conflict and rerunning. A dry run cannot predict unforeseen I/O failures during
the real run.

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
import { artifact, shot, walkthrough } from 'shotwright/capture'

walkthrough('checkout', async ({ page }) => {
  await page.goto('/cart')
  await shot(page, 'cart-full')

  await page.getByRole('button', { name: 'Check out' }).click()
  await shot(page, 'payment-step')

  // Capture one element rather than the page.
  await shot(page, 'order-summary', { locator: page.getByTestId('summary') })
  await shot(page, 'confirmed-order', {
    check: async () => { await page.getByText('Order confirmed').waitFor() },
  })
  await artifact('order.json', {
    body: JSON.stringify({ stage: 'confirmed' }), contentType: 'application/json',
  })
})
```

`shot(page, name, opts?)` writes `<runDir>/shots/<spec>/<name>.png` and records a
manifest entry. Options: `fullPage` (default true unless `clip` or `locator` is
given), `clip`, `locator`, `animations`, `caret`, `mask`, `style`, `check`, and
`note`. An optional note adds descriptive context to that shot's gallery card
and search. It does not affect shot identity or comparison.
The four screenshot options pass through to Playwright for both page and locator
captures: `animations` controls animation handling, `caret` controls text caret
visibility, `mask` takes locators to cover, and `style` applies screenshot-only
CSS. Omitted options keep Playwright's own defaults. A resolved `check` runs
before capture and sets `checked: true`; this records callback completion, even
for a no-op, not proof that an assertion ran. A thrown callback saves no shot. `artifact(name,
{ body, contentType })` also accepts `path` instead of `body`; supply exactly
one and an explicit MIME type. Its gallery preview is escaped and capped at
256 KiB, with the full file downloadable. `shot()` defaults to a full-page image;
Playwright's `page.screenshot()` defaults to the viewport.

For a generated file, use Playwright's per-test scratch path. Generate and
inspect the file at the same path, then publish a copy to the run:

```ts
import { test } from '@playwright/test'
import { artifact } from 'shotwright/capture'

test('exports a report', async () => {
  const source = test.info().outputPath('report.pdf')
  // Generate the PDF at source, then let an external reader inspect source.
  await artifact('report.pdf', { path: source, contentType: 'application/pdf' })
})
```

The reporter removes the run's `.pw` scratch directory when the run exits
normally, whether it passes or fails. Inspect and publish before the test ends.
A hard process kill has no cleanup promise.

For a more repeatable capture, opt in to Playwright's screenshot assertion
settings when needed:

```ts
await shot(page, 'stable-cart', {
  animations: 'disabled',
  caret: 'hide',
})
```

[`toHaveScreenshot()`](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot)
defaults to disabled animations and a hidden caret. By comparison,
[`page.screenshot()`](https://playwright.dev/docs/api/class-page#page-screenshot)
defaults to allowed animations and already hides the caret. This recipe changes
the animation setting; it does not add screenshot assertion retries or baselines.

The manifest uses the loaded `.shots.ts` file as the spec identity, including
tests registered by imported helpers. Shot names remain single file-name
segments and must be unique per spec; a duplicate fails its test before a new
screenshot is taken. Artifact names may contain safe relative subpaths such as
`logs/network.json`. Manifest v2 records each test's `titlePath` from enclosing
`test.describe()` titles through its own title. Older v2 manifests are read with
`[title]` as the path.
Gallery cards show that full title path, joined with ` › `, and the search box
matches describe titles and test titles as well as shot names and specs. Cards
without a linked test omit the title path.
Artifact and shot writes reject traversal and symlinks present at write time.
The output directory is trusted against concurrent path changes, as with
Playwright's `outputDir`.

Manifest v2 also records run platform and, on Linux, distribution `ID` and
`VERSION_ID`, plus one observed browser row per project that captured a shot.
The row uses the browser of the actual page for name and version. Its channel is
the configured project channel (`launchOptions.channel` takes precedence over
`channel`); spec-level `test.use()` overrides are not visible here. For a local
Linux Chromium process, the row also records a SHA-256 digest of its running
executable image. Managed means the binary that ran is in Playwright's browser
cache, regardless of who selected it, and stores a cache-relative path. A binary
outside that cache is overridden and stores only its basename. Unavailable or
conflicting values are `null`. Older v2 runs read with `environment: null` and
`browsers: []`. These fields are diagnostic and do not change compare verdicts
or the gate.

The gallery header shows the recorded environment and per-project browser rows,
including the configured channel when set. Compare adds advisory `provenance` to
its JSON summary. Its header names known differing fields, or says which side's
fields are unavailable; when all compared fields are present and match, it says
"No known render environment difference (recorded fields only)". This never
claims equivalent rendering and never changes image verdicts, counts, the gate,
or the command's exit status.

## Commands

```
shotwright run      [--only a,b] [--video] [--trace] [--run-dir-file <path>] [--config <path>] [-- <playwright test args>]
shotwright runs     [--config <path>] [--json]
shotwright gallery  [run-id|--last] [--config <path>] [--host <host>] [--port <port>] [--lan] [--include-traces]
shotwright compare  <run-a|latest|--last|path> <run-b|latest|--last|path> [--config <path>] [--output <file.html>] [--ignore <spec.shots.ts/name>]... [--threshold <0..1>] [--strict] [--fail-on-change]
shotwright init     [--dry-run] [--package-manager npm|pnpm|yarn]
```

- **`run`** captures. `--video`/`--trace` turn on the heavier artifacts. Anything
  after `--` is passed straight to `playwright test`.
  `--only` takes **substrings**, and filters *writes*, not execution — the whole
  walkthrough still runs, and only matching shots are saved. That is deliberate:
  a flow that half-runs produces screenshots of a state the app never reaches.
  Every `check` runs before selection, so a failed check fails the test even
  for a filtered shot, which writes no PNG or sidecar. If a later check reads an
  earlier shot's PNG, filtering out the earlier shot makes that check fail, so
  keep checks independent of capture files that `--only` may omit.
- **`gallery`** builds a single self-contained HTML file and serves it. `--lan`
  binds it so another device on the network can open it. Trace downloads on a
  non-loopback bind require `--include-traces`.
- **`runs`** lists passed, failed and incomplete directories. `--last` selects
  the newest run with a manifest, including a failed run; `latest` remains the
  last passed, fully published run. `run` prints `run-dir: <path>` for its own
  invocation and can write that path to `--run-dir-file <path>`.
- **`compare`** pairs shots and artifacts by spec and name, reports `identical`,
  `similar`, `changed`, `size-changed`, `added`, `removed`, or `unreadable`, and
  writes HTML, a `<page-stem>.compare.json` summary, and
  `<page-stem>.diff-<n>.png` images beside the HTML. It accepts run IDs or
  external run directory paths. `--output <file.html>` chooses the HTML path and
  sidecar stem. Repeat `--ignore <spec.shots.ts/name>` to remove an exact artifact
  from the gate; the measured state and any error stay visible. Artifact names
  may contain `/`. Unmatched keys are rejected. `--threshold` selects pixelmatch's
  per-pixel color threshold from 0 to 1 (default 0.1). `--strict` also gates
  unignored `similar` pairs. By default a completed comparison exits 0;
  `--fail-on-change` exits 1 when a gated pair remains. The terminal, HTML and
  JSON report measured non-parity, ignored non-parity and gated counts separately.

  | Exit | Meaning |
  | ---- | ------- |
  | 0 | The comparison was written (and, with `--fail-on-change`, no gated pair remains). |
  | 1 | A gated pair remains under `--fail-on-change` (only). |
  | 2 | Any error. Usage: bad, duplicate or unknown flag, wrong number of run selectors, `--threshold` outside 0..1, an unmatched `--ignore`. Runtime: missing config, an unknown run or one without a readable manifest, both selectors resolving to the same run, an `--output` inside a compared run. |

  `latest` resolves to the **last fully passed run**, not simply the most recent
  one — comparing against a run that failed halfway is a comparison against
  nothing. (It is a POSIX symlink; Windows support is not in v1.)

### Baselines and assertions

For committed visual assertions, use Playwright's
[`toHaveScreenshot()`](https://playwright.dev/docs/test-snapshots). In a
walkthrough, prefer [`expect.soft`](https://playwright.dev/docs/test-assertions)
so a failed assertion does not stop later captures; the run still fails and does
not advance `latest`. For hosted review, set `RUN_DIR` to a run directory and
`ARGOS_TOKEN` to an Argos project token, then upload its `shots/` directory with
`npx @argos-ci/cli upload "$RUN_DIR/shots"` ([Argos CLI](https://www.npmjs.com/package/%40argos-ci/cli)).
For local review, run `shotwright compare <chosen-run> latest`; the chosen run
can also be a downloaded run directory path.

### Selecting tests and shots

Use `--only b` to select which shots are written while all tests still run.
Use `-- -g <regex>` to pass a regular expression to Playwright and select which
tests run. Playwright matches it against one string joining the project name,
spec file, `describe` titles, test title and tags, so do not anchor it at the
start: `-- -g '^b$'` finds no test named `b`, while `-- -g 'b$'` matches it
(and any other test whose joined string ends in `b`).

## Configuration

`shots.config.ts` wraps a Playwright config. Playwright options such as
`globalSetup`, `workers`, `expect`, `projects`, and `webServer` pass through.
shotwright owns `testDir` (set with `shotsDir`), `testMatch`, `retries`,
`reporter`, and Playwright's staging `outputDir`. The `outputDir` option below
sets the shotwright run root. Capture settings `use.screenshot`, `use.video`,
and `use.trace` are controlled by the harness. Do not pass Playwright
`--reporter`, which can remove the manifest writer. `fullyParallel` defaults to
false: tests within one spec run in order; set `workers: 1` when separate specs
must not overlap, and use Playwright serial mode when later steps should skip
after a failure.

```ts
import { defineShotsConfig } from 'shotwright'

export default defineShotsConfig({
  shotsDir: 'shots',                              // spec directory
  outputDir: 'shots-output',                      // run directories
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: process.env.SHOTWRIGHT_VIDEO === '1' ? 1 : 2,
  videoSize: { width: 1440, height: 960 },
  webServer: { command: 'pnpm dev', url: 'http://localhost:5173' },
  use: { baseURL: 'http://localhost:5173' },      // harness invariants still win
})
```

While `shotwright run` evaluates the config, `SHOTWRIGHT_VIDEO` and
`SHOTWRIGHT_TRACE` are exactly `'1'` when their shotwright flags were requested
and `'0'` otherwise. Compare with `'1'`; these values describe shotwright CLI
flag intent, not whether recording ultimately occurs. For example,
`shotwright run -- --trace on` leaves `SHOTWRIGHT_TRACE` at `'0'` because that
trace mode is passed to Playwright. Conversely,
`shotwright run --trace -- --trace off` leaves it at `'1'`, although Playwright
can disable tracing. The CLI supplies both values to the config process.

`videoSize` requests one recorded video frame size for all projects when
`--video` is on. It does not set screenshot dimensions or ensure page content
fills the frame. Without `videoSize`, Playwright chooses the recording size:
it scales the viewport down to fit within 800×800, or uses 800×450 when no
viewport is configured. The example chooses DSF 1 for video runs and DSF 2
otherwise. Leaving `deviceScaleFactor` unset retains DSF 2 in the default
project. Choosing DSF 1 also changes screenshot pixels.

This uses the default `shots` project. To use explicit `projects` instead,
put `viewport` and `deviceScaleFactor` in each `project.use`; supplying either
harness top-level setting with `projects` now raises a config error in
`shotwright run` and `--list`; `runs`, `gallery` and `compare` still read
existing runs from such a config. In 0.4.0,
move those settings from the harness top level into each `project.use` if your
config previously combined them: the combination was silently ignored.
For video-dependent scale in explicit projects, put
`deviceScaleFactor: process.env.SHOTWRIGHT_VIDEO === '1' ? 1 : 2` in each
`project.use`.

When adapting a Playwright base config, `use: base.use` transfers only its
`use` settings. Pass `projects: base.projects` to retain project-level
`grep`/`grepInvert`, or set a deliberate top-level `grep`/`grepInvert` on the
shots config. The default `shots` project's viewport and scale override
`use.viewport` and `use.deviceScaleFactor` carried by `use: base.use`; set the
harness top-level `viewport`/`deviceScaleFactor` for the default project, or
use explicit `project.use` values with `projects`.

For 0.4.0: checks now run even when their own shot is filtered out, which
reverses 0.3.0, where `--only` skipped them. A filtered check still does all its
work, including slow waits, requests and anything that changes page state, so
audit expensive or state-changing checks before relying on `--only` for speed.
Update checks that read earlier shot PNGs so they do not depend on captures
excluded by `--only`.

## CI

`init` writes `.github/workflows/shotwright.yml`, which calls a reusable workflow
that uploads the current invocation's run directory, including failed-run
evidence when a directory was created. Inputs are `mode`, `config-path`,
`runs-on` (JSON runner labels), `working-directory`, `package-manager`,
`playwright-args` (JSON array), `traces` (default false), `upload`, `retention-days`, and
`artifact-name`. It supports npm, pnpm and yarn.
`upload` accepts `always`, `on-failure`, or `never`. The reusable workflow defaults
to `always` with seven-day retention; the generated caller uploads failed PR runs
for two days and every manual dispatch run for seven days. Override `upload` or
`retention-days` in the caller to control [Actions storage costs](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
`never` runs shots without producing a GitHub run artifact.
The workflow uploads review artifacts; it does not compare pixels as a merge
gate. Screenshots, videos, failure context, data and traces can expose
authenticated content. Playwright traces may include credentials, cookies and
network bodies; record them only when needed, review access to uploaded runs,
and choose retention accordingly.

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
| `docs/` | Design doc, ADRs, release runbook. PR numbers and short SHAs cited in documents dated before 2026-10-05 refer to the private pre-release history, not to this repository's PRs |

## License

**AGPL-3.0-or-later.** See [`LICENSE`](LICENSE) (the verbatim license text) and
[`NOTICE`](NOTICE) (the copyright notice); both ship in the npm package.

Two consequences worth knowing before you adopt it, both intended:

1. **Works that incorporate or modify shotwright carry the copyleft.** If you
   distribute such a work, it must be licensed under the AGPL. Using shotwright
   as a development tool against your application does not by itself change your
   application's license. This is not legal advice; take your own.
2. **Section 13 reaches network use.** Running a modified shotwright behind a
   network service does not exempt you from sharing the source, which is the gap
   plain GPL leaves open. The unmodified package carries no such duty; if you do
   modify it and serve the gallery to others, the usual way to comply is a
   visible link to your modified source. Both gallery pages end with that link
   ("Generated by shotwright <version> · … · source: <url>"), read at run time from
   the package's `repository` and `version` fields in `package.json`, so a fork
   points it at its own source by updating those fields.
3. **What `init` writes into your project is yours.** The files `shotwright init`
   copies into your repository (`shots.config.ts`, the example spec, the CI
   workflow, the agent skill) are templates for you to edit; you may use, modify
   and distribute them under any terms you like. The AGPL covers shotwright
   itself, not your scaffold.

The source for this package is at
<https://github.com/hestonhamilton/shotwright>. Releases are published from CI
with npm provenance attestations, from a tagged commit; check the package's npm
page for the attestation on the version you install.

If those terms do not work for your project, that is a real answer — open an issue
rather than working around the license. The reasoning is recorded in
[ADR 0018](docs/adr/0018-license-is-agpl-3-0-or-later.md).

Contributions: see [`CONTRIBUTING.md`](CONTRIBUTING.md) — contributor terms matter
here, because they determine whether the license can ever change.
