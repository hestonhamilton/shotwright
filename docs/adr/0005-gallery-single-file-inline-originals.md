# 5. Gallery is a single self-contained HTML with inline original screenshots

Date: 2026-07-29 (decisions), 2026-07-30 (recorded at E3 epic close)
Status: accepted

## Context

E3 required "a single self-contained HTML file showing every capture with
metadata, usable from a phone on the LAN." The epic text alone did not pin
what "self-contained" binds (original bytes vs thumbnails; whether video and
trace bytes inline), and several downstream contracts hung on the answer:
phone decode memory (~467 MiB RGBA estimate at 30 shots if eager), the
`latest` symlink semantics landed in PR #4, and how a gallery command
discovers a consumer's `outputDir` (only resolvable inside Playwright config
evaluation). Full context: `docs/shotwright-746.3.1-research.md`,
`docs/shotwright-746.3.2-plan.md`.

## Decision

1. **Inline originals** (owner decision 2026-07-29): every screenshot's
   original PNG bytes are embedded exactly once as a `data:` URI —
   `gallery.html` alone is the complete screenshot review artifact. Video and
   trace stay sibling files with typed links that state they need the run
   directory. No thumbnails, no re-encoding.
2. **Bounded on-demand decode is load-bearing**: at most three live overview
   image nodes (plus one 1:1 inspection node); placeholder content hides
   while its image is loaded and returns on eviction. Verified through a
   byte-unique synthetic 60-shot corpus (~35 MB HTML) on WebKit/Chromium
   phone profiles (emulated gate, owner-directed; real-device memory residual
   stays open — see `docs/shotwright-746.3.4-verification.md`).
3. **`latest` is decoupled from gallery generation**: `latest` = manifest
   published + Playwright status passed (PR #4 semantics, unchanged). A
   generator failure surfaces diagnostics and fails the run command but
   cannot hold `latest` back; `shotwright gallery` regenerates on demand.
   The durable HTML carries only an intrinsic badge ("Published manifest ·
   pass/fail status is not embedded") — how a run was selected is terminal
   output, never baked into the file.
4. **Consumer `outputDir` discovery via config probe**: `shotwright gallery`
   evaluates the consumer's config through the consumer's own Playwright in
   list mode with the private `SHOTWRIGHT_CONFIG_PROBE_FILE` env contract in
   `defineShotsConfig()` (side-effect-free probe branch). No hard-coded
   output directory; no consumer-side duplication.
5. **Serve posture**: read-only exact-allowlist `node:http` server, loopback
   by default, exposure warning derived from the actual bound address,
   `--lan` with virtual-interface filtering, no URL token, no QR, no
   `--open` (owner decisions).

## Consequences

- Copying `gallery.html` off the run directory keeps every screenshot but
  breaks video/trace links — the links say so.
- Manifest v1 remains the only input; project/test labels and a durable
  pass/fail badge would be schema forks, deliberately not taken in E3.
- The probe env var is a de-facto internal contract between the CLI and
  `defineShotsConfig()`; renaming it is a breaking internal change.
- A hybrid/external gallery mode exists only as a named future escape hatch
  if real-phone evidence ever defeats bounded decode; it must not be added
  silently.
