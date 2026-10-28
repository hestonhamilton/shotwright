# shotwright-2sr.5 — Verification

Run 2026-10-27 against `docs/shotwright-2sr.5-plan.md`, on bd 1.3.2 across the
shared server. Full registration URLs are kept in local evidence only; below,
`<shotwright>/.beads/backup` and `~/.local/state/beads-backup/shotwright` stand
in for them.

## Results by plan step

| Step | Result |
| --- | --- |
| 1. Pre-state | **Pass.** `beads_global`: one row, `backup_export → <shotwright>/.beads/backup`. `shotwright`: `backup_export → <shotwright>/.beads/backup` and `default → ~/.local/state/beads-backup/shotwright`. Both match the plan exactly. `scripts/backup-verify.sh`: OK, 157 issues / 966 commits. |
| 2. Removal | **Pass.** `BD_BACKUP_ENABLED=0 bd --global sql "CALL DOLT_BACKUP('rm', 'backup_export')"` returned status 0. The separate `SELECT DATABASE()` afterwards returned `beads_global`. The global registration set is `[]`, and shotwright's two rows are byte-identical to step 1. This is the first empirical run of the CALL, which the plan had supported from source only. |
| 3. Persistence | **Pass, for the dated register.** One `bd --global sql 'SELECT DATABASE() AS db'`, with no backup override, from each of the six listed workspaces (shotwright, shotwright-2sr.5, redteam-leak-gate clone, redteam-release-path clone, trove, trove-bid). All six returned `beads_global`. The global registration set was `[]` after the pass and again after a re-run. After the 17:20 scheduled timer run (result `success`), `scripts/backup-verify.sh` reported OK: current, 30s old, 162 issues / 978 commits; the global registration set was still `[]`. |
| 4. Runbook | **Done.** `docs/backup.md`: the second-database and `.beads/backup/` bullets were replaced with the plan's exact text, the dormant-registration sentence was added, and the `backup-verify.sh` row was qualified for `shotwright-2sr.6`. The 2026-08-02 incident text is unchanged. Prettier-clean. |
| 5. Upstream report | **Not done; does not gate the repair.** It stays a local draft until the owner decides on posting. |

## Deviations and corrections

- The first persistence loop parsed a fixed output line. In the two redteam
  clones, bd prints two permission warnings first, so the loop recorded `db`
  instead of the database name. A raw re-run showed `beads_global` for both. The
  loop's recorded exit codes came from `sed`, not bd. Neither changes the
  result. Both are recorded in the local evidence.

## Acceptance

| Criterion | Status |
| --- | --- |
| `beads_global` no longer points at or writes into a project's `.beads/backup` | **Met** for the register on 2026-10-27, per steps 2–3. Not a claim about unknown or future clients, or about a later explicit `backup.enabled` opt-in. |
| Shotwright's manual off-machine path remains intact and trusted | **Met.** `default` is unchanged; `backup-verify.sh` passed before the repair and after the next timer run (step 3). |
| Collision is reported upstream | **Open.** The draft is not posted; the owner decides whether it is posted and by whom. |

`.beads/backup/` is left on disk as untrusted incident evidence, per the plan.
Whether to restore and clean it up is the owner's open question 2.
