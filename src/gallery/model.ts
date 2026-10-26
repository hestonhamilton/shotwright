// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'

import {
  MANIFEST_VERSION,
  type Manifest,
  type ShotEntry,
  type Viewport,
  shotKey,
  validExecutable,
} from '../manifest.js'

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const crc32Table = new Uint32Array(256)
for (let value = 0; value < crc32Table.length; value++) {
  let crc = value
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  crc32Table[value] = crc >>> 0
}

export interface GalleryDiagnostic {
  path: string
  message: string
}

export interface PngModel {
  width: number
  height: number
  byteLength: number
  dataUri: string
}

export interface ArtifactReference {
  path: string
  available: boolean
}

export interface GalleryShot {
  entry: ShotEntry
  image: PngModel | null
  imageError: string | null
  video: ArtifactReference | null
  trace: ArtifactReference | null
}

export interface GallerySpec {
  name: string
  shots: GalleryShot[]
}

export interface GalleryModel {
  manifest: Manifest
  manifestByteLength: number
  specs: GallerySpec[]
  diagnostics: GalleryDiagnostic[]
  sourceManifestVersion: 1 | 2
}

export class GalleryManifestError extends Error {
  constructor(message: string) {
    super(`shotwright gallery: invalid manifest: ${message}`)
    this.name = 'GalleryManifestError'
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GalleryManifestError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new GalleryManifestError(`${label} must be a string`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new GalleryManifestError(`${label} must be a boolean`)
  }
  return value
}

function number(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new GalleryManifestError(`${label} must be a finite number >= ${minimum}`)
  }
  return value
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label)
}

function viewport(value: unknown, label: string): Viewport | null {
  if (value === null) return null
  const candidate = record(value, label)
  const width = number(candidate.width, `${label}.width`, 1)
  const height = number(candidate.height, `${label}.height`, 1)
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new GalleryManifestError(`${label} dimensions must be integers`)
  }
  return { width, height }
}

function shot(value: unknown, index: number, version: 1 | 2): ShotEntry {
  const label = `shots[${index}]`
  const candidate = record(value, label)
  return {
    name: string(candidate.name, `${label}.name`),
    spec: string(candidate.spec, `${label}.spec`),
    file: string(candidate.file, `${label}.file`),
    viewport: viewport(candidate.viewport, `${label}.viewport`),
    deviceScaleFactor:
      candidate.deviceScaleFactor === null
        ? null
        : number(candidate.deviceScaleFactor, `${label}.deviceScaleFactor`, Number.MIN_VALUE),
    fullPage: boolean(candidate.fullPage, `${label}.fullPage`),
    capturedAt: string(candidate.capturedAt, `${label}.capturedAt`),
    durationMs: number(candidate.durationMs, `${label}.durationMs`),
    video: nullableString(candidate.video, `${label}.video`),
    trace: nullableString(candidate.trace, `${label}.trace`),
    testId: version === 1 ? null : nullableString(candidate.testId, `${label}.testId`),
    checked: version === 1 ? false : boolean(candidate.checked, `${label}.checked`),
    retry: version === 1 ? 0 : integer(candidate.retry, `${label}.retry`),
  }
}

