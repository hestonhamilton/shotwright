# shotwright-2sr.2 — P: the backup migration and the per-repo audit sweep

Plan phase. Turns `docs/shotwright-2sr.1-research.md` and ADR 0013 into an
ordered, reversible sequence.

Measurements in §2 were taken on 2026-08-02 in an **isolated scratch bd project**
(`Mode: embedded`, its own Dolt data directory). The shared sql-server and the
live shotwright board were not modified: after the experiments,
the shared server's set of databases was unchanged, as were shotwright's remote and backup configuration.

## Goal

Give the bd board a real off-machine backup, prove it by restore, and only then
remove `refs/dolt/data` from the repository that is going public — while
inspecting every other repository carrying a Dolt ref and recording a disposition
for each.

The ordering is the load-bearing part, and §4 states it as an invariant.

## 1. Owner decisions carried in (2026-08-02)

Taken during this phase, in response to the measurements in §2:

1. **Layer B targets a network endpoint, not a `file://` share.** Amends
   ADR 0013; recorded as **ADR 0014**.
2. **Layer B is scheduled by a systemd user timer**, because bd's own interval
   mechanism cannot be redirected (§2.2).
3. **An active staleness alert is in scope**, not merely a manual check.

Carried in from earlier, not re-litigated here:

- shotwright's disposition is **delete the ref** (epic note, 2026-08-01). The
  owner accepted "unadvertised" as sufficient, knowing deletion does not erase
  objects (§6).
- Scope is **all databases on the shared server**, with
  shotwright proven end to end first (ADR 0013).
- The self-hosted forge is **disqualified** as a backup target: it is
  co-located with the data it would back up. Not re-evaluated.

## 2. What this phase measured

The epic named three questions to settle by experiment rather than argument. All
three are settled. One answer changes the design.

### 2.1 A failed backup does not reliably fail loudly — it depends on the destination type

`bd backup sync`, scratch project, destination broken in three different ways:

| Destination state | Exit | What the operator sees | Verdict |
|---|---|---|---|
| `file://` path **absent** — the unmounted-NAS case | **0** | `Backup synced in 18ms`, and `bd backup status` shows a fresh timestamp | **Silent failure** |
| `file://` path present but not writable | 2 | Go nil-pointer panic, `SIGSEGV`, stack trace | Loud, but a crash |
| network URL unreachable (`http://`, TEST-NET-1) | 1 | `could not access dolt url … i/o timeout`, after ~29 s | **Loud and diagnostic** |

The first row is the dangerous one and it is the realistic one. When an NFS or
SMB share is not mounted, its mountpoint is an ordinary empty local directory.
Dolt does not distinguish that from a legitimate empty destination: it
**recreated the entire destination path on local disk and wrote a complete
backup into it**, then reported success. Verified by inspection — the recreated
tree carried a new chunk archive, while the real backup's archive was elsewhere.

So a NAS that quietly stops mounting produces a backup that is green forever, on
the same disk as the thing it is backing up. That is the epic's own stated worst
case: *worse than no backup, because it is believed*.

The same probe against a network destination fails loudly with a usable error.
Hence decision 1: **layer B uses a network endpoint.** The failure mode is a
property of the destination type, so choosing the type is the fix; a guard is
something that has to be remembered.

### 2.2 bd's interval auto-backup cannot target a non-local destination

`bd backup init <path>` accepts a filesystem path or a URL, but it configures
only the **manual** `bd backup sync` path.

Measured: with a destination configured and auto-backup enabled at a 1 s
interval, three writes were made. The interval backup wrote **8 files into the
local `.beads/backup/`** and never touched the configured destination, whose
mtime and file count were unchanged.

The two mechanisms are distinct all the way down. In `repo_state.json` they are
separate Dolt backup entries — `backup_export` (automatic, local) and `default`
(`bd backup init`). shotwright has **no `.beads/dolt-backup.json`**, confirming
`bd backup init` has never run there and its `.beads/backup/` is purely the
automatic local one.

Consequence: **layer B must be driven from outside bd** — hence decision 2.

### 2.3 `bd backup status` cannot be used as the verification surface

With both mechanisms live, `bd backup status` prints:

```
Backup:
  Last backup: <2s ago>          <- automatic, went to the LOCAL directory
Config: enabled=true interval=1s
Dolt Backup:
  Destination: <off-machine>     <- the configured destination
  Last sync:   <55s ago>         <- stale; the interval never advances it
```

