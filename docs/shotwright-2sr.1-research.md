# shotwright-2sr.1 — R: Dolt self-hosting, and reading a `refs/dolt/data` ref

Research date: 2026-08-02. Ecosystem claims were web-checked on 2026-08-02 and
carry source links. Local claims were measured locally and are
marked **Measured**. Research only — no configuration was changed, no ref was
deleted, nothing was pushed to any new destination.

Prior art: `docs/shotwright-746.18.1-research.md` §3.7. This document confirms
most of it, corrects one claim, and supplies the two things it left open.

## Headline findings

1. **The self-hosted forge is co-located with the data it would back up.** It
   therefore cannot be the off-machine backup, and one of the three hosting
   candidates in the bead is disqualified before any research. **For all repo
   content, not just beads, GitHub is currently the only genuinely off-machine
   copy.**
2. **A backup already exists, runs automatically, and protects against nothing.**
   `.beads/backup/` holds 6.5 MB of `.darc` archives, gitignored, refreshed on
   bd's default ~15-minute interval, on the same machine. Against the stated
   threat (loss of this machine) it is worth zero. Redirecting it is the smallest
   change that produces a real backup.
3. **Remotes and backups are not the same thing in Dolt, and the difference is
   load-bearing here.** A remote captures the current commit of a branch. A
   backup captures the entire database *including uncommitted working-set changes
   on all branches*. Beads carries live working state; a remote-only design
   silently drops it.
4. **The remotesapi Commit RPC requires SUPER USER, and DoltHub says so plainly:**
   *"this operation is not safe from malicious use."* That constrains where the
   port may be exposed.
5. **The board content is as E9.R described — but E9.R's *history* claim is
   wrong.** Personal email is not absent; it is in commit metadata, where a
   content scanner cannot see it. See §4.4.

---

## 1. The constraint that decides the design

**Measured 2026-08-02:**

- The forge is co-located with the data it would back up.
- The shared Dolt sql-server also serves other projects.
- `bd dolt remote list` reports one remote, a `git+ssh://` GitHub URL — Dolt's
  Git-remote support, which is how `refs/dolt/data` reaches GitHub at all.
- **`bd dolt show` reports `Remotes: (none)` for the same database.** The two
  surfaces disagree. bd's own documentation describes a "split-brain remote
  configuration" failure mode where SQL-level and CLI-level remotes diverge; this
  looks like it, and it should be resolved before any migration rather than
  during one. Recorded as an open question (§5).

Owner decisions taken during this phase: the backup target is a **NAS**,
and the design is **layered** — a primary off-machine copy independent of GitHub,
with GitHub retained as a secondary.

## 2. Hosting options

| Option | Survives workstation loss? | Independent of GitHub? | Verdict |
|---|---|---|---|
| **A. NAS `dolt sql-server` + remotesapi** | Yes | Yes | **Recommended primary** |
| **B. NAS filesystem share as a `dolt backup` destination** | Yes | Yes | **Recommended alongside A** — captures what A cannot |
| C. Self-hosted forge as a plain Dolt remote | **No** | Yes | **Disqualified** — it is this machine (§1) |
| D. Dedicated private GitHub repo for dolt data only | Yes | No | **Recommended as the secondary layer** |
| E. DoltLab | Yes | Yes | Rejected — a self-hosted DoltHub is heavy infrastructure for one operator |

### 2.1 Why A and B together, not either alone

This is the finding most likely to be got wrong, because both are called
"backup" in casual use.

