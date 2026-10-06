# ADR 0001 — shotwright is an npm package built on the Playwright test-runner

- **Status:** accepted
- **Date:** 2026-07-29
- **Bead:** pre-board (founding session "playwright"); owner signed off via decision questions
- **Phase the decision landed in:** project inception

## Context

Three sibling projects (consumers A, B and C) each carry a home-grown "shots harness". Centralizing it
forces two foundational choices: how projects consume the shared tool, and what the
capture engine is built on.

## Decision

shotwright is distributed as an **npm package** (consumed as a git dependency, registry
publish optional later) and its capture engine is the **Playwright test-runner**:
consumers write `*.shots.ts` specs run by `playwright test` with a shotwright-provided
config.

## Alternatives weighed

### Distribution

| Option | Pros | Cons | Why not |
|---|---|---|---|
| npm package (chosen) | one direction of fix-flow (upgrade the dep); consumers stay thin; repo self-tests via demo app | needs a real public API boundary | — |
| Copy-in scaffold | zero coupling, easy per-project hacks | drift is the disease being cured | rejected |
| Hybrid package + scaffold | clean split | most moving parts | partially adopted: `templates/` + `init` give the scaffold half *inside* the package |
| Global CLI | no per-project install | invisible version skew | rejected |

### Engine

Plain playwright-library scripts (consumer A and B pattern) were rejected: videos, traces, and
reporting must be hand-rolled there, and consumer C already proved the test-runner
shape — webServer auto-boot, spec directory outside the e2e merge gate, per-config
artifact toggles. consumer A and B scripts migrate to specs over time.

## Consequences

- The manifest + output layout becomes a public contract; breaking it is a major version.
- Playwright becomes a peer-coupled dependency — version policy is an open E1 research
  question (peer vs bundled, browser install story).
- Philosophy is fixed as review-artifacts-not-assertions; golden-diff regression is out
  of scope and would be a separate decision to reverse.