The natural reading of "Last backup: 2s ago" under a heading that also names an
off-machine destination is "my off-machine backup is 2 seconds old." It is not.
Two further defects in the same surface:

- **`Database size` is server-wide, not per-database.** It reported an identical
  figure from two different projects; measured against the data directory it
  tracks the whole shared server, while shotwright's own database is an order of
  magnitude smaller.
- **`--global` is ignored.** `bd backup status --global` returned the current
  project's timestamp and commit, not the second database's.

Hence decision 3, and step A4: the plan ships its own checker and does not read
bd's.

### 2.4 The "split-brain remote" is a display defect, not a misconfiguration

`bd dolt remote list` reports `origin`; `bd dolt show` reports `Remotes: (none)`
for the same database. Ground truth is `repo_state.json`, which carries a fully
formed `origin` entry with its fetch specs — matching `remote list`. For
the second database (empty), which genuinely has no remote, both surfaces agree.

So `bd dolt show` simply does not read that field. **Nothing needs resolving
before migrating.** The instruction to resolve it first is discharged: the remote
that pushes today is real and correctly configured.

### 2.5 Incidental findings that change scope

- **The second database (empty) has no remote and no backup destination** — `remotes: {}` and
  `backups: {}`. It has zero copies anywhere, on or off this machine. It is the
  least protected of the three and currently the least visible, because §2.3's
  `--global` defect means its status cannot be read at all.
- **`bd dolt push <name>` silently ignores the positional argument** and pushes
  to `origin`. The named-remote flag is `--remote <name>`. Every command in this
  plan uses `--remote`; a step that omits it will push to the wrong place and
  report success. Same family as ADR 0006.
- **bd enables auto-backup by detecting a git remote** (`enabled=true (auto: git
  remote detected)`). Backup enablement is coupled to unrelated git
  configuration, so it can switch off as a side effect of a change that has
  nothing to do with backups. Step A4's checker must not assume it is on.

## 3. Consequence for ADR 0013

ADR 0013 chose, for layer B, *"`dolt backup` to a NAS filesystem share"*. §2.1
shows that destination type fails silently in exactly the scenario layer B exists
to survive. The reasoning in ADR 0013 was sound on what it knew — it weighed
`file://` against the alternatives on *coverage*, and the failure mode is not a
coverage property.

**ADR 0014 amends ADR 0013's layer B to a network endpoint** and is authored in
this phase, at decision time. Layers A and D, and the three-layer structure, are
unchanged.

## 4. The ordering invariant

> **No step may reduce the number of copies of the board until a later-created
> copy has been proven by restore.**

Today there is exactly one off-machine copy: `refs/dolt/data` in the public-bound
repository. Every step in Part A *increases* redundancy. The single step that
decreases it — deleting the ref — is Part C, and it is gated on a restore that
has actually been performed, not on a sync that was observed to succeed.

`.beads/backup/` does not count as a copy for this purpose: it is on this
workstation (ADR 0013), and §2.1 shows it is also where a silently-failed
off-machine backup lands.

## 5. Step list

Each step is one PR-sized chunk. Steps A1–A6 are `shotwright-2sr.3` (I); Part C
is `shotwright-2sr.4` (V), gated on the restore proof.

### Step A1 — Stand up the NAS Dolt endpoint and prove it accepts both roles

Deploy `dolt sql-server` on the NAS with a `remotesapi` port (container). Create the SQL user and grant the privileges the
Commit RPC requires.

**This step carries the plan's highest-risk unvalidated assumption.** Layer A —
a self-hosted remotesapi as a *Dolt remote* — is documented and well attested.
Layer B — the same endpoint as a *`dolt backup` destination* — is not. What §2.1
established is only that the **client** speaks remotesapi to an `http://` backup
URL: it performed a gRPC dial and reported a transport error. Whether a
self-hosted server **accepts** a backup sync is untested and cannot be tested
without the server.

**Abort criterion.** If the endpoint rejects `bd backup sync`, stop and re-decide
layer B before any further step. Do not fall back to a `file://` share without
returning to the owner — that is the configuration §2.1 disqualified. Options to
weigh at that point: a second dolt sql-server instance dedicated to backups, an
S3/GCS-compatible destination (both are documented dolt backup destinations), or
DoltHub.

