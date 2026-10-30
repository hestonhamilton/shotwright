# shotwright-746.54 — Verify

- **Phase:** V
- **Verdict:** **PASS**
- **Scope:** Review of `main...HEAD`; no implementation or test files changed during Verify.

## Acceptance checklist

- [x] **Parse the reusable workflow pin.** The diagnostic reads the Git-root caller, parses YAML with duplicate-key reporting, and selects direct job-level `uses` and `with.working-directory` fields (`src/init.ts:367-407`). Unit coverage excludes step actions, malformed documents, duplicate relevant keys, expressions, forks, branches, and SHA refs (`test/unit/init.test.ts:319-345`).
- [x] **Compare with the installed version.** The exact release ref is compared with `shotwrightVersion()`, the same version source used by the CLI (`src/init.ts:338-339,379,391-410`; `src/cli.ts:967-972`). The reported adoption versions are historical: this branch is `0.6.0`, and the packaged template pins `@v0.6.0` (`package.json:3`; `templates/github/shotwright.yml:17`). The consumer drift case remains reproducible in the packed-package exercise below.
- [x] **Clear warning and fix, without failure or mutation.** The notice names file, line, job, observed pin, installed CLI version, and manual replacement (`src/init.ts:411-414`). The CLI prints it once in either mode and retains `initExitCode` (`src/cli.ts:955-964`). Unit tests check both output routes, zero exit, and unchanged workflow content (`test/unit/init.test.ts:297-316`). All packed-package runs below returned zero and left workflow bytes unchanged.
- [x] **Automatic bump considered.** The plan explicitly declines an opt-in bump per owner decision (`docs/shotwright-746.54-plan.md:38-42,71-78`); implementation is read-only (`src/init.ts:367-421`).
- [x] **Covered by tests.** Unit tests cover tag variants, root and nested packages, sibling isolation, mixed jobs, symlink targets, malformed YAML, and thrown parser errors (`test/unit/init.test.ts:278-405`). The full unit suite passed: 23 files, 678 tests passed, 1 skipped.
- [x] **Dependency amendment.** `yaml` is pinned as a runtime dependency, locked at 2.9.1, and present in the reviewed allowlist (`package.json:75-79`; `pnpm-lock.yaml:19-24`; `scripts/ci/runtime-dependency-allowlist.txt:12-14`). ADR 0019 records the owner decision, prior art, read date, advisory, install size, and zero-dependency evidence (`docs/adr/0019-dependency-vulnerability-review.md:230-269`). The audit gate passed.

## Plan and amendment review

| Plan item | Evidence | Result |
|---|---|---|
| 1: recognize direct caller jobs; amended to use `yaml` | `src/init.ts:367-407`; `test/unit/init.test.ts:319-353` | Pass |
| 2: current-package targeting and exact full ref | `src/init.ts:338-361,391-410`; `test/unit/init.test.ts:348-387` | Pass |
| 3: diagnostic through both `init` modes, no changed action or exit | `src/init.ts:327-331,411-421`; `src/cli.ts:955-964`; `test/unit/init.test.ts:297-316,390-404` | Pass |
| 4: minor release note, no template bump | `.changeset/quiet-workflow-pin.md:1-5`; `templates/github/shotwright.yml:17` | Pass |
| Amendment: parser errors do not fail `init` | `src/init.ts:367-374,417-420`; `test/unit/init.test.ts:340-345,390-404` | Pass |
| Amendment: simplify path resolution; no verdict for unresolved or external target | `src/init.ts:354-365`; `test/unit/init.test.ts:356-387` | Pass |
| Amendment: ADR, allowlist, OSV gate | `docs/adr/0019-dependency-vulnerability-review.md:230-269`; `scripts/ci/runtime-dependency-allowlist.txt:12-14` | Pass |

The earlier plan text proposes a hand-rolled parser and says no dependency; the later owner/redteam amendment explicitly replaces those choices (`docs/shotwright-746.54-plan.md:71-78`). The installed package's workflow template remains at the branch's version (`templates/github/shotwright.yml:17`), as the plan requires (`docs/shotwright-746.54-plan.md:19-22`).

## Commands run

