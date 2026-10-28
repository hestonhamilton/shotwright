# shotwright-2sr.6 — Plan: prove working-set backup coverage

## Goal and binding decisions

Priority **P2**. Preserve the checked-out branch's working set in the existing `bd backup sync` archive, prove a snapshotted archive by `dolt backup restore`, and read back the published bytes. A dirty local working set is a warning and does not by itself fail a proven backup. These are the owner's 2026-10-27 decisions.

The bead's original claim that uncommitted rows were absent from the archive was an inference. The measured gap is that the existing clone/count proof and verifier cannot see those rows. The original “commit it or fail” alternative is superseded by preserve-and-prove; the backup job must not run `bd vc commit`. The prior disposable SQL `DOLT_BACKUP('sync')` experiment retained an uncommitted `config` row through `dolt backup restore`, but did not exercise `bd backup sync`. Step 1 gates implementation.

## Proof contract

Keep the existing pre-sync nonempty issue floor and issue/commit count lower bounds. After `bd backup sync`, take **one** read-only `bd sql --json` source observation. Snapshot the staging archive using the existing manifest-stability loop, then run `dolt backup restore` on **that snapshot** in disposable storage. The runtime equality gate compares the source observation with the restore: `active_branch()`, `dolt_hashof_db()` for the checked-out branch's WORKING root, and the complete sorted multiset of `(table_name, staged, status)` tuples from `dolt_status`. Compare cardinality and values, including the empty-status case. A one-row source left joined to `dolt_status` must still return scalar values when status is empty. Reject null or missing scalar fields, malformed tuples, duplicate fields, and disagreement among repeated scalar fields. Do not log SQL result JSON, `config` keys, or row values.

`dolt_hashof_table('config')` is an **experiment assertion in step 1 only**. It is not a runtime equality gate or separate proof field. The WORKING root covers changes to `config` and other versioned tables even when their status tuple stays `modified`. Step 1 must establish that the actual bd source query and CLI restore agree on this root before step 2 uses it. This comparison proves the checked-out branch's WORKING root and status; it does not inspect every branch's working set.

If the source and restored snapshot differ, fail the run **without publishing**. Emit `source changed or backup omitted data`; the proof cannot distinguish those causes. The next timer run is the retry. A source write after the observation can cause a mismatch, while a write after the snapshot proof belongs to a later backup. The manifest-stability loop only retries copying a moving staging archive; it does not trigger a second sync or whole-cycle retry.

## Destination and rollout contract

Keep the two-pass, manifest-last rsync publication. After the restore proof, calculate one canonical SHA-256 archive-tree digest from the snapshot and put it in producer-authored state with an explicit working-set proof marker. The tree consists of `manifest` and the archive files it references; the state file and staging `LOCK` are outside the tree. Encode each relative POSIX name and its file bytes unambiguously with length prefixes, sort names bytewise in the C locale, and reject duplicate names, missing or extra entries, symlinks, directories where files are required, and all other non-regular entries. The remote verifier recomputes the **same digest over destination bytes**, validates the tree, and compares it with state. This is one aggregate digest: no persisted per-file inventory, separate file count, or numeric format version. The existing archive-count check remains an independent sanity check, not a second proof field. A manifest hash alone does not prove archive bytes. State plus archive remain producer-authored evidence; replacement of both is outside this proof.

Measure the remote read and hash cost on a representative disposable archive in implementation and record elapsed time and bytes read. If a full read is too slow for every standalone verification or timer run, stop before weakening the claim and raise a measured cadence or alternate proof design to the owner. Do not silently turn standalone verification into a metadata-only check.

Keep the existing destination reachability, known-commit, nonempty-board, archive-count, and freshness checks. An old state without the new marker and digest is a **legacy copy**: run those existing checks, retain its archive, and report `legacy copy: working-set coverage unproven` separately. If those checks pass, exit **0 with the legacy warning**, without an OK claim for working-set coverage; if any fails, exit **nonzero** with its normal failure. A state that claims the new proof but has malformed or missing proof fields, or a destination digest mismatch, exits nonzero. A successful new push replaces the legacy state only after proof and publication. Keep the old archive intact through transition and rollback.

For a newly proven copy, the OK wording must say that the checked-out branch's WORKING root and status matched a disposable restore, and that destination bytes matched the proven snapshot. It must not imply that every branch was inspected. After successful content verification, query current local `dolt_status`. If nonempty, print this exact line to stderr and still exit **0**:

> `backup-verify: WARNING — local Dolt working set is dirty now; this check proves the recorded snapshot, which may differ from the current working set.`

This warning also appears after a successful push because push invokes the verifier. An unreadable local status query is a verification failure.

## Numbered steps

