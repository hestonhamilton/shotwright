# shotwright-746.7.1 — E7.R: artifacts-only CI workflow research

Research date: 2026-07-30. Repo claims were verified on branch
`feat/shotwright-746.7.1-research-ci-workflow`. Ecosystem claims were
web-checked 2026-07-30. Research only — no source, template, package, test, or
workflow files changed.

## Premise check

The bead premise still holds, with one owner-set scope correction. The design
source of truth assigns E7 to deliver reusable artifacts-only CI and prove it on
the demo app (`docs/design.md:36-37`, `docs/design.md:108-113`,
`docs/design.md:127-128`), while E6 deliberately left CI as a seam
(`docs/shotwright-746.6.1-research.md:21-25`,
`docs/shotwright-746.6.2-plan.md:49-57`, `docs/shotwright-746.6.2-plan.md:58-62`).
The working tree currently has no `.github/` directory by filesystem
inspection; that absence has no file line to cite. The shipped `templates/` tree
exists, but today it contains only init config/spec/gitignore and skill files
(`templates/init/shots.config.ts:1-5`,
`templates/init/shots/example.shots.ts:1-6`,
`templates/init/gitignore.snippet:1-4`).

Binding invariants remain unchanged: captures are human-review artifacts, not
golden assertions (`README.md:13-19`); specs are separate from merge-gate e2e
checks (`README.md:20-22`); consuming projects keep only thin config and specs
(`README.md:9-11`, `docs/design.md:21-23`, `docs/design.md:95-97`); the repo is
private and still headed public, so committed workflow/template text must not
depend on host paths, LAN IPs, usernames, or personal data (`docs/design.md:38`).

## Private reuse boundary

Owner decision, 2026-07-30: private reusable-workflow sharing is solved as
same-owner private sharing, not by making shotwright public for CI. The design
records the repo as private (`docs/design.md:38`), and `package.json` points at
the `hestonhamilton/shotwright` GitHub repository (`package.json:7-9`). GitHub
documents that private actions and reusable workflows can be shared with other
private repositories owned by the same user, after widening the called
repository's Actions Access policy to "Accessible from repositories owned by
'USER NAME' user" ([GitHub private sharing](https://docs.github.com/en/actions/how-tos/reuse-automations/share-across-private-repositories),
[GitHub repository Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository?apiVersion=2022-11-28)).

That is the E7 scope boundary. The shotwright repository's Actions Access policy
will be widened to repositories owned by the same user, and E7.V must prove the
reusable workflow from a real same-owner private consumer repo, specifically
consumer B or consumer C. Cross-account and third-party callability are out of
scope while shotwright remains private. Making the repo public now is rejected:
it would be a hard-to-reverse disclosure taken for a CI reason, and the design's
"headed public" constraint implies a full-history/publication scrub before that
step (`docs/design.md:38`). A self-contained copy-paste consumer template is also
rejected because it loses central fix propagation, which contradicts the design
rule that shared copied logic belongs in shotwright or its templates
(`docs/design.md:95-97`).

