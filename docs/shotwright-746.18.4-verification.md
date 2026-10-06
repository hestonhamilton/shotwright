# E9.V — Release verification (`shotwright-746.18.4`)

Verification record for the first publish of `shotwright` to the public npm
registry. The order of operations is fixed by the bead and is not reordered here:
dry-run rehearsal → redteam 1 (leak gate) → redteam 2 (release path and this
document's claims) → triage → owner approval → publish → verify from outside.

**Status legend.** Every section states whether it has been RUN or NOT RUN. Per
the E4.V precedent, a partial result is recorded as partial, never rounded up.

---

## 1. Dry-run rehearsal — RUN (2026-09-05), re-run REQUIRED at the publish commit

`Release` dispatched with `dry-run: true`, `dist-tag: next`.

| Field | Value |
|---|---|
| Run | `33938034433` |
| Commit | `0304e7b` (branch of PR #53; merged to `main` as `6f2c1c0`) |
| Conclusion | success |
| Packed | `shotwright-0.1.0.tgz`, 44 files, 57.1 kB packed, 199.8 kB unpacked |

Every step ran for real — verify lane, browser install, gitleaks and OSV-Scanner
install, pack, leak gate against the packed file — and the publish ran as
`npm publish --dry-run`. The leak gate passed against the exact tarball.

**This rehearsal is stale for publishing purposes.** It predates the commits that
will be on `main` at publish time (at minimum PRs #52 and the `--help`, runbook and
Dependabot fixes from 2026-10-05). Runbook §2.4 requires the dry run to be green
*for the exact commit* being published; re-dispatch and record the new run id here
before the owner gate.

### 1.1 Packed file set (from the run log)

Baseline for runbook §2.4: **44 files**. A jump to 200 is a caught mistake.

```
LICENSE
README.md
dist/capture.d.ts
dist/capture.js
dist/cli.d.ts
dist/cli.js
dist/filter.d.ts
dist/filter.js
dist/gallery/assets.d.ts
dist/gallery/assets.js
dist/gallery/compare-model.d.ts
dist/gallery/compare-model.js
dist/gallery/generate-compare.d.ts
dist/gallery/generate-compare.js
dist/gallery/generate.d.ts
dist/gallery/generate.js
dist/gallery/model.d.ts
dist/gallery/model.js
dist/gallery/render-compare.d.ts
dist/gallery/render-compare.js
dist/gallery/render.d.ts
dist/gallery/render.js
dist/gallery/resolve.d.ts
dist/gallery/resolve.js
dist/gallery/server.d.ts
dist/gallery/server.js
dist/index.d.ts
dist/index.js
dist/init.d.ts
dist/init.js
dist/manifest.d.ts
dist/manifest.js
dist/reporter.d.ts
dist/reporter.js
dist/runs.d.ts
dist/runs.js
dist/templates.d.ts
dist/templates.js
package.json
templates/github/shotwright.yml
templates/init/gitignore.snippet
templates/init/shots.config.ts
templates/init/shots/example.shots.ts
templates/skills/shots-harness/SKILL.md
```

This matches `scripts/ci/expected-files.txt` (layer A of the leak gate), which is
what the gate's PASS line in the same run asserts.

### 1.2 What the dry run does not prove

Carried from runbook §2.3, restated so nobody reads "green" as "done":

1. Registry acceptance of the OIDC credential — `--dry-run` never exchanges it.
2. Provenance generation — observable only on the published package page
   (`shotwright-746.18.7`).
3. Installability from the registry.

---

## 2. Redteam 1 — leak gate — RUN (2026-10-05)

Brief: get a host path, LAN IP, or operator username into the published tarball
while `scripts/ci/leak-gate.sh` exits 0. Dispatched to an independent review pass as a false-negative coverage test of the scanner, in a throwaway clone of
`main` at `6f2c1c0`. Every case packed a real tarball with `npm pack`, ran the real
gate against it, extracted it, and grepped for the payload. The full report, the
case harness, and a per-case transcript (command, stdout, stderr, exit, grep) are
archived outside the repo, so they are not in this
repository's history; this section is the committed record.

**Verdict as delivered: FAIL** — 29 cases, 17 detected, 1 not shipped, 1 control,
10 not detected in six classes. Triage in §4 declines all six for this release.

### 2.1 Detected (the gate works on what it claims)

Literal POSIX, macOS and Windows paths in templates and in `tsc` declaration
output; base64-, percent- and `\u`-encoded paths (gitleaks 8.30.1 decodes before
matching — see 2.3); all three RFC1918 ranges in `package.json`; a home path in a
`devDependencies` value; a path after NUL bytes; a path after 2 MiB on one line;
and 36 findings when a `sourceRoot` was pushed into `.js.map`/`.d.ts.map` output
(a hypothetical build change — current `tsconfig.build.json` emits no maps).

### 2.2 Not detected

| Class | Cases | Why the gate misses it |
|---|---|---|
| Split-then-concatenated literal | `"/ho" + "me/…"` in source | Scanner sees bytes, not evaluated strings; plan §2.5 concedes runtime-derived content |
| Non-canonical IPv4 | decimal integer, dotted octal, hex, zero-padded | `private-ipv4` matches canonical dotted decimal only |
| Private topology outside RFC1918 | IPv6 link-local `fe80::`, `.local`, `.lan` hostnames | Out of the rule set's stated scope; hostnames were already a recorded gap (746.18.3, evidence pack §7.4) |
| Public handle outside path position | bare, email local part (synthetic analogue) | The rule is `[/\\]hestonhamilton\b` — the **public GitHub handle** in path position. A bare mention of a public handle is not a disclosure. The operator's *local* username is unknown to the gate by design and is checked at flip time by `scripts/flip-evidence.sh`, which derives it at runtime |
| Sensitive tar member names | `templates/home/<x>/…` as a path | Layer A checks allowlist membership only; gitleaks scans contents, not names |
| Nested compressed archive | `.tgz` under `templates/` | Layer A admits `templates/**`; contents of an inner archive are never extracted |

### 2.3 Corrections to earlier documents, found by this run

- Plan §2.5 says base64 and hex escaping survive the gate. **Stale**: gitleaks
  8.30.1 decodes base64, percent and unicode escapes before matching and Layer B
  fired on all three (`decoded:base64|percent|unicode` tags). Coverage gain.
- `npm pack` (npm 11.13.0) did not normalise `package.json` content; the packed
  file was byte-identical to the source. The "content that exists only after
  pack" premise in the brief was not true on this path.

### 2.4 Not tested

The real operator username (the brief forbade it; the synthetic analogue plus
the regex settle the question); native Windows packing; the OSV gate (unrelated
to this test and the installer could not write to the sandbox's `$HOME`).

---

## 3. Redteam 2 — release path and this document's claims — RUN (2026-10-05)

Brief: wrong file set, stale or dirty `dist`, wrong tag, credential leakage,
anything this document asserts but has not evidenced. Dispatched to a second independent pass
against a clone of `main` with the six then-unmerged
branches merged in order (all clean), so it audited the integrated state. Full
report with command transcripts: archived outside the repo; this section is the committed record.

**Verdict as delivered: FAIL — DO NOT PUBLISH.** Thirteen findings. The blocker
(RT2-01) is simply that the preconditions are not yet met — the repo is private,
the package does not exist, no dry run exists at the publish commit — which is
the state this document already records. The other twelve are below with their
disposition; §4.2 has the reasoning.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| RT2-02 | HIGH | `flip-evidence.sh` reported **0 gitleaks findings** in a sandbox where the `/dev/stdout` report capture was empty, because it never read gitleaks' exit status. Printed a different digest and exited 0 | **Fixed** (`746.18.6`): report via `--report-path -`; exit 1 without a report, or any other status, fails closed |
| RT2-03 | HIGH | `release.yml` ran a real publish from any ref and accepted `0.1.0` under `next` or `0.1.0-rc.1` under `latest` | **Fixed** (`746.18.22`): main-only for real publishes; version/dist-tag pairing enforced |
| RT2-04 | HIGH | Runbook bootstrap let `leak-gate.sh` pack and discard its own tarball, then `npm publish` packed a second one no gate saw; also skipped `verify.sh` | **Fixed** (`746.18.23`): pack once via `npm pack --json`, scan that file, publish that file |
| RT2-05 | HIGH | Runbook token command (`--read-only=false`) set none of the permissions the prose required | **Fixed** (`746.18.23`): exact granular-token flags |
| RT2-06 | HIGH | Layer A allowlist used `dist/**` and `templates/**`; a 45th file under either passed while docs called it default-deny | **Fixed** (`746.18.21`): all 44 files listed exactly; extra file now fails |
| RT2-07 | MED | Pack step chose the first `*.tgz` by `find`; a stale tarball in the directory would be scanned and published | **Fixed** (`746.18.22`): fresh directory, filename from `npm pack --json` |
| RT2-08 | MED | `npm install -g npm@latest` floats; the Sept dry run used 12.0.2, latest was 12.2.0 | **Fixed** (`746.18.22`): pinned to 12.2.0 |
| RT2-09 | MED | Bootstrap `trap … EXIT` fires when the terminal closes, so the token file outlived the publish | **Fixed** (`746.18.23`): subshell-scoped trap, `unset` after |
| RT2-10 | MED | This document conflated the local rc bootstrap with the workflow in the owner checklist, and §7 read as if checkout/setup-node v7 were integrated | **Fixed** here: §5 split into two gates; §7 reworded |
| RT2-11 | MED | `pnpm add -D shotwright` resolves `latest`, never the rc, and pnpm 11's release-age gate rejects a fresh stable for 24h | **Fixed** (`746.18.23`): install by exact version with the age gate off in the scratch dir only; `pnpm list` before the bin |
| RT2-12 | LOW | Script in a clone named `clone` asked the backup for database `clone`; a clone with no forge remote silently skipped the hostname sweep | **Fixed** (`746.18.6`): `--name` from `package.json`; a skipped sweep is recorded into the digest |
| RT2-13 | LOW | Runbook §0 still said GitHub's ref was the only off-machine copy; §1.3 named `npm trust` with no command | **Fixed** (`746.18.23`) |

Confirmed by the audit, with commands: the six branches merge cleanly; frozen
install, build and the full verify lane pass on the integrated tree (290 tests);
the packed set is exactly the 44 files in §1.1; the exact tarball passes the leak
gate; the workflow scans and publishes the same output path; no `.npmrc`, token
or `NODE_AUTH_TOKEN` is configured; the pinned actions resolve to checkout
v6.1.0, setup-node v6.5.0, pnpm/action-setup v6.0.9, changesets/action v2.1.1
with valid input names; `changeset version` under CLI 3.0.3 takes `0.1.0-rc.1`
to `0.1.0`; the package installs from its tarball into a scratch consumer, the
bin runs, and all three export paths import; the registry has no `shotwright`;
the dolt refs are absent from GitHub; the replacement backup is healthy; the
evidence pack's adjudicated sets reproduce exactly; Dependabot alerts and the
`verify` ruleset are still unavailable while private.

Not confirmable short of publishing: OIDC acceptance, provenance, registry
installability. Not re-checked: the forge hostname (the clone had no forge
remote — now recorded rather than skipped), redteam 1's raw transcript.

---

## 4. Triage — both redteams DONE (2026-10-05)

Convention: fix-now bar is strictly false-reporting / data-loss / invariant-
violation. Everything else passes a practical-bite test — a concrete scenario
reachable in this repo's actual usage — or is recorded as considered-and-declined.
The two redteams are not iterated against each other.

### 4.1 Redteam 1

**Nothing met the fix-now bar.** The current tarball contains none of the shapes
(no archives, no maps, no non-canonical addresses, no member names with
path-like segments), so the gate's PASSED on the real artifact is not a false
report. Per class:

| Class | Disposition | Reason |
|---|---|---|
| Split literal | **Declined** | Only reachable by deliberately writing a split string; the proposed AST constant-folder adds surface to the release path for no realistic case |
| Non-canonical IPv4 | **Declined** | Accidental leaks are copy-pasted canonical addresses; nobody types `0x0A4D0009` into a template by mistake |
| IPv6 / `.local` / `.lan` | **Filed** `shotwright-746.18.21` (P3) | A LAN hostname in a template or README example is the one plausible accident; needs a rule that does not fire on `args.lan`-style property access in `dist/` |
| Public handle outside path | **Declined** | Not a disclosure — see §2.2. The local username is covered by `flip-evidence.sh` at the moment the repository is exposed |
| Tar member names | **Filed** `shotwright-746.18.21` | Cheap to add in `check-file-set.sh`; no accidental path to it today |
| Nested archive | **Filed** `shotwright-746.18.21` | Fix is to deny archives under `templates/`/`dist/` and enumerate `templates/` exactly in Layer A; no archive ships today |

What this changes about the release claim: the tarball is proven free of the
canonical shapes the invariant names (host paths, RFC1918 addresses, the handle
in path position), with the six classes above stated as the boundary of that
proof rather than folded into it.

### 4.2 Redteam 2

**Two findings met the fix-now bar**, both as false reporting: RT2-02 (the flip
evidence generator printing "0 findings" over a history gitleaks had exited 1
on) and RT2-06 (documentation calling a prefix allowlist an exact manifest, with
the gate passing a file the docs said it would catch). RT2-06 was also the second
redteam in one day to reproduce the same shape, which under the standing rule
means the prefix design was the cause, not the instance. Both are fixed on the
branches named in §3.

Everything else passed the practical-bite test on the first reading: each is a
step an operator would plausibly take on the real release path (dispatching from
the wrong branch, choosing the wrong dist-tag, following the token or install
commands as written, leaving a stale artifact directory). All were cheap, so all
were fixed rather than recorded; the exceptions are RT2-01, which is the current
state rather than a defect, and the one-day `--expires` unit, which the runbook
tells the operator to confirm on their npm rather than asserting.

**Not iterated**: the fixes were made once from this report; no third redteam was
run against them. A Release dry run from `main` after the branches merge is the
rehearsal that stands in for that, and its run id belongs in §1 before §5 is
presented.

---

## 5. Owner approval gate — NOT YET REACHED

There are **two irreversible operations**, and each gets its own gate. Presented
to the owner, in this document, before either:

**Gate A — bootstrap `0.1.0-rc.1` (runbook §1).** A local `npm publish` of a
tarball from a fresh clone at tag `v0.1.0-rc.1`, with a one-day token; the
workflow is *not* used.

- [ ] Tag `v0.1.0-rc.1` exists on `main` and `package.json` there says `0.1.0-rc.1`.
- [ ] Both redteam verdicts and their triage (§2–4), and the fixes merged.
- [ ] The packed file list from the fresh clone, compared against §1.1.
- [ ] The exact command, with the tarball path, from runbook §1.2.
- [ ] Explicit owner go-ahead, recorded on `shotwright-746.18.4` with the date.

**Gate B — stable `0.1.0` (runbook §2).** The `Release` workflow, `dry-run: false`,
`dist-tag: latest`, dispatched from `main` at the Version PR's merge commit under
OIDC.

- [ ] The trusted publisher is configured and the bootstrap token revoked (§1.3–1.4).
- [ ] A `Release` dry run at **this exact commit** is green; its run id and packed
      file list are recorded in §1.
- [ ] `package.json` says `0.1.0` (the Version PR did it, not a hand edit).
- [ ] Explicit owner go-ahead, recorded on `shotwright-746.18.4` with the date.

Preconditions that must hold before Gate A (runbook §0): the owner-performed
public flip (`shotwright-746.18.6`) and the proven replacement backup
(`shotwright-2sr.4`).

---

## 6. Publish and verify from outside — NOT YET RUN

Runbook §2.5, by exact version — `shotwright@0.1.0-rc.1` after Gate A,
`shotwright@0.1.0` after Gate B — with pnpm's release-age gate turned off in the
scratch directory only, and `pnpm list shotwright` before the bin. No credentials
configured. `shotwright --help` exits 0 with usage on stdout as of
`shotwright-746.18.12`; before that fix this step would have exited 1 and looked
like a failed publish. Then confirm the provenance badge on the package page
(`shotwright-746.18.7`).

---

## 7. What was NOT established

Maintained as the work proceeds; nothing here is rounded up.

- §5 and §6 are not yet reached. §2–4 are complete; the raw evidence for both
  redteams is archived outside the repo.
- No `Release` dry run exists at any commit containing the 2026-10-05 fixes. The
  one on record (§1) predates them, and a later one on Dependabot's PR #45
  branch (run `37385123830`) failed at the audit gate for the lockfile reason
  that `shotwright-746.18.20` fixes — so it says nothing about the action bumps
  in that PR either. The integrated workflows still pin `actions/checkout`
  v6.1.0 and `actions/setup-node` v6.5.0; only `changesets/action` moved, to
  v2.1.1. PR #45's checkout/setup-node v7 bumps are not integrated and have no
  rehearsal.
- The fixes from redteam 2 have not been re-audited. The next dry run from
  `main` is the check that stands in for that (§4.2).
