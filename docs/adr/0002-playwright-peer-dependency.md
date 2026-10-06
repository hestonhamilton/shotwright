# ADR 0002 — `@playwright/test` is a peer dependency (`>=1.60 <2`)

- **Status:** accepted
- **Date:** 2026-07-29
- **Bead:** `shotwright-746.1.1`
- **Phase the decision landed in:** R

## Context

ADR 0001 left Playwright version policy open (design doc §5, "Playwright version
coupling"): shotwright wraps the Playwright test-runner, and consumers (consumer C
today, consumers A and B at E8) carry their own Playwright pins for their e2e suites. Two
copies of `@playwright/test` in one process break the runner outright
(`Playwright Test did not expect test() to be called here`). Research and consumer-pin
survey: [shotwright-746.1.1-research.md](../shotwright-746.1.1-research.md), Axis 1.

## Decision

shotwright declares `@playwright/test` as a **peerDependency with range `>=1.60 <2`**,
plus a pinned devDependency for its own demo/self-tests. Browsers belong to the
consumer's Playwright: `init` scaffolds a `shots:install` script running
`playwright install chromium`. The CDN-blocked `executablePath` escape hatch is
documented, not designed-in.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| Peer dep `>=1.60 <2` (chosen) | Single copy guaranteed; consumer keeps its pin; playwright-bdd precedent; pnpm auto-installs peers | Consumer must satisfy the range; skew must stay in-range | — |
| Bundled (direct dependency) | Zero consumer setup | Duplicate-copy runner breakage whenever the consumer has its own e2e Playwright; duplicated browser builds | rejected |
| Optional peer + runtime probe | Standalone use | Complexity with no consumer that needs it | rejected |

## Consequences

- `defineShotsConfig` and `shotwright/capture` import from the consumer's single
  `@playwright/test` instance — fixture identity is safe by construction.
- The floor (`1.60`) tracks the lowest live consumer pin; raising it is a
  consumer-visible change and belongs in release notes.
- Playwright 2.0 is deliberately excluded (`<2`); admitting it is a tested, explicit
  range bump, not a silent one.
- shotwright's CLI must invoke the *consumer's* `playwright test` binary (resolution
  mechanism pinned in P).

## Reversal

None — resolves the question ADR 0001 explicitly deferred.
