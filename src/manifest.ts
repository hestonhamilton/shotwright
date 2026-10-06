// Manifest v1 — the public contract consumed by gallery/compare/trace/CI tooling.
// Semantics (per docs/shotwright-746.1.1-research.md Axis 2): `video`/`trace` keys
// always present (null when off), duplicate shot names fail the run, `shots` sorted
// by (spec, capturedAt) — capture order across parallel workers is nondeterministic.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { SIDECAR_DIR } from './runs.js'

export const MANIFEST_VERSION = 1

export interface Viewport {
  width: number
  height: number
}

export interface ShotEntry {
  name: string
  spec: string
  file: string
  viewport: Viewport | null
  deviceScaleFactor: number | null
  fullPage: boolean
  capturedAt: string
  durationMs: number
  video: string | null
  trace: string | null
}

export interface Manifest {
  manifestVersion: typeof MANIFEST_VERSION
  runId: string
  startedAt: string
  finishedAt: string
  shotwrightVersion: string
  playwrightVersion: string
  flags: { only: string[]; video: boolean; trace: boolean }
  shots: ShotEntry[]
}

/** Per-capture record written by shot() from a worker; merged by the reporter. */
export interface ShotSidecar {
  name: string
  spec: string
  file: string
  viewport: Viewport | null
  deviceScaleFactor: number | null
  fullPage: boolean
  capturedAt: string
  durationMs: number
  testId: string
}

export function writeSidecar(runDir: string, sidecar: ShotSidecar): void {
  const dir = path.join(runDir, SIDECAR_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${crypto.randomBytes(8).toString('hex')}.json`)
  fs.writeFileSync(file, JSON.stringify(sidecar))
}

export function readSidecars(runDir: string): ShotSidecar[] {
  const dir = path.join(runDir, SIDECAR_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ShotSidecar)
}

/** Per-test artifact paths (run-dir-relative), keyed by testId. */
export type TestArtifacts = Map<string, { video: string | null; trace: string | null }>

export interface AssembleInput {
  runId: string
  startedAt: string
  finishedAt: string
  shotwrightVersion: string
  playwrightVersion: string
  flags: { only: string[]; video: boolean; trace: boolean }
  sidecars: ShotSidecar[]
  artifacts: TestArtifacts
}

/**
 * Merge sidecars + per-test artifacts into a manifest. Sidecars whose test has no
 * recorded artifacts (crashed worker, artifacts off) get null video/trace — they
 * still assemble. Duplicate shot names are a run-level error.
 */
export function assembleManifest(input: AssembleInput): Manifest {
  const seen = new Map<string, string>()
  for (const s of input.sidecars) {
    const prior = seen.get(s.name)
    if (prior !== undefined) {
      throw new Error(
        `shotwright: duplicate shot name "${s.name}" (in ${prior} and ${s.spec}) — shot names must be unique within a run`,
      )
    }
    seen.set(s.name, s.spec)
  }
  const shots: ShotEntry[] = input.sidecars
    .map(({ testId, ...rest }) => ({
      ...rest,
      video: input.artifacts.get(testId)?.video ?? null,
      trace: input.artifacts.get(testId)?.trace ?? null,
    }))
    .sort(
      (a, b) =>
        a.spec.localeCompare(b.spec) ||
        a.capturedAt.localeCompare(b.capturedAt) ||
        a.name.localeCompare(b.name),
    )
  return {
    manifestVersion: MANIFEST_VERSION,
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    shotwrightVersion: input.shotwrightVersion,
    playwrightVersion: input.playwrightVersion,
    flags: input.flags,
    shots,
  }
}
