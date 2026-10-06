# shellcheck shell=bash disable=SC2034
# Source of truth for the OSV-Scanner release accepted by ADR 0019.
# The hashes are copied from the official v2.5.1 release manifest. Keeping the
# reviewed values here means runtime verification does not trust a checksum
# downloaded beside the binary it is meant to authenticate.
OSV_SCANNER_PIN="2.5.1"
OSV_SCANNER_SHA256_LINUX_AMD64="f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be"
OSV_SCANNER_SHA256_LINUX_ARM64="3d0f5aa5a6baa8eb32bcef247388e149ef6030a6634ccae6fa0d62681fb27a6d"
OSV_SCANNER_SHA256_DARWIN_AMD64="9f89beb6c3d784893cb1cae0a3d56c529bfe91075418c2f9440c45b79654198b"
OSV_SCANNER_SHA256_DARWIN_ARM64="75c44d6332f892a1e56286f4105a98ed751ae28d215ca0a8b65cc00d84103054"

osv_scanner_select_platform() {
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64|Linux/amd64)
      OSV_SCANNER_ASSET="osv-scanner_linux_amd64"
      OSV_SCANNER_SHA256="$OSV_SCANNER_SHA256_LINUX_AMD64"
      ;;
    Linux/aarch64|Linux/arm64)
      OSV_SCANNER_ASSET="osv-scanner_linux_arm64"
      OSV_SCANNER_SHA256="$OSV_SCANNER_SHA256_LINUX_ARM64"
      ;;
    Darwin/x86_64|Darwin/amd64)
      OSV_SCANNER_ASSET="osv-scanner_darwin_amd64"
      OSV_SCANNER_SHA256="$OSV_SCANNER_SHA256_DARWIN_AMD64"
      ;;
    Darwin/arm64|Darwin/aarch64)
      OSV_SCANNER_ASSET="osv-scanner_darwin_arm64"
      OSV_SCANNER_SHA256="$OSV_SCANNER_SHA256_DARWIN_ARM64"
      ;;
    *)
      echo "osv-scanner: unsupported platform $(uname -s)/$(uname -m)" >&2
      return 2
      ;;
  esac
}
