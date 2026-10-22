# shotwright: gaps found adopting it in a consuming project

Input document for epic `shotwright-746.28` (E10). A brief from the first
external consumer, written to be read without access to the consuming project.
Every item was reproduced on shotwright 0.1.1, @playwright/test 1.64.0 and
Node 24.14.1 (Linux), on 2026-10-22. Line references point into the published
`dist/` of 0.1.1.

## The consumer

A Playwright project lives in a subdirectory (`playwright/`) of a larger
repository and is installed with npm. It has about 250 "capture" specs:
scripted flows that log in as test personas against a shared internal host and
produce PNGs, and sometimes data (raw HTML bodies, .xlsx workbooks, JSON
readings). They serve stakeholder documents and before/after parity checks (run
once on the old build and once on the new build, then show that nothing
changed). Some flows stage data on the host and must clean it up in order. The
project's main `playwright.config.ts` has a `globalSetup` that logs in and
writes `storageState`, and the capture config inherits it.

The consumer's working `shots.config.ts`, for reference:

```ts
export default {
  ...defineShotsConfig({ shotsDir: path.resolve(__dirname, 'capture'), outputDir, viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1, use: base.use }),
  globalSetup: base.globalSetup,   // dropped by defineShotsConfig (G1)
  fullyParallel: false,            // forced to true by defineShotsConfig (G2)
  workers: 1,
};
```

Ordered by impact on the consumer. Each item gives what happens, a repro, what
was asked for, and references.

## G1. defineShotsConfig drops every Playwright option it does not list. The README says they pass through.

**What happens:** `dist/index.js` builds a fresh config from only `shotsDir`,
`outputDir`, `viewport`, `deviceScaleFactor`, `use`, `projects` and
`webServer`. `globalSetup`, `globalTeardown`, `timeout`, `expect`, `workers`,
`forbidOnly`, reporter additions, `testIgnore` and `metadata` are all silently
discarded. The README's Configuration section says "Everything not listed is
passed through untouched", and `ShotsConfigOptions` documents only `webServer`
as "Passthrough, untouched". The only workaround is to spread the result and
re-add the fields, which (a) the README does not mention and (b) bypasses the
factory's invariants.

**Repro:** pass `globalSetup: './global-setup.ts'` to `defineShotsConfig`. The
setup never runs, so `storageState` is stale or missing and every authenticated
flow fails or captures the login page.

**Asked for:** accept `Omit<PlaywrightTestConfig, HarnessOwnedKeys>` and spread
it under the harness invariants, the same way `use` already works. The
invariants are `testMatch`, `retries`, `reporter` (shotwright's own must stay),
`use.screenshot`, `use.video`, `use.trace` and `outputDir`. Add a type test
asserting that an unknown key reaches the output. Fix the README sentence
either way.

**Refs:** TestConfig; globalSetup.

## G2. `fullyParallel: true` is hard-coded.

**What happens:** every test in every file runs in parallel. A walkthrough split
into tests that depend on order (log in, stage an edit, shoot, discard) or that
share module state (a CSRF token read in one test and used in the next) races
or interleaves on the shared host. Playwright's own default runs a file's tests
in order in one worker.

**Repro:** two tests in one `.shots.ts` where the second relies on host state
the first left. With 2+ workers they run at the same time.

**Asked for:** default to Playwright's default (`fullyParallel: false`) or make
it an option. With G1 fixed, the consumer's override works. Document
`test.describe.configure({ mode: 'serial' })` for flows that must stop when a
step fails.

**Refs:** Parallelism ("By default, tests in a single file are run in order");
serial mode.

## G3. The manifest does not record whether the run, or any test, passed.

**What happens:** `manifest.json` has shots, flags and timing, but no run
status and no per-test outcome. The gallery says so outright: "Published
manifest · pass/fail status is not embedded". A reviewer cannot tell whether a
shot came from a test that later failed (the state it shows may never have
completed), and CI cannot summarise a run from its artifact.

**Repro:** a spec that shoots, then fails an assertion. The manifest lists the
shot with nothing marking the failure. Only the missing `latest` symlink hints
at it.

**Asked for:** `status` (from `FullResult.status`: passed / failed / timedout /
interrupted) at run level, and a `tests[]` array (id, title, spec, status,
error message, duration) from `onTestEnd`, with each shot linked by `testId`.
Show both in the gallery (a failed-test badge on its shots) and in compare.

**Refs:** Reporter.onEnd and FullResult.status; TestResult.

## G4. A failed test's evidence is deleted, and the path Playwright prints dangles.

**What happens:** the reporter's `onExit` removes `<run>/.pw`, which is
Playwright's `outputDir`. That includes `error-context.md` (the page snapshot at
failure) and any failure screenshot or video. Playwright has already printed
`Error Context: <run>/.pw/<test>/error-context.md`, which no longer exists.

