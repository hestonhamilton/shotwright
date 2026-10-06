# shotwright-746.7.4 — E7.V: artifacts-only CI workflow verification

Verified 2026-07-30/31 against merged `main` (`f618a1a`, PR #16). All evidence
below comes from **real GitHub Actions runs**, not local simulation.

Verdict wording in this document is deliberately narrow. An earlier draft was
redteamed and found to overclaim in six places; the corrected wording below says
only what the cited evidence establishes. Where something is unproven it is
labelled unproven, not softened.

## Epic acceptance

| Criterion | Verdict |
|---|---|
| This repo's CI runs the demo shots suite on every push | **PASS** — configured with unfiltered `on: push:`, observed executing on both a feature branch and `main` |
| The artifact contains a browsable gallery with the demo's expected shot set (not an empty gallery) | **PASS** — downloaded, byte-inspected, **and rendered in a real browser** |
| The reusable workflow is callable from another repo owned by the same account | **PARTIAL — cross-repo resolution and access PROVEN; end-to-end consumer execution UNPROVEN** (see below) |
| Cross-account/third-party callability | Out of scope by owner decision (repo is private) |

| Supporting check | Verdict |
|---|---|
| Gates: `pnpm run typecheck && pnpm run lint && pnpm run test` | **PASS** — 202/202, publint "All good!" |
| `pnpm run smoke` | **PASS** — 17/17 |
| E2.V browser-clean residual | **PROXY EVIDENCE for `self` mode only** — not closed; direct browser provenance remains open |
| No-gating invariant | **PASS by workflow inspection**; a real failed run corroborates |
| No host paths, LAN IPs, or unintended personal data in the new workflow/template files | **PASS** — with the intentional same-owner repo reference noted below |

## Runs of record

| Run | Branch | Result | Note |
|---|---|---|---|
| 30596384103 | feature | **failure** | first-ever CI run; found the `vite: not found` defect |
| 30596729374 | feature | success (1m11s) | artifact downloaded, inspected, and rendered |
| 30596862373 | `main` | success (52s) | push-triggered execution on the default branch |
| 30598119284 (private consumer repo) | consumer B | failure at step 2 | cross-repo resolution proof |

Run IDs, conclusions, and the `access_level` precondition were verified directly
via `gh`. (The V-gate redteam could not independently
confirm them — its `gh` calls failed with a network error and the private runs
returned 404 through its other path. It said so rather than assuming.)

## The first run failed, and it earned its keep

Run 30596384103 failed at `Run shotwright`:

```
[WebServer] /bin/sh: 1: vite: not found
Error: Process from config.webServer was not able to start. Exit code: 127
shotwright: 0 shot(s) → .../shots-output/2026-07-31T01-28-15_26f5
```

`self` mode invokes `node dist/cli.js` directly from bash, which carries no
`node_modules/.bin` on `PATH`, so Playwright could not spawn `vite dev`.

**This defect is unreachable locally through any normal path** — `pnpm run
demo:shots` supplies that `PATH` and masks it completely. It was findable only
because the workflow triggers on `push`, so the branch push executed it for real
before the merge.

Reproduction and fix candidates, all executed locally:

| Invocation | Result |
|---|---|
| `pnpm run demo:shots` | works — masks the bug |
| `CI=1 node dist/cli.js run --config demo/shots.config.ts` | reproduces exactly: `vite: not found`, `0 shot(s)` |
| `CI=1 pnpm exec node dist/cli.js run …` | **still fails** — `pnpm exec` contributes the *relative* `./node_modules/.bin`, and the webServer does not spawn with the repo root as cwd |
| `CI=1 PATH="$PWD/node_modules/.bin:$PATH" node dist/cli.js run …` | **works** — `2 passed`, `5 shot(s)` |

Fixed with an absolute path in `self` mode only. `consumer` mode is unaffected:
`pnpm exec shotwright run` executes from the consumer repo root, where a
root-level config resolves correctly.

## Artifact proof

Artifact `shotwright-Demo shots-30596729374-1`, downloaded with `gh run
download` and inspected on disk:

- `manifest.json` lists **exactly the five expected demo shots** —
  `about-desktop`, `mobile-layout` (about.shots.ts); `form-filled`,
  `modal-open`, `theme-dark` (home.shots.ts).
- `gallery.html` is 2,949,138 bytes containing **5 inline
  `data:image/png;base64` originals**, consistent with ADR 0005.
- The `latest` symlink was **correctly dereferenced** — the artifact contains
  the real run directory, not a dangling link. This was the highest-risk item
  flagged at the P gate; confirmed a non-issue in practice.
- **No staging leakage**: no `.sidecar`, `.pw`, `.manifest.tmp`, or `.gallery.*`.
- PNGs are real, 46 KB – 576 KB.

**Browser render — "browsable" proven, not inferred.** The downloaded
`gallery.html` was opened from `file://` in headless Chromium via Playwright and
screenshotted. Result: `5` cards, title `Shotwright gallery —
2026-07-31T01-36-18_2ffa`, search control present, all loaded `<img>` elements
complete with non-zero `naturalWidth`, and **zero `pageerror` and zero
console-error events**. The image count is bounded by design (overview decode is
capped), which the render confirms rather than contradicts.

The rendered page was then visually inspected by the reviewer: run header,
the "Published manifest · pass/fail status is not embedded" badge, `5 shots · 2
specs`, `Video and trace absent in this run`, timing and version metadata
(`shotwright 0.1.0 · Playwright 1.62.0`, `Manifest v1 · 2,156 bytes`), viewport
filter chips, keyboard affordances (`/` search, `Esc` clear, `Tab` actions), and
the `about.shots.ts` group showing real captures. `theme-dark.png` was separately
opened and inspected: dark theme applied, toggle label flipped to "Use light
theme", form populated, layout intact.

Provenance: inspected by the reviewer, not a human. Human review happens
at the PR gate.

## Callability — precisely what was and was not proven

**Proven: cross-repo resolution and access.** Calling shotwright's reusable
workflow from **consumer B**, a different repo owned by the same account, resolved
and began executing shotwright's own job:

```
JOBS
X shotwright / Shotwright artifacts
  ✓ Set up job
  ✓ Run actions/checkout@v6
  X Run pnpm/action-setup@v6
```

GitHub resolved the cross-repo `workflow_call` and ran shotwright's steps inside
another repository's runner. That is the linkage the widened Actions Access
policy exists to permit, and it was the thing in doubt. Precondition verified
independently beforehand: `gh api repos/…/actions/permissions/access` →
`{"access_level":"user"}`.

**Not proven: everything after step two.** The consumer B run **failed at
`pnpm/action-setup@v6`, before dependency install, before `shotwright run`,
before run-directory resolution, and before artifact upload.** No consumer has
installed dependencies, captured a screenshot, produced a manifest, or uploaded
an artifact through the reusable workflow. The plan expected a consumer proof
including artifact and manifest contents
(`docs/shotwright-746.7.2-plan.md:465`, `:566`); that expectation is **not met**
and is carried as residual 1.

The blocking cause is structural, not incidental: shotwright is not published to
npm and is not a dependency of any consumer, so `pnpm exec shotwright run`
cannot succeed anywhere yet. That is E8's work.

**Target changed from the planned one.** The plan named consumer C, but
running CI there would have had side effects outside E7's remit, so consumer B
was used instead. The consumer repo was left untouched: the proof branch was
pushed, observed, then deleted locally and remotely, and the repo verified back
on `main` at its original commit.

**Defect found by the proof** — filed as `shotwright-746.8.1` (under E8, where
consumer B's migration lives). The reusable workflow runs every step at the repo
root, so a monorepo consumer cannot use it. consumer B has no root `package.json`
(its app is in `frontend/`), so `pnpm/action-setup@v6` — invoked with no
`version` so that it reads `packageManager` — fails with `No pnpm version is
specified`. That message is the symptom; the cause is the root-directory
assumption. This never surfaced in shotwright's own CI because shotwright
declares `packageManager` at its root, and it would not have surfaced on
consumer C either, which also declares it.

## Browser-clean residual (E2.V) — proxy evidence, not closure

On genuinely clean GitHub-hosted runners, both `Install default Playwright
Chromium` and `Prove self-mode default Playwright browser path` passed in runs
30596729374 and 30596862373. The default cache is emptied, Chromium is installed
into it with **no `PLAYWRIGHT_BROWSERS_PATH` override anywhere**, and
`chromium.executablePath()` is asserted to resolve inside the default root.

That is the sequence E2.V's caveat anticipated
(`docs/shotwright-746.2.4-verification.md:44-50`: "on a clean host the default
cache serves both legs with no override"), executed for real on a clean runner
for the first time.

**But it is not closure.** `chromium.executablePath()` reports Playwright's
*default resolution*, not the binary the capture actually launched. The evidence
is a proxy one step removed from the claim, and it covers `self` mode only.
Overriding the browser is a supported feature (`src/index.ts:31` documents `use`
as the executablePath escape hatch) that a real consumer already relies on, so
`consumer` mode makes no browser-clean claim at all — the workflow says so in a
comment at the relevant steps.

The residual is therefore **narrowed and better-evidenced, not closed.** The root
fix — recording the launched binary in the manifest, replacing the proxy with a
direct observation — is `shotwright-746.11`.

This narrowing followed the third same-shape defect in the same proof (see the
ledger below) and was raised to the owner rather than patched a fourth time.

## No-gating invariant

**Established by inspection of the shipped workflow**, which is the real
evidence: there are no golden screenshots, no stored baselines, no visual
diffing, no snapshot assertions, and no comparison against any previous run
anywhere in `.github/workflows/shotwright.yml`. Every assertion inspects only
the current run's published shape.

Run 30596384103 **corroborates** this: it failed because the walkthrough crashed
and captured zero shots, never because pixels differed. One crash-induced
failure cannot by itself demonstrate the invariant — it can only fail to
contradict it — so it is recorded as corroborating evidence, not proof.

## Committed-content check — stated precisely

The new workflow and template files contain **no host paths, no LAN IPs, and no
unintended personal data**. `demo/shots.config.ts` and the demo vite config use
the loopback address `127.0.0.1`, which is not a host or LAN identifier.

`templates/github/shotwright.yml` **does** contain the owner/repo string
`hestonhamilton/shotwright`, and `package.json` carries it in repository
metadata. This is **intentional and unavoidable** — a GitHub reusable workflow
requires a repository-qualified `uses:` reference — and it is pre-existing,
already committed in `docs/design.md` as the project's own identity. It is noted
here rather than claimed absent: an earlier draft of this document asserted a
blanket "no usernames in committed files", which was false as written.

## Residuals

1. **No consumer has executed the workflow past step two.** The consumer B proof
   failed at `pnpm/action-setup@v6` — before install, capture, manifest, or
   artifact upload. The plan's expected consumer artifact/manifest proof is
   **not met**. Blocked on shotwright not being published or installable. E8.
2. **`shotwright-746.8.1`** — monorepo consumers unsupported; `packageManager`
   is an unstated prerequisite that `init` does not ensure.
3. **`shotwright-746.11`** — browser provenance; converts the `self`-mode proxy
   into a direct observation and would extend the claim to `consumer` mode.
4. **The job summary's rendered output was verified by local shell simulation,
   not read back from GitHub's UI.** The step reports `success` on the live run;
   its exact rendering on the run page was not visually confirmed.
5. **`shotwright-746.10` culprit identified.** The unit suite flaked twice more
   during this phase (`1 failed | 201 passed`). Captured on the second attempt:
   `test/unit/gallery-browser.test.ts:218` — pressing `/` and immediately
   asserting `#search` holds focus is an unawaited focus transition, which loses
   its race only under event-loop contention. A **test defect, not a product
   defect**; the bead carries the mechanism and a suggested fix.
6. **Consumer CI readiness** is outside what this verification established;
   E8 must confirm it before migrating each consumer.
7. **"Every push" is a configuration claim plus two observations.** `on: push:`
   is unfiltered (covering branch and tag pushes), and execution was observed on
   a feature-branch push and a `main` push. It is not a proof about all future
   pushes, and fork behaviour is untested and irrelevant while the repo is
   private and same-owner.

## Redteam ledger (E7 epic, all four gates)

One redteam per R/P/I/V transition; none re-argued against another.

| Gate | Verdict | Fix-now findings |
|---|---|---|
| R → P | NO | private-repo acceptance gap; nine-input surface; browser-clean proof insufficient; consumer-mode empty gallery |
| P → I | NO | `shot.path` field does not exist (would throw on every successful run); consumer-mode empty gallery; staging names that exist nowhere |
| I → V | NO | browser-clean proof is a proxy, not an observation |
| V → close | NO | **six overclaims in this document**: callability, browser-clean "closed", a false blanket "no usernames" check, "browsable" without a render, "every push" precision, and "demonstrated" no-gating |

The V gate is the one that mattered most for honesty: this document was written
by the reviewer itself and had no independent scrutiny until that gate.
Every overclaim it found has been corrected above, and one — "browsable" — was
upgraded from a narrowed claim to a proven one by actually rendering the
artifact rather than weakening the wording.

Reviewer-found, outside the redteams: the `pnpm exec shotwright` self-resolution
failure that broke the original architecture; the isolated-cache proof that
would have proven the wrong path; the job-summary backticks that bash read as
command substitution; the `push`+`pull_request` pair that double-ran the capture
suite on every PR push; and the `vite: not found` CI failure with its two failed
fix candidates.

**Considered and declined** (recorded, not filed): shell interpolation of inputs
into `run:` blocks (the caller already controls its own workflows — not a
privilege boundary); `rm -rf` of the browser cache on self-hosted runners
(unreachable; `ubuntu-latest` is hard-coded and both consumer repos use it);
npm/yarn consumer support (lock-in, not an invariant break); fork-PR behaviour
(not a practical scenario for a private same-owner repo).

## ADR

E7's binding decisions are recorded in
[ADR 0007](adr/0007-ci-reusable-workflow-same-owner-private.md): the
same-owner-private sharing scope, the two-input reusable-workflow surface, and
`@main` pinning in the generated consumer template.
