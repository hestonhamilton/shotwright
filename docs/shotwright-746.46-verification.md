# shotwright-746.46 verification

**Verdict: PASS.** Verified implementation commit `fa8c926`. The original defect is reproduced by the bead description, but no longer matches this implementation: dry and real conflicts both exit 1, and free scripts are written (`src/init.ts:153-175`, `src/init.ts:350-363`, `src/init.ts:471-499`). No implementation defect found in the requested scenarios.

## Acceptance checklist

- [x] Dry run reports each known conflict and has the same exit code as a real run (1); it predicts writes without making them (`src/init.ts:350-363`, `src/init.ts:405-415`, `src/init.ts:647-664`).
- [x] Free scripts are added while conflicting commands remain unchanged; every conflict is listed as skipped (`src/init.ts:153-175`, `src/init.ts:471-499`, `src/init.ts:647-664`).
- [x] Next steps list only scripts already matched or actually/predictively added; the `shots` skill is deferred while `shots` is unclaimed (`src/init.ts:304-329`, `src/init.ts:395-403`, `src/init.ts:666-685`).
- [x] Real conflict output states which files and scripts were written and gives safe rerun advice (`src/init.ts:433-449`). The resolved rerun wrote the skill and `shots`; the next rerun wrote nothing.
- [x] README documents exit 0, exit 1, dry-run limits, and partial writes (`README.md:68-81`).
- [x] The plan considered `--force-scripts` and prefixes and chose manual resolution for this fix (`docs/shotwright-746.46-plan.md`, “Conflict-resolution option”). The CLI still accepts its existing flags (`src/init.ts:84-120`).

## Commands run and results

`node_modules` existed, so installation was unnecessary. All scratch consumers and the full transcript are under `local/verify-746.46/` (gitignored). Each consumer was a fresh Git repository with a package declaration; the script invoked the built CLI with `node dist/cli.js init [--dry-run]` from that consumer directory. Exact setup and invocation commands are in `local/verify-746.46.mjs`; the transcript is `local/verify-746.46/transcript.txt`. Excerpts below omit only unrelated action lines and the local absolute path in the expected I/O error.

```text
$ pnpm run build
$ tsc -p tsconfig.build.json
exit 0

$ node local/verify-746.46.mjs
exit 0
```

| Fresh consumer scenario | CLI command(s) | Exit code(s) | Observed output and filesystem result |
|---|---|---:|---|
| pnpm, conflicting `shots` | `node dist/cli.js init --dry-run`; `node dist/cli.js init` | 1; 1 | Both: `Skipped (existing command differs): shots`, deferred skill, and `scripts: shots:gallery, shots:compare, shots:install`. Dry: `Would create`/`Would update`; no files changed. Real: `Created`/`Updated`, `The files and scripts listed under Created and Updated were written.` The consumer `shots` stayed `consumer-capture`; all three free scripts were added. Next steps included `pnpm shots:install` and `pnpm shots:gallery`, never `pnpm shots`. |
| npm, conflicting `shots` | same two commands from npm consumer | 1; 1 | Same action and script state. Printed commands were `npm exec -- shotwright run`, `npm exec -- shotwright init`, `npm run shots:install`, `npm run shots:gallery`; no pnpm command appeared. |
| Conflict removed, rerun twice | `node dist/cli.js init`; same again | 0; 0 | First: `Created .claude/skills/shots-harness/SKILL.md`, `Updated package.json (scripts): shots`. Second: `already set up — nothing to change`; no duplicate additions. |
| Two conflicts | dry and real init commands | 1; 1 | Both list skipped `shots` and `shots:gallery`; only `shots:compare` and `shots:install` were added. Next steps contain only `pnpm shots:install` among script commands. Skill deferred. |
| Custom `SKILL.md`, no script conflict | dry and real init commands | 0; 0 | Dry predicted `.claude/skills/shots-harness/SKILL.md.new`; real created it and reported `Needs your review`. Original skill content remained `Custom consumer guidance`. All four scripts were claimed. |
| Conflict plus forced write failure | dry and real init commands | 1; 1 | `shots/` was read-only. Dry predicted the known conflict and writes. Real: `failed partway through — the scaffold is incomplete`, `EACCES`, `Written before the failure: shots.config.ts`, `Not written: shots/example.shots.ts` and later actions, plus `Skipped (existing command differs): shots`. No package scripts were added because that action was not reached. |

The failure scenario used a read-only `shots/` directory so planning succeeded and the write failed during application. This verifies the write-failure precedence and conflict reporting in `src/init.ts:333-343`, `src/init.ts:350-363`, and `src/init.ts:600-614`. A dry run cannot predict that I/O failure; the README states this limit (`README.md:75-81`).

Quality gates, with a local npm cache for the pack subprocess:

```text
$ npm_config_cache=local/npm-cache pnpm run typecheck && npm_config_cache=local/npm-cache pnpm run lint && npm_config_cache=local/npm-cache pnpm run test
$ tsc -p tsconfig.build.json
All matched files use Prettier code style!
All good!                         # publint
shotwright, capture, reporter: node16 ESM and bundler green  # attw
Test Files  23 passed (23)
Tests       646 passed | 1 skipped (647)
exit 0

$ npm_config_cache=local/npm-cache pnpm exec vitest run test/smoke/cli.test.ts -t 'previews and applies free scripts'
Test Files  1 passed (1)
Tests       1 passed | 37 skipped (38)
exit 0

$ git diff HEAD^ HEAD --check
exit 0
```

The first gate attempt without `npm_config_cache` passed typecheck and reached `attw`, then failed inside its `npm pack` subprocess with exit 3. Repeating the complete gate with the local cache passed; direct `npm_config_cache=local/npm-cache npm pack --dry-run --json` also exited 0. This was a verification environment issue, not a code finding.

## Plan and redteam amendments

| Plan item | Verification |
|---|---|
| 1. Per-script added, matched, skipped states and guarded package write | Implemented in `src/init.ts:130-175`, `src/init.ts:471-499`; unit tests cover preserved command, free additions, exact match, and rerun (`test/unit/init.test.ts:350-414`). |
| 2. Shared conflict classification, per-script output, dynamic Next steps, failure precedence | Implemented in `src/init.ts:350-449`, `src/init.ts:600-685`; dry/real and failure scenarios above confirm. Coherence tests are in `test/unit/init.test.ts:84-255`. |
| 3. README, Changeset, built CLI smoke | README at `README.md:68-81`; patch Changeset at `.changeset/quiet-shots-init.md:1-5`; packed CLI smoke at `test/smoke/cli.test.ts:1912-1963` passed. |
| Redteam 1. Defer skill if `shots` conflicts | Planned at `src/init.ts:304-329`, reported at `src/init.ts:395-403`; observed in pnpm, npm, and two-conflict cases, then written on resolved rerun. |
| Redteam 2. List skipped scripts on write failure | Implemented at `src/init.ts:600-614`; observed in forced failure and tested at `test/unit/init.test.ts:381-414`. |
| Redteam 3. Changeset says dry-run exits 1 | Explicit at `.changeset/quiet-shots-init.md:5`. |

## Observations and sign-off

The CLI preserves the consumer's conflicting command, adds only free names, and does not recommend the unclaimed `shots` command. The npm consumer received npm commands throughout. Partial writes and safe rerun behavior were visible in the built CLI. **PASS for V; no gaps found against the acceptance criteria or adopted plan amendments.**
