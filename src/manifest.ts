// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { SIDECAR_DIR } from './runs.js'

export const MANIFEST_VERSION = 2 as const
export type RunnerStatus = 'passed' | 'failed' | 'timedout' | 'interrupted' | 'unknown'
export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
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
  testId: string | null
  checked: boolean
  retry: number
}
export interface TestEntry {
  id: string
  title: string
  titlePath?: string[]
  spec: string
  project: string
  status: TestStatus
  retry: number
  durationMs: number
  error?: { message: string }
}
export interface ArtifactEntry {
  name: string
  spec: string
  file: string
  contentType: string
  bytes: number
  testId: string
}
export interface FailureEntry {
  testId: string
  files: Array<{ name: string; contentType: string; file: string }>
}
export interface PublicationResult {
  ok: boolean
  error?: string
}
export interface Manifest {
  manifestVersion: typeof MANIFEST_VERSION
  runId: string
  startedAt: string
  finishedAt: string
  shotwrightVersion: string
  playwrightVersion: string
  flags: { only: string[]; video: boolean; trace: boolean }
  status: RunnerStatus
  runError?: { code: string; message: string } | null
  publication: { gallery: PublicationResult; evidence: PublicationResult }
  tests: TestEntry[]
  shots: ShotEntry[]
  artifacts: ArtifactEntry[]
  failures: FailureEntry[]
}
export type ShotSidecar = Omit<ShotEntry, 'video' | 'trace' | 'testId'> & {
  kind: 'shot'
  testId: string
}
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
  try {
    fs.writeFileSync(temp, JSON.stringify(sidecar), { flag: 'wx' })
    fs.renameSync(temp, file)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}
