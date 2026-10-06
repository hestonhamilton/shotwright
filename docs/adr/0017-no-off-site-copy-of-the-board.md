# ADR 0017 — There is no off-site copy of the board

- **Status:** accepted
- **Date:** 2026-08-02
- **Bead:** `shotwright-2sr.3`
- **Phase the decision landed in:** I
- **Supersedes:** ADR 0013, layer D only

## Context

ADR 0013 specified four layers. Layer D was an off-site copy, and it was the
reason the GitHub `refs/dolt/data` ref was to be *moved* to a dedicated private
repository rather than simply deleted: layers A–C are all in one place and die
together in a fire, flood or theft.

Layer D was never built. With layers A–C now working and proven by restore
(ADR 0016), the remaining question was whether to build it before deleting the
GitHub ref. The owner decided not to: an off-site copy is not wanted.

ADR 0013's own consequences list "retiring layer D on the grounds that the NAS
is sufficient" among the things future work must not **silently** undo. This ADR
is that clause being discharged rather than violated — the retirement is a
deliberate, recorded decision, not a step that quietly went missing.

## Decision

The board is backed up to the NAS and nowhere else. No off-site copy is
maintained, and `refs/dolt/data` on GitHub is deleted rather than relocated.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| No off-site copy (chosen) | Nothing further to build, run or pay for; unblocks the flip immediately | Site loss is total loss of the board | — |
| Dedicated private GitHub repo (ADR 0013's layer D) | Survives site loss; ~7 MB; mechanism already proven | Another repository and another push path to keep working | Owner decision: not wanted |
| Keep the ref where it is | No work | Blocks the public flip, which is the point of the epic | Disposition already decided (ADR 0011 chain) |

## Consequences

- **What is protected:** loss, corruption or theft of the workstation; local
  database corruption; accidental destruction of the board through bd itself.
  The NAS copy is proven restorable, and every push proves it again.
- **What is not:** anything that takes out the site. The repository, its code
  and its docs are unaffected; they are on GitHub. It is the *board* that is
  single-site, and that is accepted deliberately.
- **`shotwright-2sr.4` is unblocked.** Deleting `refs/dolt/data` is now gated on
  the restore proof alone, which is done. It is no longer gated on a replacement
  off-site copy existing first, because there will not be one.
- **The ordering invariant still holds and still matters.** Plan §4 says no step
  may reduce the number of copies until a later copy has been proven by restore.
  That proof exists (ADR 0016), so the deletion is legitimate. What changes is
  the count it leaves behind: one, not two.
- **Future work must not silently undo:** deleting the NAS copy, or letting the
  timer fail unnoticed. `scripts/backup-verify.sh` failing closed matters
  correspondingly more with no off-site layer behind it.

## Reversal

Cheap, if it is ever wanted. Layer D was one private repository and one push
path; `scripts/backup-push.sh` already produces a proven Dolt backup that a
second destination could consume. Nothing in this decision forecloses it.
