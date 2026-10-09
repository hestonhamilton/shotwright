# shotwright release runbook

The operational half of `docs/shotwright-746.18.2-plan.md`. That document argues
the design; this one is what you follow with your hands on the keyboard.

**One sentence to keep in mind the whole way down:** `npm publish` without
`--dry-run` is the only irreversible command here, and once `shotwright@x.y.z`
has been used, that version number can never be used again — even after a
successful unpublish.

---

## 0. Preconditions

Ordering is fixed by owner decision (2026-08-01) and is not a matter of taste.
The repo goes **public before the first publish**, because npm provenance cannot
be applied retroactively and is unavailable while the source repo is private. Any
version shipped before the flip is permanently unattested.

| # | Must be true | Tracked by |
|---|---|---|
| 1 | Replacement off-machine Dolt backup exists and has been proven by a restore | `shotwright-2sr.4` |
| 2 | `refs/dolt/data` and the `__dolt_remote_info__` branch are gone from GitHub | `shotwright-2sr.4` |
| 3 | Dependency vulnerability review run and triaged | `shotwright-746.23` — **done 2026-09-03**, ADR 0019 |
| 4 | Repo flipped to public **by the owner**, from an evidence pack | `shotwright-746.18.6` |
| 5 | npm account exists, 2FA is on, and `npm whoami` answers (section 1.1) | `shotwright-746.18.4` |

Do not start section 1 until all five hold. Rows 1 and 2 are ordered because,
until `shotwright-2sr.4` landed, GitHub's ref *was* the only off-machine copy of
the board, so deleting it before the replacement was proven would have been
unrecoverable. Both rows hold today; `scripts/flip-evidence.sh` re-checks them.

---

## 1. Bootstrap — once, ever

This publishes `0.1.0-rc.1`, a **deliberately throwaway version**. It exists
because the first publish is the one operation that cannot use trusted publishing
(a trusted publisher can only be configured on a package that already exists) and
has never been rehearsed here. Burning an rc keeps `0.1.0` — the version E8
consumes — for a publish that goes through CI with provenance.

Expect the first attempt to fail confusingly. Trusted-publishing and auth
failures surface as `404` or `ENEEDAUTH`, not as a useful message. **A 404 here
does not mean the name was taken.**

### 1.0 Put the rc version on `main` and tag it

`package.json` says `0.1.0`, and `npm publish` publishes whatever version it finds
there. **Nothing earlier in this document changes it**, so a clean clone of `main`
would publish — and permanently burn — `0.1.0` under the `next` tag, which is the
exact outcome this section exists to prevent. Measured 2026-10-05: no
`v0.1.0-rc.1` tag existed and no step set the version (`shotwright-746.18.18`).

On a branch, bump the version without creating a tag, commit it under a bead id so
the commit hook accepts it, and merge it through a PR like any other change:

```
npm version 0.1.0-rc.1 --no-git-tag-version
git commit -am 'shotwright-746.18.4: version 0.1.0-rc.1 for the bootstrap publish'
```

Once that commit is on `main`, tag the **merge commit** and push the tag:

```
git tag -a v0.1.0-rc.1 <merge-sha> -m 'Bootstrap prerelease'
git push origin v0.1.0-rc.1
```

Two things to expect: `version.yml` runs on that push to `main` and does nothing,
because there is no `.changeset/*.md` file for it to version; and
`pnpm install --frozen-lockfile` still passes, because the lockfile does not record
the root package's own version.

### 1.1 Set up the npm account and log in

Owner decision (2026-10-05): the bootstrap uses an **interactive login with
2FA**, not a bypass-2FA token. A token that can publish without a second factor
is exactly the credential a leak turns into a hijacked package, and granular
bypass-2FA tokens lose direct publish rights in January 2027 anyway. Nothing
long-lived is created; the session is logged out in 1.4.

If the account does not exist yet, in this order, in a browser:

1. Create it at `https://www.npmjs.com/signup` with the publisher email, and
   verify the email. The username is public and will appear as the package
   maintainer; the email is shown on the package page unless hidden in profile
   settings.
2. Enable 2FA under *Account → Two-Factor Authentication* and pick
   **Authorization and publishing** (the stricter of the two modes). An
   authenticator app or a passkey/security key both work; save the recovery
   codes somewhere that is not this machine. npm requires 2FA to publish a new
   package regardless, so the weaker mode buys nothing.