export function readSidecars(runDir: string): Sidecar[] {
  const dir = path.join(runDir, SIDECAR_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Sidecar
      } catch (error) {
        throw new Error(`shotwright: invalid sidecar ${f}: invalid JSON`, { cause: error })
      }
    })
}
export interface AssembleInput {
  runId: string
  startedAt: string
  finishedAt: string
  shotwrightVersion: string
  playwrightVersion: string
  flags: Manifest['flags']
  status: RunnerStatus
  publication: Manifest['publication']
  tests: TestEntry[]
  failures: FailureEntry[]
  sidecars: Sidecar[]
  artifacts: TestArtifacts
  runDir: string
}
function validateSidecar(value: unknown, index: number, final: Map<string, number>): Sidecar {
  const invalid = (reason: string): never => {
    throw new Error(`shotwright: invalid sidecar[${index}]: ${reason}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid('expected an object')
  const sidecar = value as Record<string, unknown>
  if (sidecar.kind !== 'shot' && sidecar.kind !== 'artifact') invalid('unknown kind')
  if (
    typeof sidecar.name !== 'string' ||
    !sidecar.name ||
    sidecar.name === '.' ||
    sidecar.name === '..' ||
    (sidecar.kind === 'shot'
      ? /[/\\\0]/.test(sidecar.name)
      : sidecar.name
          .split('/')
          .some((part) => !part || part === '.' || part === '..' || /[\\\0]/.test(part)))
  )
    invalid('invalid name')
  if (
    typeof sidecar.spec !== 'string' ||
    !sidecar.spec.endsWith('.shots.ts') ||
    sidecar.spec.startsWith('/') ||
    /^[a-z]:/i.test(sidecar.spec) ||
    sidecar.spec.includes('\\') ||
    sidecar.spec
      .slice(0, -'.shots.ts'.length)
      .split('/')
      .some((part) => !part || part === '.' || part === '..')
  )
    invalid('invalid canonical spec')
  if (typeof sidecar.testId !== 'string' || !sidecar.testId || !final.has(sidecar.testId))
    invalid('unknown testId')
  if (typeof sidecar.retry !== 'number' || !Number.isInteger(sidecar.retry) || sidecar.retry < 0)
    invalid('invalid retry')
  const storageSpec = (sidecar.spec as string).slice(0, -'.shots.ts'.length)
  const expected =
    sidecar.kind === 'shot'
      ? `shots/${storageSpec}/${sidecar.name}.png`
      : `data/${storageSpec}/${sidecar.name}`
  if (sidecar.file !== expected) invalid(`file must equal ${expected}`)
  if (sidecar.kind === 'shot') {
    const viewport = sidecar.viewport
    if (
      viewport !== null &&
      (typeof viewport !== 'object' ||
        Array.isArray(viewport) ||
        typeof (viewport as Viewport).width !== 'number' ||
        !Number.isInteger((viewport as Viewport).width) ||
        (viewport as Viewport).width < 1 ||
        typeof (viewport as Viewport).height !== 'number' ||
        !Number.isInteger((viewport as Viewport).height) ||
        (viewport as Viewport).height < 1)
    )
      invalid('invalid viewport')
    if (
      sidecar.deviceScaleFactor !== null &&
      (typeof sidecar.deviceScaleFactor !== 'number' ||
        !Number.isFinite(sidecar.deviceScaleFactor) ||
        sidecar.deviceScaleFactor <= 0)
    )
      invalid('invalid deviceScaleFactor')
    if (typeof sidecar.fullPage !== 'boolean') invalid('invalid fullPage')
    if (typeof sidecar.capturedAt !== 'string') invalid('invalid capturedAt')
    if (
      typeof sidecar.durationMs !== 'number' ||
      !Number.isFinite(sidecar.durationMs) ||
      sidecar.durationMs < 0
    )
      invalid('invalid durationMs')
    if (typeof sidecar.checked !== 'boolean') invalid('invalid checked')
  } else {
    if (typeof sidecar.contentType !== 'string' || !sidecar.contentType)
      invalid('invalid contentType')
    if (typeof sidecar.bytes !== 'number' || !Number.isInteger(sidecar.bytes) || sidecar.bytes < 0)
      invalid('invalid bytes')
  }
  return sidecar as Sidecar
}

function removeStaleCapture(runDir: string, file: string): void {
  let parent = runDir
  for (const segment of file.split('/').slice(0, -1)) {
    parent = path.join(parent, segment)
    try {
      if (fs.lstatSync(parent).isSymbolicLink())
        throw new Error(`shotwright: stale capture path has a symlink: ${file}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
  fs.rmSync(path.join(runDir, file), { force: true })
}
export function assembleManifest(input: AssembleInput): Manifest {
  const final = new Map(input.tests.map((t) => [t.id, t.retry]))
  const sidecars = input.sidecars.map((s, i) => validateSidecar(s, i, final))
  const selected = sidecars.filter((s) => final.get(s.testId) === s.retry)
  const seenShots = new Set<string>(),
    seenArtifacts = new Set<string>()
  const duplicateShots = new Set<string>()
  for (const s of selected)
    if (s.kind === 'shot') {
      const key = shotKey(s.spec, s.name)
      if (seenShots.has(key)) duplicateShots.add(key)
      seenShots.add(key)
    }
  seenShots.clear()
  const shots: ShotEntry[] = [],
    artifacts: ArtifactEntry[] = []
  for (const s of selected) {
    const key = shotKey(s.spec, s.name)
    const seen = s.kind === 'shot' ? seenShots : seenArtifacts
    if (s.kind === 'shot' && duplicateShots.has(key)) continue
    if (seen.has(key))
      throw new Error(`shotwright: duplicate ${s.kind} name "${s.name}" in ${s.spec}`)
    seen.add(key)
    if (s.kind === 'shot') {
      const rest = { ...s }
      delete (rest as Partial<Sidecar>).kind
      shots.push({
        ...rest,
        video: input.artifacts.get(s.testId)?.video ?? null,
        trace: input.artifacts.get(s.testId)?.trace ?? null,
      })
    } else {
      artifacts.push({
        name: s.name,
        spec: s.spec,
        file: s.file,
        contentType: s.contentType,
        bytes: s.bytes,
        testId: s.testId,
      })
    }
  }
  const retained = new Set(
    selected
      .filter((s) => s.kind !== 'shot' || !duplicateShots.has(shotKey(s.spec, s.name)))
      .map((s) => s.file),
  )
  for (const s of sidecars) if (!retained.has(s.file)) removeStaleCapture(input.runDir, s.file)
  shots.sort(
    (a, b) =>
      a.spec.localeCompare(b.spec) ||
      a.capturedAt.localeCompare(b.capturedAt) ||
      a.name.localeCompare(b.name),
  )
  artifacts.sort(
    (a, b) =>
      a.spec.localeCompare(b.spec) ||
      a.name.localeCompare(b.name) ||
      a.testId.localeCompare(b.testId),
  )
  return {
    manifestVersion: 2,
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    shotwrightVersion: input.shotwrightVersion,
    playwrightVersion: input.playwrightVersion,
    flags: input.flags,
    status: duplicateShots.size ? 'failed' : input.status,
    runError: duplicateShots.size
      ? {
          code: 'DUPLICATE_SHOT',
          message: 'Duplicate shot identity found during manifest assembly',
        }
      : null,
    publication: input.publication,
    tests: [...input.tests].sort(
      (a, b) =>
        a.spec.localeCompare(b.spec) ||
        a.project.localeCompare(b.project) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    ),
    shots,
    artifacts,
    failures: [...input.failures].sort((a, b) => a.testId.localeCompare(b.testId)),
  }
}
