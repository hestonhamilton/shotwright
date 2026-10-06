#!/usr/bin/env bash
# Hermetic adversarial checks for the production OSV gate. The Node test imports
# the real classifier/orchestrator and injects process results at that boundary;
# the shell checks exercise the shared platform/hash selector and prove a corrupt
# installer download is rejected. No OSV, npm, or other network is contacted.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pin="$here/osv-scanner-pin.sh"

check_platform() {
  local system="$1" machine="$2" expected_asset="$3" expected_hash="$4"
  local selected
  selected="$({
    uname() {
      case "$1" in
        -s) printf '%s\n' "$system" ;;
        -m) printf '%s\n' "$machine" ;;
        *) return 2 ;;
      esac
    }
    # shellcheck source=scripts/ci/osv-scanner-pin.sh
    source "$pin"
    osv_scanner_select_platform
    printf '%s|%s\n' "$OSV_SCANNER_ASSET" "$OSV_SCANNER_SHA256"
  })"
  [[ "$selected" == "$expected_asset|$expected_hash" ]]
}

echo '==> audit-gate-selftest: scanner platform and installer integrity checks'
check_platform Linux x86_64 osv-scanner_linux_amd64 \
  f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be
check_platform Linux aarch64 osv-scanner_linux_arm64 \
  3d0f5aa5a6baa8eb32bcef247388e149ef6030a6634ccae6fa0d62681fb27a6d
check_platform Darwin x86_64 osv-scanner_darwin_amd64 \
  9f89beb6c3d784893cb1cae0a3d56c529bfe91075418c2f9440c45b79654198b
check_platform Darwin arm64 osv-scanner_darwin_arm64 \
  75c44d6332f892a1e56286f4105a98ed751ae28d215ca0a8b65cc00d84103054
echo '  ok    all four supported platform assets select the reviewed hash'

if (
  uname() {
    case "$1" in
      -s) printf 'Plan9\n' ;;
      -m) printf 'mips\n' ;;
      *) return 2 ;;
    esac
  }
  # shellcheck source=scripts/ci/osv-scanner-pin.sh
  source "$pin"
  osv_scanner_select_platform
) 2>/dev/null; then
  echo '  FAIL  unsupported scanner platform was accepted' >&2
  exit 1
fi
echo '  ok    unsupported scanner platform fails closed'

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/fake-path"
cat > "$work/fake-path/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
output=''
connect_timeout=''
max_time=''
max_filesize=''
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --connect-timeout) connect_timeout="$2"; shift 2 ;;
    --max-time) max_time="$2"; shift 2 ;;
    --max-filesize) max_filesize="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "$output" ]]
[[ "$connect_timeout" == 10 ]]
[[ "$max_time" == 120 ]]
[[ "$max_filesize" == 83886080 ]]
printf 'corrupt download\n' > "$output"
SH
chmod +x "$work/fake-path/curl"

if PATH="$work/fake-path:$PATH" "$here/install-osv-scanner.sh" "$work/bin" \
  >"$work/install.out" 2>"$work/install.err"; then
  echo '  FAIL  corrupt scanner download was installed' >&2
  exit 1
fi
grep -q 'checksum mismatch' "$work/install.err"
[[ ! -e "$work/bin/osv-scanner" ]]
echo '  ok    corrupt scanner download is rejected before installation'

node "$here/osv-gate-selftest.mjs"
