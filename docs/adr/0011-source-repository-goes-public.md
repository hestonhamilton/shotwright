# ADR 0011 — the source repository goes public

- **Status:** accepted
- **Date:** 2026-08-01
- **Bead:** `shotwright-746.18.5`, under `shotwright-746.18` (E9 Distribution)
- **Phase the decision landed in:** post-R (owner decision, taken while reviewing E9.R)
- **Amends:** ADR 0010 on the repository-visibility point only

## Context

ADR 0010 decided that shotwright ships as a public npm package **with the source
repository staying private**, and defended that explicitly: the npm page's 404 to
outside visitors "is accepted, not a defect to fix by making the repo public,"
and "only the package channel goes public."

Two things then happened.

E9.R found that **npm refuses to generate provenance attestations when the
source repository is private** — withdrawn in 2023 and not reinstated
(`docs/shotwright-746.18.1-research.md`, §1.2). Under ADR 0010 as written,
provenance was not a "later" item but a closed door, permanently, for reasons
that had nothing to do with why the repo was private.

Separately and independently, the owner stated (2026-08-01) that the repository
is intended to go public once vetted for PII, secrets, and vulnerabilities. That
is a direct reversal of a position ADR 0010 argued for rather than merely
assumed, which is why it needs an ADR rather than a footnote.

The vetting is further along than expected. E9.R verified by inspection that the
git history contains no host paths, no sensitive files ever committed, and no
personal email (§3.6). Corrected 2026-10-05: the file-content check was right, but
commit metadata carried a personal address, which the pre-flip history rewrite
replaces with the GitHub noreply address.

## Decision

**The shotwright source repository becomes public**, once vetted for PII,
secrets, and vulnerabilities.

ADR 0010's distribution decision is **unchanged and still correct**: shotwright
publishes to the public npm registry under the unscoped name `shotwright`. This
ADR amends only 0010's premise that the source repository stays private, and the
consequences 0010 derived from that premise.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| Public repo (chosen) | Unblocks provenance; the npm page's `repository` link resolves; consumers can read the source they depend on; removes a standing asymmetry where a public package points at an unreadable repo | Requires a one-time vetting pass over full history; the bd board becomes public unless dealt with; git history is permanently exposed once flipped | — |
| Stay private (ADR 0010's position) | No vetting needed; board stays private by default | Provenance permanently unavailable; npm page 404s to every visitor | The owner reversed it. The provenance cost was also unknown when 0010 was written |
| New curated public repo, keep this one private | Cleanest guarantee — nothing from the private phase is exposed | New repo identity; PR/issue backlinks lost; ADR 0007's `uses:` reference and `templates/github/shotwright.yml` need repointing | Disproportionate given history is empirically clean. Remains the correct path **if** the bd board turns out to be unacceptable as public content (§`shotwright-2sr`) |

## Consequences

**Makes easy.** Provenance attestations become available, so published packages
gain a verifiable link back to source and build. The `repository` URL in
`package.json` resolves for outside visitors instead of 404ing. Consumers can
read what they install.

**Makes hard, accepted as cost.**

- **The flip is irreversible in effect.** Making a repository private again does
  not retract what was fetched, forked, or indexed while it was public.
- **A second leak gate is now required, with a different scope from the first.**
  The tarball gate (ADR 0010 prerequisite 2) covers the 43 files that ship. The
  flip exposes every commit reachable from any ref, including content long since
  deleted. Different scope, different tool, runs once rather than every release.
  A tarball gate does not and cannot cover git history.
- **Provenance cannot be applied retroactively.** Published versions are
  immutable and a version number can never be reused, so **any version published
  before the flip is permanently unattested**. The publish/flip ordering
  therefore has a permanent consequence and is called out as an open decision
  below rather than left to whoever implements first.

**What future work must not silently undo.**

- **ADR 0007's mechanism becomes moot, not merely unchanged.** 0007 shares the
  reusable CI workflow via GitHub's same-owner-private Actions access policy. A
  public repository's reusable workflows are callable by anyone, so that
  configuration stops being load-bearing. Nothing breaks — sharing gets strictly
  more permissive — but a future reader of 0007 must not conclude the private
  sharing setup is still doing work. **This ADR does not supersede 0007**; it
  records that 0007's mechanism is now redundant rather than wrong.
- **The bd board reaches GitHub as an advertised `refs/dolt/data` ref** and would
  become public with the repository. It is readable with `strings` alone; `dolt`
  is not required. Deleting the ref removes discoverability but **not** the
  objects, which GitHub retains by design and serves by SHA. This ADR does not
  decide the board's disposition — that is `shotwright-2sr`, and it must be
  resolved before the flip.
- **The headed-public invariant does not relax.** It gets stricter. Under ADR
  0010 it protected the tarball; it now protects every commit.

## Open decisions this ADR deliberately does not make

Recorded as open so they are decided explicitly rather than by whoever acts
first:

1. **Publish before or after the flip.** Flip-first costs whatever the vetting
   takes and gives every version provenance from `0.1.0`. Publish-first costs
   nothing now and permanently leaves the early versions unattested. E9.R
   recommends flip-first on the evidence that the vetting is nearly done.
2. **Whether the bd board is acceptable as public content.** A candour judgement
   about internal notes, not a security finding — E9.R verified the board carries
   only shotwright's own beads, no secrets and no host paths.
3. **Vulnerability review scope** was not addressed by E9.R. It is now decided:
   ADR 0019 adopts OSV-Scanner as the blocking gate and Dependabot as the
   remediation mechanism.

## Reversal

This ADR **amends ADR 0010**, which should be read as accepted-and-amended
rather than superseded: its registry decision, its name choice, and its
rejection of GitHub Packages and git dependencies all still hold.

**Why 0010's reasoning stopped holding.** ADR 0010 treated repository visibility
as a free variable it could set to "private" at no cost, and defended the
resulting npm-page 404 as cosmetic. Two facts it did not have: keeping the repo
private also forfeits provenance permanently, and the owner's intent for the
repository was public all along, pending a vetting pass. 0010's reasoning was
sound on what it knew — the error was scope, treating visibility as settled by
a distribution ADR when it is a repository decision with its own consequences.
That is the thing not to repeat: **visibility and distribution are separate
decisions**, and 0010 conflated them in the same way it correctly warned that
early E8 planning had conflated the package channel with the CI channel.
