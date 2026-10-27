# Migrating to shotwright 0.2.0

0.2.0 expands the capture contract for ordered flows, failed-run review, data
artifacts and parity comparisons. Upgrade the package and keep its
`@playwright/test` peer installed in the consuming package. `shotwright init
--dry-run` previews scaffold changes; `shotwright init` applies them. Run these
from the package directory, even when the Git repository has a different root.

## Capture and configuration

Pass normal Playwright config fields directly to `defineShotsConfig`: for
example, `globalSetup`, `globalTeardown`, `workers`, `timeout`, `expect`,
`metadata`, `projects` and `webServer`. A consumer no longer needs to spread
the factory result to restore them. The harness owns `testDir` through
`shotsDir`, `testMatch`, `retries`, `reporter`, and Playwright's staging
`outputDir`; the factory's `outputDir` option selects the shotwright run root.
It also controls `use.screenshot`, `use.video`, and `use.trace`, including
project `use` settings. A Playwright `--reporter` override is unsupported
because it may remove the manifest writer.

`fullyParallel` now defaults to false, so tests in one spec execute in order.
Separate spec files can still run on different workers: set `workers: 1` if
they share mutable host state. For a sequence where a failed step should skip
following steps, use `test.describe.configure({ mode: 'serial' })`. Ordinary
test ordering alone does not provide that skip behavior.

Use `shot(page, name, { check: async () => { /* verify state */ } })` to run a
callback before capture. A resolved callback sets `checked: true`; the flag
records completion, including an empty callback, rather than proving an
assertion ran. A thrown callback writes no screenshot. Filtered shots do not
run their callback. The other options are `fullPage`, `clip`, and `locator`.
`shot()` defaults to `fullPage: true` without `clip` or `locator`, whereas
Playwright's `page.screenshot()` defaults to the viewport. Equivalent capture
arguments retain screenshot bytes; compare dimensions when porting old calls.

Use `artifact('result.json', { body: JSON.stringify(result), contentType:
'application/json' })`, or provide `path` instead of `body`, to save a data
file. Exactly one of `body` or `path` and an explicit MIME type are required.
The manifest records its byte count and test ID. The gallery escapes text,
shows JSON and text previews up to 256 KiB, and offers the full download.
Compare uses source byte equality for data parity, displays text/JSON diffs,
and compares binary artifacts by bytes. Workbook normalisation is declined:
produce a stable normalised artifact in the consumer when source files carry
timestamps or other incidental bytes.

Run capture specs with `shotwright run --config shots.config.ts`. A bare
`playwright test -c shots.config.ts` fails during config evaluation before it
can execute captures; `--list` and the internal config probe remain allowed.
`shotwright run` prints `run-dir: <path>` for a created run, even when tests
fail. `--run-dir-file <path>` writes the invocation's run directory for CI.
If configuration fails before directory creation, there is no path to report.

## Manifest, identity and paths

New runs write `manifestVersion: 2`, with run `status` (`passed`, `failed`,
`timedout`, `interrupted`), `publication` results for evidence and gallery,
final-attempt `tests[]` with status, duration, retry and concise error, and
`shots[]` linked by `testId` with `checked` and `retry`. `artifacts[]` holds
MIME, bytes and test linkage; `failures[]` holds copied attachment references.
A failure can have an empty attachment list. `testId` links records within a
run; it is not a cross-run identity. A passing test can still have
`checked: false` shots, and a checked shot can come from a test that later
failed. Only a passed run with successful publication moves `latest`.

Existing v1 manifests remain readable without rewriting them. Their run and
test outcomes and publication result are **unrecorded**; their shots adapt in
memory with `testId: null`, `checked: false`, and `retry: 0`. A mixed v1/v2
compare pairs by the canonical `(spec, name)` identity and displays the v1
status as unknown. Shot names may repeat across specs, but two final shots
with the same name in one spec are rejected. Comparison no longer pairs by
bare name.

Storage strips the final `.shots.ts` suffix: `shots/sub/a.shots.ts` in older
runs becomes `shots/sub/a/<name>.png` for `sub/a.shots.ts` in new runs. The
manifest `spec` stays `sub/a.shots.ts`. Data goes in `data/sub/a/<name>`;
failure evidence goes under `failures/sub/a/`. Video and trace filenames use
readable test-title slugs plus a short ID digest to avoid collisions. The
manifest paths, rather than guessed names, are authoritative. Final retry
attempts replace earlier attempt records and stale capture files.

Failed runs retain copied Playwright attachments such as `error-context`, plus
available video and trace, before staging cleanup. The reporter prints the
copied evidence path because Playwright's earlier staging path may disappear.
Failed runs can have a manifest and gallery while `latest` remains unchanged.
An interrupted publication can leave a manifestless `incomplete` directory.

## Finding and comparing runs

`shotwright runs --json` lists run IDs, time, status and shot count, including
incomplete directories. `shotwright gallery --last` opens the newest run with
a manifest, including a failed run. `latest` still means the last passed and
fully published run. Compare accepts IDs, `latest`, `--last`, or external run
directory paths, which is useful for downloaded CI artifacts. Two path selectors
work without a configured output directory, including with `--output`. Without
`--output`, the page defaults to the configured `compare/` directory when it
exists, or a `compare/` directory beside run A otherwise. In the beside-run-A
case, an existing default page without a sidecar for the same run pair is
refused; use `--output` to choose a different file. Run IDs and `latest` still
require the configured output directory.

```sh
shotwright compare ./before/run-a ./after/run-b --output ./review/parity.html
shotwright compare latest 2026-07-28T14-02_a1b2 --fail-on-change
```

When the newest run passed, `latest` and `--last` resolve to the same run,
which compare refuses.