function integer(value: unknown, label: string): number {
  const n = number(value, label)
  if (!Number.isInteger(n)) throw new GalleryManifestError(`${label} must be an integer`)
  return n
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new GalleryManifestError(`${label} must be an array`)
  return value
}
function publication(value: unknown, label: string): { ok: boolean; error?: string } {
  const v = record(value, label),
    ok = boolean(v.ok, `${label}.ok`)
  if (ok && v.error !== undefined)
    throw new GalleryManifestError(`${label}.error forbidden when ok`)
  if (!ok && v.error === undefined)
    throw new GalleryManifestError(`${label}.error required when failed`)
  return v.error === undefined ? { ok } : { ok, error: string(v.error, `${label}.error`) }
}
export function validateManifest(value: unknown, expectedRunId?: string): Manifest {
  const candidate = record(value, 'manifest')
  const version = candidate.manifestVersion
  if (version !== 1 && version !== 2)
    throw new GalleryManifestError('manifestVersion must be 1 or 2')
  const runId = string(candidate.runId, 'runId')
  if (expectedRunId !== undefined && runId !== expectedRunId)
    throw new GalleryManifestError(
      `runId "${runId}" does not match run directory "${expectedRunId}"`,
    )
  const flags = record(candidate.flags, 'flags')
  if (!Array.isArray(flags.only) || !flags.only.every((x) => typeof x === 'string'))
    throw new GalleryManifestError('flags.only must be an array of strings')
  const shots = array(candidate.shots, 'shots').map((v, i) => shot(v, i, version))
  const seen = new Set<string>()
  for (const entry of shots) {
    const key = shotKey(entry.spec, entry.name)
    if (seen.has(key))
      throw new GalleryManifestError(`duplicate shot name "${entry.name}" in ${entry.spec}`)
    seen.add(key)
  }
  const status = version === 1 ? 'unknown' : string(candidate.status, 'status')
  if (
    !['passed', 'failed', 'timedout', 'interrupted', 'unknown'].includes(status) ||
    (version === 2 && status === 'unknown')
  )
    throw new GalleryManifestError('status is invalid')
  const pub =
    version === 1
      ? { gallery: { ok: true }, evidence: { ok: true } }
      : record(candidate.publication, 'publication')
  const tests =
    version === 1
      ? []
      : array(candidate.tests, 'tests').map((v, i) => {
          const label = `tests[${i}]`,
            t = record(v, label),
            state = string(t.status, `${label}.status`)
          if (!['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(state))
            throw new GalleryManifestError(`${label}.status invalid`)
          const title = string(t.title, `${label}.title`)
          const titlePath =
            t.titlePath === undefined
              ? [title]
              : array(t.titlePath, `${label}.titlePath`).map((part, j) =>
                  string(part, `${label}.titlePath[${j}]`),
                )
          if (!titlePath.length || titlePath.some((part) => !part) || titlePath.at(-1) !== title)
            throw new GalleryManifestError(`${label}.titlePath must be nonempty and end with title`)
          return {
            id: string(t.id, `${label}.id`),
            title,
            titlePath,
            spec: string(t.spec, `${label}.spec`),
            project: string(t.project, `${label}.project`),
            status: state as Manifest['tests'][number]['status'],
            retry: integer(t.retry, `${label}.retry`),
            durationMs: number(t.durationMs, `${label}.durationMs`),
            ...(t.error === undefined
              ? {}
              : {
                  error: {
                    message: string(
                      record(t.error, `${label}.error`).message,
                      `${label}.error.message`,
                    ),
                  },
                }),
          }
        })
  const artifacts =
    version === 1
      ? []
      : array(candidate.artifacts, 'artifacts').map((v, i) => {
          const label = `artifacts[${i}]`,
            a = record(v, label)
          return {
            name: string(a.name, `${label}.name`),
            spec: string(a.spec, `${label}.spec`),
            file: string(a.file, `${label}.file`),
            contentType: string(a.contentType, `${label}.contentType`),
            bytes: integer(a.bytes, `${label}.bytes`),
            testId: string(a.testId, `${label}.testId`),
          }
        })
  const failures =
    version === 1
      ? []
      : array(candidate.failures, 'failures').map((v, i) => {
          const label = `failures[${i}]`,
            f = record(v, label)
          return {
            testId: string(f.testId, `${label}.testId`),
            files: array(f.files, `${label}.files`).map((v, j) => {
              const l = `${label}.files[${j}]`,
                a = record(v, l)
              return {
                name: string(a.name, `${l}.name`),
                contentType: string(a.contentType, `${l}.contentType`),
                file: string(a.file, `${l}.file`),
              }
            }),
          }
        })
  const runError =
    version === 1 || candidate.runError === undefined || candidate.runError === null
      ? null
      : record(candidate.runError, 'runError')
  if (
    runError !== null &&
    (string(runError.code, 'runError.code') !== 'DUPLICATE_SHOT' ||
      string(runError.message, 'runError.message') !==
        'Duplicate shot identity found during manifest assembly')
  )
    throw new GalleryManifestError('runError is invalid')
  if (runError !== null && status !== 'failed')
    throw new GalleryManifestError('runError requires failed status')
  let environment: Manifest['environment'] = null
  if (version === 2 && candidate.environment !== undefined && candidate.environment !== null) {
    const value = record(candidate.environment, 'environment')
    const platform = string(value.platform, 'environment.platform')
    if (
      ![
        'aix',
        'android',
        'darwin',
        'freebsd',
        'haiku',
        'linux',
        'openbsd',
        'sunos',
        'win32',
        'cygwin',
        'netbsd',
      ].includes(platform)
    )
      throw new GalleryManifestError('environment.platform is invalid')
    let distribution: NonNullable<Manifest['environment']>['distribution'] = null
    if (value.distribution !== null) {
      const release = record(value.distribution, 'environment.distribution')
      const id = string(release.id, 'environment.distribution.id')
      const versionId = string(release.versionId, 'environment.distribution.versionId')
      if (
        platform !== 'linux' ||
        !/^[a-z0-9][a-z0-9._-]*$/i.test(id) ||
        !/^[a-z0-9][a-z0-9._-]*$/i.test(versionId)
      )
        throw new GalleryManifestError('environment.distribution is invalid')
      distribution = { id, versionId }
    }
    environment = { platform: platform as NodeJS.Platform, distribution }
  }
  const browsers: NonNullable<Manifest['browsers']> = []
  if (version === 2 && candidate.browsers !== undefined) {
    const rows = array(candidate.browsers, 'browsers')
    for (const [index, row] of rows.entries()) {
      const label = `browsers[${index}]`
      const browser = record(row, label)
      const project = string(browser.project, `${label}.project`)
      const name = nullableString(browser.name, `${label}.name`)
      const browserVersion = nullableString(browser.version, `${label}.version`)
      const channel = nullableString(browser.channel, `${label}.channel`)
      if (
        (name !== null && !['chromium', 'firefox', 'webkit'].includes(name)) ||
        (browserVersion !== null && !/^\d+(?:\.\d+)*$/.test(browserVersion)) ||
        (channel !== null && !/^[a-z0-9-]+$/.test(channel)) ||
        !validExecutable(browser.executable) ||
        (browser.executable !== null && name !== 'chromium')
      )
        throw new GalleryManifestError(`${label} is invalid`)
      if (
        browsers.some((prior) => prior.project === project) ||
        (browsers.length && browsers.at(-1)!.project.localeCompare(project) >= 0)
      )
        throw new GalleryManifestError('browsers must be sorted with unique projects')
      browsers.push({
        project,
        name,
        version: browserVersion,
        channel,
        executable: browser.executable,
      })
    }
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: string(candidate.startedAt, 'startedAt'),
    finishedAt: string(candidate.finishedAt, 'finishedAt'),
    shotwrightVersion: string(candidate.shotwrightVersion, 'shotwrightVersion'),
    playwrightVersion: string(candidate.playwrightVersion, 'playwrightVersion'),
    environment,
    browsers,
    flags: {
      only: [...flags.only] as string[],
      video: boolean(flags.video, 'flags.video'),
      trace: boolean(flags.trace, 'flags.trace'),
    },
    status: status as Manifest['status'],
    runError:
      runError === null
        ? null
        : {
            code: 'DUPLICATE_SHOT',
            message: 'Duplicate shot identity found during manifest assembly',
          },
    publication: {
      gallery: publication(pub.gallery, 'publication.gallery'),
      evidence: publication(pub.evidence, 'publication.evidence'),
    },
    tests,
    shots,
    artifacts,
    failures,
  }
}

export function validateRelativePath(value: string, label = 'path'): string[] {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    throw new GalleryManifestError(`${label} must be a run-relative path`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new GalleryManifestError(`${label} must not contain empty or dot segments`)
  }
  return segments
}

function containedFile(runDir: string, relativePath: string): string {
  const segments = validateRelativePath(relativePath)
  let realRunDir: string
  try {
    realRunDir = fs.realpathSync(runDir)
  } catch {
    throw new Error('run directory is missing or unreadable')
  }
  let target: string
  try {
    for (let i = 1; i <= segments.length; i++) {
      if (fs.lstatSync(path.join(realRunDir, ...segments.slice(0, i))).isSymbolicLink())
        throw new Error('referenced file escapes the run directory via symlink')
    }
    target = fs.realpathSync(path.join(realRunDir, ...segments))
  } catch (error) {
    if (error instanceof Error && error.message.includes('via symlink')) throw error
    throw new Error('referenced file is missing or unreadable', { cause: error })
  }
  const relative = path.relative(realRunDir, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('referenced file escapes the run directory')
  }
  try {
    if (!fs.statSync(target).isFile()) throw new Error('referenced path is not a file')
  } catch (error) {
    if (error instanceof Error && error.message === 'referenced path is not a file') throw error
    throw new Error('referenced file is missing or unreadable', { cause: error })
  }
  return target
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff]!
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * The one reviewer-facing reason a PNG's bytes are unreadable, or null when the
 * container is structurally sound (signature, IHDR, chunk lengths and CRCs,
 * IDAT, terminal IEND). The gallery placeholder and the compare pair error both
 * use it, so one file is described one way on both surfaces.
 */
export function pngStructureReason(contents: Buffer): string | null {
  if (
    contents.byteLength < pngSignature.byteLength ||
    !contents.subarray(0, pngSignature.byteLength).equals(pngSignature)
  ) {
    return 'not a PNG file (missing PNG signature)'
  }
  if (contents.byteLength < 33) return 'truncated PNG (ends before the complete IHDR chunk)'
  if (contents.readUInt32BE(8) !== 13 || contents.toString('ascii', 12, 16) !== 'IHDR') {
    return 'corrupt PNG (first chunk is not a valid IHDR)'
  }
  if (contents.readUInt32BE(16) === 0 || contents.readUInt32BE(20) === 0) {
    return 'corrupt PNG (IHDR dimensions must be nonzero)'
  }

  let offset = pngSignature.byteLength
  let sawIdat = false
  while (offset < contents.byteLength) {
    if (contents.byteLength - offset < 12) return 'truncated PNG (data ends early)'
    const dataLength = contents.readUInt32BE(offset)
    if (dataLength > contents.byteLength - offset - 12) return 'truncated PNG (data ends early)'
    const dataEnd = offset + 8 + dataLength
    const chunkEnd = dataEnd + 4
    const type = contents.toString('ascii', offset + 4, offset + 8)
    if (crc32(contents.subarray(offset + 4, dataEnd)) !== contents.readUInt32BE(dataEnd)) {
      return `corrupt PNG ${type} chunk (CRC mismatch)`
    }
    if (type === 'IDAT') sawIdat = true
    if (type === 'IEND') {
      if (dataLength !== 0) return 'corrupt PNG (IEND chunk must be empty)'
      if (chunkEnd !== contents.byteLength) return 'corrupt or trailing data after the image'
      return sawIdat ? null : 'corrupt PNG (missing an IDAT chunk)'
    }
    offset = chunkEnd
  }
  return 'truncated PNG (missing a terminal IEND chunk)'
}

export function readPngModel(runDir: string, relativePath: string, inline = true): PngModel {
  validateRelativePath(relativePath, 'PNG path')
  const file = containedFile(runDir, relativePath)
  let contents: Buffer
  try {
    contents = fs.readFileSync(file)
  } catch {
    throw new Error('referenced file is missing or unreadable')
  }
  const reason = pngStructureReason(contents)
  if (reason !== null) throw new Error(reason)

  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
    byteLength: contents.byteLength,
    dataUri: inline ? `data:image/png;base64,${contents.toString('base64')}` : '',
  }
}

function readArtifact(
  runDir: string,
  relativePath: string,
  diagnostics: GalleryDiagnostic[],
): ArtifactReference {
  try {
    containedFile(runDir, relativePath)
    return { path: relativePath, available: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    diagnostics.push({ path: relativePath, message: `artifact unavailable: ${message}` })
    return { path: relativePath, available: false }
  }
}

export function loadGalleryModel(runDir: string, inline = true): GalleryModel {
  const manifestPath = path.join(runDir, 'manifest.json')
  let manifestBytes: Buffer
  try {
    manifestBytes = fs.readFileSync(manifestPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new GalleryManifestError(`manifest.json could not be read: ${message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(manifestBytes.toString('utf8'))
  } catch {
    throw new GalleryManifestError('manifest.json is not valid JSON')
  }
  return buildGalleryModel(
    runDir,
    validateManifest(parsed, path.basename(runDir)),
    manifestBytes.byteLength,
    (parsed as { manifestVersion: 1 | 2 }).manifestVersion,
    inline,
  )
}

export function buildGalleryModel(
  runDir: string,
  manifest: Manifest,
  manifestByteLength = Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n'),
  sourceManifestVersion: 1 | 2 = 2,
  inline = true,
): GalleryModel {
  // Validate every consumer-controlled path before reading any referenced file.
  for (const [index, entry] of manifest.shots.entries()) {
    validateRelativePath(entry.file, `shots[${index}].file`)
    if (entry.video !== null) validateRelativePath(entry.video, `shots[${index}].video`)
    if (entry.trace !== null) validateRelativePath(entry.trace, `shots[${index}].trace`)
  }

  for (const [index, entry] of manifest.artifacts.entries())
    validateRelativePath(entry.file, `artifacts[${index}].file`)
  for (const [i, failure] of manifest.failures.entries())
    for (const [j, entry] of failure.files.entries())
      validateRelativePath(entry.file, `failures[${i}].files[${j}].file`)

  const diagnostics: GalleryDiagnostic[] = []
  const artifactCache = new Map<string, ArtifactReference>()
  for (const entry of manifest.artifacts) readArtifact(runDir, entry.file, diagnostics)
  for (const failure of manifest.failures)
    for (const entry of failure.files) readArtifact(runDir, entry.file, diagnostics)
  const galleryShots = manifest.shots.map((entry): GalleryShot => {
    let image: PngModel | null = null
    let imageError: string | null = null
    try {
      image = readPngModel(runDir, entry.file, inline)
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error)
      diagnostics.push({ path: entry.file, message: `screenshot unavailable: ${imageError}` })
    }
    const artifact = (relativePath: string | null): ArtifactReference | null => {
      if (relativePath === null) return null
      const cached = artifactCache.get(relativePath)
      if (cached) return cached
      const loaded = readArtifact(runDir, relativePath, diagnostics)
      artifactCache.set(relativePath, loaded)
      return loaded
    }
    return {
      entry,
      image,
      imageError,
      video: artifact(entry.video),
      trace: artifact(entry.trace),
    }
  })

  const specs: GallerySpec[] = []
  const specsByName = new Map<string, GallerySpec>()
  for (const galleryShot of galleryShots) {
    const existing = specsByName.get(galleryShot.entry.spec)
    if (existing) {
      existing.shots.push(galleryShot)
    } else {
      const created = { name: galleryShot.entry.spec, shots: [galleryShot] }
      specs.push(created)
      specsByName.set(created.name, created)
    }
  }
  return {
    manifest,
    manifestByteLength,
    sourceManifestVersion,
    specs,
    diagnostics,
  }
}

export interface CompareOptions {
  threshold: number
  includeAA: boolean
}
export interface CompareVerdict {
  state: 'identical' | 'similar' | 'changed' | 'size-changed' | 'unreadable'
  differentPixels: number | null
  totalPixels: number | null
  ratio: number | null
  aSize: Viewport | null
  bSize: Viewport | null
  diffPng: Buffer | null
  error?: string
}
export function compareImages(_aPng: Buffer, _bPng: Buffer, _opts: CompareOptions): CompareVerdict {
  throw new Error('not implemented')
}
export type ComparePairState =
  'identical' | 'similar' | 'changed' | 'size-changed' | 'added' | 'removed' | 'unreadable'
export interface CompareGenerationResult {
  outputFile: string
  counts: Record<ComparePairState, number>
  gate: {
    measuredNonParity: number
    ignoredNonParity: number
    nonParity: number
    failOnChange: boolean
  }
}
export { shotKey }

export interface CompareModel {
  a: GalleryModel
  b: GalleryModel
  pairs: Array<{ key: string; state: ComparePairState; spec: string; name: string }>
  counts: Record<ComparePairState, number>
  diagnostics: GalleryDiagnostic[]
}
