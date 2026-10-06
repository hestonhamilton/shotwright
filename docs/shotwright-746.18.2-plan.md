# shotwright-746.18.2 — E9.P: the release path and the tarball leak gate

Plan date: 2026-08-01. Working input is `docs/shotwright-746.18.1-research.md`
(E9.R), plus ADR 0010 as amended by ADR 0011. Repo claims below were verified on
branch `feat/shotwright-746.18.2-plan-the-release-path-and-tarball-leak-gate` at
`ea29346` and are marked **Verified**. Nothing in this phase publishes anything.

## Goal

Make the first `shotwright` publish mechanical and rehearsed rather than
improvised, and put a gate in front of it that is demonstrated to fail rather
than merely observed to pass.

The bar is set by §2 of E9.R: **`npm publish` is the only irreversible command in
this project.** A burned version number is burned permanently, unpublish is not a
retraction, and a leaked host path in the tarball is permanent public disclosure.
Everything in this plan exists to make that one command boring by the time it
runs.

## Owner decisions carried in (2026-08-01)

These were open in E9.R §6 and are now settled. They are inputs to this plan, not
conclusions of it.

| # | Decision | Consequence here |
|---|---|---|
| 0a | The bd board's `refs/dolt/data` ref **is deleted before the flip**. The owner accepts "unadvertised" as sufficient, having been told the objects survive deletion and stay reachable by SHA. | Ref deletion needs a replacement backup first (`shotwright-2sr`). Wired: `746.18.6` depends on `2sr.4`. Not this bead's work. |
| 0 | **Flip the repo public before the first publish.** | Provenance is available from the first CI publish onward. The bootstrap publish (§3.2) is deliberately a throwaway prerelease, so the version E8 consumes is attested from birth. |
| 0 (gate) | The flip is **owner-performed**. Automation assembles an evidence pack and stops; no agent or script changes repo visibility. | Out of scope here; recorded on `746.18.6`. This plan's release workflow must not assume the repo is already public at authoring time (§3.1). |

Two E9.R open items are decided by this plan and are flagged for sign-off in
§8: the release manager (Changesets) and the scanner (gitleaks).

## Finding this phase added: there is no verify lane on GitHub

**Verified** by file inspection: `scripts/ci/verify.sh` — install, typecheck,
lint, unit tests — is referenced by exactly one wrapper, `.forgejo/workflows/ci.yml:43`.
The `.github/workflows/` directory contains only `demo-shots.yml` and the
reusable `shotwright.yml`, and neither runs `verify.sh`. `grep -rn 'verify.sh'
.github/` returns nothing.

So typecheck, lint and the unit suite run **only on the forge**, which CLAUDE.md
defines as advisory with nothing gating merges on it. "CI green on PR #26" in
HANDOFF.md refers to the demo-shots lane.

This matters to E9 because the publish lane **must** be GitHub-hosted — E9.R §1.3
records that trusted publishing does not support self-hosted runners — so the
release path cannot lean on a verification lane that only exists on the advisory
provider.

**Resolution taken here, deliberately narrow:** the release workflow runs
`scripts/ci/verify.sh` itself as a precondition of publishing (Step 3). That
closes the gap for the release path without widening E9 into general CI work.
The absent PR-time verify lane on GitHub is a real gap but a *different* one, and
is proposed as a follow-up bead in §8 rather than absorbed here.

## Step list

Five steps. Each is one PR-sized chunk and none of them publishes.

### Step 1 — Package metadata and artifact validation

- Add `publishConfig: { "access": "public" }` to `package.json` (E9.R §5.2).
  **Do not add `provenance: true`** — it is a build-time failure while the repo
  is private, and once trusted publishing is live it is redundant. A comment on
  the field records why it is absent.
- Add `@arethetypeswrong/cli` as a devDependency and extend the `lint` script to
  `eslint . && pnpm run build && publint && attw --pack . --profile esm-only`.
  The `esm-only` profile pins the intent rather than suppressing the check; E9.R
  §4.1 verified it green for all three entrypoints.

Publishes nothing. Touches `package.json` only.

### Step 2 — The leak gate

