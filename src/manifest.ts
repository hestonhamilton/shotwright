// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { SIDECAR_DIR } from './runs.js'

export const MANIFEST_VERSION = 2 as const
export type RunnerStatus = 'passed' | 'failed' | 'timedout' | 'interrupted' | 'unknown'
export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
export interface Viewport { width: number; height: number }
export interface ShotEntry {
  name: string; spec: string; file: string; viewport: Viewport | null
  deviceScaleFactor: number | null; fullPage: boolean; capturedAt: string
  durationMs: number; video: string | null; trace: string | null
  testId: string | null; checked: boolean; retry: number
}
export interface TestEntry {
  id: string; title: string; spec: string; project: string; status: TestStatus
  retry: number; durationMs: number; error?: { message: string }
}
export interface ArtifactEntry {
  name: string; spec: string; file: string; contentType: string; bytes: number; testId: string
}
export interface FailureEntry {
  testId: string; files: Array<{ name: string; contentType: string; file: string }>
}
export interface PublicationResult { ok: boolean; error?: string }
export interface Manifest {
  manifestVersion: typeof MANIFEST_VERSION; runId: string; startedAt: string; finishedAt: string
  shotwrightVersion: string; playwrightVersion: string
  flags: { only: string[]; video: boolean; trace: boolean }
  status: RunnerStatus
  publication: { gallery: PublicationResult; evidence: PublicationResult }
  tests: TestEntry[]; shots: ShotEntry[]; artifacts: ArtifactEntry[]; failures: FailureEntry[]
}
export type ShotSidecar = Omit<ShotEntry, 'video' | 'trace' | 'testId'> & { kind: 'shot'; testId: string }
export type ArtifactSidecar = ArtifactEntry & { kind: 'artifact'; retry: number }
export type Sidecar = ShotSidecar | ArtifactSidecar
export type TestArtifacts = Map<string, { video: string | null; trace: string | null }>

export function shotKey(spec: string, name: string): string {
  return `${spec.length}:${spec}${name.length}:${name}`
}

export function writeSidecar(runDir: string, sidecar: Sidecar): void {
  const dir = path.join(runDir, SIDECAR_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${crypto.randomBytes(16).toString('hex')}.json`)
  const temp = `${file}.tmp`
  try { fs.writeFileSync(temp, JSON.stringify(sidecar), { flag: 'wx' }); fs.renameSync(temp, file) }
  finally { fs.rmSync(temp, { force: true }) }
}
export function readSidecars(runDir: string): Sidecar[] {
  const dir = path.join(runDir, SIDECAR_DIR)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Sidecar)
}
export interface AssembleInput {
  runId: string; startedAt: string; finishedAt: string; shotwrightVersion: string
  playwrightVersion: string; flags: Manifest['flags']; status: RunnerStatus
  publication: Manifest['publication']; tests: TestEntry[]; failures: FailureEntry[]
  sidecars: Sidecar[]; artifacts: TestArtifacts; runDir: string
}
export function assembleManifest(input: AssembleInput): Manifest {
  const final = new Map(input.tests.map(t => [t.id, t.retry]))
  const selected = input.sidecars.filter(s => final.get(s.testId) === s.retry)
  const seenShots = new Set<string>(), seenArtifacts = new Set<string>()
  const shots: ShotEntry[] = [], artifacts: ArtifactEntry[] = []
  for (const s of selected) {
    const key = shotKey(s.spec, s.name)
    const seen = s.kind === 'shot' ? seenShots : seenArtifacts
    if (seen.has(key)) throw new Error(`shotwright: duplicate ${s.kind} name "${s.name}" in ${s.spec}`)
    seen.add(key)
    if (s.kind === 'shot') {
      const rest = { ...s }
      delete (rest as Partial<Sidecar>).kind
      shots.push({ ...rest, video: input.artifacts.get(s.testId)?.video ?? null,
        trace: input.artifacts.get(s.testId)?.trace ?? null })
    } else {
      artifacts.push({name:s.name,spec:s.spec,file:s.file,contentType:s.contentType,bytes:s.bytes,testId:s.testId})
    }
  }
  const retained = new Set(selected.map(s => s.file))
  for (const s of input.sidecars) if (!retained.has(s.file)) {
    const target = path.resolve(input.runDir, s.file)
    if (target.startsWith(`${path.resolve(input.runDir)}${path.sep}`)) fs.rmSync(target, { force: true })
  }
  shots.sort((a,b) => a.spec.localeCompare(b.spec) || a.capturedAt.localeCompare(b.capturedAt) || a.name.localeCompare(b.name))
  artifacts.sort((a,b) => a.spec.localeCompare(b.spec) || a.name.localeCompare(b.name) || a.testId.localeCompare(b.testId))
  return { manifestVersion: 2, runId: input.runId, startedAt: input.startedAt,
    finishedAt: input.finishedAt, shotwrightVersion: input.shotwrightVersion,
    playwrightVersion: input.playwrightVersion, flags: input.flags, status: input.status,
    publication: input.publication, tests: [...input.tests].sort((a,b) =>
      a.spec.localeCompare(b.spec) || a.project.localeCompare(b.project) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
    shots, artifacts, failures: [...input.failures].sort((a,b) => a.testId.localeCompare(b.testId)) }
}
