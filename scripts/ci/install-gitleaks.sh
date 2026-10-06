#!/usr/bin/env bash
# Installs the pinned gitleaks into a directory on PATH, for whichever CI lane
# needs it. Defined once here rather than duplicated per wrapper, per CLAUDE.md:
# what a lane runs belongs in scripts/ci/, and the wrappers differ only in setup.
#
# The pin is read from leak-gate.sh so the installer and the gate cannot drift
# apart — a version assertion whose installer targets a different version is a
# gate that fails on every run.
#
# INTEGRITY CAVEAT, stated rather than glossed: the archive is verified against
# the checksums file from the SAME release. That detects a corrupted or truncated
# download. It does NOT detect a compromised release, because both files come
# from one origin. Pinning the observed sha256 here is strictly better and should
# happen the first time this runs somewhere with GitHub reachable
# (shotwright-746.18.3).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dest="${1:-/usr/local/bin}"

pin="$(sed -n 's/^GITLEAKS_PIN="\([^"]*\)".*/\1/p' "$root/scripts/ci/leak-gate.sh")"
if [[ -z "$pin" ]]; then
  echo 'install-gitleaks.sh: could not read GITLEAKS_PIN from scripts/ci/leak-gate.sh' >&2
  exit 2
fi

if command -v gitleaks >/dev/null 2>&1; then
  have="$(gitleaks version 2>/dev/null | tr -d 'v[:space:]')"
  if [[ "$have" == "$pin" ]]; then
    echo "install-gitleaks.sh: gitleaks ${pin} already present"
    exit 0
  fi
  echo "install-gitleaks.sh: replacing gitleaks ${have} with pinned ${pin}"
fi

case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "install-gitleaks.sh: unsupported architecture $(uname -m)" >&2; exit 2 ;;
esac

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "install-gitleaks.sh: unsupported OS $(uname -s)" >&2; exit 2 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

base="https://github.com/gitleaks/gitleaks/releases/download/v${pin}"
archive="gitleaks_${pin}_${os}_${arch}.tar.gz"

echo "==> install-gitleaks: fetching ${archive}"
curl -fsSL --retry 3 -o "$work/$archive" "${base}/${archive}"
curl -fsSL --retry 3 -o "$work/checksums.txt" "${base}/gitleaks_${pin}_checksums.txt"

echo '==> install-gitleaks: verifying checksum'
(
  cd "$work"
  # Reduce the checksums file to the one line we care about; sha256sum -c fails
  # on entries whose files are absent.
  grep " ${archive}\$" checksums.txt > expected.txt || {
    echo "install-gitleaks.sh: ${archive} not listed in the release checksums" >&2
    exit 1
  }
  sha256sum -c expected.txt
)

tar xzf "$work/$archive" -C "$work" gitleaks
# mkdir first: `install` does not create the destination directory, and
# ~/.local/bin does not exist on a stock GitHub runner. Found by the first real
# dry-run of release.yml — it worked locally only because the dir already
# existed there.
mkdir -p "$dest"
install -m 0755 "$work/gitleaks" "$dest/gitleaks"

installed="$("$dest/gitleaks" version 2>/dev/null | tr -d 'v[:space:]')"
if [[ "$installed" != "$pin" ]]; then
  echo "install-gitleaks.sh: installed binary reports '${installed}', expected '${pin}'" >&2
  exit 1
fi
echo "==> install-gitleaks: gitleaks ${pin} installed to ${dest}"
