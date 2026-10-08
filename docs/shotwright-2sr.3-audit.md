# shotwright-2sr.3 — Dolt ref audit sweep and per-repository dispositions

- **Bead:** `shotwright-2sr.3` (I), plan steps B1–B3
- **Date:** 2026-08-02
- **Method:** `scripts/dolt-ref-sweep.sh`, which drives `scripts/dolt-ref-inspect.sh`
- **Mutation:** none. The sweep fetches and classifies. No ref was deleted,
  repointed, or pushed anywhere.

## 0. What this document contains, and what it deliberately does not

It records **classifications**. It does not reproduce the values behind them.

This repository is public-facing (`ADR 0011`), so a document listing
the operator username, LAN addresses and machine layout that the sweep found
would recreate, inside a public repository, exactly the exposure the sweep exists
to measure. The raw distinct-value listings stay **outside the repository** — the
sweep writes them to a `--out` directory and its header requires that directory
be outside the repo or under the gitignored `local/`.

The raw distinct-value listings are therefore not reproduced here. Anyone
re-deriving the values runs the sweep; that is a one-command operation and it
is the correct way to see them.

## 1. Enumeration

Enumerated **by command**, never from a stored list, per plan §5 B2:

```
gh repo list <owner> --json name,visibility --limit 500
git ls-remote https://github.com/<owner>/<repo>.git 'refs/dolt/*' 'refs/heads/*dolt*'
```

| | |
|---|---|
| Carrying Dolt refs | several (count withheld; see `shotwright-uke`) |
| Unreachable (sweep incompleteness) | **0** |
| Refs present, in every case | `refs/dolt/data` **and** `refs/heads/__dolt_remote_info__` |
| Visibility of every one | **private** |

**The count moved.** `shotwright-2sr.1` found **nine** repositories carrying Dolt
refs on 2026-08-01. This sweep found **ten** on 2026-08-02. This is the reason
the plan required re-derivation rather than trusting R's number, and it is now a
measured reason rather than a precautionary one: a checked-in list would have
reported the sweep complete while missing a repository.

`refs/heads/__dolt_remote_info__` accompanies `refs/dolt/data` in all ten cases —
so any disposition that removes one must remove both, and the `git ls-remote`
pattern used here must keep matching both.

## 2. Findings

| Repository | Vis | Ref bytes | Objs | Strings | Emails | Creds | Host paths | Priv IPv4 | Hostnames | Bead ids | Cross-proj |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| shotwright | private | 6,551,294 | 44 | 133,379 | 21 | **0** | 1 | 0 | 0 | 72 | 0 |

Only shotwright's own row is reproduced. Other repositories are out of scope
for this document and are decided per repository (`shotwright-uke`).

Counts are of **distinct values**, per plan §7 and the correction R found the
hard way. They are a map, not a verdict — every non-zero cell was read before it
was classified.

- **Host paths — shotwright: not a finding.** Its single hit is a fragment of a
  bead note *about* the leak gate, quoting the pattern names the gate does and
  does not cover. Prose about paths, not a path. R's "0 host paths" holds.

- **Emails.** Two real addresses plus `git@` transport URLs and chunk-boundary
  fragments (`strings` splitting an address across a `.darc` chunk edge). The
  owner accepted the two addresses as public on 2026-08-02 (research §4.4).

## 3. shotwright's disposition — surfaced, not buried

Per the bead: this one feeds the E9 public-flip decision (`shotwright-746.18`).

