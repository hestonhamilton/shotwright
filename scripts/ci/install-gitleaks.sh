#!/usr/bin/env bash
# Installs the pinned gitleaks into a directory on PATH, for whichever CI lane
# needs it. Defined once here rather than duplicated per wrapper, per CLAUDE.md:
# what a lane runs belongs in scripts/ci/, and the wrappers differ only in setup.
#
# The version and per-platform hashes live in scripts/ci/gitleaks-pin.sh, which
# the gate sources too, so the installer and the gate cannot drift apart.
#
# Every run downloads and hashes the archive against the reviewed value. Two
# things this deliberately does NOT do, both measured by the 2026-10-05 audit
# (C7) as trust the gate was extending without saying so:
#   * it does not accept a pre-existing `gitleaks` whose version string matches —
#     a version string is not an identity, and a binary already on PATH is
#     exactly what an attacker who got that far would leave behind;
#   * it does not verify against the checksums file published beside the archive
#     — both come from one origin, so that only ever detected a truncated
#     download, never a substituted release.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dest="${1:-/usr/local/bin}"

# shellcheck source=scripts/ci/gitleaks-pin.sh
source "$root/scripts/ci/gitleaks-pin.sh"
gitleaks_select_platform

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_PIN}/${GITLEAKS_ARCHIVE}"
download="$work/$GITLEAKS_ARCHIVE"

echo "==> install-gitleaks: fetching ${GITLEAKS_ARCHIVE}"
curl -fsSL \
  --retry 3 \
  --connect-timeout 10 \
  --max-time 120 \
  --max-filesize 83886080 \
  --output "$download" \
  "$url"

echo '==> install-gitleaks: verifying sha256 against the pinned value'
# node rather than sha256sum: the latter is not on a stock macOS, and node is a
# hard requirement of every lane that runs this anyway.
actual_sha256="$(node --input-type=module -e '
  import { createHash } from "node:crypto";
  import { readFileSync } from "node:fs";
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
' "$download")"

if [[ "$actual_sha256" != "$GITLEAKS_SHA256" ]]; then
  echo "install-gitleaks.sh: checksum mismatch for ${GITLEAKS_ARCHIVE}" >&2
  echo "  expected: $GITLEAKS_SHA256" >&2
  echo "  actual:   $actual_sha256" >&2
  exit 1
fi

tar xzf "$download" -C "$work" gitleaks
# mkdir first: `install` does not create the destination directory, and
# ~/.local/bin does not exist on a stock GitHub runner. Found by the first real
# dry-run of release.yml — it worked locally only because the dir already
# existed there.
mkdir -p "$dest"
install -m 0755 "$work/gitleaks" "$dest/gitleaks"

installed="$("$dest/gitleaks" version 2>/dev/null | tr -d 'v[:space:]')"
if [[ "$installed" != "$GITLEAKS_PIN" ]]; then
  echo "install-gitleaks.sh: installed binary reports '${installed}', expected '${GITLEAKS_PIN}'" >&2
  exit 1
fi
echo "==> install-gitleaks: gitleaks ${GITLEAKS_PIN} installed to ${dest}"