**Repro:** `expect(page.locator('h1')).toHaveText('y')` on a page whose h1 is
`x`. The run directory then contains no `.pw/`.

**Asked for:** before sweeping `.pw`, copy each failed test's attachments (error
context, failure screenshot, video, trace) into `<run>/failures/<spec>/<test>/`
and list them in the manifest (G3). Or keep `.pw` when the run did not pass.

**Refs:** TestResult.attachments; TestConfig.outputDir.

## G5. A shot name used in two specs fails the whole run, but only at the end.

**What happens:** `assembleManifest` throws `duplicate shot name "dup" (in
b.shots.ts and a.shots.ts) — shot names must be unique within a run` in
`onEnd`, after every test has run. The run then has no `manifest.json` and no
`gallery.html`, `.sidecar/` is left behind, and the PNGs are orphaned. The files
are already namespaced by spec (`shots/<spec>/<name>.png`), so the global rule
is not needed for storage. Only compare pairs by bare name. Across about 250
specs, generic names (`01-login`, `before`, `form`) collide routinely.

**Repro:** two specs that each call `shot(page, 'dup')`, run together.

**Asked for:** make the identity spec + name, unique within a spec, and pair
compare on spec + name, with rename hints as now. If global uniqueness is kept,
fail fast inside `shot()` (sidecars are on disk, so a worker can check), still
publish a manifest with a run error, and clean `.sidecar/`.

Owner decision 2026-10-22: identity becomes spec + name.

## G6. compare gives no verdict: no "identical", no pixel diff, no exit code.

**What happens:** compare pairs shots by name and renders a contact sheet. The
page says it does this "without computing whether pixels are good or bad". For
before/after parity, the question is whether anything changed. The consumer
has to fall back to `cmp` and ImageMagick `compare -metric AE` to answer it.

**Asked for:** for each pair:

- a state of `identical` (byte or decoded-pixel equality), `changed`
  (differing-pixel count and ratio, pixelmatch with a threshold) or
  `size-changed`;
- a diff image next to the pair.

For the run as a whole:

- a `compare.json` summary;
- `--fail-on-change` (exit 1), so a parity check can gate a script;
- changed pairs sorted first in the sheet.

Keep it opt-in if "no verdicts" is a design choice (ADR). Parity work needs it.

**Refs:** pixelmatch (what Playwright uses); toHaveScreenshot options
(threshold, maxDiffPixels); pngjs for decoding.

Owner decision 2026-10-22: settle by external research in the R phase.

## G7. No API for non-image output.

**What happens:** about a third of the consumer's captures produce data:
normalised HTML response bodies, .xlsx workbooks, JSON or JSONL readings,
computed-style dumps. `shot()` only writes PNGs, so the consumer writes its own
files to `$SHOTWRIGHT_RUN_DIR/data/<spec>/<name>`. The manifest, gallery and
compare never see them.

**Asked for:** `artifact(name, { body | path, contentType })` in
`shotwright/capture`, written to `<run>/data/<spec>/<name>` and recorded in the
manifest with type and size.

- gallery: list artifacts per spec; inline text, HTML as source, JSON
  pretty-printed.
- compare: pair artifacts like shots: text diff for `text/*` and JSON; byte
  equality otherwise.
- xlsx: consider a hook for normalisers. A workbook carries its creation time,
  so the consumer compares the sheet XML, not the bytes.

**Refs:** testInfo.attach (the runner's own name/body/path/contentType model is
a good shape to mirror).

## G8. A bare `playwright test -c shots.config.ts` drives the app, then fails, writing into `test-results/`.

**What happens:** without `SHOTWRIGHT_RUN=1`, the config sets no `outputDir`,
so Playwright uses `<package>/test-results`, which it cleans at the start of a
run. That wipes the consumer's suite results. Every test then runs its flow
against the target (logins and staged edits on a shared host) and only fails at
the first `shot()` with `SHOTWRIGHT_RUN_DIR is not set`.

**Asked for:** throw from `defineShotsConfig` when it is not under
`shotwright run`, except during the config probe and `--list`. Then nothing
runs and nothing is cleaned.

