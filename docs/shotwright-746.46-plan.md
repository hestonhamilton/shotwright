# shotwright-746.46 — init script conflict diagnosis and plan

- **Phase:** R + P (implementation deferred)
- **Date:** 2026-10-29
- **Target release:** 0.5.1 patch from the current 0.5.0 (`package.json:3`)

## Goal and existing contract

Make `init --dry-run` accurately predict a script conflict, preserve each consumer script, add every non-conflicting shotwright script, and report the actual partial result. A conflict remains an exit-1 condition until the consumer resolves it; rerunning `init` must safely finish the setup. The README promises that `--dry-run` tells the user exactly what init will touch (`README.md:49-66`). It shows `pnpm shots`, `shots:install`, and `shots:gallery` as follow-up commands (`README.md:68-75`), so that advice must be conditional on the scripts actually being available. The design keeps consumer config/specs thin (`docs/design.md:89-99`), and ADR 0002 assigns browser installation to the consumer's `shots:install` script (`docs/adr/0002-playwright-peer-dependency.md:17-23`). ADR 0006 requires headline, next steps, and exit code to derive from one `InitOutcome` (`docs/adr/0006-shotwright-flags-parse-after-separator.md:53-58,82-83`). Preserve that invariant.

## Reproduction

Ran the built CLI from an ignored, isolated Git repository at `local/repro`. Commands, from this worktree root (after `pnpm install --frozen-lockfile --store-dir local/pnpm-store` and `pnpm run build`):

```sh
mkdir -p local/repro
git -C local/repro init -q
cat > local/repro/package.json <<'EOF'
{
  "name": "init-conflict-repro",
  "private": true,
  "packageManager": "pnpm@11.25.0",
  "scripts": { "shots": "echo existing-capture" }
}
EOF
cd local/repro
node ../../dist/cli.js init --dry-run > dry-run.out 2>&1; echo "dry-run exit: $?"
node ../../dist/cli.js init > real-run.out 2>&1; echo "real-run exit: $?"
cat dry-run.out real-run.out package.json
```

Observed (output excerpts, with status captured immediately after each command):

```text
dry-run exit: 0
shotwright init: dry run
  package.json already defines:
      "shots": "echo existing-capture"
Would create
  shots.config.ts
  shots/example.shots.ts
  .github/workflows/shotwright.yml
  .gitignore (+3 entries)
  .claude/skills/shots-harness/SKILL.md
Next steps
  2. pnpm shots:install
  3. pnpm shots
  4. pnpm shots:gallery

real-run exit: 1
shotwright init: cannot claim the `shots` script
Created
  shots.config.ts
  shots/example.shots.ts
  .github/workflows/shotwright.yml
  .gitignore (+3 entries)
  .claude/skills/shots-harness/SKILL.md
```

After the real run, `package.json` still contained only `"shots": "echo existing-capture"`; `shots:gallery`, `shots:compare`, and `shots:install` were absent. The five listed scaffold files existed. The dry-run output listed no `package.json` update. This reproduces the bead; its premise matches the current code. The reproduction used a fresh default skill, so the reported `SKILL.md.new` variant was not exercised; the skill planner has that path for a differing existing skill (`src/init.ts:470-513`).

## Root cause

1. `planInit` computes both desired script additions and conflicts before applying actions (`src/init.ts:240-245,271-303`). `mutatePackageJsonScripts` already handles each desired name independently, collecting absent names in `changed` and differing names in `conflicts` (`src/init.ts:133-152`). The loss happens later: `planPackageJson` returns without creating a package.json action when **any** conflict exists (`src/init.ts:416-438`). Thus one taken `shots` script suppresses all three free scripts.
2. The action list places config, example, workflow, package.json, ignore, and skill in that order (`src/init.ts:296-303`). `applyInitPlan` executes every planned action before outcome classification (`src/init.ts:306-316`; `src/cli.ts:955-964`). Conflict classification therefore cannot prevent scaffold writes. The conflict is detected during planning, but surfaced only after writes; describing it as discovered after writing would be inaccurate.
3. `classifyInitOutcome` returns `dry-run` before checking `plan.conflicts`, yielding exit 0; the real result reaches `script-conflict` and exit 1 (`src/init.ts:323-350,618-633`). `appendNextSteps` emits fixed script commands for every dry run and suppresses all Next steps on a real conflict (`src/init.ts:601-616,636-650`). The CLI simply selects dry versus real result, prints its formatter output, and returns that classification's code (`src/cli.ts:955-964`).

## Recommended contract

