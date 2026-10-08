# ADR 0007 — CI ships as a same-owner-private reusable workflow with a two-input surface

- **Status:** accepted (mechanism moot per ADR 0011; decision 3 superseded — the
  consumer template pins a release tag, `shotwright-746.18.28`, 2026-10-05)
- **Date:** 2026-07-30
- **Bead:** `shotwright-746.7` (E7 CI workflow)
- **Phase the decision landed in:** R (sharing scope), P (input surface, ref pinning)

## Context

E7 ships shotwright's CI as a reusable GitHub Actions workflow that consuming
projects call, plus a template `shotwright init` drops. Three binding choices
were forced during R and P, each of which a later epic would otherwise
re-litigate — and one of which constrains what E7 was allowed to claim.

**Sharing scope.** The epic's original acceptance said the workflow must be
"callable from another repo". `shotwright` is a **private repo owned by a user
account**, and GitHub only permits cross-repo reusable-workflow calls from a
private repo after that repo's Actions **Access policy** is widened, and then
only to repos owned by the same user, org, or enterprise — never to an unrelated
third party while it stays private. The research doc did not surface this; the
R-gate redteam did.

**Input surface.** The research recommended nine `workflow_call` inputs. Every
input name becomes API that generated consumer callers copy, and renaming one
later breaks every consumer that already ran `init`.

**Ref pinning.** The generated consumer template must reference the reusable
workflow with a repository-qualified `uses:` line, which requires choosing a ref
— branch, tag, or SHA — before any release process exists.

Detail in `docs/shotwright-746.7.1-research.md` and
`docs/shotwright-746.7.2-plan.md`.

## Decision

1. **Sharing is scoped to same-owner private.** shotwright's Actions Access
   policy is widened to "repositories owned by this user"
   (verified: `access_level: user`). Cross-account and third-party callability
   are explicitly **out of scope** while the repo is private, and the epic's
   acceptance criterion was amended to say so rather than left to imply more.
2. **The reusable workflow exposes exactly two inputs:** `mode`
   (`consumer` | `self`) and `config-path`. A generic `run-command` input is
   forbidden — it would turn the workflow into arbitrary shell plumbing.
3. **The generated consumer template pins `@main`.** *(Superseded 2026-10-05:
   the template pins the release tag, `@v0.1.0` at 0.1.0, so a breaking change
   to the reusable workflow no longer reaches consumers silently.)*

`mode` exists for an empirical reason, not a stylistic one: `pnpm exec
shotwright` does **not** resolve inside shotwright's own repo (a package is not
self-linked), so the self-test invocation genuinely differs from the consumer
one. Two values, both exercised today.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **A (chosen): same-owner private + 2 inputs + `@main`** | Matches actual near-term need — every E8 migration target is the same account; central fix propagation; smallest API to keep stable | Claim is scoped until the repo goes public; `@main` means consumers follow an unreleased branch | — |
| B: self-contained copy-paste template (no `uses:`) | No access policy involved; works for any consumer, public or private | Every future CI fix becomes copy-paste drift across consumers, violating the thin-consumer invariant | Loses central propagation, which is the whole point of a package-owned workflow |
| C: make the repo public now | Removes the constraint permanently; universal callability | A hard-to-reverse disclosure taken for a CI reason rather than on its own merits; would require a full-history scrub for host paths, LAN IPs, and personal data first | Wrong forcing function for a disclosure decision |
| D: nine-input surface as researched | Maximum caller flexibility | Seven of nine had exactly one real value and no caller needing an override; each name is permanent copied API | Unearned lock-in; cut at the R gate |
| E: pin the template to a release tag or SHA | Consumers isolated from breaking pre-1.0 changes | No release process exists yet; every private consumer would hand-update the SHA to get any fix | Premature — revisit when release management exists |

## Consequences

- **Easy:** a consumer's CI is four lines of caller YAML; fixes to the workflow
  reach every same-owner consumer immediately with no consumer-side change.
- **Hard, accepted:** the workflow cannot be used by anyone outside the account
  while the repo is private. E7's acceptance says this explicitly instead of
  implying broader reach.
- **Hard, accepted:** `@main` means a breaking change to the reusable workflow
  breaks every consumer at once. Tolerable at same-owner scale, not beyond it.
- **Future work must not silently undo:** the two-input surface. Re-adding
  inputs needs the same bar the R gate applied — a concrete, reachable scenario
  demanding it, not speculative flexibility. Note `shotwright-746.8.1` already
  presents one such empirically-demanded case (monorepo consumers need a
  working-directory concept); that is a legitimate trigger to revisit, and it
  arrived from a real consumer rather than from imagination.
- **Trigger for revisiting the whole ADR:** publishing shotwright to npm, or
  making the repo public. Either changes the sharing calculus, and `@main`
  should become a released tag at that point.

## Reversal

Decision 3 was reversed by `shotwright-746.18.28` on 2026-10-05: with the
repository public and the package on npm, a mutable `@main` ref would let a
breaking change to the workflow reach every consumer at once, which the private,
same-owner premise had made acceptable. The template now pins the release tag,
and `docs/release-runbook.md` 2.4b protects tags after publishing.

Supersedes nothing else. Amends the acceptance criterion on `shotwright-746.7`, which
originally read "callable from another repo" without qualification — that
wording was written before anyone checked GitHub's private-repo constraint, and
it could not have been satisfied as literally stated while the repo stayed
private.
