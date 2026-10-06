# ADR 0016 — The off-machine backup is rsync-over-ssh of a copy proven by restore

- **Status:** accepted (amends ADR 0014, corrects ADR 0013's layer C)
- **Date:** 2026-08-02
- **Bead:** `shotwright-2sr.3`
- **Phase the decision landed in:** I

## Context

Two things forced this, one a decision and one a measurement.

**The decision.** ADR 0014 specified a Dolt `remotesapi` endpoint on the NAS as
the layer B destination, and step A1 stood one up and proved it works. The owner
then replaced it: the operator's workstation already has ssh to the NAS and bd already
knows how to write a Dolt backup, so a database server exists only to be a file
receiver. A component with no job is a component that can break.

**The measurement.** The first restore drill from the new destination — the step
the plan called "the one that gets skipped" — restored **0 issues and 8 commits**
while the live database held 68 issues and 368 commits. The source being copied,
`.beads/backup/`, was not shotwright's board. It was a second database on
the same server, which is empty.

The mechanism is exact and is bd behaviour, filed as `shotwright-2sr.5`, not a
misconfiguration by this project. In `repo_state.json`, the second database's automatic backup destination is:

    file://<repo>/.beads/backup

That is *shotwright's* backup directory. Two databases share one destination,
the later writer wins, and `bd backup status` reports a fresh backup to whoever
asks. A third database on the server is unaffected: nothing else points at its
directory, and its automatic backup restores correctly.

So before this bead the board had **one** copy in total — `refs/dolt/data` on
GitHub — not "one off-machine plus a local one". Plan §2.2 states the local
backup "does cover local database corruption". It covered nothing.

## Decision

Layer B is `rsync -e ssh` of a Dolt backup that has been **restored and counted
before it is sent**, driven by a systemd user timer.

The copy is produced by bd's *manual* path (`bd backup init <staging>` then
`bd backup sync`) into a staging directory outside the repository.
`.beads/backup/` is not read by anything here.

Every push clones the staged copy into a throwaway database and compares issue,
dependency and commit counts against the live database. A copy that restores
empty, restores behind, or fails to clone is not sent, and the run fails.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| rsync-over-ssh of a proven copy (chosen) | No new service; uses access that already exists; failure is loud because ssh exits non-zero | Content proof costs a few seconds per run | — |
| Dolt `remotesapi` endpoint (ADR 0014) | Proven working in step A1; native Dolt path | A whole database server whose only job is receiving files; its own auth story (ADR 0015) | Owner decision: not worth the component |
| Keep `.beads/backup/` as the source | Zero work | **Measured empty.** Every size, count and freshness check passes on it | It is the failure |
| Trust `bd backup sync`'s exit code | Simplest | §2.1 measured exit 0 in 18 ms writing to the wrong place; 2026-08-02 measured a complete-looking backup of nothing | Exit codes are not evidence here |

## Consequences

- **ADR 0014's reasoning survives; its choice does not.** §2.1's silent failure
  needs a local path that can be conjured — an unmounted mountpoint that dolt
  recreates and writes into. `rsync -e ssh` has no such path: if the host is
  down, ssh exits non-zero and nothing is written anywhere. The property ADR
  0014 was buying is preserved without the server.
- **ADR 0013's layer C is corrected, not merely amended.** The local backup it
  describes did not exist for this database. Anything downstream that counted it
  as a copy was counting wrong.
- **File presence, byte size, archive count and freshness are all disqualified
  as evidence.** The empty backup was 7.5 MB across 76 archive files with a
  state file updating every 15 minutes. Only reading the content catches it,
  which is why the proof runs on every push rather than at drill time.
- **bd's `backup_state.json` is not a verification surface.** It named the live
  head on one push and the empty database's own commit on the next.
  `scripts/backup-push.sh` writes its own state file recording what it verified.
- **The second database still points its automatic backup at shotwright's directory.**
  Harmless now that nothing reads that directory, and it is empty in any case,
  but it is un-fixed and belongs upstream. Filed as `shotwright-2sr.5`.
- **The copy is not off-site.** Once `refs/dolt/data` is deleted from GitHub
  there is no off-site copy. ADR 0013's layer D was the answer to that; the owner
  dropped it the same day — **ADR 0017**. So the copy this ADR describes is not
  one layer of several, and the verification here carries correspondingly more
  weight.
