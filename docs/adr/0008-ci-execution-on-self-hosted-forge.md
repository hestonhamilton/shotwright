# ADR 0008 — CI execution moves to a self-hosted forge; GitHub stays canonical and CI stays advisory

- **Status:** accepted
- **Date:** 2026-07-31
- **Bead:** `shotwright-746.14`
- **Phase the decision landed in:** I

> **Update, 2026-08-01 — the outage ended before this landed.** GitHub Actions
> became available again partway through implementation, and runs went
> green again on the same branch. The decision below is **unchanged** rather
> than abandoned: the forge is a standby second opinion, the outage can recur,
> and a standby nobody exercises is one that has rotted by the time it is
> needed. Only the framing "while Actions is blocked" is obsolete — forge CI was
> always specified as advisory, and still is.

## Context

GitHub Actions was unavailable on the account at the time
(`shotwright-746.13`): every run fails in ~2s without starting, so shotwright has
had no CI signal at all, and neither has any consumer of E7's reusable workflow.
The block is account state, not a repo defect — no code change fixes it, and it
can recur.

A self-hosted Forgejo instance with an Actions runner already exists on the same
host and already runs CI for other projects. A sibling project hit the same wall a
day earlier and resolved it by moving CI execution to that instance while GitHub
stayed canonical; the operator arrangement, credentials and failure modes are
therefore already known rather than being derived here.

Three constraints shape the port:

- **The repo is private, headed public.** The forge hostname, LAN addresses and
  host paths must not enter committed files, so a status reader cannot hard-code
  the forge URL and the operator detail belongs in gitignored `local/`.
- **`.github/workflows/shotwright.yml` is consumer-facing API** (ADR 0007): a
  `workflow_call` reusable workflow that same-owner consumers pin at `@main`.
  Forgejo has no equivalent — and does not need one, because the callers are on
  GitHub.
- **Forgejo ignores `.github/workflows` entirely** once `.forgejo/workflows`
  exists. The choice of provider directory is binary, not additive.

## Decision

**CI execution runs on the forge. GitHub remains canonical for code, PRs, review
and `gh` tooling, and forge CI is advisory: no merge rule changes.**

1. `.forgejo/workflows/ci.yml` is a thin provider-native wrapper — bare `push`
   trigger, since no `pull_request` event can fire on a forge whose PRs live on
   GitHub — over shared lane scripts.
2. `scripts/ci/verify.sh` and `scripts/ci/shots.sh` are the single definition of
   what each lane runs. GitHub's reusable workflow calls `shots.sh` for **self**
   mode; consumer mode stays inline, because a consumer's checkout has no
   `scripts/ci`.
3. The forge lane inventory is `verify` + `shots`. `verify` (typecheck, lint,
   unit tests) is new: it is the verification command CLAUDE.md already
   documents, which until now nothing enforced.
4. `scripts/forge-ci-status.sh` reads all-green for a given SHA and **fails
   closed** — zero runs, an in-flight run, a `skipped` job, a stale run or a
   missing lane all exit non-zero. It is a tool, not a gate: nothing in CLAUDE.md
   requires it before a merge. That is a deliberate owner decision, and it is the
   one place this ADR diverges from the sibling project's arrangement.
5. Propagation is a second push URL on `origin`, so one `git push` reaches both
   remotes. It is a per-clone convenience, never a guarantee — the guarantee, if
   one is ever wanted, has to live in the status reader.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **A (chosen): forge wrapper + shared lane scripts, GitHub canonical, advisory** | Restores CI within the outage; lane definitions exist once; reversible by deleting one directory; no change to the PR/review workflow or to consumer-facing API | Two wrapper files; a forge most contributors would find surprising | — |
| B: wait for Actions minutes to return | Zero work; the real fix for `746.13` | Unknown timing, recurs by construction, and every commit in the window merges with no signal | Accepted as a fact, rejected as a plan |
| C: port the reusable workflow to Forgejo via `workflow_call` | One workflow shape everywhere | `workflow_call` is unproven on this instance, and every caller is on GitHub, so it would buy nothing | Cost with no consumer |
| D: copy the workflow's steps into `.forgejo/` verbatim | No refactor of the consumer-facing workflow | Two copies of the self-test assertions, drifting silently, in the file CI reads | Drift in a lane definition is a silent weakening |
| E: make the forge fully primary, as the sibling repos do | One home for everything | Rewrites the PR, review and `gh`-based workflow under outage pressure, and E7's consumers are GitHub-side by construction | Largest change to the parts that still work |
| F: make forge CI a hard merge gate (the sibling project's rule) | Merges provably green | Adds a merge-blocking dependency on a LAN host to a repo that has never had one | Owner decision: advisory for now; the reader is ready if that changes |

## Consequences

- **Easy:** CI signal exists again — a push produces `verify` and `shots` on the
  forge with a downloadable run artifact, and shotwright's own harness output
  stays reviewable. The lane scripts also run locally, unchanged.
- **Easy:** when Actions minutes are available again, nothing has to be undone. GitHub's
  workflows were never disabled; both providers then run the same lanes.
- **Hard, accepted:** the runner is `capacity: 1` and shared with other projects, so lanes run serially and a run costs materially
  more wall clock than GitHub did.
- **Hard, accepted:** CI is advisory, so a red forge run does not block anything
  mechanically. The signal only helps if someone reads it.
- **Hard, accepted:** the dual push URL is per-clone and absent from a fresh
  clone, so a fresh clone silently stops reaching the forge.
- **Future work must not silently undo:** the shared lane scripts. A step added
  to one provider's wrapper and not the other is exactly the drift alternative D
  was rejected for — lane content belongs in `scripts/ci/`. Equally, E8 consumer
  migrations must not assume `uses: hestonhamilton/shotwright/...@main` works
  from a Forgejo runner; it does not, and a consumer that runs CI on the forge
  needs its own wrapper.

## Reversal

Supersedes nothing. Amends no earlier ADR: ADR 0007's two-input surface, `@main`
pinning and same-owner-private sharing scope are untouched, because the reusable
workflow's consumer contract does not change here — only its self-mode
implementation moved into a script.

To revert: delete `.forgejo/`, and GitHub Actions is the sole provider again.
`scripts/ci/*.sh` can stay either way, and should — the self-mode lane being a
script is an improvement independent of where it runs.
