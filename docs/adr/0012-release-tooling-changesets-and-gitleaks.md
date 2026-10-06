# ADR 0012 — Release tooling: Changesets for versioning, gitleaks for the leak gate

- **Status:** accepted
- **Date:** 2026-08-01
- **Bead:** `shotwright-746.18.2`
- **Phase the decision landed in:** P

## Context

ADR 0010 (as amended by ADR 0011) committed shotwright to the public npm
registry. E9.R (`docs/shotwright-746.18.1-research.md`) established that
`npm publish` is the only irreversible command in this project: a burned version
number is unreusable forever, unpublish is not a retraction, and a leaked host
path in the tarball is permanent public disclosure.

That forces two component selections which E9.P
(`docs/shotwright-746.18.2-plan.md`) would otherwise harden into code by
default: how versions and changelogs are produced, and what scans the packed
tarball. Both were left open by E9.R §6 and are decided here at decision time
rather than retroactively.

## Decision

**Changesets** produces versions and changelogs and opens the Version PR. It does
**not** publish — `changeset publish` is deliberately unused, and the release
workflow runs an explicit `npm publish`.

**gitleaks**, pinned to an exact version, provides layers B and C of the tarball
leak gate: shotwright-specific custom rules for host paths, private-range IPv4,
and path-context usernames, over gitleaks' default credential ruleset.

## Alternatives weighed

### Release manager

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **Changesets (chosen)** | No commit convention required; release-PR model puts a reviewable human gate immediately before an irreversible publish; produces the changelog E8 migrations need | Ceremony for a single package with one maintainer; a `.changeset/*.md` file per change | — |
| semantic-release | Fully automatic | Derives versions from Conventional Commits (`feat:`, `fix:`) | This repo's convention is `<bead-id>: <subject>` under strict hook enforcement. Adopting it means changing the commit convention or bolting a second one on top. Its publish-on-merge automation is also precisely the wrong property when the publish is unrecoverable. |
| `np` | Simple, well-established | Interactive, local-first | E9 is designing *out* the human-held credential; a local interactive flow is the thing being removed. |
| No release manager (`npm version` + manual dispatch) | Zero new dependencies; genuinely simpler | No changelog | Consumers migrating in E8 need to see what changed between versions. Recorded as the named fallback if the ceremony proves disproportionate — reopening it must be an explicit decision, not a drift. |

`changeset publish` is excluded from the chosen option on purpose. It delegates
to the detected package manager, and E9.R §4.5 records that pnpm's OIDC support
is unsettled: the feature request is closed, the docs do not describe trusted
publishing, and OIDC publishing that worked under pnpm 10 regressed to a 404
under pnpm 11.0.8. The one irreversible command does not go through an
undocumented code path in a second client.

### Tarball scanner

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **gitleaks, pinned (chosen)** | `dir` mode scans an extracted tarball without git; strong custom-rule support, which is the load-bearing part; stable, packaged, widely available in CI | Go binary in the release job; **feature-frozen** (below) | — |
| secretlint | npm-native devDependency, no Go binary | Weaker custom-rule support | The custom rules *are* the gate — E9.R §3.1 measured that a naive scan is wrong three times on a clean tree, so the shotwright-specific patterns carry the weight and the generic ruleset is only a backstop. |
| Betterleaks | Same author and team; faster; more expressive filtering; actively developed; MIT | ~4 months old at decision time; no verified `--redact`; no stated gitleaks config compatibility | Does not clear the repo's standing bar that bleeding-edge tools with thin docs must earn their place — and this one gates an irreversible operation. Revisited by an explicit bead (below). |

## Consequences

- **Makes easy:** two human gates before anything ships (merging the Version PR,
  then dispatching the release workflow with `dry-run: false`); a changelog E8
  can read; one gate definition in `scripts/ci/` shared by both CI lanes and
  local runs.
- **Makes hard, accepted as cost:** the release job needs a Go binary installed
  and version-asserted. `leak-gate.sh` fails if `gitleaks version` does not equal
  the pin, because a scanner whose rule engine drifts under a pinned config
  changes the gate's meaning silently.
- **Accepted knowingly:** gitleaks is feature-frozen. Its README states
  *"Gitleaks is feature complete. I'm not merging new features into Gitleaks.
  Future releases will be security patches only. I'm shifting my focus to
  Betterleaks"* (verified 2026-08-01). Security patches are what a scanner most
  needs, and the migration surface here is four custom rules, so the cost of
  choosing gitleaks now and moving later is low and does not grow. This is a
  deliberate choice of a frozen tool, not an oversight.
- **Future work must not silently undo:** replacing the explicit `npm publish`
  with `changeset publish` or `pnpm publish`; adding a stored `NPM_TOKEN` to the
  release workflow, which has no credential input by design; or widening
  `gitleaks-tarball.toml`'s allowlist to make a failing gate pass. E9.P §2.5
  records that an in-repo gate cannot defend against a change to itself — the
  control is review of the release PR diff.

## Reversal

Supersedes nothing. Decides E9.R §6.3 and §6.4, which were carried forward as
open rather than recommended.

Note that E9.R §4.3 described Betterleaks as a project development was *moving
to*. Direct inspection on 2026-08-01 found it already shipped — v1.1.2, MIT,
four maintainers — and gitleaks already frozen. That corrected fact does not
change the decision, for the reasons in the table, but it does change the shape
of the follow-up: the migration is a real near-term evaluation with a named
successor, not a contingency awaiting one.