Exposure: the remotesapi port stays on the LAN. ADR 0013 records why —
the Commit RPC requires SUPER USER, and a push credential is an admin credential.

- **Rollback:** remove the container. Nothing on the operator's workstation has changed.

### Step A2 — Wire layer A as a named remote, keeping GitHub intact

Add the NAS as a **named** remote alongside `origin`:

```
bd dolt remote add nas http://<nas-host>:<port>/shotwright
bd dolt push --remote nas          # --remote is mandatory, see §2.5
```

`origin` is untouched, so the existing off-machine copy survives this step. After
it, the board has two off-machine copies.

- **Rollback:** `bd dolt remote remove nas`. `origin` unaffected.

### Step A3 — Wire layer B and schedule it

`bd backup init <nas-endpoint-url>`, then a **systemd user timer** running
`bd backup sync` on an interval, with an `OnFailure=` unit that raises the alert
built in step A4.

The timer, not bd's interval, is the mechanism (§2.2). bd's own auto-backup to
`.beads/backup/` is **left enabled and left local**: it costs little and does
cover local database corruption, which the off-machine layers do not distinguish
from a healthy database. It is not a backup in this plan's sense and the runbook
must say so, because §2.3 shows its status line is the one most likely to be
misread as proof the off-machine copy is fresh.

- **Rollback:** `systemctl --user disable --now` the timer; `bd backup remove`.
  Layer A and `origin` unaffected.

### Step A4 — A verification surface that fails when the backup silently does

`scripts/backup-verify.sh`. It must **prove the off-machine copy advanced**, by
reading the destination back, rather than trusting an exit code — §2.1 is a
measured case of exit 0 with nothing written where it was meant to go. It must
not read `bd backup status` (§2.3).

Checks: the destination is reachable as a network endpoint; its head commit
matches the local database's; the last verified sync is within the staleness
threshold. It fails closed — unreachable is a failure, not a skip.

**It ships with a self-test** (`scripts/backup-verify-selftest.sh`) asserting the
checker **fails** when handed the §2.1 scenario. This repo has direct precedent:
the leak gate's silent false negative was caught only because a self-test
asserted the failure case on every verify, and the same shape of defect —
a green check that is not checking — is what this whole step exists to prevent.

- **Rollback:** the scripts are additive; deleting them restores the prior state.

### Step A5 — Layer D: move the off-site copy to a dedicated private repository

Create a **private** repository that holds only Dolt data, repoint bd's `origin`
Dolt remote at it, push, and verify the ref landed.

This is the step that lets Part C delete the ref from the public-bound repository
without losing off-site coverage: the off-site copy moves rather than
disappearing. The NAS is same-site (ADR 0013), so layer D is the only layer that
survives loss of the site, and it must exist *before* the deletion.

Verify with the same `git ls-remote` form the sweep uses (§7), against the new
repository.

- **Rollback:** repoint `origin` back to the previous URL. The old ref has not
  been deleted at this point — that is Part C — so this is fully reversible.

### Step A6 — Prove restore from scratch

Restore into a **scratch location**, from layer B and independently from layer D,
and diff the restored database against the live one. A backup that has never been
restored is not a backup.

The restore must reach a database, not just extract files: check issue counts,
the most recent close reasons, and that dependency edges survive.

Note `bd backup restore` requires an initialized database (`bd init` first) and
`--force` to overwrite. Restore into a scratch project; never at the live one.

- **Rollback:** delete the scratch database. Nothing live is touched.

### Step A7 — Extend to the other two databases

Repeat A2–A6 for the other two databases, shotwright's mechanism now proven.

The second database (empty) needs the most and has the least: no remote and no backup
destination at all (§2.5), so both layer A and layer B are new for it, and §2.3's
`--global` defect means step A4's checker must be able to target it explicitly.

- **Rollback:** per-database, identical to A2/A3.

### Step B1 — Promote the ref-inspection procedure into `scripts/`

`scripts/dolt-ref-inspect.sh <git-remote-url>`, from the five-stage procedure in
`docs/shotwright-2sr.1-research.md` §4.1, with both corrections that R found the
hard way built in and asserted:

- **Report distinct values, not counts.** R's first run reported 255 email hits;
  the distinct set was 2 addresses plus fragments split across chunk boundaries.
- **Anchor the patterns.** `10\.[0-9]` matched a version string; a loose bead-id
  pattern matched UUID fragments. Anchor all four octets; anchor bead ids to
  known prefixes.