The caller reference should therefore favor central private propagation over
cross-org immutability in E7 v1: the generated consumer template should call the
workflow from the same-owner private shotwright repository by branch, initially
`hestonhamilton/shotwright/.github/workflows/<workflow>.yml@main`. GitHub
documents SHA references as the safest security/stability choice for reusable
workflows, but in this same-owner private phase the trust boundary is one user
account and the product goal is for fixes to flow centrally
([GitHub reuse workflows](https://docs.github.com/en/enterprise-server%403.19/actions/how-tos/reuse-automations/reuse-workflows)).
Release tags or full SHAs become a later release-management choice when
shotwright is public or when consumers outside the same owner are in scope.

## Current-state split

| Surface | Belongs there | Why |
|---|---|---|
| Reusable workflow | The canonical job: checkout, Node/pnpm setup, install dependencies, isolate/install Chromium, run shotwright through one of two first-class modes, assert the expected published run, upload the published run directory. | The design names a reusable `workflow_call` workflow that runs shotwright and uploads the run artifact (`docs/design.md:108-113`). GitHub requires reusable workflows to live directly under `.github/workflows` and expose `workflow_call` ([GitHub reuse workflows](https://docs.github.com/en/enterprise-server%403.19/actions/how-tos/reuse-automations/reuse-workflows)). |
| shotwright's own CI | A thin caller of the reusable workflow using `mode: self` and `config-path: demo/shots.config.ts`. The called workflow builds this repo and invokes `node dist/cli.js run`, not `pnpm exec shotwright`. | The design requires the package's own example specs and CI to run against the in-repo demo app (`docs/design.md:36-37`); the working repo entrypoint is `demo:shots`, `pnpm run build && node dist/cli.js run --config demo/shots.config.ts` (`package.json:36-43`); E2.V records that `pnpm exec shotwright` does not run from the package's own checkout (`docs/shotwright-746.2.4-verification.md:100-103`). |
| `templates/github/` | A thin consumer caller workflow that `shotwright init` can copy into `.github/workflows/`, defaulting to `mode: consumer` and requiring only the consumer's config path when it differs from `shots.config.ts`. | `init` is the mechanism for scaffolding consumer files (`docs/design.md:86-93`), and E6 left the CI file out specifically so E7 could design it (`docs/shotwright-746.6.2-plan.md:49-57`). |

The previous "one reusable workflow plus two same-shaped callers" formulation
does not survive the repo's self-checkout reality. Consumers can run the package
bin because `package.json` declares `shotwright` as a dependency bin
(`package.json:33-35`) and `init` tells script-conflict consumers to use
`pnpm exec shotwright run` (`src/init.ts:462-471`). The shotwright repo itself is
not self-linked; its own proven path is to build and run `dist/cli.js`
(`package.json:36-43`, `docs/shotwright-746.2.4-verification.md:100-103`).

The defensible shared design is still one reusable workflow, but not arbitrary
shell plumbing. It should expose a narrow `mode` switch with exactly two
documented values:

| Mode | Invocation | Why this is not a generic command input |
|---|---|---|
| `consumer` | `pnpm exec shotwright run --config <config-path> -- --workers=1` | The consumer path exercises the installed package bin and keeps boot inside `shots.config.ts`, matching the package surface and E6 init scripts (`src/init.ts:69-74`, `src/init.ts:76-89`). |
| `self` | `pnpm run build && node dist/cli.js run --config <config-path> -- --workers=1` | The self path is the repo's actual build-and-demo contract (`package.json:36-43`), limited to shotwright's caller. It does not let callers run arbitrary shell. |

This keeps the reusable workflow central, keeps both callers thin, and abandons
only the false claim that both callers can share the same command shape.

## E6 template mechanism

`shotwright init` currently adds scripts `shots`, `shots:gallery`, and
`shots:install` with commands `shotwright run`, `shotwright gallery`, and
`playwright install chromium` (`src/init.ts:69-74`). It loads exactly four
templates today: `init/shots.config.ts`, `init/shots/example.shots.ts`,
`init/gitignore.snippet`, and `skills/shots-harness/SKILL.md`
(`src/init.ts:181-188`), then plans managed file writes for config, spec,
package scripts, gitignore, and skill (`src/init.ts:199-204`). Managed files are
created when absent, reported as up-to-date when byte-identical, and left alone
when consumer-owned content differs (`src/init.ts:280-294`).

For `shotwright init` to drop CI, E7 must add a template file under the shipped
`templates/` tree and add a new plan action in `src/init.ts` that reads it via
the existing template helper. Template resolution is already centralized as
`new URL('../templates/' + rel, import.meta.url)` from the built package
(`src/templates.ts:3-8`), and `package.json` already ships `templates` in the npm
tarball (`package.json:15-18`).

The smoke inventory does need extending. It currently asserts the four E6
template files are packed (`test/smoke/cli.test.ts:693-709`) and rejects docs,
mockups, tests, and the gallery corpus fixture from the package
(`test/smoke/cli.test.ts:710-713`). A CI template would be dead-on-arrival for
published consumers if it were omitted from the tarball, so
`expectPackInventory()` should assert the new `templates/github/...` path.

## Browser-clean residual

E2.V explicitly says the install leg used a `PLAYWRIGHT_BROWSERS_PATH` override
while the capture leg resolved a pre-existing default-cache Chromium, so the two
legs were not jointly proven on a browser-clean host
(`docs/shotwright-746.2.4-verification.md:44-50`). E6.V later proved a fresh Vite
consumer with a cold browser cache after `pnpm shots:install`, but that proof
used an override path and was scoped to E6's generated init chain
(`docs/shotwright-746.6.4-verification.md:20-22`,
`docs/shotwright-746.6.4-verification.md:89-97`).

E7 CI must close that residual with a failure condition that would catch the old
defect shape. A successful `pnpm exec playwright install --list` plus a
successful demo run is insufficient: it can prove that some browser is installed
and some browser was used, not that install and capture resolved the same
browser. Playwright documents `PLAYWRIGHT_BROWSERS_PATH` as the override for both
install and run lookup paths, and says each Playwright version needs its own
browser binaries ([Playwright browsers](https://playwright.dev/docs/browsers)).

Concrete assertion for the reusable workflow:

```bash
export DEFAULT_BROWSER_CACHE="$HOME/.cache/ms-playwright"
if [ -d "$DEFAULT_BROWSER_CACHE" ] && [ -n "$(find "$DEFAULT_BROWSER_CACHE" -mindepth 1 -print -quit)" ]; then
  echo "Default Playwright browser cache is not browser-clean: $DEFAULT_BROWSER_CACHE" >&2
  exit 1
fi
pnpm exec playwright install --with-deps chromium
node --input-type=module -e "import { chromium } from '@playwright/test'; const root = process.env.DEFAULT_BROWSER_CACHE; const exe = chromium.executablePath(); if (!root || !exe.startsWith(root + '/')) throw new Error('Chromium resolves outside default Playwright browser cache: ' + exe);"
```

On Linux, Playwright's default browser cache is `~/.cache/ms-playwright`
([Playwright browsers](https://playwright.dev/docs/browsers)), so the
precondition proves the GitHub-hosted runner is browser-clean before install
rather than assuming it. The install command deliberately uses no
`PLAYWRIGHT_BROWSERS_PATH` override and keeps the consumer command shape
generated by `shotwright init` (`playwright install chromium`) while adding the
CI-appropriate `--with-deps` flag (`src/init.ts:69-74`,
[Playwright CI](https://playwright.dev/docs/ci)). `PLAYWRIGHT_BROWSERS_PATH` is
deliberately not used because it is the confound E2.V recorded and consumers do
not use it.

The subsequent shotwright capture run must also use no override, inheriting the
same default environment. This fails if a pre-existing browser is found in the
default cache before install, if Playwright's resolved executable path points
outside the default cache root, or if the capture run resolves a different
binary than the one installed. The workflow should not restore a browser cache;
Playwright's CI guide recommends installing browsers in CI and explicitly says
browser binary caching is not recommended ([Playwright CI](https://playwright.dev/docs/ci)).

## Published run assertions

Filtering may intentionally match nothing: the design says `--only` is substring
filtering where the walkthrough still runs but only matching writes are filtered
(`docs/design.md:67-68`). The gallery treats an empty manifest as valid HTML,
rendering a "No screenshots in this run" section for `shots: []`
(`src/gallery/render.ts:251-284`). Therefore "artifact contains a browsable
gallery" is not enough. A no-match run can publish a valid, browsable, empty
gallery and still be false reporting for E7's demo acceptance.

The demo self-test CI must assert the exact expected shot set already pinned by
smoke coverage: `about-desktop`, `mobile-layout`, `form-filled`, `modal-open`,
and `theme-dark`, in sorted manifest order (`test/smoke/cli.test.ts:947-956`).
It should parse `shots-output/latest/manifest.json` after the run and compare:

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const latest = fs.readlinkSync('shots-output/latest')
const manifest = JSON.parse(fs.readFileSync(path.join('shots-output', latest, 'manifest.json'), 'utf8'))
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

This fails on an empty gallery, on an accidental `--only` filter, on missing demo
specs, or on an unexpected manifest shape. The workflow should also assert
`gallery.html` exists, every manifest shot file exists, PNGs have non-empty PNG
bytes, and staging directories are absent, matching the smoke run contract
(`test/smoke/cli.test.ts:327-342`).

## Argument forwarding

ADR 0006 supersedes the older "warning only" conclusion: `parseRunArgs()` still
treats `--` as the Playwright passthrough boundary (`src/cli.ts:56-69`), but
`parseRunPassthrough()` now reclaims misplaced `--only`, `--video`, and bare
shotwright `--trace` from passthrough with warnings (`src/cli.ts:103-121`,
`src/cli.ts:194-205`). A Playwright `--trace <mode>` remains passthrough when the
next token is a known Playwright trace mode (`src/cli.ts:89-101`,
`src/cli.ts:114-118`), matching ADR 0006's accepted carve-out
(`docs/adr/0006-shotwright-flags-parse-after-separator.md:41-51`).

Safe command forms for workflow and template text:

| Intent | Consumer package bin | shotwright self-test |
|---|---|---|
| run default captures | `pnpm exec shotwright run --config shots.config.ts` | `pnpm run build && node dist/cli.js run --config demo/shots.config.ts` |
| Playwright CI workers | `pnpm exec shotwright run --config shots.config.ts -- --workers=1` | `pnpm run build && node dist/cli.js run --config demo/shots.config.ts -- --workers=1` |

The reusable workflow should not expose `shotwright-args` or `playwright-args` in
E7 v1. `shotwright-args` would make it easy for the demo caller to publish an
empty gallery with `--only`, and no current acceptance path requires default
video or trace capture. `playwright-args` would lock a public template API for a
single known CI need; hard-code `--workers=1` instead. If a later real consumer
needs a Playwright override, that scenario can justify a named, narrow input then.

## Consumer boot input

The package's own demo script builds then runs the built CLI against the demo
config (`package.json:36-43`). The demo config itself supplies the app boot:
`webServer.command: 'vite dev'`, `url: 'http://127.0.0.1:4173/'`, and
`reuseExistingServer: !process.env.CI` (`demo/shots.config.ts:6-13`), while
`demo/vite.config.ts` pins host `127.0.0.1`, port `4173`, and `strictPort: true`
(`demo/vite.config.ts:7-13`).

For consumers, boot belongs in `shots.config.ts`, not as a reusable-workflow
shell step. `defineShotsConfig()` accepts `webServer` and passes it through
untouched (`src/index.ts:23-35`, `src/index.ts:87-88`), and its probe branch can
discover `outputDir` without starting the web server (`src/index.ts:40-55`).
E6's generated Vite config already writes the editable boot block inside
`defineShotsConfig()` (`src/init.ts:76-89`, `templates/init/shots.config.ts:1-5`).

The only config-shaped reusable-workflow input should be `config-path`, defaulting
to `shots.config.ts`. A separate `boot-command` or generic `run-command` input
would duplicate the config surface and risk diverging from the `webServer.url`
that Playwright waits on.

## Ecosystem grounding

Reusable workflows must live directly in `.github/workflows`, include
`workflow_call`, and define typed inputs/secrets under that trigger; GitHub's docs
state that reusable workflow inputs are `boolean`, `number`, or `string`, secrets
can be explicitly passed or inherited, and environment secrets cannot be passed
through `workflow_call` ([GitHub reuse workflows](https://docs.github.com/en/enterprise-server%403.19/actions/how-tos/reuse-automations/reuse-workflows)).
Callers invoke reusable workflows at the job level with `jobs.<job_id>.uses`, not
as a step, and GitHub recommends commit SHA references as the safest stability
and security option ([GitHub reuse workflows](https://docs.github.com/en/enterprise-server%403.19/actions/how-tos/reuse-automations/reuse-workflows)).
Current reusable-workflow limits include ten levels, 50 unique reusable workflows
per workflow file, no caller workflow-level `env` propagation into the called
workflow, and caller token permissions can only be downgraded by the called
workflow ([GitHub reusable workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)).

Current action majors, as found today:

| Action | Current major to use | Grounding |
|---|---:|---|
| `actions/checkout` | `v6` | Marketplace shows Checkout v6 latest and recommends `contents: read` permission ([checkout marketplace](https://github.com/marketplace/actions/checkout)). |
| `actions/setup-node` | `v6` | README examples use `actions/setup-node@v6`; it supports pnpm dependency caching via `cache: pnpm` and recommends specifying Node rather than relying on PATH ([setup-node](https://github.com/actions/setup-node)). |
| `pnpm/action-setup` | `v6` | README examples use `pnpm/action-setup@v6`; it does not set up Node and can read `packageManager` when `version` is omitted ([pnpm/action-setup](https://github.com/pnpm/action-setup)). |
| `actions/upload-artifact` | `v7` | README examples use `actions/upload-artifact@v7`, while v1/v2 and v3 are deprecated or failed after their deprecation windows ([upload-artifact](https://github.com/actions/upload-artifact), [GitHub artifact deprecation changelog](https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/)). |

GitHub's Node 20 Actions runtime deprecation is active: GitHub says Node 24 became
the default runtime on runners on June 16, 2026, and users should update workflows
to action versions that run on Node 24 ([GitHub changelog](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)).
That favors the latest major tags above rather than older Node 20 action majors.
For application runtime, E7 should hard-code Node 24.x in `actions/setup-node`;
the package floor is `>=20` (`package.json:11-13`) and E2.V's verification
environment already ran on Node 24 (`docs/shotwright-746.2.4-verification.md:108-112`).

Playwright's official CI guide installs npm dependencies, then runs
`npx playwright install --with-deps`, then runs tests; its GitHub Actions example
uses `actions/checkout@v6`, `actions/setup-node@v6`, and uploads reports
([Playwright CI](https://playwright.dev/docs/ci)). Playwright explicitly says
caching browser binaries is not recommended because cache restore time is
comparable to downloading and Linux OS dependencies are not cacheable
([Playwright CI](https://playwright.dev/docs/ci)). Playwright's browser docs also
state each Playwright version needs specific browser binaries, browsers install
into OS-specific caches by default, and `PLAYWRIGHT_BROWSERS_PATH` can override
both install and run lookup paths ([Playwright browsers](https://playwright.dev/docs/browsers)).

GitHub stores build logs and artifacts for 90 days by default; public repos can
configure 1-90 days and private repos 1-400 days, subject to org/enterprise caps
([GitHub artifact retention settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository?apiVersion=2022-11-28)).
`upload-artifact@v7` supports `retention-days`, `if-no-files-found`, compression
level 0-9, hidden-file exclusion by default, and a 500-artifacts-per-job limit;
it creates a zip by default and warns that zipped artifact upload does not
preserve executable permissions ([upload-artifact](https://github.com/actions/upload-artifact)).
GitHub's download docs say browser downloads require read access and artifact
downloads are archived artifacts; the REST API says the artifact download
archive format is zip ([download workflow artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts),
[Actions artifacts REST API](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10)).

The reviewer experience should survive the artifact path for screenshot review.
Repo-side, `gallery.html` embeds CSS, script, and PNG originals inline as data
URIs (`src/gallery/render.ts:286-333`, `src/gallery/render.ts:124-132`), and ADR
0005 says `gallery.html` alone is the complete screenshot artifact while
video/trace remain sibling files (`docs/adr/0005-gallery-single-file-inline-originals.md:20-24`,
`docs/adr/0005-gallery-single-file-inline-originals.md:50-51`). Browser-side,
MDN documents data URLs as inline files within documents and notes large modern
browser limits for data URLs ([MDN data URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data)).
Therefore a downloaded artifact zip that contains the run directory should let a
reviewer extract it and open `gallery.html` for screenshots. Video/trace links
need the sibling run directory preserved because the gallery renders them as
relative sibling links (`src/gallery/render.ts:182-205`, `src/gallery/render.ts:325-325`).

## Options

| Option | Tradeoffs |
|---|---|
| **Recommended:** one reusable workflow with narrow `consumer`/`self` modes | Centralizes CI logic and private same-owner reuse, while respecting that shotwright cannot invoke its own package bin. The mode input is real API, but it is a constrained product mode, not arbitrary shell. Requires E7 to implement a small internal branch for the self-test path. |
| One reusable workflow plus two same-shaped callers | The old recommendation was simpler, but it is false in this repo: consumers use `pnpm exec shotwright`, while shotwright self-tests through `node dist/cli.js` after build (`package.json:36-43`, `docs/shotwright-746.2.4-verification.md:100-103`). |
| Self-contained consumer template only | Easiest for consumers to read and avoids private reuse settings, but every future fix becomes copy-paste drift, violating the thin-consumer invariant (`docs/design.md:95-97`). Rejected by owner decision. |
| Make shotwright public now | Would make public reusable-workflow calls simpler, but it is a hard-to-reverse disclosure for a CI reason and conflicts with the current private/headed-public publication posture (`docs/design.md:38`). Rejected by owner decision. |

## Recommendation

Create a reusable workflow with exactly this public input surface:

| Input | Type | Default | Purpose |
|---|---|---|---|
| `mode` | string | `consumer` | Selects one of the two first-class invocation paths: installed package bin for consumers, built `dist/cli.js` for shotwright self-test. This survives the self-linking ground truth without exposing arbitrary shell. |
| `config-path` | string | `shots.config.ts` | The genuine caller difference: consumers usually use `shots.config.ts`, while shotwright's own CI uses `demo/shots.config.ts` (`package.json:43`, `demo/shots.config.ts:6-13`). |

Do not expose `package-manager`, `install-command`, `browser-install-command`,
`artifact-name`, `retention-days`, `shotwright-args`, or `playwright-args` in E7
v1. Each has one real value today: pnpm is pinned by `packageManager`
(`package.json:14`); dependency install should be `pnpm install --frozen-lockfile`;
browser install should be `pnpm exec playwright install --with-deps chromium`
per Playwright CI guidance ([Playwright CI](https://playwright.dev/docs/ci));
artifact name can be a stable hard-coded convention using GitHub run context
([GitHub contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts));
retention should use the repository default unless a real caller needs shorter
or longer retention; shotwright flags are not needed for acceptance and can
create false empty galleries; Playwright args have one current CI value,
`--workers=1`, which should be hard-coded.

Artifact shape: upload the latest published run directory, not just
`gallery.html`: `manifest.json`, `gallery.html`, `shots/**`, and optional
`video/**` / `trace/**`. Use `if-no-files-found: error` so a crash before
publication is a workflow failure. Keep hidden files excluded; repo staging dirs
are not artifact contract and should be gone after a healthy run
(`test/smoke/cli.test.ts:327-342`).

Browser strategy: do not cache Playwright browsers. Isolate one browser cache in
the runner temporary directory, use it for install and capture via
`PLAYWRIGHT_BROWSERS_PATH`, assert Chromium resolves inside that cache, then run
shotwright. This is the assertion that closes the E2 residual because it fails if
install and capture are not using the same browser resolution path
(`docs/shotwright-746.2.4-verification.md:44-50`).

Demo self-test strategy: after the run, parse `shots-output/latest/manifest.json`
and assert the exact five-shot manifest set pinned by smoke coverage
(`test/smoke/cli.test.ts:947-956`). A browsable `gallery.html` alone is not
sufficient because a valid empty gallery exists by design (`docs/design.md:67-68`,
`src/gallery/render.ts:251-284`).

## Open Questions

1. Workflow file naming and template destination: P must choose the reusable
   workflow filename under `.github/workflows/` and the consumer template path
   under `templates/github/`, then keep those names stable enough for generated
   callers.
2. Same-owner verification target: P must choose consumer B or consumer C for E7.V,
   define the minimal branch/workflow change needed to prove callability, and
   specify how that consumer-side proof branch is cleaned up afterward.
3. Job-summary presentation: P must decide whether to write a Markdown job
   summary linking `upload-artifact`'s `artifact-url` output. This is presentation
   only; the acceptance artifact remains the uploaded run directory
   ([GitHub job summaries](https://docs.github.com/en/actions/reference/workflow-commands-for-github-actions#adding-a-job-summary),
   [upload-artifact](https://github.com/actions/upload-artifact)).

## Self-review

- **Measured-or-flagged:** PASS. Quantitative claims are repo-pinned artifact
  counts with line references or web-cited ecosystem limits/defaults.
- **Derived-value semantics:** PASS. The recommendation distinguishes run
  directory, `latest`, manifest publication, exact shot-set assertion, and
  artifact upload shape.
- **Emergent structure:** PASS. The doc names the three CI surfaces, the private
  same-owner reuse boundary, and the two allowed workflow modes.
- **Batch/concurrency:** PASS. The browser-clean residual is specified as one
  isolated-cache install-and-run sequence, not separate legs.
- **Inherited-constraints-grounded:** PASS. E7 constraints were checked against
  current design, E6 seam docs, init/template code, demo scripts, gallery empty
  semantics, and smoke inventory.