| Condition | Dry run | Real run |
|---|---|---|
| No script conflict; all planned writes succeed | Exit **0**; show would-write actions and valid Next steps | Exit **0**; show written actions and valid Next steps |
| One or more desired script names have different consumer commands | Exit **1**; show would-write actions, each skipped script, and that setup would remain incomplete | Exit **1**; write non-conflicting scripts and other planned files, show written actions and each skipped script; state setup remains incomplete |
| Actual filesystem write fails | Cannot predict reliably; dry run reports the plan and any known script conflicts | Exit **1**; retain current partial-write failure report and safe rerun advice (`src/init.ts:540-553`) |

**Ordering and reporting.** Determine all script conflicts and non-conflicting additions in the plan, before any write (`src/init.ts:240-245`). Continue with non-conflicting writes; do not make a script conflict an all-or-nothing abort. This matches the scaffold's existing partial-write behavior (`src/init.ts:306-316`) and the acceptance requirement to add free scripts. List each conflicting script as `Skipped (existing command differs)` with its existing command; list added names under the package.json update in both predicted and actual sections. Exact matches are `Up to date`, not added or skipped. Use the same planned conflict set for both paths and one outcome classification for headline, advice, and exit status as ADR 0006 requires (`docs/adr/0006-shotwright-flags-parse-after-separator.md:53-58`). An actual write failure takes precedence over a known script conflict, while still showing the written/not-written action accounting (`src/init.ts:327-330,540-553`).

**Next steps.** Build script-command advice from the post-run (or predicted post-run) script state. A script is available only if its current command already equals shotwright's desired command or the package.json action actually wrote it. Never recommend `pnpm shots`, `shots:install`, or `shots:gallery` when that name is unclaimed; keep the non-Vite config-edit instruction before capture, as existing tests require (`test/unit/init.test.ts:111-120`; `test/smoke/cli.test.ts:1936-1949`). For a conflict, include resolution and safe-rerun advice, plus only available script commands; the direct `pnpm exec shotwright run` escape hatch remains valid (`src/init.ts:583-598`). Dry-run wording uses `would`; real-run wording explicitly says which files and scripts **were written** and: “Resolve the skipped script conflict and re-run `pnpm exec shotwright init`; existing scaffold files and scripts will be skipped safely.” If no actions were needed, say so rather than implying files were written.

**Exit-code documentation.** Add to README: 0 means the planned/actual setup has no unresolved script conflicts (even if user-owned files need review); 1 means a known script conflict or an actual error. For `--dry-run`, 1 predicts the known conflict but does not mean a write was attempted. Exit 1 after real init may still mean successful partial writes; read the Created/Updated/Skipped sections, resolve the conflict, and rerun. A dry run cannot promise parity for unforeseen I/O failures between preview and apply. Keep the CLI usage unchanged (`README.md:191-197`; `src/init.ts:75`).

## Conflict-resolution option

| Option | Benefit | Cost / risk | Decision |
|---|---|---|---|
| Preserve consumer script, add free names, guide manual rename or direct CLI | Small patch; no overwrite; deterministic rerun | Owner must resolve one name | **Recommended for this fix** |
| `--force-scripts` | Single-command resolution | Permanent CLI API; overwrites an explicitly owned consumer command and needs recovery semantics | Defer; only add with a separate use case and opt-in design |
| Script prefix | Avoids collisions without overwriting | Permanent naming/config surface touching docs, templates, and user expectations | Defer; needs evidence from multiple consumers |

The bead asks to consider an opt-in mechanism, not to ship one. The existing CLI accepts only `--dry-run` and `--package-manager` (`src/init.ts:75,98-114`), and the README publishes that narrow surface (`README.md:191-197`). A safe, manual resolution is already possible, so a new flag is disproportionate for this patch.

## Numbered implementation plan

1. **Model per-script outcomes in the init plan and package action.** Keep conflict detection before writes, but remove the early return that suppresses free additions (`src/init.ts:121-152,416-438`). Represent added, exact-match, and skipped names explicitly; apply only absent names after the existing package.json unchanged-since-plan check (`src/init.ts:432-437`). Pin: unit test with one conflicting `shots` and three free names verifies the old command byte-for-byte, all free commands, and a second run with no duplicate additions. Revisit the current tests that expect package.json unchanged for this case (`test/unit/init.test.ts:324-350`; `test/smoke/cli.test.ts:1912-1930`).
2. **Unify conflict outcome and output.** Make dry and real classification consult the same conflict set; preserve the single `InitOutcome` contract (`src/init.ts:323-350`; `docs/adr/0006-shotwright-flags-parse-after-separator.md:53-58`). Report each skipped script plus predicted/actual additions, written files, safe rerun, and dynamically valid Next steps (`src/init.ts:353-395,583-650`). Pin: extend the table-driven coherence cases (`test/unit/init.test.ts:84-235`) for dry/real conflict parity, multiple conflicts, exact-match scripts, fresh and already-created scaffolds, and no unclaimed script commands; verify real write-failure precedence.
3. **Exercise the built CLI and document semantics.** Update the README init section and exit-code meaning (`README.md:49-75,191-197`). Update the smoke conflict case so a built/packed CLI dry run and real run both exit 1, report the same script additions/skips with tense-appropriate file sections, retain the consumer `shots` command, add the other three scripts, avoid unclaimed Next steps, and succeed idempotently after conflict resolution (`test/smoke/cli.test.ts:1912-1930`). Add a patch Changeset targeting 0.5.1 under the established release process (`docs/adr/0012-release-tooling-changesets-and-gitleaks.md:22-26,34-41`). Run `pnpm run typecheck && pnpm run lint && pnpm run test`, the targeted smoke case, and the isolated CLI reproduction.

