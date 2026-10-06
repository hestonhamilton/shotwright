# ADR 0009 — Compare artifacts live in `<outputDir>/compare/` under a dot-separated pair filename

- **Status:** accepted
- **Date:** 2026-08-01
- **Bead:** `shotwright-746.4.3`
- **Phase the decision landed in:** I

## Context

E4 adds `shotwright compare A B`, which writes an HTML review artifact derived
from two completed runs. Where that file lands is a public surface: the plan's
own Risks section conceded that "after users script against the path, changing it
would require compatibility output or a deprecation window." A path users script
against is binding, and CLAUDE.md requires an ADR at decision-time for binding
choices rather than retroactively at the epic-close gate. E4.P therefore left
this as its single Open Question and required this ADR
(`docs/shotwright-746.4.2-plan.md`, "ADR Needed?").

Two sub-questions had to be settled together.

**Where.** `docs/design.md:72` documents the output tree as run-id directories
plus a `latest` symlink. A compare artifact belongs to neither run — placing it
inside run B would imply B is the canonical "after" container, when `compare A B`
merely names two selected runs.

**What filename.** The plan drafted `<A>__vs__<B>.html` and its P→I redteam
showed the separator is ambiguous. `validateRunId()` (`src/gallery/resolve.ts:28`)
accepts any single basename, so a hand-named run directory `foo__vs__bar` is
legal, and comparing it against `baz` yields `foo__vs__bar__vs__baz.html` — the
same filename `compare foo bar__vs__baz` would produce. Generated run ids are
`<timestamp>_<4hex>` and never contain `__vs__`, so this is only reachable via a
hand-named directory. Narrow, but the ambiguity is free to avoid, and a filename
convention is far cheaper to get right before adoption than after.

## Decision

Compare artifacts are written to:

```text
<outputDir>/compare/<A-run-id>.vs.<B-run-id>.html
```

The separator is `.vs.` — literal dots. `validateRunId()` rejects any run id
containing `.` (`src/gallery/resolve.ts:28`), so **no legal run id can contain
the separator**, and splitting the filename back into its two run ids is exact.
Unambiguity here is structural, not conventional: it does not depend on generated
ids happening to avoid a magic string, and it cannot be broken by a hand-named
run directory.

`<outputDir>/compare/` is a sibling of the run directories, inside the already
gitignored review-output tree, owned by neither run.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| A (chosen) — flat `compare/<A>.vs.<B>.html` | Unambiguous by construction; flat and globbable; both ids readable on disk; one new directory total | Dots in a filename read slightly unusually | — |
| B — nested `compare/<A>/<B>.html` | Also unambiguous (each segment is an already-validated basename); groups every comparison against a given A | A directory per A run; deeper tree to clean up; the grouping serves a browsing pattern nobody has asked for | Equally correct, strictly more structure than the problem needs |
| C — short deterministic hash `compare/<hash>.html` | Fixed-length names; no separator question at all | Opaque — a human cannot tell what a file compares without opening it; needs the ids rendered in-page to be usable at all | Fights the repo's whole premise. This tool exists so review artifacts are cheap to eyeball; an unreadable filename adds a decode step to every use |
| D — inside run B | Operationally cheapest; no new directory | Implies B owns the comparison and is the canonical "after" | Semantically wrong; `compare A B` selects two runs, it does not designate a baseline |
| E — flat in the output root | Near the runs | Pollutes a tree documented as run dirs plus `latest`; every consumer listing runs must special-case it | Breaks `docs/design.md:72` for no gain over A |

## Consequences

- **Makes easy:** parsing a compare filename back to its two run ids; globbing
  `compare/*.html`; deleting all compare output with one `rm -rf`; keeping the
  run-directory tree exactly as `docs/design.md:72` documents it, plus one
  clearly-named sibling.
- **Makes hard, accepted:** compare output is regenerated review material, not
  historical storage — writing the same pair twice overwrites atomically. Anyone
  wanting to keep a comparison must copy it out. This matches the repo's first
  principle that output is throwaway and gitignored.
- **`compare/` is not run-like, and code that enumerates runs must not treat it
  as one.** `runDirectories()` in `test/smoke/cli.test.ts:61` counts every output
  entry except `latest`, so a stray `compare/` directory reads as a run. E4.I
  cleans it up in the compare smoke test's `finally`; a later change that tightens
  that helper to require `manifest.json` would be a superset of this fix and is
  welcome. Any future run-enumeration code has the same obligation.
- **Must not be silently undone:** the separator is load-bearing, not cosmetic.
  Replacing `.vs.` with any separator composed of characters `validateRunId()`
  permits reintroduces exactly the ambiguity this ADR exists to close. If the
  separator ever changes, the replacement must also be built from characters no
  legal run id may contain, and this ADR must be superseded rather than edited.
- A caller-specified output path stays out of E4 (plan non-goal). Adding one
  later is additive and does not require reversing this ADR — it would only
  change the default.

## Reversal

This ADR **reverses E4.P's first draft** on two points, both on the P→I
redteam's finding 4.

The draft argued the output location was "a scoped CLI artifact convention"
needing no ADR. That reasoning stopped holding against the draft's own Risks
section, which conceded the path becomes lock-in once users script against it.
Those two statements cannot both stand; the concession is the true one, so the
decision is recorded here at decision-time.

The draft also specified `__vs__` as the separator. That stopped holding once the
redteam observed `validateRunId()` admits a hand-named `foo__vs__bar`. The
draft's implicit premise — that run ids never contain the separator — is true of
*generated* ids only, and the validator is what actually bounds the input.

The same finding's path-length concern is **declined**, as in the plan: run ids
are ~24 characters, so a paired filename is ~57 and nowhere near a filesystem
limit.
