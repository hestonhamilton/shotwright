# Beads backup — how it works and how to check it

The board lives in a Dolt database on a shared `dolt sql-server`. This is how a
copy of it gets off that machine, and how you find out when that has stopped
happening.

Design decisions: **ADR 0013** (layered backup), **ADR 0014** (layer B is not a
`file://` share), **ADR 0016** (layer B is rsync-over-ssh of a copy proven by
restore, and what was wrong before). Plan: `docs/shotwright-2sr.2-plan.md`.

## The one thing to know

**`bd backup status` is not evidence.** On 2026-08-02 it reported a backup
seconds old, every 15 minutes, for a directory that contained a different,
empty database — 0 issues where the board had 68. It reports on whatever directory it
is pointed at, not on whether the board is in it.

Nothing in this repo reads it. Use `scripts/backup-verify.sh`.

## What runs

| | |
|---|---|
| `scripts/backup-push.sh` | Makes a backup, **restores it and counts it**, sends it over ssh, reads the destination back. One database per run. |
| `scripts/backup-verify.sh` | Goes and looks at the destination. Answers "is there a real, current, non-empty copy of this board off this machine". Fails closed. |
| `scripts/backup-verify-selftest.sh` | Proves the checker can fail. Runs in `scripts/ci/verify.sh`; needs no NAS and no bd. |
| `scripts/backup-install.sh` | Installs the systemd user timer that runs the push. |

The destination is `<host>:<path>` in `SHOTWRIGHT_BACKUP_DEST`. It is **not in
this repository and must not be** — the repo is headed public and a NAS address
is exactly the shape of string the leak gate does not catch
(`shotwright-746.18.3`). The systemd unit carries it and is generated at install
time.

## Checking it by hand

```sh
export SHOTWRIGHT_BACKUP_DEST=<host>:<path>       # from the installed unit
scripts/backup-verify.sh                          # this project
scripts/backup-verify.sh --project <path-to-consumer-checkout>
```

Green looks like:

```
backup-verify: OK — destination is current at qk4ve6tv7i5v… (2s old, 1 archives, 68 issues / 369 commits)
```

The issue and commit counts are the part that matters. Everything else in that
line was also true of the empty backup.

## Checking the timer

```sh
scripts/backup-install.sh --status
systemctl --user list-timers shotwright-beads-backup.timer
journalctl --user -u shotwright-beads-backup.service -n 50
```

A failed run triggers `shotwright-beads-backup-alert.service`. The timer is
`Persistent=true`, so a missed run catches up rather than being skipped.

## Installing or moving it

```sh
scripts/backup-install.sh \
  --dest <host>:<path> \
  --project . \
  --project <path-to-consumer-checkout> \
  --interval 30min --now
```

Each `--project` becomes its own step, so a failure names the database rather
than "the backup". `--uninstall` removes all three units. Requires
`loginctl enable-linger "$USER"` for the timer to run while logged out; enable it once on the host.

## Restoring

The drill, and what to do for real. Never restore onto the live database.

```sh
rsync -a <host>:<path>/shotwright/ /tmp/restore-src/
dolt clone file:///tmp/restore-src /tmp/restored
cd /tmp/restored
dolt sql -q "select count(*) from issues;"
```

Recorded drill, 2026-08-02, from the NAS destination into a fresh database:
68/68 issues (matching on `md5(close_reason)`, not just count), 104/104
dependency edges, 369 commits, zero rows differing in either direction.

## What is NOT covered

- **Off-site — deliberately, see ADR 0017.** This is a decision, not an
  oversight: ADR 0013's layer D was weighed and dropped.
- **A second database.** Currently empty (0 issues), and its automatic backup
  destination points at *shotwright's* backup directory — the bd defect behind
  the empty-backup incident. Not fixed here. `shotwright-2sr.5`.
- **`.beads/backup/`.** Written by bd, read by nothing here. Do not add anything
  that trusts it.

## Why `bd dolt push` no longer reaches GitHub

`shotwright-2sr.4` deleted `refs/dolt/data` and
`refs/heads/__dolt_remote_info__` from the shotwright repository. A single
`bd dolt push` put both straight back, with new hashes — so the deletion had to
be made to stick before it meant anything.

**The control is the Dolt remote named `origin`.** It now points at a local
path instead of GitHub:

```sh
bd dolt remote list      # origin -> a local file:// path
```

`bd dolt push` writes there and nothing leaves the machine. Verified: deleted
the refs, ran `bd dolt push` twice with a board write in between, and
`git ls-remote` still shows no Dolt refs.

Three things that do **not** work, all measured, so nobody retries them:

| Attempted control | What happens |
|---|---|
| `bd dolt remote remove origin` | Next push prints *"Configured Dolt remote origin from git origin"* and pushes to GitHub anyway |
| `bd config set/unset sync.remote` | `bd dolt push` ignores this key entirely. Setting it to a local path still pushed to GitHub. `unset` also does not remove it from `config.yaml` |
| git `pre-push` hook rejecting `refs/dolt/*` | Never fires. Dolt speaks the git wire protocol over ssh natively and does not shell out to `git`, so no git-side hook can see the push. Note `core.hooksPath` is `.beads/hooks`, not `.git/hooks` |

bd only auto-derives a remote from the git remote when `origin` is **absent**.
Point it somewhere harmless and it is left alone.

### The caveat that matters

**This control is not in the repository.** It therefore does **not** survive a
fresh clone, and anyone who runs `bd dolt remote remove origin` re-arms the
original behaviour.

There is no repo-level equivalent, because the key that *is* tracked
(`sync.remote` in `.beads/config.yaml`) is not what `bd dolt push` reads.

So the public-flip checklist must verify by looking, not by trusting:

```sh
git ls-remote <repo> | grep dolt      # must return nothing
```

Beware also that bd **auto-commits `.beads/config.yaml`** whenever a dolt remote
is added or removed, including any absolute host path it contains. Six
such commits appeared on a branch during `2sr.4` and had to be dropped. Check
`git log` after any `bd dolt remote` operation.
