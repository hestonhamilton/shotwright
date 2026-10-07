// SPDX-License-Identifier: AGPL-3.0-or-later
// Run directory lifecycle: id generation, creation, atomic manifest publish,
// and the `latest` symlink (POSIX-only in v1, per plan deferral).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { Manifest } from './manifest.js'

export const SIDECAR_DIR = '.sidecar'

/** `<UTC YYYY-MM-DDTHH-mm-ss>_<4 hex>`, e.g. `2026-07-29T14-02-11_a1b2`. */
export function generateRunId(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-')
  return `${stamp}_${crypto.randomBytes(2).toString('hex')}`
}

export interface RunDir {
  runId: string
  runDir: string
}

/**
 * Create a fresh run directory under outputDir (plus its sidecar staging dir).
 * Collisions with an existing directory regenerate the id suffix.
 */
export function createRunDir(outputDir: string, idGenerator = generateRunId): RunDir {
  fs.mkdirSync(outputDir, { recursive: true })
  for (;;) {
    const runId = idGenerator()
    const runDir = path.join(outputDir, runId)
    try {
      fs.mkdirSync(runDir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
    fs.mkdirSync(path.join(runDir, SIDECAR_DIR))
    return { runId, runDir }
  }
}

/** Write manifest.json atomically: temp file + rename. */
export function publishManifest(runDir: string, manifest: Manifest): void {
  const tmp = path.join(runDir, '.manifest.tmp')
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n')
  fs.renameSync(tmp, path.join(runDir, 'manifest.json'))
}

/** A run without a published manifest is incomplete (crashed) — tooling ignores it. */
export function isCompleteRun(runDir: string): boolean {
  return fs.existsSync(path.join(runDir, 'manifest.json'))
}

/** Point `<outputDir>/latest` at runId, atomically replacing any previous link. */
export function updateLatestSymlink(outputDir: string, runId: string): void {
  const tmp = path.join(outputDir, '.latest.tmp')
  fs.rmSync(tmp, { force: true })
  fs.symlinkSync(runId, tmp)
  fs.renameSync(tmp, path.join(outputDir, 'latest'))
}
