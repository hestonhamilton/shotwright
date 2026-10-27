# shotwright-2sr.5 — Plan: remove the global backup collision

## Goal and current pins

Remove **only** `beads_global`'s `backup_export` registration from shotwright's `.beads/backup` destination, then check its absence after one normal-environment pass through the dated shared-server workspace register. Do not change shotwright's `default` registration: `scripts/backup-push.sh` depends on that manual staging destination. The separate `shotwright-2sr.6` owns the script's omission of uncommitted working-set rows; it does not change this registration repair or the trust gate.

Measured 2026-10-27 after the fleet upgrade: the inventoried shared-server clients are bd 1.3.2; all shared-server databases reached schema v66 with unchanged issue counts; `backup.enabled` and `BD_BACKUP_ENABLED` are unset for the six checkouts in the register below (explicitly false in some unrelated repositories). The [v1.3.2 auto-backup code](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/backup_auto.go#L19-L42) defaults it off in server mode, but an explicit override can enable it (read 2026-10-27). The upgrade is complete, so the research document's proposed upgrade step is obsolete. Both `SELECT DATABASE()` pins work: `bd sql` selects `shotwright`, and `bd --global sql` selects `beads_global`. Both still register `backup_export` at shotwright's `.beads/backup`; shotwright also registers `default` at `~/.local/state/beads-backup/shotwright`. No write to `.beads/backup` has been observed since the upgrade swap. These are registration facts, not proof of backup contents.

`bd doctor` 1.3.2 reports `Phantom Databases: beads_global`, but its check runs `SHOW DATABASES` and flags **any** `beads_*` or `*_beads` name other than the current configured database; it does not test whether that name is inaccessible ([`cmd/bd/doctor/dolt.go:565-630` at v1.3.2](https://github.com/gastownhall/beads/blob/v1.3.2/cmd/bd/doctor/dolt.go#L565-L630), read 2026-10-27). Here, `SHOW DATABASES` lists `beads_global` and `bd --global sql` queries it. Treat this warning as a naming-rule false positive for this plan. Do **not** restart the server or drop a database because of the warning. If the global pin fails later, stop and investigate connection health before any removal.

## Numbered steps

Each step is an implementation or verification chunk. Run commands from the shotwright repository root unless a command says otherwise. `--json` avoids truncating the destination URL. The write in step 2 requires the owner's authorization under the repository rules; this plan executes no database write.

1. **Pin the exact pre-state and the trusted copy.** Immediately before the write, record the selected database and both complete registration sets. Check the independent manual backup once. If the executable or a listed client's backup policy has changed since the dated register below, stop and revise the plan. Run:

   ```sh
   BD_BACKUP_ENABLED=0 bd --global sql --json 'SELECT DATABASE() AS db, name, url FROM dolt_backups ORDER BY name'
   BD_BACKUP_ENABLED=0 bd sql --json 'SELECT DATABASE() AS db, name, url FROM dolt_backups ORDER BY name'
   scripts/backup-verify.sh
   ```

   **Verify:** the first SQL result has exactly `beads_global / backup_export / shotwright .beads/backup`; the second has exactly `shotwright / backup_export / shotwright .beads/backup` and `shotwright / default / ~/.local/state/beads-backup/shotwright` (compare the complete URLs, allowing for expanded `~`). The verifier must pass. If any registration differs, stop and revise the plan. **Rollback:** no mutation in this step; retain the prior registration and restore the trusted backup service if its verifier failed before proceeding.

2. **Remove the one global registration.** Quiesce concurrent global backup administration for this brief SQL operation. Keep the environment override on the write and its immediate post-state checks. Execute in this order, without substituting `bd backup remove` or omitting `--global`:

   ```sh
   BD_BACKUP_ENABLED=0 bd --global sql "CALL DOLT_BACKUP('rm', 'backup_export')"
   BD_BACKUP_ENABLED=0 bd --global sql 'SELECT DATABASE() AS db'
   BD_BACKUP_ENABLED=0 bd --global sql --json 'SELECT DATABASE() AS db, name, url FROM dolt_backups ORDER BY name'
   BD_BACKUP_ENABLED=0 bd sql --json 'SELECT DATABASE() AS db, name, url FROM dolt_backups ORDER BY name'
   ```

   **Verify:** the separate post-CALL selector query returns `beads_global`, the global registration query returns zero rows, and the shotwright registration set is byte-for-byte the same as in step 1. The zero-row query cannot itself prove which database was selected; the pre-write result, `--global` selector, and separate post-CALL selector query provide that guard. Source inspection supports this scoped `CALL`, but it has not been tested empirically ([`internal/storage/versioncontrolops/backup.go:65-103` at v1.3.2](https://github.com/gastownhall/beads/blob/v1.3.2/internal/storage/versioncontrolops/backup.go#L65-L103), read 2026-10-27). **Rollback:** if the wrong database was selected or shotwright's rows changed, stop; restore its registration only from the recorded pre-state using an authorized, database-scoped `DOLT_BACKUP('add', name, url)` after pinning `SELECT DATABASE()` again. If global removal itself must be reversed, the equivalent global `add` restores the recorded URL, but that deliberately reopens the collision; use it only while isolating a failure. Never alter `default` as a rollback shortcut.

3. **Preserve the stale directory and verify persistence.** Do not delete, move, or trust `.beads/backup` in this bead. On 2026-10-27, its `backup_state.json` named a commit found in shotwright's `dolt_log` and absent from `beads_global`'s, but that state file is workspace-local and does not identify the current archive. The earlier restore proved it held `beads_global` then. The manifest and archive contents cannot be identified conclusively with the permitted read-only bd queries; proving the current contents would require a disposable restore, outside this plan's read-only inspection. Its historical contents may include both databases' chunks. Preserve it for evidence and avoid a destructive cleanup decision based on its timestamp or state file.

   **Read-only shared-server register, 2026-10-27.** This register was built from installed `.beads/metadata.json` and config files under `~/projects` and comparable home checkouts, plus `bd --version` and the normal shell environment in each checkout. Only databases on the shotwright shared server are in scope; other local or embedded bd stores are excluded. The name identifies the checkout, not a filesystem path. `backup.enabled` is unset in each active config, `BD_BACKUP_ENABLED` is unset in each normal shell, and bd 1.3.2's server-mode default makes the effective value **false**.

   | Workspace name | Database | bd version | `backup.enabled` | `BD_BACKUP_ENABLED` | Effective auto backup |
   | --- | --- | --- | --- | --- | --- |
   | shotwright | shotwright | 1.3.2 | unset | unset | off |
   | shotwright-2sr.5 | shotwright | 1.3.2 | unset | unset | off |
   | redteam-leak-gate clone | shotwright | 1.3.2 | unset | unset | off |
   | redteam-release-path clone | shotwright | 1.3.2 | unset | unset | off |
   | trove | trove | 1.3.2 | unset | unset | off |
   | trove-bid | trove | 1.3.2 | unset | unset | off |

   After removal, run **one** read-only `bd --global sql 'SELECT DATABASE() AS db'` from each listed workspace in its normal environment, with no `BD_BACKUP_ENABLED=0` override. Record the operator, timestamp, workspace name, command completion, and result for each. Then run one global registration query from shotwright:

   ```sh
   BD_BACKUP_ENABLED=0 bd --global sql --json 'SELECT DATABASE() AS db, name, url FROM dolt_backups ORDER BY name'
   ```

   **Verify:** each workspace command selects `beads_global`, and the subsequent registration query returns zero rows. This proves absence after one pass through the **listed register on 2026-10-27**; it does not prove anything about unknown or future clients or later explicit opt-ins. After the next scheduled timer run, run `scripts/backup-verify.sh` once to check the independent manual path. That timer check does not exercise global auto backup unless the timer itself issues `--global`. Do not repeat the global persistence pass merely because the timer ran. **Rollback:** if `beads_global.backup_export` reappears, stop using `.beads/backup`, find the enabling client and disable its automatic backup before repeating step 2. If shotwright's `default` or the verifier fails, restore the prior manual configuration or service from the recorded pre-state and investigate; do not count the automatic directory as a substitute.

4. **Update the runbook after the recorded result.** In `docs/backup.md`, replace the **whole** second-database bullet under “What is NOT covered” with this exact text, substituting the actual removal date if it differs:

   > - **A second database.** On 2026-10-27, `beads_global` had no `backup_export` registration after the scoped removal and the listed shared-server workspace checks. This is a dated registration result, not a guarantee about future clients or a claim about that database's contents. `shotwright-2sr.5`.

   Replace the `.beads/backup/` bullet with:

   > - **`.beads/backup/`.** Historical, untrusted material from bd's automatic backup path. Its current archive contents are not proven. Nothing here reads it; do not use it as a restore source or publish it without a separate content and retention review.

   Keep the 2026-08-02 incident paragraph as historical text. Qualify the verifier's “current board” sentence in the `scripts/backup-verify.sh` table entry with this exact replacement:

   > Goes and looks at the destination. Checks for a real, recent, non-empty copy of the committed board off this machine. While `shotwright-2sr.6` is open, a green check does not prove uncommitted working-set rows are in that copy. Fails closed.

   Add this sentence immediately after the replacement bullets: “Shotwright's own `backup_export` registration remains in place but is dormant under the current server-mode default; its manual `default` registration is unchanged.” Keep `scripts/backup-verify.sh` as the manual-path trust gate. Verify the prose against the step 2 and 3 results, and keep complete `file://` destinations in local evidence only. **Rollback:** if persistence fails before the runbook edit, retain the historical incident wording and defer the dated result; if the edit is inaccurate, correct that prose from recorded evidence.

5. **Prepare the upstream report separately; it does not gate registration repair.** Correct `local/beads-backup-collision-report.md` before any upstream posting: distinguish the historical bd 1.1.0 incident from the current 1.3.2 fleet; state that server-mode auto backup now defaults **off**, with explicit opt-in still able to collide; replace the claim that the first global command caused the registration with the conditional mechanism (auto backup enabled, due, and a changed commit). Keep historical counts and head matches explicitly dated, not current measurements. Clarify that `backup_state.json` and `bd backup status --global` are workspace-local signals, and that `default` is a separate manual registration. Replace its hardcoded temporary clone path with `$TMPDIR` or a portable disposable directory; scrub all host paths from public text. Make the workaround say that manual init/sync does not remove `backup_export` and that restore/content proof is required. Cite [#2962](https://github.com/gastownhall/beads/issues/2962) for same-database name conflict, [#2993](https://github.com/gastownhall/beads/issues/2993) for broader redesign, [#3594](https://github.com/gastownhall/beads/issues/3594) for remote-server path selection, [#5209](https://github.com/gastownhall/beads/issues/5209) and [#5742](https://github.com/gastownhall/beads/issues/5742) for misleading status, [#3878](https://github.com/gastownhall/beads/issues/3878) for concurrent `rm`/`add`, and [#4070](https://github.com/gastownhall/beads/issues/4070) for manifest/chunk inconsistency (all read 2026-10-27). Those are related reports, not the exact cross-database collision. **Verify:** review the draft against the dated local measurements and links, then search it for host-specific paths before presenting it to the owner. **Rollback:** keep the report as a local draft and correct inaccurate text. Posting is the owner's call; this step does not post it.

## Risks and rollback

The high-risk action is selecting the wrong database for `rm`; the pre-write registration sets, separate post-CALL selector query, and immediate registration rows are its deterministic pin. The concurrency risk is a client explicitly enabling automatic backup after removal; the dated client register and one workspace pass bound the observed result, while later opt-ins require a separate check. A failed `scripts/backup-verify.sh` is a backup failure even if registration checks pass. The on-disk automatic archive is outside the trusted path, so this plan neither uses it as a rollback copy nor deletes it. The `shotwright-2sr.6` working-set issue remains a separate limitation of the current script.

## Acceptance criteria and mapping

| Acceptance bullet | Step and evidence |
| --- | --- |
| `beads_global` no longer points at or writes into a project's `.beads/backup` | Steps 1–2 pin and remove its only `backup_export`; step 3 checks absence after one pass through the dated workspace register. Any reappearance fails acceptance. |
| Shotwright's manual off-machine path remains intact and trusted | Steps 1–3 preserve `default`; step 1 checks the manual path before repair and step 3 checks it after the next timer run. Step 4 keeps that qualified gate in the runbook. |
| Collision is reported upstream | Step 5 produces a corrected, reviewable draft independently of repair. The bead's literal “reported upstream” criterion remains open until the owner chooses to post and the issue URL is recorded; do not claim this criterion complete from a draft. |

## Considered and declined

| Alternative | Reason declined |
| --- | --- |
| Remove shotwright's own `backup_export` too | It is dormant with the current server-mode default, and its registration alone no longer causes the cross-database collision once global is removed. Removing it adds another database write and rollback surface without satisfying an extra acceptance criterion. Revisit only if an explicit shotwright auto-backup opt-in is found. |
| Remove or move `.beads/backup` now | Its present archive identity is not proven by permitted inspection; it is untrusted but may be useful incident evidence. Cleanup is a separate, explicitly reviewed decision after a disposable restore if wanted. |
| Use `bd --global backup remove` or `bd --global backup init` | The research found `remove` returns early when `default` is missing, while `init` adds `default` without clearing `backup_export`; neither targets this row. |
| Change fleet-wide backup policy or restart the server | The fleet is already upgraded and defaults off where relevant. Broader changes create collateral risk; the doctor warning is explained by its name filter. |
| Trust `bd backup status`, file freshness, or a successful sync | None proves the directory contains shotwright's database; [#4070](https://github.com/gastownhall/beads/issues/4070) also shows a manifest can get ahead of chunks (read 2026-10-27). |

## Redteam outcome

- **Applied findings 1, 2, 3, and 8:** dated finite workspace register and one persistence pass; exact whole-bullet runbook replacements and working-set qualification; separate post-CALL database pin; repeated inventory, pins, and verifier removed; upstream report separated from repair.
- **Declined findings 4–7 and 9:** retain the scoped CALL, default-off source conclusion, historical directory, and shotwright registration; keep the existing public-text controls. The CALL is supported by source inspection, not an empirical test.

## Open questions for the owner

1. After reviewing the corrected upstream draft, should it be posted, and by whom? Until then the upstream-report acceptance bullet stays open.
2. Is a later disposable restore and cleanup of the historical `.beads/backup` directory wanted? This repair leaves it intact.

## Plan self-review

- **Measured or flagged — pass:** version, schema, registration, and state-file observations are dated; persistence is explicitly pending implementation.
- **Derived-value semantics — pass:** a zero-row global registration means no registered global destination, not that the archive is valid; freshness and state-file commits do not identify archive contents.
- **Emergent structure — pass:** registrations are per database while URLs can coincide; shotwright's `default` and `backup_export` are independent rows.
- **Batch and concurrency — pass:** one scoped SQL removal is followed by immediate post-state and one dated-register persistence pass; concurrent global backup administration is quiesced for the write.
- **Inherited constraints grounded — pass:** `scripts/backup-push.sh` uses manual `init`/`sync`, and ADR 0016 plus `docs/backup.md` exclude `.beads/backup` from the trusted path. The separate working-set defect remains with `shotwright-2sr.6`.