New files, all under the existing `scripts/ci/` convention so both CI lanes and a
local run share one definition (E9.R §6.4):

- `scripts/ci/leak-gate.sh` — the gate.
- `scripts/ci/gitleaks-tarball.toml` — custom rules.
- `scripts/ci/expected-files.txt` — the packed-file allowlist.

Wired as `pnpm run leak-gate`, and called from `scripts/ci/verify.sh` so it runs
on every branch, not only at release. Design in §2 below.

### Step 3 — The release workflow

`.github/workflows/release.yml`, `workflow_dispatch` only, with inputs
`dist-tag` (default `latest`) and `dry-run` (default **`true`**). Steps:

1. `actions/checkout` at the dispatched ref.
2. pnpm + Node 24.x, then `npm install -g npm@latest` — `actions/setup-node`'s
   bundled npm is not guaranteed to clear the 11.5.1 floor (E9.R §1.3).
3. `pnpm install --frozen-lockfile`.
4. `pnpm exec playwright install --with-deps chromium` — required because
   `test/unit/gallery-browser.test.ts` launches Chromium, exactly as the forge
   wrapper documents.
5. `scripts/ci/verify.sh`.
6. `npm pack --dry-run` into the log, so the shipped file set is reviewable in
   the run record after the fact.
7. `scripts/ci/leak-gate.sh`.
8. `npm publish --tag "${dist-tag}" --access public`, **skipped entirely when
   `dry-run` is true**, in which case `--dry-run` is appended instead.

Permissions `id-token: write`, `contents: read`. No `NODE_AUTH_TOKEN`, no
`secrets.NPM_TOKEN` — the workflow has no credential input at all, by design.

A `concurrency: { group: release, cancel-in-progress: false }` block. Two
concurrent release runs are the one way this workflow could attempt the
irreversible command twice; queuing them is free and cancellation is not safe
here (§5, lens 4).

### Step 4 — Changesets for versioning and changelog only

`pnpm add -D @changesets/cli && pnpm exec changeset init`, plus
`.github/workflows/version.yml` running `changesets/action` with **no `publish`
input**, so it only ever opens or updates the Version PR.

**`changeset publish` is deliberately not used.** E9.R §4.5 records that pnpm's
OIDC support is unsettled and that a pnpm-11 regression broke OIDC publishing;
`changeset publish` delegates to the detected package manager, which would put
the one irreversible command on a code path this project does not control.
Publishing stays an explicit `npm publish` line in Step 3.

Net effect: two human gates before anything ships — merging the Version PR, then
dispatching the release workflow with `dry-run: false`.

### Step 5 — The release runbook

`docs/release-runbook.md`, carrying the bootstrap sequence (§3.2), the token
handling rules (§3.3), the revoke step, and the rehearsal procedure (§4). This
is the document E9.V executes.

---

## 2. The leak gate

### 2.1 What it runs against

The packed tarball, never the working tree. E9.R §3.1 gives both halves of the
reason: the working tree carries `local/`, `.env` and `docs/` that never ship
(noise), and it *misses* anything that reaches `dist/` through the build
(the failure that matters). The gate packs, extracts, and scans the extraction.

```
npm pack --pack-destination "$work"      # or accept a prebuilt tarball as $1
tar xzf "$work"/*.tgz -C "$work"          # yields $work/package/
```

### 2.2 Three layers

**Layer A — file-set allowlist (default-deny).** Every path in the extracted
`package/` must match a glob in `scripts/ci/expected-files.txt`
(`dist/**`, `templates/**`, `README.md`, `package.json`). Anything unmatched
fails. This layer is content-blind and catches a newly-shipped file regardless
of what is in it — including the two files E9.R §3.1 flagged as shipping despite
not appearing in `files`.

The gate also prints the file count and packed size against the recorded
baseline. **Verified at `ea29346`: 43 files, 42.8 kB packed, 158.6 kB unpacked**
— unchanged from E9.R's measurement at `54ab715`. Drift is reported, not failed
on; a legitimate `dist/` change moves the count and a hard equality check would
be edited away within two releases.

**Layer B — shotwright-specific patterns.** Custom gitleaks rules, because these
are the load-bearing part and no scanner ships them:

