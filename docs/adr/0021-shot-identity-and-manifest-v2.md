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

## E11 capture amendment (2026-10-26)

The loaded file suite determines `spec` even when a helper declares the test. A shot claims its final PNG with exclusive creation before capture and writes the unmodified Playwright PNG bytes through that claim. A collision fails the claimant's test. Retry replacement requires prior sidecars only for the same test identity, all from lower retries, including the immediately preceding retry; an unproved claim remains a collision. Late duplicate sidecars are structural run failures: ambiguous captures are omitted, one path-free `runError` is published, and the effective failed status controls the gallery, run list and `latest`. Artifacts may use relative subpaths; path components are checked before writing. Manifest v2 optionally carries each test's ancestor-to-leaf `titlePath`; older v2 readers use `[title]`.

### Threat model

Static containment rejects traversal and symlinks present at write time. Portable Node has no `openat`, so the path check and final open cannot be race-free. A concurrent writer inside the output directory can swap a checked component before the open and is out of scope, matching the trust boundary of Playwright's own `outputDir`.

### Prior art and currency

Read 2026-10-26: Playwright [TestInfo](https://playwright.dev/docs/api/class-testinfo) distinguishes the declaration `file` from `titlePath` starting at the loaded test file. Its [Suite](https://playwright.dev/docs/api/class-suite) API exposes the file suite and its source location. Node's [file descriptor guide](https://nodejs.org/learn/manipulating-files/working-with-file-descriptors-in-nodejs) documents opening a file once and writing through its descriptor.

## Reversal

This changes the global-name rule of the initial manifest contract. The first external consumer showed that the rule prevents normal captures across many specs; the per-spec storage layout already supplies the needed namespace.