| Acceptance requirement | Step |
|---|---|
| Dry run reports conflict and matches real exit code/outcome | 2, 3 |
| Add free scripts; list every conflicting one as skipped | 1, 2, 3 |
| Next steps never name an unclaimed script | 2, 3 |
| State files were written and rerun is safe | 2, 3 |
| Document exit-code meaning | 3 |
| Decide opt-in resolution | Conflict-resolution option above |

## Risks and rollback

- This patch intentionally changes the existing “package.json unchanged on any conflict” behavior asserted in unit and smoke tests (`test/unit/init.test.ts:324-350`; `test/smoke/cli.test.ts:1912-1930`). Preserve the conflicting command exactly; update those tests to validate the new per-script rule.
- A package.json edit between planning and writing still fails the existing unchanged-since-plan guard (`src/init.ts:432-437`). Keep that check and report partial writes accurately. The plan does not promise atomicity across scaffold files; the current action loop is sequential and stops on its first I/O failure (`src/init.ts:306-316`).
- Rollback is reverting the patch release before adoption. Consumer files already written remain consumer-owned; rerunning the fixed init is the forward recovery path.

## Considered and declined

- Abort before *all* writes on a script conflict: would avoid a partial scaffold but would violate the requirement to add non-conflicting scripts and would leave less useful setup progress. Conflict detection already occurs before writes (`src/init.ts:240-245,296-303`).
- Exit 0 on a conflict because free scripts were added: would hide an unresolved desired command from automation; the current real-run contract already exits 1 (`src/init.ts:328-330`).
- Suggest `pnpm shots` when the consumer owns a different `shots` command: the README's example assumes init installed the desired script (`README.md:68-75`), so this would misdirect capture.
- Add `--force-scripts`, a prefix flag, or whole-init transactional rollback in this patch: each expands the permanent CLI or mutation contract beyond the reproduced failure (`src/init.ts:75,98-114,306-316`).

## Self-review and open questions

- **Measured-or-flagged:** pass; reproduction records observed statuses and file effects, with no performance claim.
- **Derived-value semantics:** pass; added, exact-match, and skipped script states are defined individually, including zero additions and multiple conflicts.
- **Emergent structure:** pass; `desiredScripts` has four names in iteration order (`src/init.ts:68-81,137-145`); output must preserve a stable per-name order, with no duplicate reporting.
- **Batch/concurrency:** pass with explicit limit; actions are sequential and non-transactional (`src/init.ts:306-316`), while package.json retains the unchanged-since-plan check (`src/init.ts:432-437`).
- **Inherited constraints grounded:** pass; README dry-run promise and ADR 0006 outcome rule are checked against current code above.
- **Open questions:** none blocking implementation. Exact output wording can be refined in tests while preserving the contract above.

## Redteam amendments (2026-10-29)

A plan redteam returned "proceed with changes"; both findings are adopted in this fix.

1. **Defer the skill while `shots` is unclaimed.** The generated skill tells users and agents to run `pnpm shots` (`templates/skills/shots-harness/SKILL.md:13`). Writing it while that name belongs to a different consumer command would publish false capture instructions. When the `shots` script is a conflict, plan no skill action, and report the skill as deferred until the conflict is resolved, in both dry and real runs. The safe re-run then writes it. Tests cover the conflicting `shots` case. Other skipped script names do not defer the skill.
2. **Failure reports list known skipped scripts.** `formatInitFailure` (`src/init.ts:540-553`) lists only actions, and a conflicting script has none. On an actual write failure, the report also lists every known skipped script beside the write error. Add a test.
3. **Changeset wording.** The patch changeset states plainly that `init --dry-run` now exits 1 when it predicts a script conflict.
