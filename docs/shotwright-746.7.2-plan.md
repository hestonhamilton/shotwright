# shotwright-746.7.2 - E7.P: artifacts-only CI workflow plan

Plan date: 2026-07-30. Binding input: `docs/shotwright-746.7.1-research.md`.
Also checked `README.md`, `docs/design.md`, `docs/shotwright-746.6.2-plan.md`,
`src/init.ts`, `test/smoke/cli.test.ts`, `package.json`, `demo/shots.config.ts`,
and the local consumer C / consumer B shapes. Plan only: E7.I should
touch workflow, template, source, and test files; this phase writes no code. The
workflow/template text specified below must not contain host paths, LAN IPs, or
personal filesystem paths.

## Goal

Deliver the E7 artifacts-only CI surface:

- shotwright's own CI runs the demo shots suite exactly once on every `push`.
- The uploaded artifact is the published run directory, including a browsable
  `gallery.html` and the expected non-empty five-shot demo manifest.
- A reusable `workflow_call` workflow can be called by another private repo owned
  by the same account.
- Consumers remain thin: generated callers only select `mode` and
  `config-path`; all repeated CI logic lives in this package repo.
- CI is review aid only. A job may fail because setup, install, browser
  resolution, or the walkthrough crashed. It must never fail because pixels,
  layout, screenshots, videos, traces, or gallery contents changed relative to a
  committed baseline.

## Research deviations and carried corrections

The research doc is mostly carried forward, but two conclusions are corrected
explicitly:

| Research conclusion | Plan decision | Why |
|---|---|---|
| Assert `~/.cache/ms-playwright` is absent/empty before install, and hard-fail if GitHub's runner image is not browser-clean. | **Make-empty**: `rm -rf "$HOME/.cache/ms-playwright"` first, then install Chromium into the default cache and assert `chromium.executablePath()` resolves inside that default path. | Asserting runner image cleanliness would fail on GitHub runner-image drift unrelated to shotwright. Making the default cache empty is deterministic and still proves install -> resolve -> capture through the default Playwright path, which is the E2.V residual. |
| Use an isolated `PLAYWRIGHT_BROWSERS_PATH` temp cache in the recommendation section. | Do **not** set `PLAYWRIGHT_BROWSERS_PATH` in E7 CI. | The residual is specifically about default-cache install and capture not being jointly proven. An override path is the confound E2.V recorded. |

The research conclusion that generated callers should use a same-owner private
repo reference is carried forward, with the concrete filename/ref chosen below.

## Step list

### 1. Add the reusable workflow

Create `.github/workflows/shotwright.yml`.

Name choice: `shotwright.yml` is the generated-caller API. It is short, package
branded, and describes the reusable service rather than the current demo. Avoid
`ci.yml` because consumers will read it in a `uses:` line and need to know which
workflow they are calling; avoid `shots.yml` because `shotwright` is the package
surface and leaves room for future package-owned CI workflows.

Workflow structure:

```yaml
name: shotwright

on:
  workflow_call:
    inputs:
      mode:
        description: "Invocation mode: consumer uses the installed package bin; self builds this repo and runs dist/cli.js."
        required: false
        type: string
        default: consumer
      config-path:
        description: "Path to the shotwright config file."
        required: false
        type: string
        default: shots.config.ts

permissions:
  contents: read

jobs:
  shots:
    name: Shotwright artifacts
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Prepare default Playwright browser cache
        run: <browser-cache script below>
      - name: Run shotwright
        run: <mode switch script below>
      - name: Assert demo shot set
        if: inputs.mode == 'self'
        run: <five-shot manifest script below>
      - name: Resolve published run directory
        id: resolve
        run: <resolve script below>
      - name: Assert published run artifact shape
        env:
          RUN_DIR: ${{ steps.resolve.outputs.run-dir }}
        run: <artifact-shape script below>
      - name: Upload shotwright run
        id: upload
        uses: actions/upload-artifact@v7
        with:
          name: shotwright-${{ github.workflow }}-${{ github.run_id }}-${{ github.run_attempt }}
          path: ${{ steps.resolve.outputs.run-dir }}
          if-no-files-found: error
      - name: Write job summary
        if: always() && steps.upload.outputs.artifact-url != ''
        run: <summary script below>
```