3. Confirm the name is still free. `npm view shotwright` answering **404** is
   the expected result (it was free on 2026-10-05). Anything else means the
   name was taken in the meantime and the package name needs a decision before
   anything else happens.

Then, from the terminal:

```
npm login            # opens the browser; complete the login and the 2FA prompt there
npm whoami           # must print the publisher username
```

`npm login` stores a session token in `~/.npmrc`. That is why 1.4 exists.

### 1.2 Publish the rc from a clean clone

From a **fresh clone at the tag**, not your working tree. `dist/` is gitignored
build output, so a stale or partial `dist/` in a working tree ships silently
wrong code with no diff to review.

```
git clone git@github.com:hestonhamilton/shotwright.git /tmp/shotwright-release
cd /tmp/shotwright-release
git checkout v0.1.0-rc.1
scripts/ci/install-gitleaks.sh "$HOME/.local/bin"   # always downloads and hashes; see section 4
scripts/ci/install-osv-scanner.sh "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
scripts/ci/verify.sh                                 # the whole lane, must exit 0

# Pack ONCE. Scan that file. Publish that file. (Redteam 2 found the earlier
# version of this block let leak-gate.sh pack and discard its own tarball, then
# let npm publish pack a second one that no gate had seen.)
mkdir release-artifact
tarball="$(realpath "release-artifact/$(npm pack --pack-destination release-artifact --json \
  | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8'))[0].filename")")"
scripts/ci/leak-gate.sh "$tarball"                   # must exit 0
grep -q '"version": "0.1.0-rc.1"' package.json       # the version you mean to burn

# Publish from the logged-in session. With 2FA in "authorization and
# publishing" mode npm opens the browser for the second factor; pass --otp
# only if it insists on a code at the prompt.
npm publish "$tarball" --tag next --access public
```

`--tag next` is explicit, and npm requires a tag for prereleases. **It did not
keep the rc off `latest`.** Measured at the bootstrap (2026-10-08): with no
non-prerelease version in existence, the registry set `latest` to `0.1.0-rc.1`
as well as `next`, so a bare `npm install shotwright` resolved the rc until
`0.1.0` was published 49 minutes later and took `latest` over. Nothing needs
doing about it, but do not announce the package name between the two publishes,
and check the tags in 2.5 once the stable version is out.

**A second version appears that you did not publish.** The same publish left a
two-file `shotwright@0.0.0-stage` on the registry, timestamped two and a half
minutes before `0.1.0-rc.1` — npm's staged-publish placeholder. The owner
unpublished it after `0.1.0` shipped. If it reappears on a future laptop
publish, `npm unpublish shotwright@0.0.0-stage` is the command, and any login
session opened for it is closed as in 1.4. That is the one
unpublish this runbook has ever sanctioned: the version number it burns is one
nobody wants, and section 3's rule against unpublishing as a *mitigation* is
unaffected. The registry's `time` map still lists `0.0.0-stage` afterwards;
`versions` does not, and that is the field to read.

Passing the tarball path to `npm publish` is what makes "the file the gate
scanned" and "the file npm uploads" the same bytes; `realpath` matters because
npm reads a bare relative path with a slash as GitHub shorthand (section 2.3).

**No credential is typed, copied, or exported in this step.** The only
credential involved is the login session in `~/.npmrc` from 1.1, which 1.4
removes. If anything asks you to paste a token, stop: that is not this runbook.

### 1.3 Create the `npm-publish` environment, then configure the trusted publisher

**First, the GitHub Environment.** `release.yml` runs its `publish` job in an
environment named `npm-publish`, and that job is the only place in the workflow
that can mint an OIDC token (`shotwright-746.18.27`). This is done after the
repository is public (precondition 4), which is when environments with
protection rules become available to it. In the repository's
*Settings → Environments → New environment*:

1. Name it exactly `npm-publish`.
2. *Deployment branches and tags*: **Selected branches and tags**, with one rule,
   `main`. Not "No restriction", and not "Protected branches only".
3. *Required reviewers*: add the owner. Leave *Prevent self-review* off if the
   owner is the only person who can dispatch, or the job can never be approved.