[Dolt's backup documentation](https://www.dolthub.com/docs/sql-reference/server/backups)
is explicit: *"using remotes for backups only backs up to the current commit of a
branch, not the working set or other branches"*, whereas a backup captures *"the
entire state of the database, including uncommitted changes on all branches"*.

bd's own `config.yaml` draws the same line in its comments — *"Dolt-native backup
(periodic backup for off-machine recovery). This is full database backup only.
Cross-machine sync uses Dolt remotes."*

So: **A is how the board syncs. B is how the board survives.** A design with only
A loses uncommitted working state, which for a live issue tracker is exactly the
state most likely to be irreplaceable.

### 2.2 Option A mechanics

Server side (NAS, Docker):

```
dolt sql-server --remotesapi-port <port>
```

or the equivalent `remotesapi: port: <port>` stanza in the server config
([Dolt configuration docs](https://www.dolthub.com/docs/sql-reference/server/configuration/)).
The remotesapi listens on the same address as the SQL server.

Client side:

```
bd dolt remote add nas http://<nas-host>:<port>/shotwright
DOLT_REMOTE_PASSWORD=... bd dolt push nas
```

Auth is **SQL users, not `dolt creds`** — `--user` plus the
`DOLT_REMOTE_PASSWORD` environment variable
([Dolt SQL Server push support](https://www.dolthub.com/blog/2023-12-29-sql-server-push-support/)).

**Two caveats that constrain deployment, both from DoltHub's own writeup:**

- The Commit RPC **requires SUPER USER** on the target server —
  `GRANT ALL PRIVILEGES ON <db>.* TO ... WITH GRANT OPTION`. Anything that can
  push can also do anything else to that server.
- *"this operation is not safe from malicious use"*, and concurrent writes can
  race.

Consequence: **do not expose the remotesapi port beyond the LAN.** A
push credential here is effectively an admin credential. This is acceptable for a
single-operator LAN and would not be acceptable on a public interface.

### 2.3 Option B mechanics

```
dolt backup add nas file:///<mounted-nas-path>/dolt-backup
dolt backup sync nas
```

and, from SQL, `call dolt_backup('sync', 'nas')`. Restore is a first-class
command:

```
dolt backup restore file:///<mounted-nas-path>/dolt-backup <restored-name>
```

Destinations may be `file://`, S3, or GCS. Option B needs the NAS mounted
(NFS or SMB), which is a dependency Option A does not
have. That is a point in favour of running both: they fail differently.

### 2.4 What happens when the NAS is unreachable mid-push

The bead asks this explicitly and it is the question that decides whether the
design is trustworthy in practice.

A Dolt push is not atomic across the network in a way that guarantees the
destination is left consistent under arbitrary interruption, and bd's auto-backup
runs unattended on an interval. The design requirement that follows is not
technical but operational: **a failed push must be loud.** A backup that fails
silently for six weeks is indistinguishable from no backup, and is worse, because
it is believed.

This is unverified as written and must be settled by experiment in the I phase —
see §5.

## 3. Recommendation

**Run A and B to the NAS, keep D as the off-site layer, retire nothing until a
restore has been proven.**

1. **A — NAS `dolt sql-server` with remotesapi**, as the Dolt remote for all
   every database on the shared server, not shotwright alone. The NAS becomes
   the "centralized, shared local dolt server."
2. **B — `dolt backup` to a NAS filesystem share**, for full-state capture
   including working sets.
3. **D — a dedicated private GitHub repo holding only dolt data**, as the
   off-site layer. This is what covers the gap A and B share: **the NAS is
   same-site.** Fire, flood, theft, or a power event takes it and this
   workstation together. Keeping a GitHub layer is not vestigial; it is the only
   thing in the design that is off-site.
4. **Only then** delete `refs/dolt/data` from the shotwright repo, per the
   owner's disposition decision.

Ordering is not negotiable: GitHub's ref is currently the only off-machine copy
of the board (§1), so step 4 before steps 1–3 destroys it.

## 4. Reading a `refs/dolt/data` ref without a database

### 4.1 The procedure

Five stages. Developed and **run end to end on 2026-08-02 against the live
shotwright ref on GitHub**; the classifier below is the corrected version.

1. **Advertise check** — `git ls-remote <remote> 'refs/dolt/*' 'refs/heads/*dolt*'`.
   Confirms whether anything is discoverable at all.
2. **Fetch into a bare repo** — `git fetch <remote> '+refs/dolt/data:refs/dolt/data'`.
   No database, no `dolt` binary.
3. **Enumerate** — `git ls-tree -r -l refs/dolt/data`, with a size and extension
   breakdown.
4. **Extract** — `git cat-file blob <sha> | strings -n 6` over every blob.
5. **Classify** — counts per category, *plus* a distinct-value listing for the
   categories where the count alone is meaningless.

Stage 5 is the part that distinguishes this from a grep, and it is also where
the first draft was wrong twice. Both corrections are worth carrying:

- **A count without the distinct values is not a classification.** The first run
  reported 255 email hits; the distinct set was 2 real addresses plus `strings`
  fragments split across chunk boundaries. Report distinct values.
- **Loose patterns manufacture findings.** A private-IP pattern of
  `10\.[0-9]` matched `pnpm@10.33.0`; a bead-id pattern of
  `[a-z][a-z0-9]{2,}-[0-9a-z]{2,}` matched UUID fragments and reported them as
  foreign project prefixes. Anchor all four octets; anchor bead ids to known
  prefixes.

### 4.2 Results on the shotwright ref

**Measured 2026-08-02**, ~5 MB of `.darc` chunk archives, 113,657 extracted
strings:

| Category | Result |
|---|---|
| Host paths | **0** — confirms E9.R |
| Private-range IPv4 | **0** after anchoring (the single hit was a version string) |
| Actual credentials | **0** |
| Credential-*shaped* strings | 26, all prose *about* tokens and secrets, plus one schema column name — confirms E9.R substantively |
| Distinct email addresses | 2 (see §4.4) |
| `shotwright-*` bead ids | 73 distinct |
| Other projects' bead ids (three sibling consumers and another sibling project) | **0 each** — confirms E9.R's no-cross-project-leak claim |

So the board is one project's issue tracker in plaintext, as E9.R described. The
owner's disposition decision — delete the ref, accept "unadvertised" as
sufficient — is unaffected by anything found here.

### 4.3 Generalising it

The procedure takes a git remote URL as its only argument, so running it across
every repo carrying a dolt ref is a loop, not a rewrite. That is `2sr.3`'s sweep.
Promoting the script from scratch into `scripts/` is P/I work, deliberately not
done in this phase.

### 4.4 The one E9.R claim that does not hold

E9.R §3.6 states: *"Personal email: absent. The only address-shaped strings in
history are the `git@ssh.github.com` transport URL."*

**Measured:** `git log --all --format='%ae%n%ce' | sort -u` returns four distinct
identities, two of them personal addresses, on commits throughout this repo's
history. They appear in **no tracked file content**, which is precisely why the
E9.R scan missed them.

**The general lesson, which outlives this instance:** `gitleaks git` and every
other content scanner read blobs. Author and committer identity live in commit
headers. Reporting "history is clean" on the strength of a content scan is
reporting on the wrong surface.

Recorded against `shotwright-746.18.6`, whose evidence pack must now cover commit
metadata explicitly. The owner accepted these addresses as public on 2026-08-02;
the requirement is that the acceptance is stated, not that anything is changed.
Rewriting history was considered and rejected — it would change every commit SHA,
including the five `refs/dolt/data` SHAs already in push history, and would
invalidate the clean-history evidence base.

## 5. Open questions for `2sr.2`

1. **The split-brain remote.** `bd dolt remote list` and `bd dolt show` disagree
   about whether a remote is configured (§1). Resolve before migrating, not
   during.
2. **Failure behaviour on an unreachable NAS** (§2.4). Empirically decidable:
   push with the NAS down, inspect exit status and whether bd surfaces it. The
   requirement is a loud failure; the mechanism is unknown.
3. **Does bd's auto-backup accept a non-local destination directly**, or does it
   need a mounted path? Its config exposes `backup.git-repo` and `backup.enabled`
   but the destination path is not obviously configurable. If it is not, Option B
   runs as a scheduled `dolt backup sync` outside bd.
4. **One database or three?** The shared server hosts a second
   database (empty), `shotwright`, and a sibling project's. Backing up only shotwright leaves two unprotected;
   the owner's framing ("centralized, shared local dolt server") implies all
   three, which makes this bigger than shotwright's epic.
5. **Restore proof.** `dolt backup restore` exists and is documented, but a
   backup that has never been restored is not a backup. `2sr.4` must restore to a
   scratch location and diff against the live database — not merely observe a
   successful sync.

## 6. Self-review

Run against the five-lens rubric. Flags are recorded rather than hidden.

1. **Measured-or-flagged** — *pass.* Every local claim is marked **Measured**
   and was produced by a command run during this phase. The one unbacked
   assertion, §2.4's failure behaviour on an unreachable NAS, is labelled
   unverified in place and carried to §5 rather than stated as fact.
2. **Derived-value semantics** — *flag, then corrected.* The classifier's counts
   are meaningless without distinct values: 255 email "hits" were 2 real
   addresses plus fragments. Recorded in §4.1 as a property of the method, not a
   one-off slip, because the same trap applies to every category it reports.
3. **Emergent structure** — *pass, and it mattered.* `.darc` chunk archives split
   strings across chunk boundaries, so `strings` yields truncated fragments that
   look like distinct values. That is an emergent property of the storage format,
   not of the data, and it is why §4.1 insists on distinct-value listing.
4. **Batch/concurrency** — *flag.* bd's auto-backup runs unattended on an
   interval, and DoltHub documents that concurrent writes to a remotesapi server
   can race. Neither the interaction nor the failure-reporting path is verified.
   §2.4 states the requirement (loud failure) and §5.2 assigns the experiment.
5. **Inherited-constraints-grounded** — *flag, and it caught something.*
   Re-checking E9.R against the real repo found its "personal email absent" claim
   false (§4.4), because it scanned file contents while the addresses live in
   commit headers. Its board claims were all confirmed. This lens is the reason
   the flip evidence pack changed.

**Not established by this document:** that a push to the NAS fails loudly; that
bd's auto-backup can target a non-local destination at all; whether the
split-brain remote in §1 is a real misconfiguration or two views of one setting.
All three are assigned to `2sr.2` rather than guessed at here.

## Sources

- [Dolt — Backups](https://www.dolthub.com/docs/sql-reference/server/backups)
- [Dolt — Using remotes](https://docs.dolthub.com/sql-reference/version-control/remotes)
- [Dolt — Remotes concepts](https://docs.dolthub.com/concepts/dolt/git/remotes)
- [Dolt — SQL server configuration](https://www.dolthub.com/docs/sql-reference/server/configuration/)
- [DoltHub blog — Dolt SQL Server push support (2023-12-29)](https://www.dolthub.com/blog/2023-12-29-sql-server-push-support/)
- [DoltHub blog — Announcing Git remote support in Dolt (2026-02-13)](https://www.dolthub.com/blog/2026-02-13-announcing-git-remote-support-in-dolt/)
- [dolthub/dolt-sql-server Docker image](https://hub.docker.com/r/dolthub/dolt-sql-server)
- [beads — Dolt remote federation](https://github.com/gastownhall/beads)
