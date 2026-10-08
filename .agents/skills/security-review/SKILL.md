---
name: security-review
description: Audit a diff against shotwright's concrete threat surface — the gallery server, the tarball leak gate and its installers, the CI/release workflows, consumer-facing templates, and the agent hooks/permissions. Produces a findings report; never modifies code.
---

# security-review

Audit-only. Produce a findings report; never modify code.

shotwright is a CLI plus a loopback/LAN gallery server, published to npm from
GitHub Actions, with an in-repo leak gate standing between the working tree and
the tarball. It has no accounts, sessions, database, or upload path. The themes
below are the ones a diff here can actually touch; do not pad a report with
web-app themes that have no surface in this repo.

## Threat themes

1. **Gallery server** (`src/gallery/server.ts`) — binds loopback by default,
   LAN only with `--lan`. Check: Host-header check still applied; CSP still
   emitted; path resolution cannot escape the run directory; shot names and
   spec paths are validated before they reach a filesystem call or HTML; no
   new route serves user-controlled bytes with an executable MIME.
2. **The leak gate** (`scripts/ci/leak-gate.sh`, `check-file-set.sh`,
   `gitleaks-tarball.toml`, `expected-files.txt`) — a diff to any of these is
   the security-relevant part of a release PR. Check: layer A remains exact
   (every shipped path listed, no prefix globs); B and C remain two separate
   gitleaks runs; `GITLEAKS_CONFIG*` still unset, ignore path still empty,
   `gitleaks:allow` still refused; `leak-gate-selftest.sh` still proves each
   of those by failing on a seed. A weakened assertion is a finding.
3. **Pinned tools** (`gitleaks-pin.sh`, `osv-scanner-pin.sh`, the `install-*`
   scripts, `NPM_PIN_*` in `release.yml`) — every bump must carry a hash taken
   from the upstream manifest and confirmed against a downloaded artifact;
   an installer must never accept a pre-existing binary by version string.
4. **Workflows** (`.github/workflows/*.yml`, `.forgejo/workflows/ci.yml`,
   `templates/github/shotwright.yml`) — `permissions:` stays minimal and
   job-level; `id-token: write` only on the `publish` job under the
   `npm-publish` environment; expressions reach shell via `env:`, never
   interpolated into `run:`; `persist-credentials: false`; action refs pinned.
   A change to one lane's wrapper that belongs in `scripts/ci/*.sh` is a
   finding (CLAUDE.md: steps live in the script, wrappers differ only in setup).
5. **Public-repo invariant** — no host paths, LAN IPs, usernames, or personal
   data in committed files or in anything that ships. `git ls-files` for
   `.env`, keys, `local/`; fixtures must use `.invalid`/`.example` and
   sequential-alphabet seeds and be listed in `.gitleaksignore`.
6. **Consumer-facing templates** (`templates/**`, written by `shotwright init`)
   — `init` never overwrites a differing file; the CI template pins the
   reusable workflow to a tag, not `@main`; nothing in a template reads a
   secret or widens a consumer's workflow permissions.
7. **Agent configuration** (`.claude/settings.json`, `.claude/hooks/*.sh`) —
   auto-allow stays read-only (no `Bash(bd *)`, no `find` with
   `-exec/-delete`); hooks act only on files under `$CLAUDE_PROJECT_DIR`;
   `bd dolt push` stays denied.

## Steps

1. `git diff --name-only <base>...HEAD` — identify touched files.
2. Map files to the themes above; skip untouched themes and say so.
3. For each touched theme: read the changed code, look for the pattern and
   its negation, note `file:line`.
4. Tool sweep when relevant: `pnpm run lint`, `scripts/ci/leak-gate.sh`,
   `scripts/ci/leak-gate-selftest.sh`, `scripts/ci/audit-gate.sh`,
   `gitleaks dir . --redact` (expect only the `.gitleaksignore` fixtures).
5. Output a report:
   - **Per theme:** pass / risk / fail (one sentence).
   - **Findings:** `SR-<n>` with `file:line`, severity, description, mitigation.
   - **Out of scope:** themes the diff did not touch.
   Inline is fine for a quick sweep. When persisting, write
   `docs/<bead-id>-security-review.md`: per-theme verdicts as a pass/risk/fail
   table; each `SR-<n>` as a finding block with a severity marker.
6. Triage per the project convention: fix-now is strictly false-reporting,
   data loss, or an invariant violation; everything else must pass a
   practical-bite test (a scenario reachable in this repo's actual usage) to
   become a bead, otherwise record it as considered-and-declined. Confirm
   before `bd create`.

## Boundaries

- This skill audits; fixes go through the normal bead workflow.
- Confirm before creating any bead from findings.