4. No environment secrets and no environment variables. Publishing carries no
   credential; anything added here is a design reversal (see the header of
   `release.yml`).

**Create and configure it before the first real dispatch of `Release`.** Until
it exists with these rules, the publish job is not protected by it. GitHub does
*not* refuse a job that names a missing environment: it silently creates one
with **no protection rules** and runs the job, so a real dispatch made before
this step would reach `npm publish` guarded only by the in-file main check. If an
`npm-publish` environment already exists when you get here, open it and confirm
the rules above rather than assuming them.

The environment's branch policy is the real main-only control. The workflow's
own "refuse anything but main" step is defence in depth, because a dispatch from
a branch runs that branch's copy of `release.yml` and could simply delete the
step; the branch policy lives in repository settings, where a branch cannot
edit it.

**Then the trusted publisher.** On `npmjs.com/package/shotwright/access` — the
**package's** access page, not account settings — or from the terminal, which
needs **npm ≥ 11.15.0**:

```
npm --version                 # 11.15.0 or newer, or stop and upgrade first
npm trust github shotwright --file release.yml --repo hestonhamilton/shotwright --environment npm-publish --allow-publish
npm trust list shotwright     # confirm exactly one relationship: release.yml, environment npm-publish
```

Both the version floor and `--allow-publish` are load-bearing. Since 2026-05-20
the registry requires every trust relationship to name a permission
(`--allow-publish` or `--allow-stage-publish`). npm 11.15.0 and later refuse
client-side with a message when the flag is missing; older CLIs that have the
`trust` command (11.10.0 onward) send the old payload and get a **bare
`400 Bad Request`** with no explanation. Measured 2026-10-08 on npm 11.13.0,
which an earlier revision of this section named as sufficient. `release.yml`
runs a plain `npm publish`, so `--allow-publish` is the one that matches;
`--allow-stage-publish` would register a relationship the workflow cannot use.

The `--file` is the workflow filename as it appears under `.github/workflows/`;
the trust check matches on it, so renaming the workflow later silently breaks
publishing until this is updated. The `--environment` binds the relationship to
the `npm-publish` environment, so the registry refuses a token minted by any job
that does not run in it — which is what makes the environment's branch policy
and reviewer binding on the publish itself, not just on the workflow. Renaming
the environment breaks publishing the same way renaming the file does.

### 1.4 Log out immediately

**This is the step that gets skipped.** `npm login` left a session token in
`~/.npmrc`; after 1.3 nothing on this machine needs it, because every later
publish is the OIDC workflow.

```
npm logout
npm whoami          # must fail with ENEEDAUTH
npm token list      # must prompt for login or list nothing for this session
```

If you minted any token along the way (you should not have), revoke it here
with `npm token revoke <id>` and confirm with `npm token list`.

### 1.5 Get back to `0.1.0`

The CI publish of `0.1.0` goes through section 2, and the first changeset must be
a **`patch`**. `changeset version` applies `semver.inc`, and from `0.1.0-rc.1` both
`patch` and `minor` yield `0.1.0`; `major` would skip to `1.0.0`. Measured
2026-10-05 with `@changesets/cli` 2.31.1 and again with 3.0.3 (the version
`shotwright-746.18.20` moved to), against this repo's `.changeset/config.json`:
a `patch` changeset took `package.json` from `0.1.0-rc.1` to `0.1.0` and wrote a
`## 0.1.0` section to `CHANGELOG.md`, identically under both. Do not hand-edit the version back — let the
Version PR do it, so the changelog is right.

---

## 2. Every release after that

### 2.1 Describe the change

```
pnpm exec changeset
```

Writes a `.changeset/*.md` file. Commit it with the work it describes. For the
very first release after the rc bootstrap, pick `patch` (section 1.5).

### 2.2 Merge the Version PR

Pushing to `main` runs `.github/workflows/version.yml`, which opens or updates a
Version PR bumping the version and writing `CHANGELOG.md`. Merging it is
**human gate 1**.

**The Version PR is only opened if a repository setting allows it.** *Settings →
Actions → General → Workflow permissions → Allow GitHub Actions to create and
approve pull requests* must be on. It was off at the first release (2026-10-08),
and with it off `changesets/action` cannot open a pull request with
`GITHUB_TOKEN`: the changeset merges and no Version PR ever appears. Check it
before the first changeset lands, and after anything that resets repository
settings:

```
gh api repos/hestonhamilton/shotwright/actions/permissions/workflow
# want: "can_approve_pull_request_reviews": true
gh api -X PUT repos/hestonhamilton/shotwright/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
```

Keep `default_workflow_permissions` at `read` in that call; the endpoint sets
both fields.

**The Version PR's `verify` run is created but parked, and the PR cannot merge
until someone approves it.** When a workflow opens or updates a pull request
with `GITHUB_TOKEN`, GitHub creates the `pull_request` runs in an
approval-required state and waits for a user with write access. The PR shows
only the CodeQL default-setup checks, the required `verify` check has not
reported, and the `main` ruleset blocks the merge (`mergeStateStatus: BLOCKED`).
Approve the run in either of two ways:

- On the PR page, select **Approve workflows to run**.
- From a terminal:

  ```
  sha="$(gh pr view <pr> --json headRefOid --jq .headRefOid)"
  gh api "repos/hestonhamilton/shotwright/actions/runs?head_sha=$sha" \
    --jq '.workflow_runs[] | select(.conclusion=="action_required") | [.id, .name] | @tsv'
  gh api -X POST repos/hestonhamilton/shotwright/actions/runs/<run-id>/approve
  ```

Measured on Version PR #12 (2026-10-09): the parked `Verify` run restarted as
attempt 2, passed, and the PR went from `BLOCKED` to `CLEAN`. Every update of the
Version PR by the bot (another push to `main`) produces a new head with a new
parked run, so approve again after the last update and merge only on a `verify`
run for the PR's current head.

Closing and reopening the PR as the owner also works, because the reopen is an
owner-caused event that starts a fresh run. That is what the first release did
on PR #9, before the parked run was noticed. Treat it as a fallback.

Two alternatives were considered and are not used. A `workflow_dispatch`
trigger on `verify.yml` does not help: a dispatched run is not attached to the
pull request and does not satisfy a ruleset's required check (GitHub,
"Troubleshooting required status checks"). Opening the Version PR with a GitHub
App token removes the approval step entirely, and is what GitHub recommends for
that, but it adds an app and a stored private key to a repository that
otherwise holds no long-lived write credential. One approval per release is the
cheaper trade for a single-owner repository.

**The forge lane is absent for a Version PR by construction.** The bot's branch
is pushed by Actions to GitHub only, never through the two-URL `origin` that
reaches the forge, so `scripts/forge-ci-status.sh` reports no runs for its
head, which that script treats as not-green. That is expected here, not a
standby failure, and the forge is advisory in any case.

> Known convention friction: the Version PR's commit is
> `chore: version packages`, which does not match this repo's
> `<bead-id>: <subject>` convention. It is created server-side by
> `changesets/action`, so the local commit hook does not fire on it. Left as-is
> rather than faking a bead id onto every future version bump; revisit if the
> drift becomes annoying.

### 2.3 Rehearse

Dispatch **Release** with `dry-run: true` (the default). The workflow has two
jobs (`shotwright-746.18.27`):

- **`build`** — read-only permissions, no token. Every step runs for real —
  verify, browser install, gitleaks install, pack, leak gate,
  `npm publish --dry-run` — and it uploads the tarball plus its `.sha256` as the
  `release-tarball` run artifact. It runs identically on a real dispatch.
- **`publish`** — skipped on a dry run. On a real dispatch it waits for approval
  in the `npm-publish` environment, downloads `release-tarball`, checks its
  sha256 against the hash `build` reported through its job outputs, and runs
  `npm publish --provenance`. It checks out no code and installs nothing but the
  integrity-pinned npm.

Download the `release-tarball` artifact from a dry run if you want to inspect
the exact bytes a real run would have published.