Input surface: exactly two inputs.

| Input | Default | Justification |
|---|---|---|
| `mode` | `consumer` | Required because shotwright's own checkout is not self-linked: `pnpm exec shotwright` fails in this repo, while consumers use the installed package bin. Allowed values are exactly `consumer` and `self`; the run step rejects any other value before executing a shotwright command. |
| `config-path` | `shots.config.ts` | The only legitimate path difference: consumers default to `shots.config.ts`, while this repo uses `demo/shots.config.ts`. |

Do not add `run-command`, `boot-command`, package manager, Node version,
artifact name, retention, browser install, shotwright args, or Playwright args
inputs. Each has one E7 value today, or would become arbitrary shell plumbing.

Prepare default browser cache step:

```bash
set -euo pipefail
DEFAULT_BROWSER_CACHE="$HOME/.cache/ms-playwright"
rm -rf "$DEFAULT_BROWSER_CACHE"
mkdir -p "$DEFAULT_BROWSER_CACHE"
pnpm exec playwright install --with-deps chromium
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test'

const root = `${process.env.HOME}/.cache/ms-playwright`
const exe = chromium.executablePath()
if (!exe.startsWith(`${root}/`)) {
  throw new Error(`Chromium resolves outside default Playwright browser cache: ${exe}`)
}
console.log(`Chromium resolves inside default Playwright browser cache: ${exe}`)
NODE
```

Failure conditions: install failure, missing Playwright peer, or Chromium
resolving outside `~/.cache/ms-playwright`. Do not cache browser binaries and do
not set `PLAYWRIGHT_BROWSERS_PATH`.

Run step:

```bash
set -euo pipefail
case "${{ inputs.mode }}" in
  consumer)
    pnpm exec shotwright run --config "${{ inputs.config-path }}" -- --workers=1
    ;;
  self)
    pnpm run build
    node dist/cli.js run --config "${{ inputs.config-path }}" -- --workers=1
    ;;
  *)
    echo "Unsupported shotwright mode: ${{ inputs.mode }}" >&2
    exit 1
    ;;
esac
```

The mode branch is deliberately narrow. It is not a generic command input and
does not let consumers inject arbitrary shell.

Demo five-shot assertion, `self` mode only:

```bash
set -euo pipefail
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const latest = fs.readlinkSync('shots-output/latest')
const manifest = JSON.parse(
  fs.readFileSync(path.join('shots-output', latest, 'manifest.json'), 'utf8'),
)
assert.deepEqual(
  manifest.shots.map((shot) => [shot.spec, shot.name]),
  [
    ['about.shots.ts', 'about-desktop'],
    ['about.shots.ts', 'mobile-layout'],
    ['home.shots.ts', 'form-filled'],
    ['home.shots.ts', 'modal-open'],
    ['home.shots.ts', 'theme-dark'],
  ],
)
NODE
```

Failure conditions: empty gallery, missing demo shot, unexpected extra shot,
unexpected spec/name ordering, broken `latest` symlink, missing manifest, or
invalid JSON. This is a false-reporting assertion, not golden-diff gating.

Resolve published run directory:

```bash
set -euo pipefail
latest="$(readlink shots-output/latest)"
run_dir="shots-output/$latest"
if [ ! -d "$run_dir" ]; then
  echo "Published run directory missing: $run_dir" >&2
  exit 1
fi
echo "run-dir=$run_dir" >> "$GITHUB_OUTPUT"
echo "run-id=$latest" >> "$GITHUB_OUTPUT"
```

Artifact-shape assertion:

