# ADR 0021 — Shot identity and manifest v2

- **Status:** accepted
- **Date:** 2026-10-22
- **Bead:** `shotwright-746.28.3`
- **Phase the decision landed in:** I

## Context

The first external consumer reuses generic capture names across many specs and needs run status, test outcomes, and data artifacts. The v1 manifest has a global shot-name constraint and no outcome fields. See `docs/shotwright-746.28.1-research.md` and `docs/shotwright-746.28.2-plan.md`.

## Decision

Shot identity is the canonical `(spec,name)` pair, encoded with length-prefixed components. New runs write manifest v2 with runner, test, publication, artifact, and failure records. Readers normalize v1 in memory, retaining its unknown outcome and publication provenance.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| Composite identity and v2 (chosen) | Reused names and explicit outcomes | Migration for readers | — |
| Global shot names | No identity change | Blocks ordinary multi-spec flows | Consumer need requires reuse |
| Add optional fields to v1 | Small writer edit | Absence remains ambiguous and weakens validation | Status and publication require a clear version boundary |

## Consequences

- Specs can reuse the same shot name; duplicates within a spec fail publication.
- Readers need a v1 adapter and must label its outcome and publication as unrecorded.
- Writer and downstream compare must keep the composite identity and final-retry rule.

## Reversal

This changes the global-name rule of the initial manifest contract. The first external consumer showed that the rule prevents normal captures across many specs; the per-spec storage layout already supplies the needed namespace.
