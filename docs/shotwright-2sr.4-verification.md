# shotwright-2sr.4 — V: verification of the backup, and the dispositions awaiting approval

Date: 2026-08-02. Verifies the work landed by `shotwright-2sr.3` (PR #42).
Design: ADR 0013, ADR 0016, ADR 0017. Runbook: `docs/backup.md`.

**Nothing has been deleted.** Section 5 is a request for approval, not a record
of action taken.

## 1. Restore, re-verified by a different path

The bead requires the restore be verified *independently of whoever ran I*.
The implementer also ran verification, so personnel independence is not available here — say so plainly rather
than let the checkbox imply something it does not. What was done instead is
**method** independence: the implementation drill used `dolt clone` and compared
with SQL; this one uses `bd backup restore`, the path an operator would actually
reach for in a disaster, and compares through `bd` itself.

Pulled the copy from the destination, `bd init` into an empty scratch project,
`bd backup restore <path> --force`:

| | live | restored |
|---|---|---|
| total issues | 69 | **69** |
| open | 16 | **16** |
| in progress | 1 | **1** |
| blocked | 5 | **5** |
| closed | 52 | **52** |
| ready to work | 11 | **11** |

`shotwright-2sr.3`'s close reason — 700-odd characters of prose — came back
byte-identical. So the restore reaches a working board, not just a database with
the right row counts.

This also verifies the documented procedure: `bd backup restore` works, which
`docs/backup.md` had not previously claimed because the implementation drill
never used it.

## 2. Redteam: what silently breaks it

Each case had to fail **loudly** and leave the destination no worse off.

| # | Failure injected | Result | Verdict |
|---|---|---|---|
| R1 | Destination host unreachable (TEST-NET-1) | `ssh: connect … Connection timed out`, push exits 1 before writing | **PASS** |
| R3 | ssh authenticates as a user with no access | `Permission denied (publickey)`, push exits 1, nothing sent | **PASS** |
| R4 | Transport dies **between** the content pass and the pointer pass | Push exits 1: *"the destination has the new content but still points at the old manifest"*. Destination still names the previous commit, still 69 issues, still restorable. New archives present but unreferenced. | **PASS** |
| R6 | Real timer service run against an unreachable destination | `OnFailure=` fired; `shotwright-beads-backup-alert.service` activated; journal carries the message at **priority `alert`** | **PASS** |
| R7 | Two pushes racing each other against one database | Both exit 0, destination consistent at one commit afterwards | **PASS** |

R4 is the one worth dwelling on: it is the two-pass ordering claim in
`backup-push.sh` being tested rather than asserted, and the destination
genuinely survived a mid-push death with its previous complete state intact.

### Two of these tests were wrong before they were right

Recorded because a redteam that only reports its successes is not evidence of
much.

- **The credential test passed twice while proving nothing.** `-i /dev/null`
  with `IdentitiesOnly=yes` does not remove a credential when `~/.ssh/config`
  names an `IdentityFile` for that host — config-specified identities still
  count. The push kept succeeding and it looked like a passing test. Only
  authenticating as a user with no access actually removed the credential.
- **The unwritable-destination test could not hold.** `chmod 500` on the
  destination directory did not stop the push, because `rsync -a` implies
  `--perms` and reset the directory's mode from the source before writing. That
  is rsync behaving correctly, not a defect — but a test that "passes" because
  the fault never landed is worse than no test. Replaced with transport-layer
  fault injection (R4), which fails where it is aimed.

## 3. The timer and bd's own interval backup, running concurrently

Plan §12 lens 4 flagged this as bounded but untested. Observed:

They **cannot** collide, because they write to different destinations. From
shotwright's `repo_state.json`:

```
backup_export  ->  <project>/.beads/backup            (bd's interval, local)
default        ->  <state-dir>/beads-backup/shotwright (this design's staging)
```

Two concurrent pushes against the same live database both completed and left the
destination consistent, so the shared read path does not contend either.

One standing oddity, unchanged and harmless: `backup_export` is where
a second database also writes (`shotwright-2sr.5`). Nothing in this design reads
that directory, so the collision no longer has any effect here.

## 4. Limits of this verification — read before approving

- **Not personnel-independent.** Section 1 explains what was substituted.
- **The push-side "empty backup" guard was not demonstrated firing.** Provoking
  it needs a shared-server database with zero issues, and two attempts to build
  a scratch one produced an embedded-mode project instead. The equivalent rule
  *is* demonstrated on the verify side, hermetically, by self-test case C11,
  which runs in CI on every push. So the failure mode is covered; the second
  line of defence is not independently proven.
- **`backup-verify.sh` returns OK after a failed pointer pass**, because the
  destination genuinely still holds a valid, recent backup. That is correct, and
  it means verify is not the surface that tells you a push failed — the push's
  own exit code and the alert are. Verify catches the *consequence* only once
  the copy ages past 24h. Division of labour is deliberate; noted so nobody
  later reads a green verify as "the last push succeeded".
- **Embedded-mode projects fail with a misleading message.**
  `backup-push.sh` on a non-shared-server project dies with *"could not read the
  live head commit — is the bd server up?"* when the real cause is that the
  project is not on the shared server at all. Fails closed and sends nothing, so
  it is a wording defect, not a safety one. Not fixed here.

## 5. Dispositions — AWAITING OWNER APPROVAL

Re-derived 2026-08-02, by command, not from the stored list. The count moved
9 → 10 between 2026-08-01 and 2026-08-02, which is why it is re-derived every
time.

**Several repositories carry Dolt refs; every one of them is PRIVATE.** Every one carries
`refs/dolt/data` *and* `refs/heads/__dolt_remote_info__` — both must go together
wherever anything goes.

| Disposition | Repositories |
|---|---|
| **DELETE both refs** (shotwright: private → **going public**) | 1 |
| KEEP (private) | the rest |

The KEEPs are one rule, not several judgements: **a Dolt ref in a private
repository is a legitimate backup, not an exposure.** It only becomes an
exposure when the repository's visibility changes, which is why the check
belongs on the public-flip checklist (`shotwright-746.18.6`) rather than being
re-litigated per repo.

### What deleting the ref does and does not do

Stated so approval is informed, per this bead's acceptance criteria:

**Deletion removes discoverability, not the objects.** After deletion the ref no
longer appears in `git ls-remote` and nothing advertises it, but the underlying
Git objects remain on GitHub's servers until their garbage collection runs, on a
schedule outside our control. Anyone who already has the object IDs may still be
able to reach them.

If the goal is *non-disclosure* — a guarantee that the board's contents were
never and can never be retrieved from GitHub — **deletion does not deliver it,
and only a fresh repository does.** The owner has been told this and has
acknowledged it (2026-08-02).

What deletion *does* deliver, which is the actual requirement: the shotwright
repository can go public without a Dolt ref hanging off it advertising a
complete copy of the board to anyone who runs `git ls-remote`.

### Approval, and what was actioned

Owner approval recorded in the bead, 2026-08-02, verbatim: *"only act on
shotwright. this will always be a per repo decision"*.

- [x] DELETE `refs/dolt/data` + `refs/heads/__dolt_remote_info__` on
      **shotwright** — **DONE**, confirmed by re-deriving from the remote
- [x] Discoverability-not-erasure acknowledged by the owner
- [ ] ~~KEEP on the other repositories~~ — **not approved as a standing rule.** The
      owner's decision is that this is *always* a per-repo call. The other repositories
      are **untouched and undecided**, which is not the same as "KEEP". Each is
      decided on its own facts, when it is decided. The "one durable rule"
      framing proposed in `docs/shotwright-2sr.3-audit.md` is superseded.

### The deletion did not hold the first time

Worth recording in full, because a disposition that silently reverts is worse
than one that was never actioned.

The refs were deleted and confirmed gone. A single `bd dolt push` — the command
CLAUDE.md's managed Beads block and bd's own session-close protocol both
instruct agents to run — restored both, with new hashes.

Four containment attempts, all measured:

| Attempted | Result |
|---|---|
| `bd dolt remote remove origin` | Next push: *"Configured Dolt remote origin from git origin"*, pushed to GitHub |
| `bd config set/unset sync.remote` | `bd dolt push` does not read this key. Set to a local path, it **still** pushed to GitHub; `unset` does not even remove it from `config.yaml` |
| git `pre-push` hook rejecting `refs/dolt/*` | Never fires — Dolt speaks the git wire protocol over ssh natively. (Installed at `core.hooksPath` = `.beads/hooks`; the obvious `.git/hooks` is not used here) |
| GitHub rulesets / branch protection | not available while the repository is private, and they target branches and tags, not custom refs |

**What worked:** point the Dolt remote named `origin` at a local path. bd only
auto-derives from the git remote when `origin` is *absent*; when it exists, it
is left alone. Verified by deleting the refs, then running `bd dolt push` twice
with a board write in between — `git ls-remote` still shows nothing.

**The control is machine-local** (`repo_state.json` under the shared server's
data dir), so it does not survive a fresh clone, and there is no tracked
equivalent — the key that *is* tracked, `sync.remote`, is not the one that
governs the push. The flip checklist must therefore verify by `git ls-remote`
rather than trust configuration.

### Two incidents caused by this investigation, both cleaned up

- **bd auto-committed six times** to the working branch while dolt remotes were
  being added and removed, and one commit carried an absolute host path
  (`file:///home/<user>/...`) into the tracked `.beads/config.yaml` — a
  headed-public violation. Caught before the branch was pushed; the commits were
  dropped and `config.yaml` restored to match `main`. **`main` never had a
  `sync:` block at all** — an earlier reading that it predated the session was
  wrong.
- **A probe overwrote bd's own `pre-push` hook**, because
  `git rev-parse --git-path hooks` resolves to `.beads/hooks` under this repo's
  `core.hooksPath`. Restored from `HEAD`.

## 6. Verdict

The backup works, fails loudly in every mode tested, survives a mid-push death
with its previous state intact, raises an alert that was observed firing, and
restores to a working board by two independent methods.

It is one copy, same-site, by decision (ADR 0017). Nothing in this verification
changes that, and the alert and the fail-closed checker are what stand in for
the redundancy that was declined.
