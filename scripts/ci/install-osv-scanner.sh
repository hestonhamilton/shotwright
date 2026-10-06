#!/usr/bin/env bash
# Install the exact OSV-Scanner release reviewed in ADR 0019. The version and
# platform hashes live in osv-scanner-pin.sh so the installer and gate cannot
# drift. Every run downloads and hashes the binary; a pre-existing executable
# with the right version string is not accepted as proof of identity.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dest="${1:-/usr/local/bin}"

# shellcheck source=scripts/ci/osv-scanner-pin.sh
source "$root/scripts/ci/osv-scanner-pin.sh"
osv_scanner_select_platform

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

url="https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_PIN}/${OSV_SCANNER_ASSET}"
download="$work/osv-scanner"

echo "==> install-osv-scanner: fetching ${OSV_SCANNER_ASSET}"
curl -fsSL \
  --retry 3 \
  --connect-timeout 10 \
  --max-time 120 \
  --max-filesize 83886080 \
  --output "$download" \
  "$url"

actual_sha256="$(node --input-type=module -e '
  import { createHash } from "node:crypto";
  import { readFileSync } from "node:fs";
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
' "$download")"

if [[ "$actual_sha256" != "$OSV_SCANNER_SHA256" ]]; then
  echo "install-osv-scanner.sh: checksum mismatch for ${OSV_SCANNER_ASSET}" >&2
  echo "  expected: $OSV_SCANNER_SHA256" >&2
  echo "  actual:   $actual_sha256" >&2
  exit 1
fi

mkdir -p "$dest"
install -m 0755 "$download" "$dest/osv-scanner"

installed_version="$("$dest/osv-scanner" --version 2>/dev/null | sed -n 's/^osv-scanner version: //p' | head -n 1)"
if [[ "$installed_version" != "$OSV_SCANNER_PIN" ]]; then
  echo "install-osv-scanner.sh: installed binary reports '${installed_version}', expected '${OSV_SCANNER_PIN}'" >&2
  exit 1
fi

echo "==> install-osv-scanner: OSV-Scanner ${OSV_SCANNER_PIN} installed"