Both get a self-test on fixed input, for the same reason as A4: these are checks
whose failure mode is looking like they worked.

- **Rollback:** additive; delete the script.

### Step B2 — Enumerate and sweep

Enumerate **by command**, never from a stored list:

```
gh repo list --json name --limit 200
# then, per repo:
git ls-remote <remote> 'refs/dolt/*' 'refs/heads/*dolt*'
```

Verified this phase: the `ls-remote` form returns
`refs/dolt/data` and `refs/heads/__dolt_remote_info__` for shotwright. R found
nine repositories carrying Dolt refs on 2026-08-01; the sweep re-derives that set
rather than trusting the number, since repositories are created between runs.

Run `dolt-ref-inspect.sh` against every repository that has a ref. Classify per
§7. **Read-only** — the sweep deletes nothing.

- **Rollback:** none needed; no mutation.

### Step B3 — Write the dispositions

One disposition per repository, using the §8 template. shotwright's is already
decided (delete); the other eight are open and are this epic's work.

- **Rollback:** a disposition is a document until Part C actions it.

### Step C1 — Action shotwright's disposition (2sr.4, gated)

**Only after A6 has proven a restore.** Delete `refs/dolt/data` and the
`refs/heads/__dolt_remote_info__` branch from the public-bound repository.

Record in `shotwright-746.18.6`'s evidence pack, at the moment of the flip:

- that deletion removes discoverability but **not** the objects (§6), knowingly
  accepted by the owner;
- the identity set in commit metadata — E9.R's "personal email absent" claim was
  false, and content scanners cannot see commit headers.

- **Rollback:** re-push the ref from layer A, B, or D. This is precisely why C1
  is last, and why the rollback is only real if A6 passed.

## 6. Ref deletion does not erase the objects

Stated plainly because a plan that implies otherwise is wrong:

**Deleting `refs/dolt/data` removes discoverability, not data.** The ref stops
being advertised by `git ls-remote`, so it stops being findable by enumeration.
The underlying objects remain in the repository — GitHub retains unreachable
objects by design and they stay reachable **by SHA** to anyone who has, or can
guess, one. Five such SHAs already exist in push history.

Any step that treats deletion as achieving non-disclosure is wrong. The owner's
acceptance is of *unadvertised*, explicitly not of *erased*, and the alternatives
that would have gone further — a fresh repository that never carried the ref, and
a GitHub Support GC request — were offered and declined.

## 7. Classification criteria

Applied by `dolt-ref-inspect.sh` to the strings extracted from each ref, and
reported as **distinct values** per category:

| Category | What counts | Note |
|---|---|---|
| PII | Names, email addresses, postal addresses, phone numbers | Report the distinct set; a count is not a classification |
| Credentials | Tokens, keys, passwords, connection strings with secrets | Distinguish real credentials from prose *about* credentials — R found 26 of the latter and 0 of the former |
| Host paths | Absolute paths revealing usernames or machine layout | The repo's headed-public invariant |
| Network identifiers | Private-range IPv4, LAN hostnames | Anchor all four octets. The leak gate did **not** catch a forge hostname, so hostnames need explicit treatment |
| Third-party names | People, companies, projects not the owner's | Presence is not automatically disqualifying; context decides |
| Financial / personal content | Amounts, account references, personal circumstances | — |
| Candid internal notes | Prose the owner would not want public | Judgement call; surface it, do not adjudicate it in the script |

Cross-project leakage is checked separately: bead-id prefixes belonging to other
projects appearing in a ref that should hold only one project's board.

## 8. Disposition template

One per repository:

```
Repository:        <name>
Refs present:      refs/dolt/data, refs/heads/__dolt_remote_info__
Ref size:          <bytes> across <n> objects
Visibility today:  private | public
Findings:          <distinct values per §7 category>
Disposition:       keep | delete | migrate
Reason:            <why — tied to findings and to whether the repo may go public>
Gated on:          <restore proof, if the disposition removes a copy>
```

`migrate` means the Dolt data moves to the dedicated private repository from step
A5 and the ref is then deleted from the original.

## 9. Risks and rollback