1. **GATE — prove the actual bd path in isolation.** Use bd 1.3.2 in a new disposable project with its own `.beads` and database. Start a disposable Dolt sql-server rooted in disposable data on a random loopback port; initialize with `bd init --server --server-host --server-port`. Confirm `bd context` and connection identity point only to that disposable server **before any write**. Never aim the test at the shared server; `bd -C` alone does not establish isolation. Create a committed baseline and a `config`-only dirty row, then run the actual `bd -C <disposable-project> backup init` and `bd -C <disposable-project> backup sync`. Restore the resulting archive with `dolt backup restore` into a disposable directory. Show that the row remains uncommitted and compare branch, WORKING root, full sorted status tuples, and `dolt_hashof_table('config')` between a `bd sql --json` observation and the CLI restore. Record whether bd's precommit, backup registration, or ignored tables affect the hashes; identify any difference before proceeding. Stop the disposable server and remove its data. **Step 2 depends on this gate passing.** If isolation or hash agreement cannot be established, stop and raise the blocking fact in Open questions; do not run the experiment against the shared server.
2. **Change `scripts/backup-push.sh`.** Retain the pre-sync floor, sync once, take the post-sync observation, snapshot with the existing manifest-stability loop, restore that exact snapshot, and compare the runtime equality fields. Fail a mismatch with the specified diagnostic and no publication. After a passing restore, calculate the canonical archive-tree digest and write the new proof marker and digest to state; publish with the existing content-first, pointer-last rsync. A disposable fixture must show a retained dirty `config` row and failed publication when the restored row/root/status is omitted or changed. Run `bash -n scripts/backup-push.sh`. Roll back with step 3 while retaining the last complete destination archive.
3. **Change `scripts/backup-verify.sh`.** Recompute and compare the destination archive-tree digest for new proof states, preserve existing transport/freshness/count checks, implement the explicit legacy exit semantics, and print the precise dirty-local warning after a successful new proof. Measure remote read cost on a representative disposable archive and record elapsed time and bytes. Verify clean and dirty success, legacy success and failure, malformed new state, altered destination bytes, and unreachable destination with hermetic fixtures; run `bash -n scripts/backup-verify.sh` and `scripts/backup-verify-selftest.sh`. Roll back push and verifier together, without deleting the last complete archive.
4. **Extend `scripts/backup-verify-selftest.sh` and update `docs/backup.md`.** Keep the selftest hermetic: fixture directory and SSH stub, with no live board or real destination. Cover positive clean and dirty copies, an omitted or altered working row/root/status in the snapshot proof, changed manifest or archive bytes, missing/extra/non-regular tree entries, legacy state with passing and failing existing checks, malformed new proof, and transport failure. Use step 1's real restore to anchor fixture semantics. `scripts/ci/verify.sh` already invokes the selftest. Replace the `scripts/backup-verify.sh` table cell with this exact text: **“Goes and looks at the destination. Checks a recent, non-empty board and reads back the complete archive-tree digest against the snapshot whose checked-out WORKING root and status matched a disposable restore. For a newly proven copy, OK means destination bytes match that snapshot; it does not claim all branches were inspected. Warns with exit 0 when the local working set is dirty now. A legacy copy can pass the existing checks with exit 0, but reports ‘legacy copy: working-set coverage unproven’ separately. Fails closed on failed checks or malformed new proof.”** Change the restore drill to copy into `$TMPDIR` scratch space and use `dolt backup restore` instead of `dolt clone`; remove the scratch directory after the drill. Run `scripts/backup-verify-selftest.sh`, `scripts/ci/verify.sh` in the normal CI environment, and check that the old clone drill and old open-bead warning are gone from `docs/backup.md`.

## Acceptance mapping

| Bead criterion under the owner decision | Steps |
| --- | --- |
| Detect a dirty pre-backup working set and preserve and prove it | 1, 2 |
| Report current local dirtiness without failing a proven copy | 3, 4 |
| Demonstrate preserved rows and fail when proof omits or changes them | 1, 2, 4 |
| Prove published bytes and preserve existing reachability/freshness/count checks | 2, 3, 4 |
| Document verification, legacy rollout, and a WORKING-preserving restore drill | 4 |
| Check upstream producer behavior | Research cites the bd 1.3.2 path; step 1 tests that path directly. |

## Risks, rollback, and self-review

- **Measured or flagged — flag:** prior Dolt restore behavior was measured only through SQL backup. The bd path is pinned by step 1. Remote hashing cost is unmeasured and pinned by step 3; a slow result triggers the owner decision described above.
- **Derived values — pass:** branch and WORKING root must be present; status is a sorted multiset including empty status; the archive-tree digest has a fixed name/byte encoding and rejects missing, extra, duplicate, or non-regular entries. Steps 1–4 exercise these cases.
- **Emergent structure — pass:** the archive tree includes manifest plus referenced archive bytes; one digest binds names and content. The proof covers the checked-out branch, with no claim about other branches. Steps 2–4 pin both properties.
- **Batch/concurrency — flag:** one post-sync observation can race a writer, so step 2 requires restore equality and fails publication on mismatch. The next timer run retries. Manifest stability pins the snapshot, and manifest-last rsync is the publication boundary.
- **Inherited constraints — pass:** the pre-sync floor and existing destination checks remain; step 1 verifies the bd 1.3.2 assumption without the shared server. No raw `dolt` command touches the shared server.

Rollback reverses push, verifier, selftest, and runbook together while retaining the last complete destination archive. The legacy path keeps checks meaningful during rollout; it does not grant working-set proof to an old copy.

## Redteam outcome

1. Cut pre-sync A, A/B comparison, and whole-cycle retry; one post-sync observation is compared with the restored snapshot, and mismatch fails this run.
2. Replaced per-file inventory, separate file count, and numeric format version with one canonical archive-tree digest; remote cost is measured before accepting every-check use.
3. Made the isolated bd 1.3.2 sync/restore experiment a gate for step 2, with connection identity checked before writes.
4. Kept branch, WORKING root, and complete status tuples as runtime equality; `config` hash is an experiment assertion only.
5. Added legacy-copy reporting with explicit exit codes and retention of the old archive through transition.
6. Replaced the warning with timeline-neutral wording and narrowed OK to the checked-out branch and proven destination bytes.
7. Declined: no headed-public leak was found in the plan; the restore drill still switches to `$TMPDIR`.

## Open questions

None before step 1. If the disposable bd project/server cannot be isolated, or its `bd sql --json` source observation does not hash-match the CLI restore for identical rows and status, stop before step 2 and raise the specific discrepancy to the owner.
