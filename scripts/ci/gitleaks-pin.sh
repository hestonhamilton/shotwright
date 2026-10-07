# shellcheck shell=bash disable=SC2034
# Source of truth for the gitleaks release the leak gate runs under. Sourced by
# scripts/ci/leak-gate.sh (version assertion) and scripts/ci/install-gitleaks.sh
# (download + hash), so the installer and the gate cannot drift apart.
#
# Pinned so a scanner whose rule engine drifts under a pinned config cannot
# change the gate's meaning silently.
#
# Confirmed against the release list on 2026-08-01: v8.30.1, published
# 2026-03-21, is the latest release. Do not take the version from the gitleaks
# README — its pre-commit example still shows 8.24.2, published 2025-03-22.
# gitleaks is feature-frozen and ships security patches only, so an old build
# forfeits the one kind of update it still receives.
#
# The hashes are the sha256 of each release archive. They were taken from the
# v8.30.1 release manifest on 2026-10-07 and the linux_x64 value was confirmed
# by hashing an independently downloaded archive. Keeping the reviewed values
# here means the installer does not trust a checksums file downloaded beside the
# archive it is meant to authenticate — that detects a truncated download, not a
# substituted release. Same pattern as osv-scanner-pin.sh (ADR 0019).
GITLEAKS_PIN="8.30.1"
GITLEAKS_SHA256_LINUX_X64="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
GITLEAKS_SHA256_LINUX_ARM64="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
GITLEAKS_SHA256_DARWIN_X64="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"
GITLEAKS_SHA256_DARWIN_ARM64="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"

gitleaks_select_platform() {
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64|Linux/amd64)
      GITLEAKS_ARCHIVE="gitleaks_${GITLEAKS_PIN}_linux_x64.tar.gz"
      GITLEAKS_SHA256="$GITLEAKS_SHA256_LINUX_X64"
      ;;
    Linux/aarch64|Linux/arm64)
      GITLEAKS_ARCHIVE="gitleaks_${GITLEAKS_PIN}_linux_arm64.tar.gz"
      GITLEAKS_SHA256="$GITLEAKS_SHA256_LINUX_ARM64"
      ;;
    Darwin/x86_64|Darwin/amd64)
      GITLEAKS_ARCHIVE="gitleaks_${GITLEAKS_PIN}_darwin_x64.tar.gz"
      GITLEAKS_SHA256="$GITLEAKS_SHA256_DARWIN_X64"
      ;;
    Darwin/arm64|Darwin/aarch64)
      GITLEAKS_ARCHIVE="gitleaks_${GITLEAKS_PIN}_darwin_arm64.tar.gz"
      GITLEAKS_SHA256="$GITLEAKS_SHA256_DARWIN_ARM64"
      ;;
    *)
      echo "gitleaks: unsupported platform $(uname -s)/$(uname -m)" >&2
      return 2
      ;;
  esac
}