From the worktree root. The fixture script and command transcript are in ignored `local/verify-pin-consumers.py` and `local/pin-consumers-results.txt`; the 139 MB scratch consumer installs were removed after verification.

```text
pnpm run build && pnpm pack --pack-destination local
  exit 0; built TypeScript and packed shotwright-0.6.0.tgz.

npm_config_cache=local/npm-cache python3 local/verify-pin-consumers.py > local/pin-consumers-results.txt 2>&1
  exit 0; installed the tarball in clean root and nested-package consumers.
  Each case ran node <installed package>/dist/cli.js init --dry-run --package-manager npm
  and node <installed package>/dist/cli.js init --package-manager npm.

npm_config_cache=local/npm-cache pnpm run typecheck && npm_config_cache=local/npm-cache pnpm run lint && npm_config_cache=local/npm-cache pnpm run test && npm_config_cache=local/npm-cache bash scripts/ci/audit-gate.sh
  exit 0; typecheck passed; eslint/prettier/publint/attw passed;
  23 test files passed, 678 tests passed, 1 skipped;
  audit gate: 257 current packages clean, live canary detected, PASSED.

npm_config_cache=local/npm-cache pnpm run smoke
  exit 0; 3 smoke test files passed, 57 tests passed. The consumer browser-install
  probe timed out and the suite continued with its existing browser cache.

git diff main...HEAD --check
  exit 0; no whitespace errors.

pnpm exec prettier --check docs/shotwright-746.54-verification.md
  exit 0; verification document formatting passed.
```

The first `pnpm run typecheck && pnpm run lint && pnpm run test && bash scripts/ci/audit-gate.sh` stopped at lint's `attw` invocation because `npm pack` tried to write npm's default cache outside the writable worktree. The retry above set `npm_config_cache=local/npm-cache` and passed. This was an environment cache error, not a lint finding.

## Packed-package observations

The table gives warnings for `--dry-run` and normal `init` respectively. **Every row returned exit 0 in both modes and kept the workflow SHA-256 identical before and after.** The packed CLI reports installed version `0.6.0` (`package.json:3`; `src/cli.ts:967-972`).

| Consumer / workflow case | Warnings dry / normal |
|---|---:|
| Root package, equal `@v0.6.0` | 0 / 0 |
| Root package, older `@v0.4.0` | 1 / 1 |
| Root package, newer `@v0.7.0` | 1 / 1 |
| Root package, SHA pin | 0 / 0 |
| Root package, fork | 0 / 0 |
| Root package, `@main` | 0 / 0 |
| Root package, malformed YAML | 0 / 0 |
| Root package, 1,500-level nested YAML | 0 / 0 |
| Nested package, current `apps/web`, older pin | 1 / 1 |
| Nested package, sibling `apps/other`, older pin | 0 / 0 |
| Nested package, current `apps/web`, equal pin | 0 / 0 |
| Nested package, two unequal current-package jobs plus a sibling | 2 / 2 |
| Actual packed template, equal pin | 0 / 0 |
| Actual packed template, older pin | 1 / 1 |

Representative actual output (older template pin, both modes):

```text
Warning: .github/workflows/shotwright.yml:17 job shotwright uses @v0.4.0, while the shotwright CLI running init is 0.6.0. For this package, review the workflow release changes, then change that job's uses pin to @v0.6.0.
```

The clean nested consumer resolved `yaml` from `local/pin-consumers/monorepo/apps/web/node_modules/yaml/dist/index.js` through the installed `shotwright/dist/init.js`, confirming the tarball's runtime dependency resolves without the source worktree's `node_modules` (`package.json:75-79`; `src/init.ts:4-5`).

## Observations and sign-off

No acceptance or amended-plan gap found. The warning is intentionally limited to an exact upstream release ref and a resolvable current-package target (`src/init.ts:338-361,389-410`); it does not claim that matching tags prove identical CI and local binaries (`docs/shotwright-746.54-plan.md:23-29`). Diff review found only the scoped source, test, dependency, ADR, plan/research, and changeset files; the changed text scan found no absolute host path or LAN address. No gallery UI changed in this diff (`git diff main...HEAD --name-only`).

**Sign-off: PASS.** The packed CLI, unit and smoke suites, and audit gate establish the requested warning, non-failing behavior, package isolation, and unchanged caller bytes.