```bash
set -euo pipefail
run_dir="${{ steps.resolve.outputs.run-dir }}"
test -f "$run_dir/manifest.json"
test -f "$run_dir/gallery.html"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const runDir = process.env.RUN_DIR
const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'))
assert(Array.isArray(manifest.shots), 'manifest.shots must be an array')
assert(manifest.shots.length > 0, 'shotwright artifact is empty: manifest.shots.length must be > 0')
for (const shot of manifest.shots) {
  assert.equal(typeof shot.file, 'string', 'manifest shot file must be a non-empty string')
  assert.notEqual(shot.file.trim(), '', 'manifest shot file must be a non-empty string')
  const png = path.join(runDir, shot.file)
  const bytes = fs.readFileSync(png)
  assert(bytes.length > 8, `${shot.file} is empty`)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${shot.file} is not a PNG`)
}
for (const staging of ['.sidecar', '.pw', '.manifest.tmp']) {
  assert(!fs.existsSync(path.join(runDir, staging)), `${staging} should not be published`)
}
assert(
  !fs.readdirSync(runDir).some((entry) => entry.startsWith('.gallery.')),
  '.gallery.* should not be published',
)
NODE
```

Set `RUN_DIR` from `steps.resolve.outputs.run-dir`. This assertion is
mode-agnostic and runs for both `self` and `consumer`: it fails with
`shotwright artifact is empty: manifest.shots.length must be > 0` when the
current manifest has no shots. This is not golden-diff gating. It only proves
the current run captured at least one artifact; it compares nothing against a
baseline, stores no reference, and has no notion of any previous run.

Use `shot.file`: `ShotEntry` exposes `file` and has no path field
(`src/manifest.ts:19-23`), and smoke coverage reads PNG bytes from `shot.file`
(`test/smoke/cli.test.ts:320-335`). The non-empty assertion prevents
`path.join(runDir, undefined)`-style publication failures from turning a
successful walkthrough into a CI failure for the wrong reason.

The unpublished run-dir staging surfaces are `.sidecar`, `.pw`, `.manifest.tmp`,
and entries beginning `.gallery.`. `.sidecar` is the sidecar directory name
(`src/runs.ts:10`), `.manifest.tmp` is the atomic manifest temp file inside the
run directory (`src/runs.ts:45`), and smoke asserts `.sidecar`, `.pw`,
`.manifest.tmp`, and `.gallery.*` are absent from the run directory
(`test/smoke/cli.test.ts:338-342`). `.latest.tmp` is intentionally excluded
because it is created under the output directory, not the run directory
(`src/runs.ts:57`).

Upload step:

```yaml
with:
  name: shotwright-${{ github.workflow }}-${{ github.run_id }}-${{ github.run_attempt }}
  path: ${{ steps.resolve.outputs.run-dir }}
  if-no-files-found: error
```

Do not set `retention-days`; use repo/org defaults. Upload the entire published
run directory, not only `gallery.html`, so video/trace sibling links keep working
when those are enabled later.

Job summary: **yes**. Add a Markdown summary after upload because it is a
presentation aid with no gating semantics. It should link the uploaded artifact
using `steps.upload.outputs.artifact-url`, name the run id, and tell the reviewer
to download/extract the artifact and open `gallery.html`. Keep it generic and
free of host paths, usernames, LAN IPs, or local filesystem paths.

Summary script:

```bash
set -euo pipefail
{
  echo "## Shotwright artifacts"
  echo
  echo "- Run: \`${{ steps.resolve.outputs.run-id }}\`"
  echo "- Artifact: ${{ steps.upload.outputs.artifact-url }}"
  echo
  echo "Download and extract the artifact, then open \`gallery.html\` from the run directory."
} >> "$GITHUB_STEP_SUMMARY"
```

### 2. Add this repo's thin caller workflow

Create `.github/workflows/demo-shots.yml`.

Name choice: `demo-shots.yml` states that this repo's CI proves the packaged
demo, not general repo checks. Avoid `ci.yml` because this repo currently has no
CI and future lint/test workflows should not be conflated with artifacts-only
shots.

Trigger decision: run on `push` only, with no branch or path filters. This
satisfies the epic's "runs the demo shots suite on every push" requirement
literally and exactly once per push. Same-repo PR branches still get checks
because the branch push itself triggers the run. The repo is private and
same-owner, so there are no fork PRs whose only trigger would be `pull_request`.
The first merged workflow will only truly prove itself after it runs on GitHub
Actions.

Workflow structure:

```yaml
name: Demo shots

on:
  push:

permissions:
  contents: read

jobs:
  demo-shots:
    uses: ./.github/workflows/shotwright.yml
    with:
      mode: self
      config-path: demo/shots.config.ts
```

No secrets are required. No branch/ref appears in the self caller because local
reusable workflow calls use the same commit.

### 3. Add the generated consumer caller template

Create `templates/github/shotwright.yml`.

Template path choice: `templates/github/shotwright.yml` mirrors the destination
file name and sits beside the existing `templates/init/` and
`templates/skills/` families without pretending to be a whole copied
`.github/` tree. The destination should be `.github/workflows/shotwright.yml`.

Template `uses:` line:

```yaml
jobs:
  shotwright:
    uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@main
    with:
      mode: consumer
      config-path: shots.config.ts
```

Use `@main` for the generated template in E7. The repo is private, pre-1.0, and
same-owner only; central propagation of fixes is more valuable than pinning a
temporary SHA that every private consumer would have to update manually. When
shotwright becomes public or starts serving third-party consumers, release tags
or SHAs should be reconsidered. Do not use the current feature branch in a
committed template. The owner/repo string is unavoidable in the committed
template because GitHub reusable workflows require a repository-qualified
`uses:` reference.

The full template:

```yaml
name: Shotwright

on:
  workflow_dispatch:
  pull_request:

permissions:
  contents: read

jobs:
  shotwright:
    uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@main
    with:
      mode: consumer
      config-path: shots.config.ts