Compare always reports `identical`, `similar`, `changed`, `size-changed`,
`added`, `removed`, or `unreadable` for each shot or artifact pair. For PNGs,
`identical` means decoded pixels match exactly; `similar` means pixelmatch
finds no different pixels at its recorded threshold despite unequal pixels.
The page shows counts, reasons for unreadable files and PNG diffs. It writes a
`<page-stem>.compare.json` summary and `<page-stem>.diff-<n>.png` files beside
its HTML; with `--output`, their names use the requested HTML stem. By default
a completed compare exits 0.
`--fail-on-change` exits 1 if any shot or artifact pair is outside
`identical`/`similar`. This is an optional script gate, not a mandatory CI
baseline. Two external run directories with the same basename are distinct:
their path digests disambiguate the default output name.

## CI, traces and package compatibility

`shotwright init --package-manager npm` (or `pnpm` or `yarn`) places package
files in the current package and workflow/skill files at the containing Git
root. It detects a single supported lockfile or package manager declaration;
use the flag when detection is ambiguous. `init` writes a caller workflow from
`templates/github/shotwright.yml`, pinned to the release tag matching the
installed package. Check the `uses:` line in that template for the current pin;
the release process updates it when the package version changes. The inputs
below are available on the 0.2.0 reusable workflow. If you scaffolded under
0.1.1, change the caller's `uses:` line before using them:

```yaml
# Before
uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@v0.1.1
# After
uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@v0.2.0
```

The 0.2.0 reusable workflow accepts `mode` (`consumer` or repository `self`),
`config-path`, `runs-on` (JSON runner-label array), `working-directory`, `package-manager`,
`playwright-args` (JSON string array), `traces` (default false),
`retention-days`, and `artifact-name`. It uses the current invocation's run directory
for upload, including failed captures when a directory exists. `node-version`
and `output-dir` inputs were declined: the workflow uses Node 24, while
`shots.config.ts` owns the run root. Named secrets must be mapped through the
reusable-workflow boundary; a caller's plain `env` does not cross it.

All run artifacts can expose authenticated content. Playwright traces can
contain form values, cookies and network bodies. `shotwright gallery --lan`
withholds trace downloads on a non-loopback bind; add `--include-traces` only
for a trusted audience. Loopback serving permits traces. CI trace recording
is off unless `traces: true`; uploaded screenshots, failure context, video
and data can still contain sensitive material. Set access and retention to
match the captured content. A separate upload-traces switch was declined in
favor of recording control and uploading the complete invocation directory.

At the 0.2.0 release, the package still declared `engines.node: >=20` for ESM
consumers. Loading its ESM exports with CommonJS `require('shotwright')` or
`require('shotwright/capture')` needs Node `^20.19.0 || >=22.12.0` with
`require(esm)` enabled. A separate CommonJS build was declined. The
`@playwright/test` dependency remains consumer supplied.

For 0.4.0, the current `engines.node` floor is `>=22.12.0`: Node 20 and
Node 22.0–22.11 are no longer supported. See the [current install guidance](../README.md#install)
before upgrading.

## G1–G13 disposition

| Gap | Shipped behaviour or disposition | Where |
|---|---|---|
| G1 | Playwright config passes through; harness-owned keys and capture toggles still win. | `defineShotsConfig`, `shots.config.ts` |
| G2 | `fullyParallel` defaults false; consumer can set workers and serial mode. | `defineShotsConfig`, spec config |
| G3 | Manifest v2 records run, test and publication results; v1 outcome is unrecorded. | `manifest.json`, gallery |
| G4 | Failed-test attachments survive staging cleanup; copied paths are reported. | `failures/`, `manifest.json` |
| G5 | Identity is `(spec, name)`; duplicates within one spec fail publication. | `shots/`, compare |
| G6 | Seven verdicts, diffs and JSON; exit gate is opt-in. | `compare`, `--output`, `--fail-on-change` |
| G7 | MIME-tagged data artifacts and capped preview; workbook normaliser declined because content-specific normalisation belongs in the consumer. | `artifact()`, `data/`, gallery |
| G8 | Bare Playwright capture invocation fails during config evaluation. | `defineShotsConfig`; use `shotwright run` |
| G9 | Trace recording defaults off in CI; LAN serving requires explicit trace exposure. Separate upload-traces input declined because the workflow uploads the whole invocation. | `traces`, `gallery --include-traces` |
| G10 | Nested npm/pnpm/yarn workflow inputs and failed-run upload. `node-version` declined (fixed Node 24); `output-dir` declined (config owns it). | reusable workflow, `--run-dir-file` |
| G11 | Root-aware scaffold and manager-specific commands. | `init --package-manager` |
| G12 | Status listing and newest manifest selector; compare accepts external paths. | `runs --json`, `gallery --last`, `compare` |
| G13a | Storage strips the final `.shots.ts` suffix; canonical manifest spec retains it. | `shots/`, `manifest.json` |
| G13b | Video and trace paths use readable test slugs plus collision-resistant digests. | `video/`, `trace/` |
| G13c | Successful config probes are silent; failures replay output. | CLI config probe |
| G13d | `check` runs before capture; `checked` means callback completion, not verified assertions. | `shot({ check })`, `manifest.json` |
| G13e | CJS loading floor is documented; a separate CJS build was declined because supported Node loads ESM. | package exports, Node `^20.19.0 || >=22.12.0` |
| G13f | `shot()` full-page default is documented against Playwright's viewport default. | `shot({ fullPage })` |

The spec/name and v2 decisions are in [ADR 0021](adr/0021-shot-identity-and-manifest-v2.md);
verdict semantics are in [ADR 0022](adr/0022-compare-verdicts-are-review-aid.md).
