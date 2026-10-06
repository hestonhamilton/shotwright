#!/usr/bin/env bash
set -euo pipefail

# The self-mode shots lane: build this repo, capture the demo run with the built
# CLI, and assert the published run is the exact shape shotwright claims to
# produce. `pnpm exec shotwright` deliberately does NOT work here — a package is
# not self-linked — which is why self mode runs dist/cli.js directly.
#
# Browser installation is NOT here on purpose: CI wipes ~/.cache/ms-playwright to
# prove default-path resolution, and a script that does that would be hostile to
# run locally. The workflow owns that step.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

config_path="${1:-demo/shots.config.ts}"
export CONFIG_PATH="$config_path"

echo "==> shots: build"
pnpm run build

echo "==> shots: prove default Playwright browser path"
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const root = `${process.env.HOME}/.cache/ms-playwright`
const exe = chromium.executablePath()
if (!exe.startsWith(`${root}/`)) {
  throw new Error(`Chromium resolves outside default Playwright browser cache: ${exe}`)
}
console.log(`Chromium resolves inside default Playwright browser cache: ${exe}`)

// Static source-text check only; this is not resolved-config analysis.
const configPath = process.env.CONFIG_PATH
const config = fs.readFileSync(configPath, 'utf8')
if (/\bexecutablePath\b/.test(config)) {
  throw new Error(`${configPath} declares executablePath; self mode is not browser-clean`)
}
if (/(^|[,{]\s*)channel\s*:/.test(config)) {
  throw new Error(`${configPath} declares channel; self mode is not browser-clean`)
}
NODE

echo "==> shots: run ($config_path)"
PATH="$root/node_modules/.bin:$PATH" node dist/cli.js run --config "$config_path" -- --workers=1

echo "==> shots: assert demo shot set"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const latest = fs.readlinkSync('shots-output/latest')
const manifest = JSON.parse(
  fs.readFileSync(path.join('shots-output', latest, 'manifest.json'), 'utf8'),
)
assert.deepEqual(
  manifest.shots.map((shot) => [shot.spec, shot.name]),
  [
    ['about.shots.ts', 'about-desktop'],
    ['about.shots.ts', 'mobile-layout'],
    ['home.shots.ts', 'form-filled'],
    ['home.shots.ts', 'modal-open'],
    ['home.shots.ts', 'theme-dark'],
  ],
)
NODE

run_id="$(readlink shots-output/latest)"
run_dir="shots-output/$run_id"
if [ ! -d "$run_dir" ]; then
  echo "Published run directory missing: $run_dir" >&2
  exit 1
fi

echo "==> shots: assert published run artifact shape"
RUN_DIR="$run_dir" node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const runDir = process.env.RUN_DIR
const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'))
assert(fs.existsSync(path.join(runDir, 'gallery.html')), 'gallery.html must be published')
assert(Array.isArray(manifest.shots), 'manifest.shots must be an array')
assert(manifest.shots.length > 0, 'shotwright artifact is empty: manifest.shots.length must be > 0')
for (const shot of manifest.shots) {
  assert.equal(typeof shot.file, 'string', 'manifest shot file must be a non-empty string')
  assert.notEqual(shot.file.trim(), '', 'manifest shot file must be a non-empty string')
  const png = path.join(runDir, shot.file)
  const bytes = fs.readFileSync(png)
  assert(bytes.length > 8, `${shot.file} is empty`)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${shot.file} is not a PNG`)
}
for (const staging of ['.sidecar', '.pw', '.manifest.tmp']) {
  assert(!fs.existsSync(path.join(runDir, staging)), `${staging} should not be published`)
}
assert(
  !fs.readdirSync(runDir).some((entry) => entry.startsWith('.gallery.')),
  '.gallery.* should not be published',
)
NODE

echo "==> shots: published $run_dir"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    printf 'run-dir=%s\n' "$run_dir"
    printf 'run-id=%s\n' "$run_id"
  } >>"$GITHUB_OUTPUT"
fi
