# shotwright-746.65 — verification

- **Phase:** V
- **Date:** 2026-10-29
- **Verdict:** PASS

## Live run of §2.4c

The three `bash` blocks of `docs/release-runbook.md` §2.4c were extracted verbatim and run in one shell for the owner-approved `v0.6.0` backfill (`version=0.6.0`, `run_id=40970401508`). Exit status 0. Output, with npm's update notice omitted:

```text
verified real publish run 40970401508 and peeled tag v0.6.0 at 6fd3c3bc64daf21c8f176c5e3ee7e648f8266c04
notes from 6fd3c3bc64daf21c8f176c5e3ee7e648f8266c04:CHANGELOG.md (0.6.0)
<the 0.6.0 Minor Changes and Patch Changes section>
no Release for v0.6.0; creating once
https://github.com/hestonhamilton/shotwright/releases/tag/v0.6.0
verified Release v0.6.0: exact notes, title, classification, no assets; Latest=v0.6.0; remote tag unchanged
```

This exercised: the real-publish-run check (not a dry run), full peeling of the annotated tag to the run's head commit, the npm `latest` dist-tag check, literal extraction of the `## 0.6.0` section from the tagged commit, the draft-aware absence check, creation with an explicit `--latest`, and the post-create checks (exact body, title, not a draft, not a prerelease, no assets, GitHub Latest equal to the tag, remote tag unchanged). The exact-body comparison passed, so GitHub stored the notes without normalisation.

## Pinned locally by the implementer

A wrong-SHA run exited 1 before any write. Extraction passed the exact `0.6.0` section and the missing, duplicate, empty, EOF-terminated, prerelease-heading and literal-dot cases (plan amendment 3).

## Gates

`pnpm run typecheck && pnpm run lint && pnpm run test`: passed (`Test Files 23 passed (23)`, `Tests 656 passed | 1 skipped (657)`). The change is runbook text only; no package code changed, so no changeset.

## Not done

Older tags stay tag-only, by owner decision. The prerelease (`next`) path has not run live; it will on the next prerelease.