| # | Risk | Mitigation | Rollback |
|---|---|---|---|
| 1 | Layer B is rejected by a self-hosted remotesapi endpoint | A1 tests it first, before anything else changes | Abort criterion in A1; return to owner |
| 2 | A step pushes to `origin` instead of the NAS via the `--remote` trap (§2.5) | Every command uses `--remote`; A4's checker reads the destination back | Re-push to the correct remote |
| 3 | Backup appears green while writing nowhere useful | The destination type is network, not `file://` (§2.1); A4 verifies by read-back and self-tests the failure case | — |
| 4 | The ref is deleted before a restore is proven | §4 invariant; C1 sits in the V bead, gated on A6 | Re-push from A/B/D — only real if A6 passed |
| 5 | NAS credential is effectively an admin credential | Port stays on LAN (ADR 0013/0014) | Rotate the SQL user; revoke grants |
| 6 | Auto-backup silently disables via the git-remote coupling (§2.5) | A4 asserts the state it expects rather than assuming | Re-enable in config |
| 7 | Restore produces files but not a working database | A6 checks issue counts, close reasons and dependency edges, not file presence | Re-run from another layer |
| 8 | The sweep misses a repository created after the last run | B2 enumerates by command every run; the count is never hardcoded | Re-run the sweep |

## 10. Acceptance mapping

| Acceptance bullet (`shotwright-2sr.2`) | Step |
|---|---|
| Plan doc committed | this document |
| Backup-before-deletion ordering explicit and justified | §4, and C1's gate on A6 |
| Every step has a rollback | §5 per-step, consolidated in §9 |
| Audit sweep enumerates repos by command | B2 |
| Classification criteria written down | §7 |
| Disposition template written down | §8 |
| States plainly that ref deletion does not erase objects | §6 |

## 11. Deterministic pins for load-bearing assumptions

| Assumption | Pin | Step |
|---|---|---|
| A self-hosted remotesapi endpoint accepts a `dolt backup` sync — **the plan's largest unvalidated claim** | A live `bd backup sync` against the endpoint, with an abort criterion if it fails | A1 |
| The off-machine backup is actually advancing | `backup-verify.sh` reads the destination back and compares head commits | A4 |
| The verifier would catch the §2.1 silent failure | `backup-verify-selftest.sh` asserts the checker **fails** on that scenario | A4 |
| The backup is restorable, not merely present | Restore to scratch, diff against live, check counts / close reasons / dependency edges | A6 |
| The inspection script's counts mean something | Self-test on fixed input asserting distinct-value reporting and anchored patterns | B1 |
| The repo set is current | Enumeration by command every run | B2 |

## 12. Self-review

Against the five-lens rubric.

1. **Measured-or-flagged** — *pass.* Every claim in §2 was produced by a command
   run this phase in an isolated project. The one assumption that is *not*
   measured — a self-hosted remotesapi accepting a backup sync — is labelled the
   largest unvalidated claim in A1 and §11, with an abort criterion, rather than
   being carried as settled. What §2.1 does establish about it (client-side dial
   only) is stated narrowly.
2. **Derived-value semantics** — *flag, and it is the phase's main finding.* Two
   bd surfaces report values that do not mean what they appear to: "Last backup"
   describes the local copy while sitting under a heading naming the off-machine
   destination, and "Database size" is server-wide. §2.3 records both; step A4
   exists because of them.
3. **Emergent structure** — *pass.* The relevant emergent property is that an
   unmounted share is indistinguishable from an empty directory, which is what
   makes §2.1 silent. That is a property of the filesystem/mount model, not of
   Dolt, and it is why the fix is the destination *type* rather than a guard.
4. **Batch/concurrency** — *flag.* The systemd timer and bd's own interval
   backup can run concurrently against the same database, and DoltHub documents
   that concurrent writes to a remotesapi server can race. Neither the
   interaction nor its failure reporting is verified. A3 keeps the two
   mechanisms pointed at different destinations, which bounds it but does not
   test it; A4's read-back is the detection path. **Carried to `2sr.3` as a
   thing to observe, not a thing this plan has settled.**
5. **Inherited-constraints-grounded** — *flag, and it caught the main defect.*
   Re-checking ADR 0013's layer B against real behaviour found the chosen
   destination type silently failing (§3), which is why ADR 0014 exists. The
   epic's instruction to resolve the "split-brain remote" before migrating was
   also checked rather than accepted, and dissolved (§2.4).

**Not established by this document:** that the NAS endpoint accepts backup syncs
(A1); that timer-driven and bd-driven backups do not interfere (lens 4); the
contents or dispositions of the eight non-shotwright refs (B2/B3).