**Refs:** TestConfig.outputDir ("Defaults to <package.json-directory>/test-results.
This directory is cleaned at the start.").

## G9. Traces (and videos) can carry credentials, and nothing warns about it.

**What happens:** `--trace` records actions with their arguments, including
`fill()` values such as a persona's password, plus network request and
response bodies and cookies. Measured: one `--trace` run of a walkthrough that
logs in two personas held their passwords 16 times across its two trace zips.
The gallery serves traces, `--lan` exposes them to the network, and the CI
workflow uploads the run directory as an artifact. Playwright offers no
redaction.

**Asked for:** a README warning; keep traces out of `gallery --lan` unless
`--include-traces` is passed; an `upload-traces` input in the CI workflow,
default off.

**Refs:** Trace viewer (Network tab shows request/response bodies);
upload-artifact.

## G10. The reusable CI workflow only fits a pnpm package at the repo root on ubuntu-latest.

**What happens:** `.github/workflows/shotwright.yml@v0.1.1` hard-codes the
following, and none of it is an input:

- `pnpm/action-setup`, `pnpm install` and `pnpm exec`;
- the path `shots-output/latest`;
- `runs-on: ubuntu-latest`;
- Node 24;
- `--workers=1`.

It resolves the run through `latest`, which only moves on a passed run, so a
failed run (the one that most needs review) is never uploaded. A consumer in a
subdirectory, using npm, against an internal host reachable only from
self-hosted runners, cannot use it.

**Asked for:** inputs for `runs-on`, `working-directory`, `package-manager`
(or detect it from the lockfile), `node-version`, `output-dir`,
`playwright-args` and `retention-days`. Resolve the newest run directory, not
`latest`. Upload with `if: always()` and an `if-no-files-found` that matches.
Pass `env` and `secrets` through for base URL and credentials.

**Refs:** Reusing workflows: inputs; runs-on and context availability
(`inputs` is allowed in `jobs.<job_id>.runs-on`); defaults.run.working-directory;
status check functions (`always()`).

## G11. init assumes the package is the repo root and uses pnpm.

**What happens:** `init --dry-run` in a subdirectory package plans
`.github/workflows/shotwright.yml` and `.claude/skills/...` relative to the
current directory. GitHub only reads workflows at the repo root, so this one
would never run. The next steps print `pnpm shots:install` and similar, and the
README's install section is pnpm-only.

**Asked for:** find the git root for `.github/` and `.claude/` (and set
`working-directory` in the generated workflow, see G10). Detect the package
manager from `npm_config_user_agent` or the lockfile, and print the matching
commands. Add npm and yarn lines to the README.

**Refs:** npm `npm_config_user_agent` (how only-allow-style tools detect the
manager).

## G12. `latest` only exists after a passed run, and there is no way to list runs.

**What happens:** after a failed run, `shotwright gallery` refuses with
"latest is missing — run shotwright run successfully or pass a run-id", and the
user has to `ls` the output directory for the id. `compare` only accepts runs
under the one configured `outputDir`, so it cannot compare two runs downloaded
from different CI jobs or hosts.

**Asked for:**

- `shotwright runs`: list each run with id, time, status (G3) and shot count.
- `--last`: the newest run whatever its status, labelled as such.
- compare should accept run-directory paths as well as ids.

## G13. Small usability items

- **Spec directory keeps the suffix:** shots land at
  `shots/pim-capabilities.shots.ts/01.png`, so a directory is named like a
  file. Strip the matched suffix (`shots/pim-capabilities/01.png`).
- **Videos and traces are named by opaque test id:**
  `video/dfeb6a15c37b7baf4c16-fbda903a3831b931c10d.webm` means nothing in a
  downloaded CI artifact. Name them `<spec>/<test-title-slug>.webm`, and keep
  the id in the manifest.
- **The config probe prints noise:** gallery and compare print `Listing tests:
  Total: 0 tests in 0 files` from the probe's `--list`. Capture the probe's
  stdio and print it only on failure.
- **No verify-before-shoot hook:** the consumer's rule is "assert the state the
  image claims, then shoot", so that a picture of a stale or half-rendered page
  never reaches a reviewer. It wraps `shot()` to do this. Consider
  `shot(page, name, { check: async () => ... })`, recorded in the manifest as
  verified.
- **ESM-only package with `engines: node >=20`:** a CommonJS consumer (a
  Playwright TypeScript project without `"type": "module"`, which is common)
  loads it through `require(esm)`. That is unflagged only from Node 20.19 and
  22.12. It works on Node 22 and 24. Either narrow engines to
  `^20.19.0 || >=22.12.0` or add a `require` export condition. Refs: Node:
  loading ECMAScript modules using require().
- **Default `fullPage: true` differs from Playwright:** `page.screenshot()`
  defaults to the viewport, while `shot()` defaults to the full page. Porting
  `page.screenshot({ path })` silently changes the image. Call this out in the
  README's migration notes.

## What worked well (keep it)

- `shot()` output was byte-identical to `page.screenshot()` /
  `locator.screenshot()` for the same viewport and DSF. 11 pilot PNGs matched
  the old harness exactly.
- Run directories with atomic manifest publish, and `latest` meaning "last
  passed run", are the right default.
- The gallery is genuinely good: self-contained, filterable, phone-friendly.
  Video and trace attach per shot with no extra code.
- Resolving the consumer's own `@playwright/test` (never `npx`) avoided any
  version skew.
