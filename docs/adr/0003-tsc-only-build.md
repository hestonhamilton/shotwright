# ADR 0003 — tsc-only ESM build (no bundler)

- **Status:** accepted
- **Date:** 2026-07-29
- **Bead:** `shotwright-746.1.1`
- **Phase the decision landed in:** R

## Context

The package needs a build toolchain. The bead framed the contest as "tsup vs tsc", but
research (2026-07-29) found tsup **no longer actively maintained** — its own npm page
recommends tsdown, the Rolldown-based successor. The owner fixed the target as
ESM-only, Node ≥20. Details: [shotwright-746.1.1-research.md](../shotwright-746.1.1-research.md), Axis 3.

## Decision

shotwright builds with **plain `tsc`**: ESM + `.d.ts` emitted straight to `dist/`,
`dist` mirroring `src`. Companions: `tsc --noEmit` for typecheck, ESLint flat config
(`eslint.config.mjs`, ESLint 10 at adoption) with typescript-eslint, Vitest 4.x for
unit tests. **tsdown is
the named fallback** if a bundling need is ever measured.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| tsc-only (chosen) | Zero extra tooling; maximal maturity/docs; ESM-only needs no bundling or CJS interop; honest stack traces | No minification (irrelevant for a dev-tool); hand-maintained `exports` map | — |
| tsdown | Fast, actively maintained tsup successor | Young ecosystem, thinner docs — fails the maturity bar for a package this small | fallback, not default |
| tsup | Familiar, huge legacy install base | Not actively maintained — disqualified for a new package | rejected |

## Consequences

- No bundler config to maintain; the build is `tsc -p tsconfig.build.json`.
- Multi-entry `exports` (`.`, `./capture`, CLI `bin`) are maintained by hand in
  package.json — trivial at this size, revisit if entry points multiply.
- Templates (`templates/`) ship as plain files (already in package.json `files`),
  untouched by the build.
- Adopting tsdown later is a build-internals swap, not a public-contract change — it
  needs a measured bundling need, not a preference.

## Reversal

None.
