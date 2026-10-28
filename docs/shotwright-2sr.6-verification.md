# shotwright-2sr.6 — Verification

Run 2026-10-27 against `docs/shotwright-2sr.6-plan.md`, on bd 1.3.2 and Dolt
2.2.1. Every experiment ran on disposable data. The live board's issue count,
head, working-set status and global commit count were recorded before the
implementation slices, and matched after each of them.

## Results by plan step

| Step | Result |
| --- | --- |
| 1. Gate | **Pass.** An isolated bd project used its own `.beads` and a disposable `dolt sql-server` on a random loopback port, with isolation checked before any write. A `bd remember` row left `config` dirty. Then came the real `bd backup init` / `bd backup sync`, then `dolt backup restore`. Branch, WORKING root, `config` hash and status tuples matched the `bd sql --json` observation, and the row was present and uncommitted after restore. bd's pre-backup commit changed neither HEAD nor the WORKING root. |
| 2. `backup-push.sh` | **Done.** One post-sync observation; a snapshot of the manifest plus the archives it references; a restore from a digest-checked copy (restore writes an `oldgen` directory into its input); and exact equality on branch, WORKING root, status multiset and counts before publishing. A mismatch fails with `source changed or backup omitted data` and sends nothing. The state records `working_set_proof` and `archive_tree_sha256`. |
| 3. `backup-verify.sh` | **Done.** It recomputes the archive-tree digest on the destination with the same function, sent over ssh, and keeps the existing transport, known-commit, count and freshness checks. A legacy state reports `legacy copy: working-set coverage unproven` with exit 0 when the existing checks pass. A dirty local working set prints the plan's exact warning with exit 0. Python 3.8+ is checked on both hosts. |
| 4. Selftest and runbook | **Done.** 45 hermetic cases. They include real-shaped clean `bd` and Dolt CLI observations; a push-level gate negative (a mismatched restore gives a nonzero exit, no state, no publication); a valid manifest edit that fails on digest, not parse; and an unknown extra staging file that neither fails the push nor reaches the destination. `docs/backup.md` carries the plan's replacement text and a `dolt backup restore` drill in `$TMPDIR`. |

## Read-only rehearsals against real data

These ran outside the plan's steps, as reviewer checks. Nothing was written to
the board, the staging directory or the destination.

- **The staged archive restores to the live observation.** A copy of the real
  staging archive was taken with the manifest-based selection: 222 referenced
  files, digest computed. It was restored in scratch, and its normalized
  observation was byte-equal to a live `bd sql --json` observation.
- **This rehearsal found one fix-now bug before merge.** With a clean status,
  `dolt sql -r json` omits the null status keys; `bd sql --json` includes them
  as null. The first parser rejected the CLI shape, so every clean-board push
  would have refused to publish. The hand-written fixtures had hidden it. Fixed,
  with real-shaped selftest cases, and every other tool-output fixture was
  rechecked against a disposable run.
- **The new verifier passes the existing copy.** Run against the real
  destination, which still holds a pre-change state, it reported
  `legacy copy: working-set coverage unproven` and exited 0.
- **Both hosts have the required tools.** Python 3.11.2 on both;
  `sha256sum` on the destination.

## Checks

`bash -n` on every backup script; `scripts/backup-verify-selftest.sh` (exit 0);
`pnpm run typecheck && pnpm run lint && pnpm run test` (622 passed, 1 skipped);
`scripts/ci/verify.sh` (exit 0). Not measured: the digest's read cost over the
real network link. It was 24 MB in 0.025 s through a local transport stub, and
the first post-merge timer run will give the real figure.

## Redteams

- **R→P:** dropped fail-on-dirty, and led to the experiment that settled the
  premise.
- **P→I:** cut the plan to one observation and one digest; added the legacy
  path and the gate.
- **I→V:** four findings, all fixed: the Python preflight, the push-gate
  negative test, the digest-level manifest negative, and manifest-based
  snapshot selection.

## Acceptance

| Criterion (owner decision 2026-10-27: preserve and prove) | Status |
| --- | --- |
| A dirty working set is preserved and proven, not committed or failed | **Met** on disposable data (gate, end-to-end push) and by the real-archive rehearsal. |
| The verifier reports dirtiness rather than a bare OK | **Met.** Exact warning, exit 0. |
| A test or reproduction covers both | **Met.** Selftest cases plus `local/` disposable logs. |
| `docs/backup.md` records the behaviour | **Met.** |
| Upstream checked | **Met** in research: #4078 and PR #7608 are not in v1.3.2. |

The first real working-set proof lands with the first timer run after merge.
Until then the destination stays a legacy copy, and the verifier says so.