> **A failed dry run proves only what it reached.** Steps after the failure are
> untested, so fix and re-dispatch rather than assuming the rest of the path is
> sound. Expect several rounds the first time a change touches the workflow.
>
> This is not hypothetical. The first rehearsal (2026-08-01) took three rounds,
> and each defect was only reachable once the previous one was fixed:
>
> 1. `install` does not create its destination directory, and `~/.local/bin` is
>    absent on a stock runner.
> 2. `actions/setup-node`'s `registry-url` exports `NODE_AUTH_TOKEN` and writes a
>    token `.npmrc`, breaking trusted publishing — and surfacing as a **bare
>    404**, not an auth error ([actions/setup-node#1551](https://github.com/actions/setup-node/issues/1551)).
> 3. npm reads a bare relative path containing a slash as GitHub shorthand, so a
>    tarball argument became `github:release-artifact/…` and failed `EALLOWGIT`.
>
> All three would have hit a real publish identically, and number 2 would have
> been actively misleading: section 1.1 tells you not to read a 404 as "the name
> was taken", which points at the registry — while the actual cause was an
> `.npmrc` written by a setup action. Diagnosing that after burning a version
> number is the scenario the rehearsal exists to prevent.

**Four things this does not prove, and cannot short of publishing:**

1. That the registry accepts the credential. `--dry-run` does not exchange the
   OIDC token, so a misconfigured trusted publisher — including a missing or
   misspelled `--environment` — surfaces only for real.
2. That provenance is generated. Observable only on the published page.
3. That the package installs from the registry.
4. That the `publish` job itself works: the environment approval, the artifact
   download, the hash check and the npm install inside it. A dry run skips that
   job entirely, so its first execution is a real publish. If it fails before the
   `Publish` step nothing has been consumed — fix and re-dispatch — but read its
   log rather than assuming the cause.

### 2.4 Publish

Dispatch **Release** with `dry-run: false`. This is **human gate 2**, and the
irreversible one. Check before you click:

- [ ] The dry run for this exact commit was green.
- [ ] You are dispatching from `main`. The `npm-publish` environment admits only
      `main`, and the workflow also refuses a real publish from any other ref
      (`shotwright-746.18.22`), but check before either has to.
- [ ] When the run pauses for review, approve the `publish` job only if `build`
      for **this run** is green and the packed file set in its log matches the
      check below. Approval is the last point at which nothing has happened.
- [ ] The packed file set in the run log is what you expect — baseline is
      **45 files, 59.8 kB packed** (since `NOTICE` shipped,
      `shotwright-746.18.36`), and `scripts/ci/expected-files.txt` lists every
      one of them. The authoritative figures are `BASELINE_FILES` and
      `BASELINE_PACKED` in `scripts/ci/leak-gate.sh`, which the gate prints; if
      this line disagrees with them, this line is stale. A jump to 200 files is
      a caught mistake.
- [ ] `dist-tag` is right. `next` for anything with a prerelease suffix. The
      workflow also enforces the pairing, so a mismatch fails before packing.
- [ ] The version number is one you are willing to burn permanently.

### 2.4b Tag the release and protect the tag

Consumers pin the reusable workflow to the release tag, not to `main`
(`templates/github/shotwright.yml`, `shotwright-746.18.28`), so the tag has to
exist, match the npm version exactly, and never move.

```bash
git tag -a v0.1.0 <published-sha> -m 'shotwright 0.1.0'
git push origin v0.1.0
```

- [ ] The tag name is `v` plus the version in `package.json` of the published
      commit, nothing else. The template ships with that string in it.
- [ ] Tags are protected: a repository ruleset on `refs/tags/v*` that forbids
      update and deletion (Settings → Rules → Rulesets, available once the
      repository is public). Create it with the first release and never
      remove it; a moved tag would silently change every consumer's CI.
- [ ] When the version bumps, the template's `uses:` line bumps with it in the
      same Version PR, so `shotwright init` always writes the current tag.

### 2.5 Verify from outside

Name the version. `pnpm add -D shotwright` resolves `latest`, which never selects
the rc that lives under `next`, and for a stable release pnpm 11's
`minimumReleaseAge` (1440 minutes by default) rejects anything published in the
last day. Both would read as "the publish failed" when it did not. For this one
isolated smoke test, and nowhere else, turn the age gate off:

```
cd "$(mktemp -d)" && pnpm init
printf 'minimum-release-age=0\n' > .npmrc        # this directory only
pnpm add -D shotwright@0.1.0-rc.1                # or shotwright@0.1.0 for the stable
pnpm list shotwright                             # the version you just published, not an older one
pnpm exec shotwright --help                      # exit 0, usage on stdout
```

No credentials configured — that is the point of the check.

After a **stable** publish, also confirm the tags and the version list, because
the bootstrap left `latest` on the rc until the first stable version replaced it
(section 1.2):

```
npm view shotwright dist-tags versions --json
# latest must be the stable version just published; next stays on the newest
# prerelease; versions must not contain 0.0.0-stage
```

As of 2026-10-08 that reads `latest: 0.1.0`, `next: 0.1.0-rc.1`, and exactly
those two versions.

Then open `npmjs.com/package/shotwright` and confirm the **provenance
attestation badge**. npm's docs say trusted publishing generates provenance
automatically, but 2026 practitioner reports say `--provenance` was still
needed, so the workflow now passes it explicitly (`shotwright-746.18.27`). If
the badge is still absent, that is a real defect, not the flag. Tracked as
`shotwright-746.18.7` — do not leave it unchecked, because nothing fails to
remind you.

> **Expect a lag on pnpm 11.** `minimumReleaseAge` defaults to 1440 minutes
> there, so a fresh version will not resolve for 24 hours. That is not a broken
> publish. Budget a day before the first E8 migration.

---

## 3. When something goes wrong

You cannot retract. You can only redirect and warn.

| Situation | Do this | Not this |
|---|---|---|
| Bad build, wrong files, stale `dist` | Publish a fixed patch; `npm dist-tag add shotwright@<good> latest`; `npm deprecate shotwright@<bad> "…"` | `npm unpublish` |
| Prerelease landed on `latest` | `npm dist-tag add shotwright@<good> latest` | anything drastic — this one is genuinely recoverable |
| Host path or secret in the published tarball | Rotate anything exposed; accept the disclosure; publish a fixed version | Treating unpublish as a fix — the tarball was world-readable and mirrored the moment it landed |
| Deprecation applied by mistake | `npm deprecate shotwright@<range> ""` — an empty message clears it | — |

`npm unpublish` is not in the mitigation strategy. It never restores the version
number, it cannot undo disclosure, and unpublishing every version blocks new
publishes of the name for 24 hours.

---

## 4a. The dependency vulnerability gate

`scripts/ci/audit-gate.sh`, run by `scripts/ci/verify.sh` alongside the leak gate.
They answer different questions about the same tarball: the leak gate asks what
bytes ship, the vulnerability gate asks what code the build trusted to produce
them.

The local checks run before any network call: shotwright must still have zero
runtime dependencies; `pnpm-lock.yaml` must remain schema 9.0; and every
`osv-scanner.toml` exception must have one ID, reason, and future expiry. Package-
wide exceptions are rejected.

The live check uses the checksum-pinned OSV-Scanner 2.5.1 binary. A clean current
tree requires valid JSON, scanner exit 0, the exact requested lockfile source,
and an extracted-package count equal to the lockfile's `packages` map. A second
scan of the one-package `lodash@4.17.20` fixture must exit 1 and report
`GHSA-35jh-r3h4-6jhm`. That canary proves the parser, advisory data, matcher, and
classifier all fired.

Online scans have a 30-second process deadline. An indeterminate result retries
the complete current+canary pair once using a freshly downloaded OSV database in
a new temporary cache, with a 120-second download deadline. A current finding
never triggers fallback, and two invalid/unavailable paths fail the lane. No
release-only or fail-open mode exists.

`scripts/ci/audit-gate-selftest.sh` runs alongside the live gate and is hermetic.
It injects fixed process results into the production classifier/orchestrator to
prove findings, malformed output, incomplete extraction, timeouts, missing
canaries, identity mismatches, and two-source failure remain non-green.

A diff to `osv-scanner.toml` **accepts a vulnerability**. Review it as the
security-relevant part of a release PR, exactly as with `expected-files.txt`.

The `overrides` entries in `pnpm-workspace.yaml` pin transitive versions
(`brace-expansion`, `nanoid`, `source-map-js` at the time of writing — read the
file, not this sentence). Each names the advisory it closes. Removing one to tidy
up can reintroduce the advisory; the gate is what catches that. An override that
matches no package in the lockfile is dead and should go, which is how the
`js-yaml` pair left on 2026-10-07.

---

## 4. The leak gate

`scripts/ci/leak-gate.sh`, run by `scripts/ci/verify.sh` on every branch and
against the exact tarball in the release workflow.

- **Layer A** — `scripts/ci/expected-files.txt`, a default-deny allowlist of what
  may ship. Content-blind, so it catches a new file whatever is in it.
- **Layer B** — `scripts/ci/gitleaks-tarball.toml`, the four shotwright rules,
  plus one built at run time from your workstation login (next paragraph).
- **Layer C** — gitleaks' stock default ruleset, for generic credential shapes.

**B and C are two separate gitleaks runs, and must stay that way.** Merging them
with `[extend] useDefault = true` silently suppresses `/home/` host-path
detection — measured on gitleaks 8.30.1, fires standalone, reports "no leaks
found" merged. Do not consolidate them to tidy the script up.

**Your workstation login is not in the repo, so the gate cannot know it unless
you say.** The committed username rule matches the GitHub handle, which is the
only name the repository may carry. Whenever you run the gate on your own
machine (sections 1.2 and 2.3), supply the login and the gate adds a rule for it
on the fly, in any position, not just paths:

```
SHOTWRIGHT_OPERATOR_LOGIN="$(id -un)" scripts/ci/leak-gate.sh "$tarball"
```

CI leaves it unset and the gate prints which mode it ran in. Nothing writes the
login anywhere; `scripts/ci/leak-gate-config.sh` builds the effective config
under the gate's temp dir and it is deleted on exit.

`scripts/ci/leak-gate-selftest.sh` runs alongside the gate on every verify and
asserts each rule fires on its own shape *and* stays quiet on the three strings
that legitimately appear in a correct tarball. If it fails, fix the rules — do
not weaken the assertions.

It **fails closed** when gitleaks is missing. That is deliberate: a gate that
skips its scan and reports green launders the absence of a check as a passing
one. If it fails that way, install the pin — do not work around it.

**It cannot be switched off from outside the repo.** The 2026-10-05 audit found
three ways a scan is normally neutralised without touching the scanned files —
`GITLEAKS_CONFIG` / `GITLEAKS_CONFIG_TOML` in the environment, a
`.gitleaksignore` in the working directory, and a `gitleaks:allow` comment on
the leaking line — and measured each as exit 0 on a seeded token. The gate now
unsets the variables, points both layers at an empty ignore file, tells the
scanner to disregard the marker, and fails outright if the marker appears in a
shipped file. The self-test drives the real gate over a miniature tarball under
each of those conditions and asserts it still fails. The repository's own
`.gitleaksignore` exists only for the fixture seeds in
`scripts/dolt-ref-inspect-selftest.sh`, so a public scanner stays quiet after
the flip; it never reaches the tarball.

**Authoritative scans run over a copy that carries no `.gitleaksignore`.**
gitleaks reads suppression state from the tree it scans, and in `git` mode it
reads the repository's `.gitleaksignore` whatever `--gitleaks-ignore-path` says
(measured on 8.30.1). The repository's ignore file exists for third-party
scanners' benefit only. The tarball gate therefore scans an extracted archive
and `scripts/flip-evidence.sh` scans a `--no-checkout` clone; a new scan added
to this repo that is meant to be believed must do the same, or a line in
`.gitleaksignore` becomes a way to remove a finding from the evidence.

**The installer trusts only the hash committed here.** `scripts/ci/gitleaks-pin.sh`
carries the version and the per-platform sha256 of each release archive,
confirmed against an independently downloaded copy; `install-gitleaks.sh`
downloads and hashes every time and never accepts a `gitleaks` already on
PATH on the strength of its version string. To bump: take the hashes from the
upstream release manifest, confirm at least one by hashing a download, then
change the pin file in a reviewed PR — the gate asserts the version it runs
under, so the two cannot drift.

**What it does not catch** is in plan section 2.5 and is worth reading before you
trust it. In short: any encoding, anything derived at runtime, non-path PII, and
— most importantly — a change to the gate's own config. An in-repo gate cannot
defend against being edited. Review the diff to
`scripts/ci/gitleaks-tarball.toml` and `scripts/ci/expected-files.txt` as the
security-relevant part of any release PR.
