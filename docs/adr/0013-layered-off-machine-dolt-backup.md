# ADR 0013 — Layered off-machine backup for the bd board

- **Status:** accepted
- **Date:** 2026-08-02
- **Bead:** `shotwright-2sr.1`
- **Phase the decision landed in:** R

## Context

`bd dolt push` writes the entire beads database to GitHub as `refs/dolt/data`, a
ref `git ls-remote` advertises. ADR 0011 commits this repository to going public,
and the owner decided (2026-08-01) that the ref is deleted before the flip.

That created a deadlock the epic `shotwright-2sr` exists to break: **the ref
cannot be deleted, because it is the only off-machine copy of the board.**

`shotwright-2sr.1` measured two facts that decide the shape of the replacement,
both recorded in `docs/shotwright-2sr.1-research.md`:

1. **The self-hosted forge is co-located with the data it would back up.** It
   cannot be the off-machine backup. For all repo content, GitHub is currently
   the only genuinely off-machine copy.
2. **A backup already exists and protects against nothing.** `.beads/backup/`
   holds `.darc` archives refreshed on bd's ~15-minute default, on the same
   machine. Against loss of this machine it is worth zero, and it is
   more dangerous than having none, because it is believed.

## Decision

Three layers, to a NAS and to GitHub. All three, because each covers a
failure the others do not.

- **A — Dolt remote.** A `dolt sql-server` on the NAS with a `remotesapi` port,
  used as the Dolt remote. This is how the board *syncs*.
- **B — Dolt backup.** `dolt backup` to a NAS filesystem share. This is how the
  board *survives*.
- **D — off-site copy.** A dedicated private GitHub repository holding only dolt
  data. This is the only layer that is off-site.

Scope: **every database on the shared server**, **with shotwright proven first** — mechanism established
end to end including a restore, then extended.

No ref is deleted anywhere until a restore has been proven, not merely a
successful sync observed.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **A + B + D (chosen)** | Covers machine loss, working-set loss, and site loss independently | Three mechanisms to operate | — |
| A alone (remote only) | Simplest | **Captures only the current commit of a branch** | Dolt's docs are explicit that remotes do not capture the working set or other branches. A live issue tracker's uncommitted state is exactly what is least reproducible. |
| B alone (backup only) | Captures full state | Requires the NAS mounted; no sync path | Backup and sync are different jobs; losing sync means losing multi-machine use. |
| Self-hosted forge as a Dolt remote | Already exists, already trusted | **It is co-located with the data it would back up** | Disqualified by measurement, not by argument. |
| DoltLab | Full self-hosted DoltHub | Heavy infrastructure | Disproportionate for one operator. |
| NAS only, no GitHub layer | Fully GitHub-independent | **Nothing is off-site** | One fire, flood, or theft takes both copies together. |
| Keep `refs/dolt/data` as-is | No work | Blocks the public flip | The disposition is already decided (ADR 0011 chain). |

## Consequences

- **Makes easy:** deleting `refs/dolt/data` safely, which unblocks
  `shotwright-746.18.6` and therefore the first publish. Also gives the other two
  databases a real backup, which they do not have today.
- **Makes hard, accepted as cost:** three mechanisms rather than one, and the
  NAS becomes infrastructure that must stay running.
- **Accepted knowingly — the remotesapi is privileged.** Dolt requires SUPER USER
  on the target server for the Commit RPC, and DoltHub states that *"this
  operation is not safe from malicious use."* A push credential is effectively an
  admin credential. **The remotesapi port must not be exposed beyond the local
  network.** This is acceptable for a single-operator LAN and would not
  be acceptable on a public interface.
- **Accepted knowingly — the NAS is same-site.** Layer D is what covers that, and
  is the reason the GitHub layer is retained rather than retired once the NAS
  works.
- **Future work must not silently undo:** collapsing A and B into "the backup"
  (they capture different things); exposing the remotesapi beyond the local
  network; deleting any dolt ref before a restore has been *performed*; or
  retiring layer D on the grounds that the NAS is sufficient.

## Reversal

Supersedes nothing. It does correct an assumption carried in the `shotwright-2sr`
epic description, which listed "the existing self-hosted forge as a plain dolt
remote" as a candidate. That option was never viable: the forge is co-located
with the data it would be backing up.
