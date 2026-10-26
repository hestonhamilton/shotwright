// SPDX-License-Identifier: AGPL-3.0-or-later
// Run directory lifecycle: id generation, creation, atomic manifest publish,
// and the `latest` symlink (POSIX-only in v1, per plan deferral).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { Manifest } from './manifest.js'
import type { RunnerStatus } from './manifest.js'
import { validateManifest } from './gallery/model.js'

export const SIDECAR_DIR = '.sidecar'

export interface RunListing {
  runId: string
  runDir: string
  status: RunnerStatus | 'incomplete'
  shotCount: number | null
  startedAt: string | null
  publication: Manifest['publication'] | null
  runError: Manifest['runError']
}

function runTimestamp(runId: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})_[0-9a-f]{4}$/.exec(runId)
  if (!match) return null
  const value = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`)
  return Number.isNaN(value) ? null : value
}

export function formatPublication(row: RunListing): string {
  if (row.status === 'incomplete') return '-'
  if (row.publication === null) return 'unrecorded'
  const failures = [
    !row.publication.gallery.ok ? 'gallery failed' : null,
    !row.publication.evidence.ok ? 'evidence failed' : null,
  ].filter((value): value is string => value !== null)
  return failures.length ? failures.join(', ') : 'ok'
}

/** Discover directories, including runs interrupted before manifest publication. */
export function listRuns(outputDir: string): RunListing[] {
  if (!fs.existsSync(outputDir)) return []
  const rows = fs.readdirSync(outputDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'compare') return []
    const runDir = path.join(outputDir, entry.name)
    let row: RunListing = {
      runId: entry.name,
      runDir,
      status: 'incomplete',
      shotCount: null,
      startedAt: null,
      publication: null,
      runError: null,
    }
    try {
      if (fs.lstatSync(path.join(runDir, 'manifest.json')).isSymbolicLink()) return [row]
      const raw = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8')) as unknown
      const manifest = validateManifest(raw, entry.name)
      row = {
        ...row,
        status: manifest.status,
        shotCount: manifest.shots.length,
        startedAt: manifest.startedAt,
        runError: manifest.runError,
        publication:
          (raw as { manifestVersion: number }).manifestVersion === 1 ? null : manifest.publication,
      }
    } catch {
      // A missing or malformed manifest has no trustworthy outcome or count.
    }
    return [row]
  })
  rows.sort((a, b) => {
    const aTime = runTimestamp(a.runId)
    const bTime = runTimestamp(b.runId)
    return aTime !== null && bTime !== null && aTime !== bTime
      ? bTime - aTime
      : b.runId.localeCompare(a.runId)
  })
  return rows
}

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
