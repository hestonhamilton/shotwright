# shotwright-746.18.1 — E9.R: npm publishing in 2026, dangers, and tooling

Research date: 2026-08-01. Ecosystem claims were web-checked on 2026-08-01 and
every registry-behaviour or policy claim below carries a source link; nothing
here is asserted from training memory. Repo claims were verified on branch
`feat/shotwright-746.18.1-research-npm-publishing` at `54ab715`. Empirical
checks were run against a real packed tarball (`npm pack`) and are marked
**Verified locally**. Research only — no source, template, package, test, or
workflow files changed.

## Headline findings

Five findings change the shape of E9.P. Two of them constrain ADR 0010
directly.

1. **Provenance is gated on the planned public flip, and the ordering is
   load-bearing.** npm refuses to generate provenance when the source
   repository is private. The owner has since confirmed (2026-08-01) that the
   repo is intended to go public once vetted, which reopens provenance — but
   published versions are immutable, so **any version published before the flip
   can never gain provenance retroactively.** Publish-then-flip permanently
   marks the early versions; flip-then-publish costs whatever the vetting takes.
   This is an operator sequencing decision, not a technical one. See
   [§1.2](#12-provenance-is-gated-on-the-public-flip).
2. **The first publish cannot use trusted publishing.** A trusted publisher is
   configured on a package that already exists, so the initial version must be
   pushed with a granular token. E9 needs an explicit, one-time bootstrap step.
   See [§1.4](#14-the-first-publish-bootstrap-problem).
3. **Classic npm tokens were permanently revoked on 2025-12-09.** Auth in 2026
   is granular tokens (90-day maximum, 7-day default), 12-hour login sessions,
   or OIDC. Any plan written against the old token model is dead on arrival.
   See [§1.1](#11-authentication-after-the-2025-token-purge).
4. **`README.md` ships even though `files` does not list it.** The leak gate
   must cover the always-included files, not just `dist/` and `templates/`.
   **Verified locally.** See [§3.1](#31-host-paths-usernames-lan-ips).
5. **A naive leak grep fails on this repo's legitimate content.** `127.0.0.1`
   and the string `hestonhamilton` both appear in the tarball for correct
   reasons. A gate built on those patterns is a gate that gets disabled.
   **Verified locally.** See [§3.1](#31-host-paths-usernames-lan-ips).

## Premise check against ADR 0010

The core decision holds. Public npm remains the right call and nothing found
here argues for GitHub Packages, a git dependency, or staying on tarballs. But
the ADR needs amendment on three points:

- ADR 0010's prerequisite 1 ("a release path that publishes `dist` +
  `templates`") is understated: the tarball also carries `README.md` and
  `package.json` unconditionally.
- ADR 0010's prerequisite 2 (a mechanical leak check) is correct and is
  reinforced below, but the pattern set it implies is not implementable as
  written without false positives.
- **ADR 0010's private-repo premise is superseded by an owner decision.** The
  ADR states that the npm page's 404 to outside visitors "is accepted, not a
  defect to fix by making the repo public," and its Consequences section is
  written throughout on the assumption the repo stays private. The owner
  confirmed on 2026-08-01 that the repo **is** planned to go public once vetted
  for PII, secrets, and vulnerabilities. That is a direct reversal of a stated
  ADR position.

**This requires an ADR before E9.P closes** — either an amendment to 0010 or a
superseding 0011 — per the repo's decision-time ADR convention. It is not a
detail to absorb into a plan doc: it changes the provenance answer, the leak
gate's scope (§3.6), and ADR 0007's sharing mechanism (§3.7). Raised here rather
than absorbed silently.

The private-repo / public-package split survives in the interim; it just costs
provenance for as long as it lasts.

---

## 1. Registry mechanics and auth

### 1.1 Authentication after the 2025 token purge

The token model changed underneath everyone in late 2025 and the old advice is
now actively wrong.

- **All npm classic tokens were permanently revoked on 2025-12-09.** They
  "cannot be recovered or recreated"
  ([GitHub community discussion #179562](https://github.com/orgs/community/discussions/179562)).
- **Granular access tokens have a 90-day maximum lifetime**, defaulting to 7
  days at creation (same source). There is no such thing as a long-lived npm
  publish token in 2026.
- **`npm login` yields a session token**, originally 2 hours, extended to 12
  hours on 2025-12-12. It does not appear in the token list (same source).
- **Publishing requires 2FA on the account, or a granular token with "Bypass
  2FA" enabled.** 2FA is enforced by default for newly created packages (same
  source) — which is exactly what `shotwright` will be.
- The npm CLI gained `create`/`list`/`revoke` for granular tokens on 2025-12-09
  (same source), so the bootstrap token can be minted without the web UI.

**Consequence for E9.P:** there is no "set a secret once and forget it" option.
Either the release workflow uses OIDC (no stored secret at all), or someone
rotates an `NPM_TOKEN` secret at least every 90 days. That asymmetry is the
whole argument for trusted publishing here, since provenance — the usual second
argument — is off the table.

### 1.2 Provenance is gated on the public flip

npm's automatic provenance generation applies only when **all** of these hold:
publishing via trusted publishing (OIDC), publishing from a **public**
repository, and publishing a public package
([npm Docs — Trusted publishing](https://docs.npmjs.com/trusted-publishers/)).

Publishing with provenance from private source repositories was withdrawn in
2023 and has not returned
([GitHub Changelog, 2023-07-25](https://github.blog/changelog/2023-07-25-publishing-with-npm-provenance-from-private-source-repositories-is-no-longer-supported/)).
Attempting it surfaces as `Can't generate provenance for new or private
package` ([nrwl/nx#27754](https://github.com/nrwl/nx/issues/27754)).

So provenance is not permanently closed — it is **blocked until the repo is
public**, which the owner has confirmed is planned. Two things follow, and the
second is the one that matters.

**Provenance cannot be applied retroactively.** A published version is
immutable; there is no operation that adds an attestation to an already-uploaded
version, and §2.1 forecloses the obvious workaround — the version number cannot
be republished. So every version shipped before the flip is permanently
unattested, forever, even after the repo goes public.

That makes the ordering a real decision with an asymmetric cost:

| Order | Cost |
|---|---|
| **Flip public, then publish** | Delay: E8 waits on the PII/secrets/vulnerability vetting. Every published version has provenance from `0.1.0` onward. |
| **Publish now, flip later** | No delay. `0.1.0` and any versions before the flip are permanently unattested. Provenance starts mid-history, which is a slightly odd signal to consumers but not a defect. |

**Recommendation: flip first, if the vetting can be scoped to days rather than
weeks.** The evidence in §3.6 is that the vetting is close to already done —
history is empirically clean — so the delay is likely small and the cost of
getting it wrong is permanent. But this is an operator call about E8's schedule,
not a technical determination, and it is listed as an open decision in §6.

**Either way, do not set `provenance: true` in `publishConfig` until the repo is
actually public.** That flag is a build-time failure, not a no-op. If the
publish-first order is chosen, the release workflow should carry a comment
saying provenance is deliberately absent *pending the public flip* — so a future
session neither "fixes" its absence prematurely nor forgets to enable it
afterwards. Enabling provenance after the flip should be its own tracked bead;
it will otherwise be missed, because nothing fails to remind anyone.

Note also that once the repo is public and trusted publishing is in use,
provenance is generated **automatically** with no flag
([npm Docs](https://docs.npmjs.com/trusted-publishers/)) — though at least one
2026 practitioner report found an explicit `--provenance` still necessary in
practice ([philna.sh](https://philna.sh/blog/2026/01/28/trusted-publishing-npm/)).
Verify empirically rather than assuming; the npm page shows the attestation
badge when it worked.

### 1.3 Trusted publishing: what it needs

Requirements, from [npm Docs — Trusted publishing](https://docs.npmjs.com/trusted-publishers/):

- **npm CLI ≥ 11.5.1** and **Node ≥ 22.14.0**. Local environment already
  satisfies both — **Verified locally**: `npm 11.13.0`, `node v24.16.0`. The
  npm bundled with `actions/setup-node` is not guaranteed to be new enough;
  practitioners report needing an explicit `npm install -g npm@latest` step
  ([philna.sh, 2026-01-28](https://philna.sh/blog/2026/01/28/trusted-publishing-npm/)).
- Workflow permissions `id-token: write` and `contents: read`.
- Configuration lives on the **package's** access page
  (`npmjs.com/package/<name>/access`), not the account settings page
  ([philna.sh, 2026-01-28](https://philna.sh/blog/2026/01/28/trusted-publishing-npm/)).
  Since 2026-02-17 the `npm trust` command (CLI ≥ 11.10.0) can configure
  trusted publishing in bulk from the terminal
  ([GitHub community discussion #187403](https://github.com/orgs/community/discussions/187403)).
- **Self-hosted runners are not supported**
  ([npm Docs](https://docs.npmjs.com/trusted-publishers/)). This matters here:
  the self-hosted forge lane (ADR 0008) **cannot** be the publish lane. It stays
  advisory, as CLAUDE.md already says. The publish job must run on
  GitHub-hosted runners.

### 1.4 The first-publish bootstrap problem

npm requires a package to exist before its trusted publisher can be configured,
unlike PyPI which allows pre-registration. The initial version must therefore be
published manually or with a token, after which the workflow switches to OIDC
([npm/cli#8544](https://github.com/npm/cli/issues/8544); the
[`setup-npm-trusted-publish`](https://github.com/azu/setup-npm-trusted-publish)
tool exists purely to automate publishing a placeholder for this reason).

Diagnostics for this path are poor — trusted-publishing failures surface as
misleading `404` / `ENEEDAUTH` errors rather than a useful message
([npm/cli#9088](https://github.com/npm/cli/issues/9088)). Expect the first CI
publish attempt to fail confusingly, and do not read a 404 as "the name was
taken."

**Recommended bootstrap for E9.I**, in order:

1. Mint a short-lived granular token (7-day default is plenty) with publish
   scope on `shotwright` and Bypass-2FA.
2. Publish `0.1.0` — from a clean checkout, after the leak gate passes on the
   packed tarball.
3. Configure the trusted publisher on the package access page (or via
   `npm trust`), pointing at the repo and the release workflow filename.
4. Revoke the bootstrap token immediately. Do not store it as a repository
   secret; do not let it expire on its own.
5. All subsequent releases go through OIDC with no stored credential.

Step 4 is the one that gets skipped. It should be an explicit acceptance
criterion on the E9.I bead, not a line in a doc.

### 1.5 What actually gets uploaded

The precedence order, from [npm/cli wiki — Files & Ignores](https://github.com/npm/cli/wiki/Files-&-Ignores)
and the [npm-packlist](https://github.com/npm/npm-packlist) implementation:

1. **`files` in `package.json` wins at the package root.** When present, the
   root `.npmignore` and `.gitignore` are ignored entirely.
2. If there is no `files` field, **`.npmignore` trumps `.gitignore`** — they are
   not merged.
3. If neither `files` nor `.npmignore` exists, `.gitignore` is used.
4. **Nested `.npmignore` files are honoured regardless of `files`.** A path
   listed in `files` but excluded by a subdirectory `.npmignore` is still
   excluded.
5. **Always included regardless of everything above:** root `package.json`,
   root `README`, `LICENSE`/`LICENCE`, `COPYING`, and bundled dependencies.
6. **Always excluded:** `.git`, `.npmrc`, `node_modules` (except bundled deps).

shotwright has `files: ["dist", "templates"]` (`package.json:15-18`), so rule 1
governs and rules 2–3 never fire. Rule 5 is the one that matters, and it is not
theoretical:

**Verified locally** — `npm pack --dry-run` on `54ab715` produces 43 files,
42.8 kB packed / 158.6 kB unpacked, comprising `dist/**` (36 files),
`templates/**` (5 files), **and `README.md` and `package.json`**, neither of
which appears in `files`.

The `.npmrc`-always-excluded rule is a useful safety net but should not be
leaned on; it does not cover `.env` or `local/`, which are excluded here only
because `files` is an allowlist.

---

## 2. What is irreversible

This is the section the epic exists for. Everything below is registry policy,
not convention, and none of it can be negotiated after the fact.

### 2.1 Unpublish is not a retraction

From the [npm Unpublish Policy](https://docs.npmjs.com/policies/unpublish/):

- **Within 72 hours of publishing**, a version may be unpublished provided no
  other package in the public registry depends on it.
- **After 72 hours**, unpublishing requires **all** of: no other public-registry
  packages depend on it; **fewer than 300 downloads in the last week**; and
  **a single owner/maintainer**.
- **"Once `package@version` has been used, you can never use it again."** This
  is the single most important sentence in this document. A version number
  burned by a bad publish is burned permanently, even after a successful
  unpublish.
- **Unpublishing every version blocks new publishes of that name for 24 hours.**
- **"Once you have unpublished a package, you will not be able to undo the
  unpublish."**

The 72-hour window reads like a safety net and is not one. It only helps if the
mistake is *noticed* within 72 hours, and it never restores the version number.
For a leaked host path the window is irrelevant in the way that counts: the
tarball was world-readable and mirrored the moment it landed. Unpublishing
removes future availability, not past disclosure.

**Plan accordingly: treat every publish as permanent disclosure of the tarball
contents.** The 72-hour rule is not part of the mitigation strategy and E9.P
should not cite it as one.

### 2.2 What the real remediation paths can and cannot do

**`npm deprecate`** updates the registry entry so installers print a warning. It
does **not** remove content, and the package remains fully installable
([npm Docs — npm-deprecate](https://docs.npmjs.com/cli/v11/commands/npm-deprecate/)).
It **is** reversible: re-running with an empty string `""` as the message clears
the deprecation. It accepts semver ranges (`npm deprecate shotwright@"<0.2.0"
"…"`), and those ranges **do** include prereleases. It may prompt for an OTP.

**`npm dist-tag`** moves which version a bare `pnpm add shotwright` resolves to.
Applying a tag to another version moves `latest` off the bad one
([npm Docs — npm-dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)).

Together these are the honest remediation story: **you cannot retract, you can
only redirect and warn.** For a bad-but-not-leaking release — wrong file set,
broken build, stale `dist` — the correct response is publish a fixed patch
version, move `latest`, and deprecate the bad one. Never reach for unpublish.

For a release that leaks a host path or a secret, deprecation does nothing about
the disclosure. The response there is credential rotation and accepting the
disclosure, plus a fixed version. Which is why the gate has to be upstream.

### 2.3 Summary table

| Action | Reversible? | Undoes disclosure? | Reusable version number after? |
|---|---|---|---|
| `npm publish` | No | — | — |
| `npm unpublish` (≤72h, no dependents) | **No** | **No** | **No, never** |
| `npm unpublish` (>72h, all 3 conditions) | **No** | **No** | **No, never** |
| `npm deprecate` | Yes (empty message) | No | n/a |
| `npm dist-tag add/rm` | Yes | No | n/a |

---

## 3. Dangers, and the gate for each

### 3.1 Host paths, usernames, LAN IPs

This is shotwright's specific exposure, because ADR 0010 makes the headed-public
invariant load-bearing and the standing project lesson is that reviewers miss
path leaks.

**Verified locally** on `54ab715`: packing the tarball, extracting it, and
grepping the extracted tree for `/home/<user>`, `/Users/<user>`, the operator
username, private-range IPs, and loopback produced **no host-path leaks**. The
tree is clean today.

But the same scan produced **three classes of legitimate hit**, and this is the
finding E9.P has to absorb:

- `127.0.0.1` in `dist/init.js`, `dist/cli.js`, and `dist/gallery/server.js` —
  the gallery server's loopback bind and the generated Vite `webServer` default.
  Intentional, correct, must not be flagged.
- `hestonhamilton` in `package.json` `repository.url` — required by
  `package.json:7-9` and by npm's repository linking.
- `hestonhamilton` in `templates/github/shotwright.yml`, in the
  `uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@main` line —
  required for the reusable workflow to resolve at all (ADR 0007).

**A gate that greps for the bare username or for `127.0.0.1` fires on all
three, is wrong three times on a clean tree, and will be weakened or disabled by
the third release.** The gate must instead match:

- absolute host-path prefixes: `/home/<segment>/`, `/Users/<segment>/`,
  `/root/`, and `C:\Users\`;
- **private-range** IPv4 only: `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16` — explicitly **not** loopback;
- the username **only in path-like context**, i.e. preceded by a path
  separator, so `repository.url` and the `uses:` line do not match;
- generic credential shapes, delegated to a scanner (below) rather than
  hand-rolled.

Two further requirements, both from the E9 framing and both non-negotiable:

- **The gate runs against the packed tarball, not the working tree.** The
  working tree contains `local/`, `.env`, and `docs/` that never ship; scanning
  it produces noise and, worse, scanning it *misses* anything that enters
  `dist/` via the build. Pack, extract, scan the extraction.
- **E9.I must demonstrate the gate failing on a seeded host path.** A gate only
  ever observed passing has not been shown to work. Seed a path into a
  `templates/` file in a scratch copy, confirm non-zero exit, then remove it.

Note also that the `templates/init/gitignore.snippet` and
`templates/init/shots.config.ts` files are *generated into consumer repos*, so a
leak there propagates outward rather than merely being disclosed.

### 3.2 Wrong file set, or a stale `dist` from a dirty tree

`files: ["dist", "templates"]` is an allowlist, which is the safe shape — the
default-deny direction. The live risk is not *extra* files but **stale** ones:
`dist/` is gitignored build output, so publishing from a working tree with an
old or partial `dist/` ships silently wrong code with no diff to review.

Mitigations for E9.P: publish only from CI, from a fresh clone at a tag; run
`pnpm run build` in the publish job rather than trusting any checked-out state;
and treat `npm pack --dry-run` file-count/size output as a reviewable artifact
of the release run. The current baseline to compare against is **43 files,
42.8 kB packed** (Verified locally) — a release that suddenly packs 200 files
is a caught mistake.

### 3.3 Accidental `latest` on a prerelease

npm made this materially safer: **publishing a prerelease version now requires
an explicit `--tag`**, and the default `latest` tag is only applied when the
version being published is above the registry's current highest non-prerelease
version ([npm/cli#7910](https://github.com/npm/cli/pull/7910)). Historically
`npm version prerelease && npm publish` would happily tag a prerelease as
`latest` ([npm/cli#7553](https://github.com/npm/cli/issues/7553)).

Do not rely on the guard alone. Pass `--tag next` explicitly for any prerelease.
If it does happen, remediation is `npm dist-tag add shotwright@<good> latest`,
which moves `latest` back
([npm Docs — Adding dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)).
This is one of the few genuinely recoverable mistakes in E9.

### 3.4 Name-adjacent risk for an unscoped name

`shotwright` is unscoped. **Verified locally 2026-08-01**:
`https://registry.npmjs.org/shotwright` returns HTTP 404, so the name is still
unclaimed — ADR 0010's check still holds.

Unscoped names carry two asymmetric risks. **Dependency confusion** — an
attacker claiming a name that a private registry also serves — is *not* a risk
for shotwright, because the name will be genuinely public and there is no
private registry serving it. The direction that does apply is **typosquatting**:
neighbours like `shotwrite`, `shot-wright`, or `shotwrights` can be registered
by anyone, and consumers who fat-finger the install get someone else's code
([Snyk on aliasing extensions](https://snyk.io/blog/exploring-extensions-of-dependency-confusion-attacks-via-npm-package-aliasing/),
[npm Docs — Threats and mitigations](https://docs.npmjs.com/threats-and-mitigations/)).

The generic advice is "prefer scoped names"
([npm Docs — Threats and mitigations](https://docs.npmjs.com/threats-and-mitigations/)),
but ADR 0010 already weighed and chose unscoped, and the reasons still stand.
The proportionate response for a package of this profile is **not** defensive
name registration (which npm discourages and which costs ongoing maintenance),
but simply: publish `shotwright` promptly to claim it, and have `shotwright
init` generate the dependency line so consumers never hand-type the name. E8's
migrations should copy the install command from the README rather than retype
it.

### 3.5 Install-time script execution

shotwright defines no `preinstall`/`install`/`postinstall` script
(`package.json:36-44`), which is the right shape and should be preserved.

The ecosystem has moved hard against install scripts: **pnpm 10 blocks
dependency lifecycle scripts by default**, requiring explicit allowlisting via
`pnpm.onlyBuiltDependencies`, in direct response to the rspack postinstall
malware incident
([Socket, pnpm 10.0.0](https://socket.dev/blog/pnpm-10-0-0-blocks-lifecycle-scripts-by-default)).

**Consequence for E8:** because shotwright has no install scripts, consumers on
pnpm 10+ need **no** `onlyBuiltDependencies` entry for it and will see no
approval prompt. That is a migration ergonomics win worth stating in the
migration guide. It also means **adding an install script later would be a
breaking change** for every consumer — it should require an ADR, not a commit.

Note that Playwright browser download is a separate matter: it happens via
`playwright install`, invoked explicitly, not via a shotwright lifecycle hook.

### 3.6 The public flip is a different scan from the tarball gate

These two gates get conflated, and conflating them is how one of them ends up
not existing. They differ in scope, in what they must catch, and in when they
run:

| | Tarball leak gate | Public-flip vetting |
|---|---|---|
| **Scope** | `dist/`, `templates/`, `README.md`, `package.json` — 43 files | Every file in **every commit reachable from any ref**, plus issues, PR text, and Actions logs |
| **Runs** | Every release, forever | Once, before flipping visibility |
| **Catches** | What ships to consumers | What was ever committed, including content since deleted |
| **Tool** | `gitleaks dir` on the extracted tarball (§4.3) | `gitleaks git` over full history |

The critical asymmetry: **`git` history is not covered by the tarball gate at
all.** A host path committed to `docs/` in March, scrubbed in April, is invisible
to every tarball scan ever run and becomes world-readable the instant the repo
flips. This is exactly the shape of the standing project lesson about dispatched
documents arriving with absolute host paths.

**Verified locally, 2026-08-01**, against all refs on this branch's history:

- **Host paths: clean.** `git log --all -S'/home/<user>'` returns **0 commits**,
  and grepping every reachable revision for `/home/<segment>/` returns no hits.
- **Sensitive files: never committed.** No `local/`, `.env`, `.npmrc`, `*.pem`,
  `*.key`, or credential-named file appears in the added-file history.
- **Personal email: absent.** The only address-shaped strings in history are the
  `git@ssh.github.com` transport URL in `.beads/config.yaml`.
  Corrected 2026-10-05: that check covered file contents only; commit metadata carried a personal address, which the pre-flip history rewrite replaces with the GitHub noreply address.
- **`.beads/interactions.jsonl` is tracked and benign** — 6 records of bead
  field changes with work-note reasons and the operator's GitHub username. No
  transcript content, no credentials.
- **Private-range IPs are present but are synthetic test fixtures** —
  `192.168.0.42`, `10.8.0.2`, `172.17.0.1` and similar in
  `test/unit/gallery-server.test.ts` and `test/unit/cli.test.ts`. They are
  invented addresses exercising LAN-detection logic, not real network data.

Two consequences. First, **the vetting looks close to complete already** —
which is the evidence behind §1.2's recommendation to flip before publishing.
Second, **those test fixtures will trip the §3.1 private-IP rule**, and this is
a feature, not a bug to suppress globally: `test/` is not in the tarball, so the
release gate never sees them, while the repo-wide scan correctly flags them for
a human to confirm as synthetic. Scope the private-IP rule to the tarball gate
and use an explicit allowlist entry — with a comment saying *why* they are
safe — for the history scan. Do not add a blanket ignore for the pattern.

What this scan does **not** cover, and E9.P should assign explicitly: GitHub
issue and PR bodies, Actions run logs, and any branch that exists only on a
remote. Those become public with the repo and are not in local history.

Vulnerability review — the third item in the owner's vetting list — is out of
scope for this research and is not addressed here. It should be its own bead;
at this phase a native package-manager check plus Dependabot was the cheap
baseline. That later investigation is complete: ADR 0019, as amended by
`shotwright-746.18.16`, replaces the retired native endpoint with OSV-Scanner.

### 3.7 The bd board ships to GitHub as `refs/dolt/data`

`bd dolt push` writes the entire beads database to GitHub as a custom ref. This
is not covered by any scan in §3.6, because it is not reachable from `main` and
never appears in a working tree.

**Verified locally, 2026-08-01:**

- **The ref is advertised.** `git ls-remote origin` lists
  `refs/dolt/data` at `a518eb9`, alongside a `refs/heads/__dolt_remote_info__`
  branch. Advertised means discoverable — no SHA guessing needed. Any account
  with read access can `git fetch origin '+refs/dolt/data:...'`, which today
  means collaborators and after the flip means everyone.
- **It is 37 files, ~5.0 MB**, mostly Dolt `.darc` chunk archives.
- **The contents are trivially readable — `dolt` is not required.** Running
  `strings` over the archives recovers bead IDs, titles, and close-reason prose
  directly (e.g. `bd: close shotwright-746.3.4`). Compression is not protection.
  Assume the board is plaintext.

The scope, which is the part that determines how much this matters:

- **Only shotwright's board is present.** Scanning every chunk archive for
  bead-ID prefixes yields 3,074 `shotwright-*` hits and **no** beads from the
  consumer projects or another sibling project. The remaining hits are `bd-7dac`
  (a bd-internal identifier) and substring artifacts of `shotwright` itself. The
  shared Dolt *server* hosts several databases; this ref carries one.
- **No host paths and no credential-shaped strings** appear anywhere in the
  board content.

So this is **not** a cross-project leak and not a secrets incident. What it is:
shotwright's complete internal issue tracker — every bead description, redteam
finding, close reason, and mid-epic judgement call — becoming public alongside
the code. That content is the same *kind* as `docs/`, which is already destined
for publication. Whether the candid version of it should also be public is an
owner judgement about candour, not a security determination, and this document
does not make it.

**What is a security determination: deleting the ref before the flip does not
erase it.** Git dereferences rather than deletes, and GitHub retains unreachable
objects in the repository network indefinitely and by design; commits from a
repository's private phase remain reachable after it is made public, and objects
from deleted refs stay accessible to anyone who knows — or brute-forces — the
SHA ([Truffle Security](https://trufflesecurity.com/blog/anyone-can-access-deleted-and-private-repo-data-github),
[GitHub community #70144](https://github.com/orgs/community/discussions/70144),
[Neodyme — Hidden GitHub commits](https://neodyme.io/en/blog/github_secrets/)).
Short-SHA references are accepted from four characters, a 16⁴ keyspace that is
cheap to enumerate. GitHub confirmed this as intended behaviour through its
disclosure programme. The five `refs/dolt/data` commit SHAs are already recorded
in this repo's push history.

That leaves two honest paths, and they should be chosen on how much the board's
candour matters:

| Path | Guarantee | Cost |
|---|---|---|
| **Delete the ref, flip this repo** | Removes discoverability. Does **not** remove the objects — recoverable by SHA. | Cheap and fast. Appropriate **if** the board being readable is acceptable-but-untidy rather than unacceptable. |
| **Publish from a fresh repo** containing only curated `main` history; keep this repo private | Clean. Nothing from the private phase exists in the public object store. | New repo identity; PR/issue backlinks do not carry over; ADR 0007's `uses:` reference and `templates/github/shotwright.yml` must be repointed. |

Given the empirical scope above — one project's board, no secrets, no host
paths — **deletion is likely proportionate**, but that conclusion depends
entirely on the candour judgement, which is the owner's. If the answer is "the
board must not be public," deletion alone does not deliver that and the fresh-repo
path is the only one that does.

**A hard prerequisite either way: `refs/dolt/data` on GitHub is the only
off-machine backup of the board**, exactly as CLAUDE.md states, and the obvious
substitute does not currently exist. **Verified locally:** the self-hosted forge
holds only `refs/heads/main`, and at `2a416b2` — three commits behind GitHub's
`4837f74`. The dual-push URL on `origin` is not keeping the forge in sync, and it
carries no dolt data at all.

So **deleting the ref with no replacement destination destroys the only backup
of the board.** E9.P must sequence a replacement first — pushing dolt data to
the forge, or to a dedicated private beads repo — and verify the replacement is
readable before anything is removed from GitHub. This is the step most likely to
be skipped under time pressure, and it is unrecoverable.

Two incidental findings from the same inspection, neither urgent: the forge's
`main` is stale as noted above, and a merged branch
`refs/heads/feat/shotwright-746.14-forge-ci` still exists on GitHub despite
HANDOFF.md recording no stale branches. Both are follow-up beads.

### 3.8 The flip changes ADR 0007's mechanism

ADR 0007 shares the reusable CI workflow via GitHub's *same-owner-private*
Actions access policy, and E7 widened the Actions Access setting specifically to
make that work. **A public repository's reusable workflows are callable by
anyone**, so the flip does not break consumers — the sharing gets strictly more
permissive — but the mechanism ADR 0007 documents becomes moot rather than
merely unchanged.

This is not a blocker and nothing needs to be rebuilt. It does mean the
ADR-0010 amendment should note the interaction, so a future reader of ADR 0007
does not conclude the private-sharing configuration is still load-bearing when
it has quietly become a no-op.

Related, and worth a bead either way: once the repo is public and shotwright is
version-resolved from npm, `templates/github/shotwright.yml` still pins the
workflow at `@main` (§6.5). Public visibility makes that pin more consequential,
not less — anyone can now call it, and `@main` has no stability contract.

---

## 4. Tooling

### 4.1 Package-shape validation — already mostly in place

**publint** is already a devDependency (`package.json:54`) and already runs in
the lint script (`package.json:39`). **Verified locally**: `publint v0.3.22`
reports `All good!`.

**`@arethetypeswrong/cli` (attw)** is **not** currently a dependency, and should
be added. It runs the *published artifact* through every TypeScript resolution
mode and catches the exports-map bugs publint does not
([@arethetypeswrong/cli](https://www.npmjs.com/package/@arethetypeswrong/cli)).
The 2026 convention for a TypeScript library is `npm pack` + `publint` +
`attw --pack` ([tsdown — Package validation](https://tsdown.dev/options/lint)).

**Verified locally**, `attw --pack .` on `54ab715` reports, for all three
entrypoints (`.`, `./capture`, `./reporter`):

```
node10:            💀 Resolution failed
node16 (from CJS): ⚠️ ESM (dynamic import only)
node16 (from ESM): 🟢 (ESM)
bundler:           🟢
```

Both warnings are **inherent to being ESM-only**, not defects: `node10` is
pre-`exports` TypeScript resolution, and the CJS warning simply says CommonJS
consumers must use dynamic `import()`. ESM-only is the correct default for a new
library in 2026 ([tsdown](https://tsdown.dev/options/lint)), and shotwright is
consumed by Playwright specs which are ESM.

**Verified locally**: `attw --pack . --profile esm-only` marks both as
`(ignored)` and reports green throughout. E9.P should wire attw with
`--profile esm-only` — pinning the intent — rather than either "fixing" ESM-only
or suppressing the check wholesale.

### 4.2 Tarball inspection

`npm pack --dry-run` lists the exact file set, count, packed and unpacked size
without writing a tarball; `npm pack` writes it for extraction and scanning.
Both were used for the empirical checks above. `pnpm pack` is equivalent for
producing the artifact (publint shells out to it), but `npm pack --dry-run`'s
`npm notice` listing is the more useful review output.

The release job should emit the dry-run listing into the log before publishing,
so the file set is reviewable in the run record after the fact.

### 4.3 Named tarball scanner

The bead asks for a named tool that scans a **packed tarball** rather than a
working tree. There is no tool that scans a `.tgz` in place; the working pattern
is `npm pack` → `tar xzf` → scan the extracted `package/` directory.

**Recommended: `gitleaks`, `dir` mode**, against the extracted tree:

```
gitleaks dir --no-banner --redact package/
```

The `dir` command scans a directory tree on disk without consulting git; the CLI
was reorganised around `git`/`dir`/`stdin` in v8.19.0, deprecating the older
`detect --no-git` form ([gitleaks](https://github.com/gitleaks/gitleaks),
[gitleaks.org](https://gitleaks.org/)). It supports custom regex rules, which is
how the shotwright-specific host-path and private-IP patterns from §3.1 get
added rather than being a second, separate script.

One maintenance note to carry into the plan: **gitleaks has been declared
feature-complete by its maintainer**, with future releases limited to security
patches and active development moving to a successor project, *Betterleaks*
([appsecsanta, 2026](https://appsecsanta.com/gitleaks)). Gitleaks is the right
choice today — stable, packaged, widely available in CI — but pin the version
and expect a migration decision within a year or two. That is a follow-up bead,
not an E9 blocker.

`secretlint` ([secretlint](https://github.com/secretlint/secretlint)) is the
credible npm-native alternative and installs as a devDependency rather than a
binary. It is a reasonable second choice if E9.P prefers not to add a Go binary
to the release job; gitleaks is recommended for its stronger custom-rule support,
which the host-path patterns need.

Neither tool detects host paths out of the box — that is not what secret
scanners look for. **The shotwright-specific patterns from §3.1 must be written
as custom rules; they are the load-bearing part of the gate, and the scanner is
the generic backstop underneath them.**

### 4.4 Release manager — recommendation

**Recommended: Changesets.**

The choice is decided by two repo-specific constraints rather than by general
merit:

- **semantic-release is disqualified.** It derives versions from Conventional
  Commits (`feat:`, `fix:`)
  ([Oleksii Popov — NPM release automation](https://oleksiipopov.com/blog/npm-release-automation/)).
  This repo's commit convention is `<bead-id>: <subject>` under strict hook
  enforcement (CLAUDE.md). Adopting semantic-release means either changing the
  commit convention or bolting a second convention on top of it. Neither is
  worth it for one package.
- **`np` is disqualified by shape.** It is an interactive, local-first publish
  tool. E9 needs publishing to happen in CI under OIDC with no human-held
  credential; a local interactive flow is the thing being designed out.

Changesets requires no commit convention — contributors write a
`.changeset/*.md` file describing the change in prose, and the tool handles the
version bump, changelog, and publish when you choose to release
([Liran Tal — Introducing Changesets](https://lirantal.com/blog/introducing-changesets-simplify-project-versioning-with-semantic-releases),
[Tony Ward — Managing releases with Changesets](https://www.tonyward.dev/articles/managing-releases-with-changesets)).

The deciding argument for E9 specifically: **Changesets' release-PR model
inserts an explicit, reviewable human gate immediately before an irreversible
publish.** Given §2, that gate is the feature. semantic-release's fully
automatic publish-on-merge is precisely the wrong property for a package where
a mistaken version number is unrecoverable.

Considered and declined: **no release manager at all** — `npm version` plus a
manually-dispatched workflow. It is genuinely simpler, adds zero dependencies,
and for a single package with a single maintainer it would work. It is declined
because it produces no changelog, and consumers migrating in E8 need to see what
changed between versions. If E9.P finds Changesets' ceremony disproportionate in
practice, this is the fallback to reopen — but it should be an explicit
decision, not a drift.

One caveat to carry: pnpm's own Changesets guide documents publishing with a
stored `NPM_TOKEN` and says nothing about OIDC or provenance
([pnpm — Using Changesets](https://pnpm.io/using-changesets)). E9.P must not
copy that workflow verbatim; the publish step needs the §4.5 treatment.

### 4.5 Publish with `npm`, not `pnpm`

pnpm's OIDC/trusted-publishing support is unsettled. The feature request
([pnpm/pnpm#9812](https://github.com/pnpm/pnpm/issues/9812)) is closed, pnpm's
documentation does not describe trusted publishing, and there is a reported
regression where OIDC publishing that worked under pnpm 10 began failing with a
404 under pnpm 11.0.8
([pnpm/pnpm#11513](https://github.com/pnpm/pnpm/issues/11513)).

The repo pins `pnpm@10.13.1` (`package.json:14`) — **Verified locally**, matching
the installed pnpm.

**Recommendation: use pnpm for install and build, and `npm publish` for the
publish step only.** npm is the client with first-party OIDC support and the
documented version floor. This avoids betting the one irreversible operation in
the project on an undocumented code path in a second client, at the cost of one
extra line in a workflow. If E9.P selects Changesets, configure its publish
command accordingly rather than accepting the default `pnpm publish`.

---

## 5. Consumer-facing behaviour

### 5.1 The `@playwright/test` peer dependency

`peerDependencies: { "@playwright/test": ">=1.60 <2" }` (`package.json:45-47`),
per ADR 0002.

pnpm sets `auto-install-peers` to **true** by default (since pnpm 7), so a
consumer running `pnpm add -D shotwright` **will have `@playwright/test`
installed automatically** if it is missing, rather than being warned or failing
([pnpm — Settings](https://pnpm.io/next/settings),
[pnpm discussion #3995](https://github.com/orgs/pnpm/discussions/3995)). If the
consumer already has a `@playwright/test` that conflicts with the range, pnpm
declines to install a conflicting version and surfaces it as a peer warning
rather than an install failure.

**Consequence for E8:** the auto-install is convenient but silent, and a
consumer can end up on a Playwright version they never chose. The migration
guide should have consumers declare `@playwright/test` explicitly as their own
devDependency rather than relying on the auto-install — which is also what makes
the version visible in review, and connects to the browser-provenance concern
already tracked in `746.11`.

### 5.2 Exports map and `bin` — clean, no changes needed

**Verified locally**: publint reports `All good!` and attw is green under the
`esm-only` profile for all three entrypoints (§4.1). The subpath exports
(`package.json:19-32`) and the `bin` entry (`package.json:33-35`) need **no
changes** to publish cleanly.

Two small hygiene items for E9.P, neither a defect:

- **Add `publishConfig: { access: "public" }`.** Unscoped packages default to
  public, but new-package publishes have been reported to want `access` set
  explicitly ([npm/cli#7706](https://github.com/npm/cli/issues/7706)). It costs
  nothing and removes a first-publish failure mode. Do **not** add
  `provenance: true` alongside it — see §1.2.
- The `bin` target `./dist/cli.js` must be executable and carry a shebang.
  Verify in the smoke suite against the installed package, not the source tree.

### 5.3 Release-age cooldowns will delay E8

This is a scheduling finding that would otherwise ambush the first migration.

Every major package manager now gates on how recently a version was published:
pnpm added `minimumReleaseAge` in v10.16 (Sept 2025), Yarn added
`npmMinimalAgeGate` in 4.10.0, Bun shipped its own in v1.3, and npm added
`--min-release-age` in CLI 11.10.0 (Feb 2026)
([Socket — minimumReleaseAge and bulk OIDC](https://socket.dev/blog/npm-introduces-minimumreleaseage-and-bulk-oidc-configuration)).

**pnpm 11 defaults `minimumReleaseAge` to 1440 minutes — one day.** A
newly published version will not resolve for consumers on pnpm 11 until it is 24
hours old
([Cryptika on pnpm 11](https://www.cryptika.com/pnpm-11-turns-on-minimum-release-age-by-default-to-reduce-npm-supply-chain-risk/),
[pnpm — Mitigating supply chain attacks](https://pnpm.io/supply-chain-security)).

shotwright and its consumers are on pnpm 10 today, where this is off by default
— so E8 is not blocked. But any consumer on pnpm 11, and any consumer who
enables the setting, sees a **24-hour lag between publish and installability**.
E9.V and the first E8 migration must not interpret that lag as a broken publish.
Budget a day between publishing and attempting the first consumer migration.

Adopting a cooldown for shotwright's *own* dependencies is a separate, cheap
supply-chain win and is worth a follow-up bead, not E9 scope.

---

## 6. What E9.P must decide

Carried forward as open decisions, not recommendations already made:

0a. **Is the bd board acceptable as public content?** (§3.7) An owner candour
   call, not a technical one — it decides between deleting `refs/dolt/data`
   (cheap, leaves recoverable objects) and publishing from a fresh repo (clean,
   costs the repo identity). Whichever is chosen, **a replacement off-machine
   backup must exist and be verified before the ref is removed.**

0. **Publish before or after the public flip.** The one decision that has a
   permanent consequence attached (§1.2): versions published while the repo is
   private can never gain provenance. §3.6's evidence says the vetting is nearly
   done, which argues for flipping first. Needs an owner call against E8's
   schedule. **This decision also determines whether the ADR-0010 amendment is
   written before or alongside E9.P** — but the amendment itself is required
   regardless, since the private-repo premise is already reversed.

1. **First published version number.** `0.1.0` is available and unreleased.
   Given §2's "never reusable" rule, consider whether the first publish should
   be `0.0.1` or a `0.1.0-rc.1` prerelease (published with `--tag next`) to
   prove the pipeline end-to-end while keeping `0.1.0` unburned for the release
   that E8 actually consumes. **Recommended**, but it is a plan-phase call.
2. **Whether the bootstrap publish is manual-local or a one-shot workflow.**
   Manual-local is simpler and the token never touches GitHub; a workflow is
   reproducible. §1.4 assumes manual-local.
3. **Changesets adoption scope** — full release-PR bot, or Changesets for
   versioning/changelog with a manually-dispatched publish.
4. **Where the leak gate lives** — a `scripts/ci/` script consistent with the
   existing CI-lane convention (CLAUDE.md) is the obvious home, so both lanes
   and local runs share one definition.
5. **Whether `templates/github/shotwright.yml`'s `@main` pin** should become a
   version tag once shotwright is published, since consumers will then be
   version-resolving the package but branch-resolving the workflow. Possibly
   out of scope for E9; worth a bead either way.

## 7. Risk register for E9.V

Ordered by cost of getting it wrong.

| Risk | Irreversible? | Gate |
|---|---|---|
| Host path / secret in published tarball | **Yes** — disclosure is permanent | §3.1 gate on extracted tarball, demonstrated failing |
| Secret or PII in **git history** at the public flip | **Yes** — disclosure is permanent | §3.6 `gitleaks git` over all refs; history verified clean 2026-08-01 |
| Full bd board public via `refs/dolt/data` | **Yes** — objects survive ref deletion | §3.7 owner candour call; deletion ≠ erasure |
| **Losing the board** by deleting the only backup | **Yes** — no other copy exists | §3.7 stand up replacement backup and verify it *before* removing the ref |
| Versions published pre-flip are unattested forever | **Yes** — versions immutable | §1.2 ordering decision (§6.0) |
| Burning a version number on a bad publish | **Yes** — number never reusable | Prerelease-first (§6.1); dry-run review |
| Publishing stale/partial `dist` | Recoverable via patch + deprecate | Build in CI from clean checkout (§3.2) |
| Prerelease tagged `latest` | Recoverable via `dist-tag` | Explicit `--tag next` (§3.3) |
| Bootstrap token left live | Recoverable, but a standing exposure | Explicit revoke step as acceptance criterion (§1.4) |
| Consumer install lag on pnpm 11 | Not a defect | Expect 24h (§5.3) |

---

## Sources

- [npm Docs — Unpublish policy](https://docs.npmjs.com/policies/unpublish/)
- [npm Docs — Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/)
- [npm Docs — npm-deprecate](https://docs.npmjs.com/cli/v11/commands/npm-deprecate/)
- [npm Docs — npm-dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)
- [npm Docs — Adding dist-tags to packages](https://docs.npmjs.com/adding-dist-tags-to-packages/)
- [npm Docs — Threats and mitigations](https://docs.npmjs.com/threats-and-mitigations/)
- [GitHub community #179562 — Classic token removal](https://github.com/orgs/community/discussions/179562)
- [GitHub community #187403 — Bulk trusted publishing config, `npm trust`](https://github.com/orgs/community/discussions/187403)
- [GitHub Changelog — npm trusted publishing GA (2025-07-31)](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)
- [GitHub Changelog — Provenance from private repos unsupported (2023-07-25)](https://github.blog/changelog/2023-07-25-publishing-with-npm-provenance-from-private-source-repositories-is-no-longer-supported/)
- [npm/cli#8544 — Allow publishing initial version with OIDC](https://github.com/npm/cli/issues/8544)
- [npm/cli#9088 — Trusted publishing reports misleading 404/ENEEDAUTH](https://github.com/npm/cli/issues/9088)
- [npm/cli#7910 — Publishing prerelease requires explicit tag](https://github.com/npm/cli/pull/7910)
- [npm/cli#7553 — `npm publish` tags pre-versions as latest](https://github.com/npm/cli/issues/7553)
- [npm/cli#7706 — `--provenance` default `public` access](https://github.com/npm/cli/issues/7706)
- [npm/cli wiki — Files & Ignores](https://github.com/npm/cli/wiki/Files-&-Ignores)
- [npm/npm-packlist](https://github.com/npm/npm-packlist)
- [nrwl/nx#27754 — Can't generate provenance for private package](https://github.com/nrwl/nx/issues/27754)
- [pnpm/pnpm#9812 — Support OIDC publishing](https://github.com/pnpm/pnpm/issues/9812)
- [pnpm/pnpm#11513 — pnpm publish OIDC fails on pnpm 11](https://github.com/pnpm/pnpm/issues/11513)
- [pnpm — Settings (auto-install-peers)](https://pnpm.io/next/settings)
- [pnpm discussion #3995 — Automatically install peerDependencies](https://github.com/orgs/pnpm/discussions/3995)
- [pnpm — Using Changesets](https://pnpm.io/using-changesets)
- [pnpm — Mitigating supply chain attacks](https://pnpm.io/supply-chain-security)
- [philna.sh — Things you need to do for npm trusted publishing to work (2026-01-28)](https://philna.sh/blog/2026/01/28/trusted-publishing-npm/)
- [azu/setup-npm-trusted-publish](https://github.com/azu/setup-npm-trusted-publish)
- [Socket — pnpm 10.0.0 blocks lifecycle scripts by default](https://socket.dev/blog/pnpm-10-0-0-blocks-lifecycle-scripts-by-default)
- [Socket — npm introduces minimumReleaseAge and bulk OIDC configuration](https://socket.dev/blog/npm-introduces-minimumreleaseage-and-bulk-oidc-configuration)
- [Cryptika — pnpm 11 turns on minimum release age by default](https://www.cryptika.com/pnpm-11-turns-on-minimum-release-age-by-default-to-reduce-npm-supply-chain-risk/)
- [@arethetypeswrong/cli on npm](https://www.npmjs.com/package/@arethetypeswrong/cli)
- [tsdown — Package validation (publint & attw)](https://tsdown.dev/options/lint)
- [gitleaks](https://github.com/gitleaks/gitleaks) · [gitleaks.org](https://gitleaks.org/)
- [appsecsanta — Gitleaks 2026 status](https://appsecsanta.com/gitleaks)
- [secretlint](https://github.com/secretlint/secretlint)
- [Oleksii Popov — NPM release automation: semantic-release vs Release Please vs Changesets](https://oleksiipopov.com/blog/npm-release-automation/)
- [Liran Tal — Introducing Changesets](https://lirantal.com/blog/introducing-changesets-simplify-project-versioning-with-semantic-releases)
- [Tony Ward — Managing releases with Changesets](https://www.tonyward.dev/articles/managing-releases-with-changesets)
- [Snyk — Dependency confusion via npm package aliasing](https://snyk.io/blog/exploring-extensions-of-dependency-confusion-attacks-via-npm-package-aliasing/)
