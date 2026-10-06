# ADR 0014 — Layer B backs up to a network endpoint, not a mounted share

- **Status:** accepted
- **Date:** 2026-08-02
- **Bead:** `shotwright-2sr.2`
- **Phase the decision landed in:** P
- **Amends:** ADR 0013 (layer B only)

## Context

ADR 0013 established a three-layer off-machine backup for the bd board: a Dolt
remote for sync (A), a `dolt backup` for full state including working sets (B),
and a private GitHub repository as the only off-site copy (D). For layer B it
specified *"`dolt backup` to a NAS filesystem share"*.

`shotwright-2sr.2` then measured how `bd backup sync` behaves when its
destination is broken — the epic's first question, which ADR 0013 could not
answer because R had deliberately left it to experiment. Measured 2026-08-02 in
an isolated scratch bd project; full transcript in
`docs/shotwright-2sr.2-plan.md` §2.1:

| Destination state | Exit | Operator sees |
|---|---|---|
| `file://` path **absent** | **0** | `Backup synced in 18ms`, status shows a fresh timestamp |
| `file://` path unwritable | 2 | Go nil-pointer panic |
| network URL unreachable | 1 | `could not access dolt url … i/o timeout` |

The first row is the unmounted-NAS case, and it is silent. An unmounted NFS or
SMB mountpoint is an ordinary empty local directory; Dolt cannot distinguish it
from a legitimate empty destination, so it **recreated the destination path on
local disk, wrote a complete backup into it, and reported success.**

A NAS that quietly stops mounting therefore yields a backup that stays green
forever, stored on the same disk as the database it is meant to protect. ADR 0013
names this exact outcome as the thing the design exists to avoid: worse than no
backup, because it is believed.

## Decision

**Layer B targets a network endpoint** — the NAS `remotesapi` server, addressed
as a URL — rather than a `file://` path on a mounted share.

Layers A and D, and the three-layer structure, are unchanged.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **Network endpoint (chosen)** | Unreachability is loud by construction: exit 1 with a diagnostic error | Whether a self-hosted remotesapi *accepts* a backup sync is unproven | — |
| Keep `file://` + mount-liveness guard and post-sync read-back | Honours ADR 0013 as written; guards are cheap | A guard is a thing that must be remembered, and anything that bypasses it restores the silent mode | Correctness by construction beats correctness by discipline when the failure is silent |
| Both: network primary, guarded `file://` secondary | Most coverage | A fourth mechanism to operate, for a layer that already has a same-site limitation covered by D | Disproportionate |
| S3 / GCS destination | Also loud; documented dolt backup destinations | Reintroduces a third-party dependency the NAS was chosen to avoid | Held as the fallback if the chosen option fails its A1 test |

## Consequences

- **Makes easy:** a failed backup is detectable at the moment it fails, rather
  than at the moment it is needed.
- **Makes hard, accepted as cost:** layer B now depends on the same NAS service
  as layer A, so a server outage takes both. They were already same-site; D is
  what covers site loss, and it is retained.
- **Carries an unvalidated assumption, deliberately front-loaded.** Layer A —
  remotesapi as a Dolt *remote* — is well attested. Layer B — the same endpoint
  as a *backup destination* — is not. Measurement established only that the
  client dials remotesapi for an `http://` backup URL; server acceptance is
  untested. `shotwright-2sr.3` step A1 tests it before anything else changes,
  with an explicit abort criterion.
- **Future work must not silently undo:** reverting layer B to a `file://` path
  on a mounted share, on the grounds that it is simpler or that the mount is
  reliable. The failure is silent, so operational confidence in the mount is not
  evidence. If a `file://` destination is ever reintroduced, the silent-failure
  case must be asserted by a self-test that fails when the backup does.
- **Verification does not read `bd backup status`.** That surface reports the
  local automatic backup's freshness alongside the off-machine destination's
  name, which reads as a claim about the wrong copy (plan §2.3).

## Reversal

Amends ADR 0013's layer B. The earlier reasoning stopped holding because it
selected a destination on **coverage** — a filesystem share captures full
database state, which is true and remains true — while the disqualifying property
is a **failure mode**. Nothing available at the time ADR 0013 was written
distinguished the two candidates on that axis; the experiment the epic scheduled
is what surfaced it.

ADR 0013 is otherwise unchanged and remains the authority on the three-layer
structure, the disqualification of the self-hosted forge, the LAN
exposure limit for the remotesapi, and the rule that no ref is deleted before a
restore has been performed.