```

Consumer trigger choice: `pull_request` plus `workflow_dispatch`. Do not add
`push` to generated consumers by default; screenshots are review artifacts, and
consumer owners can widen triggers if they want every push. This does not weaken
shotwright's own epic acceptance, which is handled by `demo-shots.yml`.

### 4. Extend `shotwright init` to install the CI template

Yes, `shotwright init` grows a CI step. The design says init scaffolds CI, E6
intentionally left it as an E7 seam, and a template that does not ship is dead
on arrival for consumers.

Implementation in `src/init.ts`:

- Load `const ciWorkflow = loadTemplate('github/shotwright.yml')` inside
  `planInit()`.
- Plan it as a managed file at `.github/workflows/shotwright.yml`.
- Use the same `planManagedFile()` semantics as config/spec: create when absent,
  mark up-to-date when identical, leave alone when the consumer has changed it.
  A differing workflow must not exit 1; consumers may legitimately customize
  triggers or config path.
- Include it in formatted output under Created / Left alone / Up to date through
  the existing action/report paths.
- Do not add new CLI flags.

Smoke inventory: extend `test/smoke/cli.test.ts` `expectPackInventory()` around
lines 693-713 to require `templates/github/shotwright.yml`. This is mandatory:
unit tests can stay green while the npm tarball omits the generated CI template.

Add focused init tests in E7.I:

- fresh init creates `.github/workflows/shotwright.yml`;
- re-run with identical workflow reports up-to-date;
- re-run with consumer-edited workflow leaves it alone and exits 0;
- dry-run lists the CI workflow without writing;
- pack inventory contains `templates/github/shotwright.yml`.

### 5. Prove same-owner reusable workflow callability in E7.V

Recommended target: consumer C, not consumer B.

Reasoning:

- Consumer C uses a different framework with its own runner config, and already has
  `playwright.shots.config.ts`, `e2e/shots/*.shots.ts`, `shots` and
  `shots:install` scripts, and established shots harness context.
- Consumer B already has a `shots` script of its own; proving shotwright there would collide with an
  existing migration surface and is not minimal for E7.V.

Minimal consumer proof branch, after owner confirmation at E7.V time:

1. In the local consumer C checkout, create a temporary branch such as
   `verify/shotwright-reusable-workflow`.
2. Add `shotwright` as a dev dependency pointing at the shotwright branch or
   commit under test. For the proof run, use an explicit feature-branch ref or
   SHA so the consumer can call the not-yet-merged workflow. The committed
   shotwright template still uses `@main`.
3. Add a minimal `shots.config.ts` that uses `defineShotsConfig()` and points at
   one tiny proof spec, or adapt the existing `playwright.shots.config.ts` only
   enough to use shotwright's config factory. Do not migrate the full
   consumer C shots suite in E7.V; that belongs to E8.
4. Add one minimal `shots/*.shots.ts` proof spec using `walkthrough()` and
   `shot()`, targeting an already bootable route from the existing webServer
   setup.
5. Add `.github/workflows/shotwright.yml` using:

```yaml
jobs:
  shotwright:
    uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@<E7_SHA_OR_BRANCH>
    with:
      mode: consumer
      config-path: shots.config.ts
```

6. Push the consumer proof branch only after owner confirmation. Run it in
   Actions and record the run URL, called workflow evidence, uploaded artifact,
   and manifest contents in the E7.V verification doc.
7. Clean up afterward by closing/deleting the temporary consumer branch after
   evidence is recorded and the owner confirms it is no longer needed. Do not
   merge the consumer proof branch as part of E7 unless the owner explicitly
   changes scope.

Pushing anything to a consumer repo requires owner confirmation at E7.V time.
This plan names the proof branch and changes but does not assume permission.

## No-gating invariant

Real workflow failures:

- checkout, pnpm setup, Node setup, dependency install, or browser install fails;
- the default browser cache proof fails;
- `mode` is not `consumer` or `self`;
- `pnpm exec shotwright run` / `node dist/cli.js run` exits non-zero;
- `shots-output/latest`, `manifest.json`, `gallery.html`, or referenced PNG files
  are missing or malformed;
- in both `self` and `consumer` modes, `manifest.shots` is missing, is not an
  array, or has length 0;
- in both modes, any manifest shot has a missing or empty `file` value, because
  `ShotEntry` exposes `file` and not `path` (`src/manifest.ts:19-23`);
- the published run directory still contains `.sidecar`, `.pw`, `.manifest.tmp`,
  or an entry beginning `.gallery.`;
- artifact upload finds no files;
- in `self` mode only, the exact five expected demo shots are not present.

Must never fail the job:

- PNG pixels differ from a previous run;
- screenshots, videos, traces, or gallery HTML differ from a baseline;
- a human reviewer would reject the UI;
- a changed artifact compared to a past run, except where the current run
  violates the explicit publication, non-empty-manifest, and demo-manifest
  assertions above.

No golden screenshots, no stored baselines, no visual diff thresholds, no
snapshot assertions, and no artifact comparison against another run.
The non-empty-manifest assertion is still not golden-diff gating: it exists
because the gallery renders `shots: []` as valid browsable HTML
(`src/gallery/render.ts:277-284`), and the research already identified empty
published galleries as false reporting (`docs/shotwright-746.7.1-research.md:171-177`).

## Verification strategy

### Locally provable in E7.I

- YAML files parse structurally with a local YAML-aware check or a focused
  workflow linter if available.
- Unit/init tests prove `shotwright init` loads and reports
  `templates/github/shotwright.yml`.
- Smoke pack inventory proves the npm tarball includes
  `templates/github/shotwright.yml`.
- Existing smoke tests plus a local invocation prove the demo still produces the
  five-shot manifest and gallery using `node dist/cli.js run --config
  demo/shots.config.ts -- --workers=1`.
- A local shell or test fixture can exercise the manifest/artifact assertion
  script against a known run directory, including the mode-agnostic
  `manifest.shots.length > 0`, `shot.file`, PNG signature, and staging absence
  checks.
- Local grep/tests can prove there are no committed host paths, LAN IPs,
  usernames, or personal filesystem paths in the new workflow/template text.

### CI-run-only in E7.V

- `actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v6`, and
  `actions/upload-artifact@v7` execute on GitHub-hosted runners.
- The GitHub runner default browser cache can be removed and repopulated, and
  Chromium resolves inside `~/.cache/ms-playwright` on the runner.
- The first `push` workflow invocation actually runs in this repo; because
  there is no existing CI, local validation cannot close this.
- The uploaded Actions artifact exists, is downloadable, and contains an
  extractable run directory with `gallery.html`.
- The job summary renders and links to `upload-artifact`'s `artifact-url`.
- Same-owner private reusable-workflow callability works from a real consumer
  repo. This requires an actual Actions run in consumer C after owner
  confirmation to push the temporary proof branch.

## Acceptance mapping

| Step | Acceptance / constraint satisfied |
|---|---|
| 1 | Reusable workflow exists, has exactly two justified inputs, installs browsers without caching, proves default-cache resolution, runs shotwright, uploads the published run directory, and writes optional review summary. |
| 2 | This repo runs demo shots exactly once on every push, with no branch or path filters and no unrelated CI assertions. |
| 3 | Consumers get a thin generated caller using same-owner private reuse by `@main`, with no copied CI implementation. |
| 4 | `shotwright init` grows the CI scaffold and tests prove the template ships in the package tarball. |
| 5 | E7.V has a concrete same-owner consumer proof target and cleanup plan, with owner confirmation required before pushing. |
| No-gating invariant | Job failures are limited to setup, browser, run, publication, upload, and false-reporting assertions; no pixel/golden gating is introduced. |

## Assumption pins

| Load-bearing assumption | Deterministic pin | Lands in |
|---|---|---|
| `mode` has only two valid values and no shell escape hatch is needed. | Workflow `case` rejects all other values; no `run-command` input exists. | Step 1 |
| Default-cache proof closes the E2.V browser residual. | `rm -rf ~/.cache/ms-playwright`, install without `PLAYWRIGHT_BROWSERS_PATH`, assert `chromium.executablePath()` starts with the default cache root, then run capture in same environment. | Step 1 / E7.V |
| Demo CI artifact is not empty false reporting. | Mode-agnostic `manifest.shots.length > 0` assertion plus exact sorted five-shot manifest assertion for `self` mode. | Step 1 |
| Uploaded artifact is the published run directory, not a staging or partial directory. | Resolve `shots-output/latest`, assert manifest/gallery/PNG bytes via `shot.file`, assert `.sidecar`, `.pw`, `.manifest.tmp`, and `.gallery.*` are absent, then upload that directory with `if-no-files-found: error`. | Step 1 |
| Generated CI template reaches consumers. | `src/init.ts` managed file action plus pack inventory assertion for `templates/github/shotwright.yml`. | Step 4 |
| Same-owner private reusable calls work in practice. | Real consumer C Actions run calls shotwright's reusable workflow from a temporary proof branch and uploads an artifact. | Step 5 / E7.V |

## Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Action major or GitHub runner behavior differs from researched docs. | E7.V records real Actions output; failures are CI-only evidence, not local guesswork. | Patch the workflow in E7.I follow-up before closing E7.V. |
| `@main` causes consumers to pick up breaking pre-1.0 changes. | Same-owner/private scope accepts central propagation for E7; public/third-party scope is out of scope. | Later switch template to release tags or SHAs when release management exists. |
| Consumer C proof becomes larger than expected. | Keep E7.V to one minimal proof spec/config; defer full migration to E8. | Delete the temporary proof branch and choose consumer B only with owner confirmation. |
| Init overwrites consumer workflow edits. | Use existing managed-file leave-alone semantics. | Revert only the E7.I init change if tests show overwrite behavior; do not touch consumer files. |

## Open questions

None. The workflow filenames, template destination/ref, browser-clean strategy,
consumer proof target, job summary decision, init CI behavior, local-vs-CI
verification split, triggers, and no-gating failure boundary are all settled
above.

## Self-review

- **Measured-or-flagged:** PASS. Quantitative claims are the exact two-input API,
  exact five-shot demo manifest, and cited action majors carried from research.
- **Derived-value semantics:** PASS. The plan defines `latest`, run directory,
  uploaded artifact, demo manifest, and job summary separately.
- **Emergent structure:** PASS. The three workflow surfaces and their coupling
  are explicit: reusable, self caller, consumer template.
- **Batch/concurrency:** PASS. Browser install and capture are one sequential
  default-cache sequence; workflow triggers avoid path-filter race assumptions.
- **Inherited-constraints-grounded:** PASS. The plan rechecks design, E6 init
  mechanics, package scripts, smoke inventory, demo config, and candidate
  consumer repo shape rather than treating research as gospel.