```
Repository:        shotwright
Refs present:      refs/dolt/data, refs/heads/__dolt_remote_info__
Ref size:          6,551,294 bytes across 44 objects
Visibility today:  private — committed to going public (ADR 0011)
Findings:          0 credentials. 0 real host paths (the single hit is prose
                   about the leak gate). 0 private IPv4. 0 hostnames.
                   0 cross-project bead ids. 2 real email addresses, already
                   accepted as public by the owner. 72 distinct shotwright bead
                   ids — one project's issue tracker in plaintext.
Disposition:       DELETE
Reason:            The ref contents are not themselves disqualifying — the sweep
                   found nothing in them the owner has not already accepted.
                   The disposition is driven by the decision already taken
                   (2026-08-01): the ref goes before the flip. This audit
                   confirms that decision costs nothing beyond the board's
                   plaintext, and finds no additional reason to reconsider it.
Gated on:          A proven RESTORE (plan step A6), not a successful sync.
                   Also on step A5, which moves the off-site copy to a dedicated
                   private repository first — deletion must move the copy, never
                   reduce the number of copies.
```

**Two things the E9 evidence pack must state, because deletion does not achieve
what it sounds like it achieves:**

1. **Deletion removes discoverability, not data** (plan §6). The ref stops being
   advertised by `git ls-remote`. The objects remain and stay reachable by SHA,
   and five such SHAs already exist in push history. The owner's acceptance is of
   *unadvertised*, explicitly not of *erased*.

2. **Content scanners cannot see commit metadata** (research §4.4). The identity
   set in commit headers must be stated in the evidence pack; a `gitleaks git`
   pass is evidence about blobs and about nothing else.

## 4. Other repositories

Other repositories are out of scope for this audit and are decided per
repository (`shotwright-uke`). Nothing here pre-approves any of them.

**The rule this audit adds:** no repository carrying `refs/dolt/data` may be
made public until its ref has been dispositioned first. The flip checklist must
include a `git ls-remote <remote> 'refs/dolt/*'` check, because the ref is
invisible in the working tree, invisible to `gitleaks`, and invisible in the
GitHub web UI.

## 5. What this sweep cannot tell you

Stated because a sweep that implies completeness it does not have is worse than
a narrower one honestly scoped.

- **Hostname detection is incomplete by construction.** `.local`, `.lan`,
  `.internal` and `.home.arpa` are matched by suffix. A LAN service reached at a
  public DNS name is indistinguishable from any other domain without knowing
  which names are the operator's — and `shotwright-746.18.3` measured exactly
  this failure: the leak gate did not catch a self-hosted forge hostname, because
  it is not a host path, a LAN IP, or a username. The inspector accepts known
  names via `--hostnames` / `$DOLT_REF_INSPECT_HOSTNAMES` rather than committing
  them. **This sweep was run without that list**, so its hostname column is a
  floor, not a total.

- **Four plan §7 categories are not scored at all**: third-party names, financial
  and personal content, and candid internal prose. The inspector has no basis to
  adjudicate them and does not try — a category scored badly reads as a category
  cleared. Judging them means reading the extracted strings, and for the
  largest boards that is hundreds of thousands of strings each. **Not done in this sweep.**
  It is the one part of plan §7 this document leaves open.

- **This is one account.** Refs pushed to any other remote — another forge,
  another account — are outside the enumeration.

- **A ref that was deleted before this sweep leaves no trace here,** and its
  objects may still exist. The sweep reads what is advertised now.

## 6. Verification of the tooling itself

Both scripts were validated before their output was trusted:

- `scripts/dolt-ref-inspect-selftest.sh` drives the real inspector over fixed
  inputs and asserts every category fires on its own shape, that R's two measured
  false positives (`pnpm@10.33.0` as a private IP, a UUID fragment as a bead id)
  stay dead, that a truncated real host path is still reported, and that 255
  mentions of 2 addresses report **2**. Positive controls sit in the
  must-not-fire blocks, because a classifier that reports nothing at all would
  otherwise pass them.
- The inspector reproduced R §4.1's hand-run procedure against the live
  shotwright ref, and the one number that differed from R — host paths, 1 versus
  0 — was read rather than assumed, and resolved to a prose fragment.

The self-test found a genuine defect in itself on first run: a heredoc attached
to a command substitution never reached the classifier, so all thirteen must-fire
checks were reading empty output and reporting pass-by-vacuum on the must-not-fire
half. That is the failure mode this class of check has, and it is why the
positive controls are now permanent.
