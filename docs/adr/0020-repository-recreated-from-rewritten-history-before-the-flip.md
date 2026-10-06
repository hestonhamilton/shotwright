# ADR 0020 — The repository is recreated from rewritten history before the flip

- **Status:** accepted; amended 2026-10-05 (see *Amendment* below)
- **Date:** 2026-10-05
- **Bead:** `shotwright-746.18.6.1`; amendment `shotwright-746.18.31`
- **Phase the decision landed in:** I

## Context

Making the repository public exposes every commit, not just the tree at
`main`. The tree was scrubbed on 2026-10-05 (`shotwright-746.18.24`, PR #66):
other private projects named only by role, an audit's per-repository findings
reduced to aggregates, an ADR's endpoint details removed, provenance narration
made neutral. That scrub changed `main` and nothing else.

A measurement the same day established what history still holds (recorded
outside the repo, since the record itself names the strings): the scrubbed
class of strings appears in 102 of 164 commits and in three commit messages,
so rewriting only the worst files would not be enough. A full
`git filter-repo` rewrite, rehearsed on a scratch mirror with a replacements
file that never enters the repo, removed every match from every blob and
message while leaving the `main` tree hash and the commit count unchanged.

The rehearsal also established the fact that forced the decision. GitHub keeps
every pull request's head commit reachable under `refs/pull/N/head`. This
repository has 67 such refs. They are fetchable by anyone from a public
repository, and a force push of rewritten history does not touch them. So the
obvious sequence, rewrite then flip, would leave each old commit one `git
fetch` away for anyone who read a pull request number.

## Decision

The rewritten history is pushed to a **new** repository that takes the
`hestonhamilton/shotwright` name. The current repository is renamed to a
private archive name first, stays private, and is deleted once the new one is
verified. Only `main` is carried over; no other ref, stash, or remote-tracking
branch from the old repository is pushed. The flip happens on the new
repository.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| Recreate from rewritten history (chosen) | Old objects are unreachable from the public repository by construction; no dependency on a third party's queue; same repository name, so package metadata and the trusted-publisher binding are unaffected | The GitHub pull request and issue trail is lost; every clone, worktree and the forge mirror must be re-created; Dependabot re-opens its PRs | — |
| Force push the rewrite in place, ask GitHub Support to purge | Keeps the PR trail | Old commits stay fetchable through `refs/pull/*` until Support acts; the repo must stay private until they confirm, on their timeline | A control that depends on someone else's queue is not one this project can verify |
| Rewrite only the three worst files | Fewer commits renumbered | Measured insufficient: the same strings live in nine other files and in commit messages | Does not remove what it set out to remove |
| Squash to a single fresh commit | Simplest possible history | Throws away the real development record, which the ADRs and R/P/I/V docs cite by commit | The rewrite keeps that record; squashing would not |
| Flip with history as is | No disruption | Publishes a list of other private repositories with their findings, and an endpoint's authentication state, in readable history | The scrub's purpose was to not publish exactly that |

## Consequences

- **Easy (as amended):** the public repository's history begins at a single
  commit whose tree is the scrubbed tree. Nothing from before it exists as an
  object. This is checkable: the superseded root and head commits' hashes are
  known, and a clone of the public repository must contain none of them.
  `scripts/flip-evidence.sh` carries that check so the evidence pack can state
  it rather than assume it. *The original wording of this bullet claimed that
  the rewritten history "contains nothing the scrub removed"; that was false,
  see the amendment.*
- **Cost accepted:** pull request numbers cited anywhere in beads, ADRs and
  verification docs refer to private history and will not resolve on the
  public repository. Commit hashes cited in docs likewise. Beads live on Dolt and are unaffected. The forge
  mirror is re-created from the new history rather than force-updated, for the
  same reason the GitHub repository is.
- **Hazard that future work must not silently undo:** any clone, worktree or
  mirror taken before the recreation carries the old history. Pushing from one
  of them reintroduces every removed object. All such copies are re-cloned, the
  archive repository is deleted after verification, and the flip-evidence check
  above is what catches a stale copy that was missed.
- Dependabot's version updates, the Actions workflows and the in-repo
  configuration all travel with the tree. Repository settings that do not
  (description, merge options, issues enabled, Dependabot alerts at the flip)
  are re-applied by hand and recorded on the bead.

## Reversal

None; this ADR amends nothing. History was rewritten once before, on
2026-07-29, for author identity. The tone read of 2026-10-05 is what showed a
second rewrite was needed, and this ADR records that cause so the decision is
not re-litigated when the pull request numbers in older docs stop resolving.

## Amendment — 2026-10-05, same day

The first recreation (bead `shotwright-746.18.6.1`) rewrote history with
`git filter-repo --replace-text`: a list of strings was replaced in every blob
and message, the HEAD tree was verified unchanged, and the result was pushed
as the only ref of a new repository. A four-part read-only audit run the same
evening (reports kept outside the repository, under `local/`) found that this
was not what the decision above needed. The scrub commit had rewritten whole
passages by hand, and every *earlier version* of those files was still
reachable with only the listed strings swapped out: the pre-scrub description
of the backup endpoint, the per-repository audit table, a delegated-agent
skill that named two accounts, and the scrub commit's own message describing
what it removed. Replacing strings cannot remove prose. The audit also found
the workstation's own LAN address committed as a test fixture and adjudicated
as invented, and a personal e-mail address as the author of most commits.

**Decision as amended:** after the audit's tree fixes merge, `main` is
replaced by **one commit** whose tree is the fixed tree, authored and
committed under the owner's GitHub noreply identity, and the repository is
recreated again exactly as above. No targeted second pass: only a history
with no pre-flip blobs at all can be shown to contain none of the removed
prose. The previous development history stays in the private archive
repositories.

**What the check now proves:** the public clone contains none of the
superseded root or head commits (original root, first-rewrite root, first
recreation's heads), and every commit author and committer in it is a
GitHub noreply identity. The local clone used for the flip must set
`user.email` to the noreply address so later commits do not regress this;
the check fails on any that do.

**Lesson recorded:** verifying a rewrite by grepping for the replacement
list only proves the list was applied. The question the decision asks is
"what can a reader reach", and that is answered by enumerating reachable
content, not by searching for known strings.