| Rule | Matches | Deliberately does **not** match |
|---|---|---|
| `host-path-posix` | `/home/<segment>/`, `/Users/<segment>/`, `/root/` | relative paths, `/home` with no trailing segment |
| `host-path-windows` | `C:\Users\` | — |
| `private-ipv4` | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | **loopback** — `127.0.0.1` is the gallery server's correct bind and appears in three `dist/` files |
| `operator-username-in-path` | the username preceded by a path separator | the bare username, which is required in `package.json` `repository.url` and in `templates/github/shotwright.yml`'s `uses:` line |

This table is the whole reason the gate is not a grep. E9.R §3.1 measured a
naive scan firing **three times on a clean tree**; a gate that is wrong three
times per release is a gate that gets disabled by the third release.

**Layer C — generic credential shapes.** gitleaks' default ruleset, as the
backstop under Layer B. Run with `--redact` so a true positive does not print the
secret into a public Actions log.

> **Corrected during E9.I (2026-08-01).** This plan assumed Layers B and C would
> be one gitleaks invocation with `[extend] useDefault = true`. Measured with
> gitleaks 8.30.1, that merge **silently suppresses the `/home/` alternative of
> `host-path-posix`**: identical input, identical rule, fires standalone and
> reports "no leaks found" with the default ruleset merged in. `/Users/` and
> `/root/` are unaffected — only `/home/` is swallowed, by a global allowlist in
> gitleaks' default config.
>
> That is a false negative on the most important pattern this gate has, and it
> presents as a pass. Layers B and C are therefore **two separate invocations**,
> so neither ruleset can disarm the other. See `scripts/ci/gitleaks-tarball.toml`
> for the measurement and `scripts/ci/leak-gate-selftest.sh` for the standing
> regression assertion.

### 2.3 How it fails

Exit `1` on any layer failing. Prints, per finding: the rule name, the path
relative to `package/`, the line number, and a redacted excerpt. Exit `0` prints
the file count, packed size, and baseline delta, and nothing else.

Layer A failures print the unmatched path and the sentence "not covered by
`scripts/ci/expected-files.txt` — if this file is meant to ship, add it there in
the same PR that adds the file."

### 2.4 gitleaks acquisition and version pinning

gitleaks is a Go binary and is **Verified absent** from this workstation. The
script requires it on `PATH` and fails with the pinned version and an install
line; CI installs it in a step. `leak-gate.sh` asserts `gitleaks version` equals
the pin and fails if not — a scanner whose rule engine drifts underneath a
pinned config changes the gate's meaning silently.

**Correction to E9.R §4.3, from direct inspection 2026-08-01.** E9.R described
Betterleaks as a project development was *moving to*. It has already shipped —
v1.1.2, MIT, four maintainers — and gitleaks' README now reads *"Gitleaks is
feature complete. I'm not merging new features into Gitleaks. Future releases
will be security patches only. I'm shifting my focus to Betterleaks."* So the
successor is present, not pending.

This does not change the selection (ADR 0012): Betterleaks is ~4 months old, its
`--redact` support is unverified, and it makes no gitleaks-config-compatibility
claim — the repo's standing bar is that thin-docs tools must clear a high one,
and this tool gates an irreversible operation. It does change the follow-up from
a contingency into a real near-term evaluation with a named successor. The
migration surface is four custom rules, so the cost of moving later stays low
and does not grow.

### 2.5 Adversarial: what still gets past this gate while it stays green

The bead requires this section, and the requirement is earned — a prior redteam
in this repo defeated four greppable checks in one attempt by satisfying the
vocabulary and exit-status constraints while computing the forbidden thing
anyway. **This gate constrains the literal bytes of shipped files. It does not
constrain computation, and it is not a security boundary.**

1. **Any encoding.** A host path base64'd, hex-escaped, or split across string
   concatenation in source survives `tsc` into `dist/` and matches no rule.
   `'/ho' + 'me/' + u` is invisible to every layer.
2. **Runtime-derived paths.** `os.homedir()` in shipped code emits a host path
   into the consumer's artifacts at run time. Nothing is in the tarball to find.
   The gate scans what ships, not what shipping does — and shotwright's whole
   job is writing files.
3. **Non-path PII.** Layers A–C target file identity, path shapes, private IPs
   and credential shapes. A real name, an email, or a customer reference in
   `templates/skills/shots-harness/SKILL.md` prose passes cleanly.
4. **Leaks inside already-allowed shapes.** Layer A globs on `dist/**`, so a new
   file under `dist/` is allowed by construction. Layer A catches *new
   directories*, not new files in old ones; inside `dist/`, only Layers B–C apply.
5. **Editing the gate.** `gitleaks-tarball.toml` is an in-repo file. Adding one
   `allowlist` entry keeps every check green at exit `0`. **An in-repo gate
   cannot defend against a change to itself.** The actual control is human review
   of the release PR diff, and it is worth stating plainly that this is a
   control on *accident*, not on a motivated author.
6. **Loopback carve-out abuse.** `127.0.0.1` is exempt by design. A real internal
   address written as `127.0.0.1` in a comment beside the real one, or any
   address in `127.0.0.0/8` beyond `.1`, is not flagged.

What the gate *does* reliably catch is the failure mode this project has actually
suffered: an absolute host path arriving in a file via a dispatched document or a
generated artifact, unnoticed by a reviewer. That is worth having. It is not
worth over-claiming.

7. **The scanner's own defaults.** Added after E9.I measured it: merging a
   second ruleset in can suppress a rule of yours without saying so. That is not
   hypothetical here — it happened, to the `/home/` pattern, and the gate stayed
   green. Anything that changes how the scanner is *invoked* — an added
   `[extend]`, a shared config, a version bump — can disarm a rule while every
   visible signal keeps saying pass. This is the same shape as route 5, but it
   does not require anyone to touch the rules.

### 2.6 The demonstration requirement

A gate only ever observed passing has not been shown to work. **E9.I must
demonstrate the gate failing**, and the demonstration must be automated, not a
one-time manual check recorded in prose: a test that copies the tarball
extraction to a scratch dir, seeds `/home/seeded-leak-probe/x` into a
`templates/` file, runs the gate, and asserts non-zero exit plus the expected
rule name in the output. One case per Layer-B rule.

---

## 3. Publishing

### 3.1 The exact commands

**Steady state — CI, OIDC, no stored credential:**

```
npm publish --tag latest --access public
```

Run from the release workflow with `permissions: { id-token: write, contents:
read }` on a GitHub-hosted runner, npm ≥ 11.5.1, Node ≥ 22.14.0. No
`NODE_AUTH_TOKEN` is set and no `.npmrc` is written. Provenance is generated
automatically once the repo is public and the trusted publisher is configured.

**ESTIMATE (unverified):** that provenance needs no explicit `--provenance`
flag. npm's docs say automatic; one 2026 practitioner report says the flag was
still required in practice (E9.R §1.2). This cannot be settled before a real
publish. **Pin:** E9.V checks the npm page for the attestation badge after the
first OIDC publish, and adds `--provenance` only if it is absent. Recorded as an
open item, not resolved here by guessing.

**Bootstrap — one time, manual, local:**

```
npm publish --tag next --access public
```

from a fresh `git clone` at the tag, after `pnpm install --frozen-lockfile`,
`pnpm run build`, and `scripts/ci/leak-gate.sh`. No provenance — a local machine
cannot attest, and this version is throwaway by design (§3.2).

### 3.2 First version and dist-tag

**`0.1.0-rc.1` published to `next` first; `0.1.0` to `latest` second.**

The justification is E9.R §2.1's one-line rule: *once `package@version` has been
used, you can never use it again.* The bootstrap publish is the riskiest publish
in the project's life — it is the one that cannot use trusted publishing (E9.R
§1.4), whose failures surface as misleading `404`/`ENEEDAUTH` (same source), and
which has never been run here. Pointing that publish at `0.1.0` bets the version
number E8 consumes on the least-rehearsed operation available.

Burning `0.1.0-rc.1` instead costs a version number nobody wanted and buys three
things:

1. The name is claimed immediately, which is E9.R §3.4's typosquatting response.
2. The trusted publisher can be configured, because the package now exists.
3. **`0.1.0` then ships through CI under OIDC — so the version E8 actually
   consumes carries provenance from birth.** Combined with the owner's flip-first
   decision, no version anyone depends on is ever unattested.

`--tag next` is passed explicitly. npm now requires an explicit tag for
prereleases and only applies `latest` above the current highest non-prerelease
(E9.R §3.3), but the guard is not leaned on. If `latest` lands on a prerelease
anyway, `npm dist-tag add shotwright@<good> latest` moves it back — one of the
few genuinely recoverable mistakes in E9.

### 3.3 Authentication, and where it is not stored

The bootstrap token is a granular token with publish scope on `shotwright` and
Bypass-2FA, minted with `npm token create` (E9.R §1.1 — classic tokens were
permanently revoked 2025-12-09; 7-day default lifetime is ample).

Supplied to the one command via a throwaway user-config, never the real one:

```
tmpnpmrc="$(mktemp)"; trap 'shred -u "$tmpnpmrc"' EXIT
read -rs -p 'npm token: ' NPM_TOKEN            # not in shell history
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$tmpnpmrc"
NPM_CONFIG_USERCONFIG="$tmpnpmrc" npm publish --tag next --access public
```

**Where it is not stored:** not in GitHub repository or environment secrets; not
in `~/.npmrc`; not in the repo; not in `local/`; not in shell history. That npm
always excludes `.npmrc` from tarballs (E9.R §1.5 rule 6) is a safety net, not
part of the design.

**Revoked immediately after step 3 of §3.4 — not left to expire.** E9.R §1.4
names this as the step that gets skipped, and it is already an acceptance
criterion on E9.V.

### 3.4 Bootstrap order

1. Mint the token (§3.3).
2. Publish `0.1.0-rc.1` to `next` from a clean clone, gate passing.
3. Configure the trusted publisher on `npmjs.com/package/shotwright/access`, or
   via `npm trust` — **Verified**: local npm is `11.13.0`, clearing the 11.10.0
   floor for that command.
4. `npm token revoke <id>`. Confirm with `npm token list`.
5. Release `0.1.0` to `latest` through the workflow under OIDC.

Steps 1–4 happen only once, ever.

---

## 4. Rehearsal, and what cannot be rehearsed

Dispatch `release.yml` with `dry-run: true` (the default). Every step in §Step 3
executes for real — checkout, npm upgrade, install, browser install, `verify.sh`,
`npm pack --dry-run`, the leak gate — and the publish step runs as `npm publish
--dry-run`, which packs and validates without uploading.

**The single irreversible command is `npm publish` without `--dry-run`.**
Nothing else in this plan cannot be undone.

Stated explicitly because the bead requires it — **three things cannot be
rehearsed short of publishing:**

1. **Registry acceptance of the credential.** `--dry-run` does not exchange the
   OIDC token or validate the bootstrap token. A trusted-publisher
   misconfiguration surfaces only on the real attempt, and E9.R §1.4 warns it
   surfaces as a misleading `404`. **Do not read that 404 as "the name was
   taken."**
2. **Provenance generation** (§3.1) — observable only on the published page.
3. **That the package installs from the registry.** Proven after the fact, and
   E9.R §5.3 warns that consumers on pnpm 11 see a 24-hour `minimumReleaseAge`
   lag. E9.V must not read that lag as a broken publish.

The rc.1 bootstrap exists precisely because items 1 and 2 are unrehearsable: it
converts them from a risk to `0.1.0` into a risk to a throwaway version.

---

## 5. What the smoke suite does after this lands

**Unchanged. The tarball-based consumer install stays, and no registry install is
added to `pnpm run smoke`.**

The suite already packs and installs a real tarball — `packShotwrightPackage()`
at `test/smoke/cli.test.ts:775` runs `pnpm pack` and four consumer scenarios
install from it (`:1105`, `:1159`, `:1183`, `:1199`). That is the right shape and
this plan does not disturb it, for three reasons:

- It is hermetic and needs no network to the registry, so it gates the release
  *before* publishing. A registry install by definition cannot.
- It tests the same bytes that ship. The tarball is the artifact.
- A registry install in `smoke` would fail for 24 hours after every publish for
  anyone on pnpm 11 (E9.R §5.3), training the operator to ignore a red suite.

The registry install is still required, just not here: it is a **one-shot
post-publish check in E9.V** — `pnpm add -D shotwright` plus `pnpm exec
shotwright --help` in a scratch consumer with no credentials configured, which is
already E9.V's acceptance criterion. `pnpm pack` stays the smoke suite's packer
even though `npm publish` does the publishing; E9.R §4.2 records the two as
equivalent for producing the artifact.

---

## 6. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Host path ships in the tarball | Leak gate, demonstrated failing (§2.6) | **None.** Disclosure is permanent. This row is why the gate is upstream. |
| Bootstrap publish burns `0.1.0` | rc.1 first (§3.2) | None — but the burned number is throwaway by design |
| Bootstrap token left live | Explicit revoke, acceptance criterion on E9.V | `npm token revoke` |
| Stale/partial `dist` published | Workflow builds from a fresh checkout; `verify.sh` before pack | Patch release + `npm deprecate` the bad version |
| Prerelease lands on `latest` | Explicit `--tag`; npm's own guard as backup | `npm dist-tag add shotwright@<good> latest` |
| Two release runs race | `concurrency: release`, no cancel-in-progress | n/a — prevented |
| Provenance silently absent | E9.V checks the npm page for the badge | Add `--provenance`, publish next patch |
| gitleaks pin drifts | Version assertion in `leak-gate.sh` (§2.4) | Repin |
| Release workflow relies on a GitHub verify lane that does not exist | Workflow runs `verify.sh` itself (§Finding) | n/a — designed around |

## 7. Acceptance mapping

| Acceptance bullet | Step | Section |
|---|---|---|
| Exact publish command, tag, access flag, provenance setting | Steps 1, 3 | §3.1 |
| How auth is supplied and where it is **not** stored | Step 5 | §3.3 |
| Leak gate runs against the packed tarball | Step 2 | §2.1 |
| What the gate rejects | Step 2 | §2.2 |
| How it fails — exit status and output | Step 2 | §2.3 |
| **What could still get past while staying green** | Step 2 | §2.5 |
| First version and dist-tag, justified | Step 3 | §3.2 |
| Dry-run rehearsal short of publishing; the single irreversible command named | Steps 3, 5 | §4 |
| What the smoke suite does after this lands | — (no change) | §5 |
| Plan doc committed | this file | — |

### Deterministic pins for load-bearing assumptions

| Assumption | Pin | Lands in |
|---|---|---|
| The gate catches host paths | Seeded-leak test asserting non-zero exit + rule name, one per Layer-B rule | Step 2 |
| The shipped file set is exactly the four known shapes | `expected-files.txt` allowlist, fails on any unmatched path | Step 2 |
| Loopback and the bare username are not flagged | Negative tests over the three known-legitimate hits | Step 2 |
| gitleaks behaviour is stable | `gitleaks version` equality assertion | Step 2 |
| ESM-only resolution is green | `attw --pack . --profile esm-only` in `lint` | Step 1 |
| Concurrent releases cannot double-publish | `concurrency` group in the workflow | Step 3 |
| Provenance needs no explicit flag | **Unpinnable before publish.** Observation in E9.V (§3.1) | E9.V |

## 8. Component decisions — signed off, ADR 0012

Owner sign-off 2026-08-01. Both selections are recorded in
`docs/adr/0012-release-tooling-changesets-and-gitleaks.md`, authored at decision
time per the repo convention.

- **Changesets**, for versioning and changelog only, with `changeset publish`
  deliberately unused (§Step 4).
- **gitleaks**, pinned, as Layers B–C of the gate (§2.4), knowingly adopting a
  feature-frozen tool for the reasons in the ADR.

### Follow-up beads

Grounded against current practice by web search on 2026-08-01 before filing, at
the owner's instruction, rather than filed from the plan's assumptions.

1. **No verify lane on GitHub.** Typecheck/lint/test run only on the advisory
   forge, so nothing blocking verifies a PR. Current guidance is required status
   checks via rulesets, with one gotcha that applies directly here: a check only
   enters the merge checklist when it runs against the PR's **head commit**, so a
   workflow triggered on `push` but not `pull_request` never reports and blocks
   the PR permanently. Both existing wrappers here trigger on bare `push`.
2. **Provenance follow-through.** npm's docs say trusted publishing generates
   provenance automatically with no flag, but 2026 practitioner reports say
   `--provenance` was still needed — possibly only on the first publish. A third
   route is `publishConfig.provenance`. Settle empirically in E9.V.
3. **gitleaks → Betterleaks evaluation.** No longer a contingency: the successor
   has shipped (§2.4). Evaluate once it has a release history and a verified
   `--redact`; the migration surface is four custom rules.
4. **Action and reusable-workflow pinning.** Broader than E9.R §6.5's
   `templates/github/shotwright.yml@main` finding: tags are mutable too, and the
   2026 consensus — and GitHub's own guidance — is full-commit-SHA pinning with a
   version comment. This repo's own workflows pin `actions/checkout` and
   `pnpm/action-setup` by tag. GitHub's 2026 roadmap includes a workflow lockfile
   that would change the mechanism again, so this wants a decision, not a sweep.
5. **Vulnerability review.** Resolved by `shotwright-746.23` and amended by
   `shotwright-746.18.16`: OSV-Scanner is the blocking CI gate and Dependabot
   proposes routine and advisory-driven repairs. ADR 0019 records why the native
   package-manager endpoint is no longer used.

Filed as `746.20`, `746.18.7`, `746.21`, `746.22`, `746.23`. Two are wired into
the critical path on owner decision: `746.18.7` (provenance) depends on the first
publish, and **`746.23` (vulnerability review) blocks the flip** — the owner's
vetting list named PII, secrets *and* vulnerabilities, and the third had no home
until now.

## 9. Self-review

Run against the five-lens rubric before exit. Flags are recorded, not hidden —
naming an unbacked claim is what stops the surrounding rigor from laundering it.

1. **Measured-or-flagged** — *flag.* Two claims are estimates and are tagged
   inline: whether provenance needs an explicit `--provenance` (§3.1), and the
   assumption that the pre-flip vetting is short (inherited from E9.R §3.6, owned
   by `746.18.6`, not by this plan). Every other number here — 43 files, 42.8 kB,
   npm 11.13.0, the three legitimate-hit classes, the smoke-suite line numbers —
   was measured on this branch and is marked **Verified**.
2. **Derived-value semantics** — *pass, with one definition added.* The
   file-count baseline is a **reported delta, not an assertion** (§2.2);
   equality would be edited away. The allowlist's semantics in the aggregate are
   defined: unmatched path fails, matched-but-empty `dist/` is caught upstream by
   `verify.sh` building first, and glob matching is per-path with no ordering
   dependence.
3. **Emergent structure** — *pass.* The gate's inputs are a flat path list; no
   ordering, cardinality or connectivity property is inferred from a proxy. The
   one cardinality claim (43 files) is measured and explicitly non-gating.
4. **Batch/concurrency** — *flag, then resolved.* The publish is a multi-step
   non-atomic sequence with no transaction available, and the first draft of this
   plan had no concurrency control — two dispatches could both reach `npm
   publish`. Added: `concurrency: { group: release, cancel-in-progress: false }`
   (§Step 3), with cancellation off because cancelling mid-publish is worse than
   queueing.
5. **Inherited-constraints-grounded** — *flag, and it caught something.* Checking
   ADR 0010/0011 and E9.R's constraints against the real tree surfaced that
   **`scripts/ci/verify.sh` has no GitHub wrapper**, so a release path assuming a
   green GitHub verify lane would have been assuming something untrue. Designed
   around in §Finding and filed as follow-up 1. The rest of E9.R's repo claims
   re-verified clean at `ea29346`.

**Not established by this plan:** that the gate's Layer-B rules are sufficient
against a motivated author (§2.5 argues they are not, by construction); that
provenance works end to end (§3.1, unpinnable); and that the trusted-publisher
configuration is correct (§4, unrehearsable). Each is assigned to E9.V rather
than rounded up here.
