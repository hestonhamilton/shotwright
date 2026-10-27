---
"shotwright": minor
---

## Upgrading from 0.3.0

- `shotwright run` and `--list` now refuse a config that combines explicit
  `projects` with harness top-level `viewport` or `deviceScaleFactor`, which
  were previously ignored; move those values into each `project.use`. `runs`,
  `gallery` and `compare` still read existing runs from such a config. Pass
  `projects: base.projects` to retain project-level `grep`/`grepInvert` when
  adapting a base config. With the default `shots` project, its device settings
  take precedence over `use.viewport` and `use.deviceScaleFactor`.
- Every shot `check` now runs under `--only`, including when its capture is
  filtered out. This reverses 0.3.0's skipped filtered checks: audit expensive
  or state-changing checks and checks that read earlier PNGs the filter may omit.
  A failed check fails the test without writing that shot's PNG or sidecar.
- Node 20 and Node 22.0–22.11 are no longer supported. Upgrade to Node
  `>=22.12.0`. npm's `engines` check warns by default and refuses installation
  only with `engine-strict`. This remains an ESM-only package; synchronous
  CommonJS `require()` can load its exports from Node 22.12.0 only while the
  module graph has no top-level `await`.

## Additions

- Add optional per-shot `note` text to `shot()`. Notes appear on gallery cards
  and in search, with escaped text, bounded keyboard-scrollable cards, and an
  edge shadow when they overflow. Notes do not change shot identity or compare
  results; older galleries ignore the new field.
- Copy path artifacts in bounded chunks. A source that cannot be opened leaves
  the prior retry artifact in place; a failed copy removes its incomplete
  destination claim.
- Document Playwright's `test.info().outputPath()` scratch workflow for
  generated artifacts: inspect and publish the same source path before the
  test ends. The reporter removes the run scratch directory on ordinary exit.
