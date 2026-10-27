# E12 consumer brief — anonymized

**Epic:** `shotwright-746.38` · **Reported against:** shotwright 0.3.0 · **Date received:** 2026-10-27

A consuming Playwright package has roughly 100 capture specs, installs shotwright from npm, and runs some walkthroughs against a production target. The report distinguishes reproduced behavior from code inspection. Its production gate and environment names below are generic descriptions, not consumer identifiers. Earlier requests for screenshot options, artifact subpaths, helper-registered tests, duplicate-name handling, render provenance, full test titles, and `-g` documentation were resolved in 0.3.0. Committed baselines remain outside this request.

## C1. Production selection and project options

The consumer's base Playwright config gives its production project `grep: /@prod-safe/`; its shots config passes `use: base.use` but no `projects`. Every test is then listed for the default `shots` project. A production-writing spec could run. The consumer asks for a warning that project `grep`/`grepInvert` do not transfer, or an explicit filter option on the default project. As another edge, `viewport` and `deviceScaleFactor` supplied alongside `projects` appear to be ignored. They ask that the values apply, be refused, or be documented. Their workaround is to pass the base projects through. This report does not establish that a top-level Playwright `grep` is dropped.

## C2. Filtered shot checks

With `--only` or `SHOTWRIGHT_ONLY`, `shot()` skips `check` for shots whose names do not match. A check that probes a route's response can therefore disappear while the test passes. The consumer asks for checks to run on every shot call while filtering only capture writes, or for the skip to be documented.

## C3. Artifact location and scratch space

`artifact()` resolves to `void`. A spec that writes a workbook or PDF and then invokes an external inspector needs a path, and a step sometimes needs a temporary output directory. The consumer asks for either the written artifact path or a per-test scratch directory. Their workaround creates and cleans a temporary copy in the spec.

## C4. Large artifact copies

`artifact({ path })` currently reads the entire source file before writing it. This is acceptable for small workbooks but expensive for a large video, archive, or download. The consumer asks for a streamed copy or an explicit move option.

## C5. Node engine metadata

`engines.node` accepts Node 20 and the package has no `require` export condition. The README states that unflagged `require(esm)` starts at Node 20.19 or 22.12. The consumer asks for engine metadata matching that range or a `require` condition.

## C6. Per-shot context

Gallery cards show the test title path but a loop can still produce multiple shots in one test. The consumer asks for an optional `note` on `shot()` that appears on the card and participates in search.
