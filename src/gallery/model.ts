import fs from 'node:fs'
import path from 'node:path'

import {
  MANIFEST_VERSION,
  type Manifest,
  type ShotEntry,
  type Viewport,
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

function shot(value: unknown, index: number): ShotEntry {
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
  }
}

export function validateManifest(value: unknown, expectedRunId?: string): Manifest {
  const candidate = record(value, 'manifest')
  if (candidate.manifestVersion !== MANIFEST_VERSION) {
    throw new GalleryManifestError(`manifestVersion must be ${MANIFEST_VERSION}`)
  }
  const runId = string(candidate.runId, 'runId')
  if (expectedRunId !== undefined && runId !== expectedRunId) {
    throw new GalleryManifestError(
      `runId "${runId}" does not match run directory "${expectedRunId}"`,
    )
  }
  const flags = record(candidate.flags, 'flags')
  if (!Array.isArray(flags.only) || !flags.only.every((item) => typeof item === 'string')) {
    throw new GalleryManifestError('flags.only must be an array of strings')
  }
  if (!Array.isArray(candidate.shots)) {
    throw new GalleryManifestError('shots must be an array')
  }
  const shots = candidate.shots.map(shot)
  const seen = new Set<string>()
  for (const entry of shots) {
    if (seen.has(entry.name)) {
      throw new GalleryManifestError(`duplicate shot name "${entry.name}"`)
    }
    seen.add(entry.name)
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: string(candidate.startedAt, 'startedAt'),
    finishedAt: string(candidate.finishedAt, 'finishedAt'),
    shotwrightVersion: string(candidate.shotwrightVersion, 'shotwrightVersion'),
    playwrightVersion: string(candidate.playwrightVersion, 'playwrightVersion'),
    flags: {
      only: [...flags.only] as string[],
      video: boolean(flags.video, 'flags.video'),
      trace: boolean(flags.trace, 'flags.trace'),
    },
    shots,
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
    target = fs.realpathSync(path.join(realRunDir, ...segments))
  } catch {
    throw new Error('referenced file is missing or unreadable')
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

export function readPngModel(runDir: string, relativePath: string): PngModel {
  validateRelativePath(relativePath, 'PNG path')
  const file = containedFile(runDir, relativePath)
  let contents: Buffer
  try {
    contents = fs.readFileSync(file)
  } catch {
    throw new Error('referenced file is missing or unreadable')
  }
  if (contents.byteLength < 33) throw new Error('PNG is truncated before the complete IHDR chunk')
  if (!contents.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
    throw new Error('PNG signature is invalid')
  }
  if (contents.readUInt32BE(8) !== 13 || contents.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG first chunk is not a valid IHDR')
  }
  const width = contents.readUInt32BE(16)
  const height = contents.readUInt32BE(20)
  if (width === 0 || height === 0) throw new Error('PNG IHDR dimensions must be nonzero')

  let offset = pngSignature.byteLength
  let sawIdat = false
  let sawIend = false
  while (offset < contents.byteLength) {
    if (contents.byteLength - offset < 12) throw new Error('PNG contains a truncated chunk')
    const dataLength = contents.readUInt32BE(offset)
    if (dataLength > contents.byteLength - offset - 12) {
      throw new Error('PNG contains a truncated chunk')
    }
    const dataEnd = offset + 8 + dataLength
    const chunkEnd = dataEnd + 4
    const type = contents.toString('ascii', offset + 4, offset + 8)
    const expectedCrc = contents.readUInt32BE(dataEnd)
    if (crc32(contents.subarray(offset + 4, dataEnd)) !== expectedCrc) {
      throw new Error(`PNG ${type} chunk CRC is invalid`)
    }
    if (type === 'IDAT') sawIdat = true
    if (type === 'IEND') {
      if (dataLength !== 0) throw new Error('PNG IEND chunk must be empty')
      if (chunkEnd !== contents.byteLength) {
        throw new Error('PNG IEND chunk must end exactly at the end of the file')
      }
      sawIend = true
      break
    }
    offset = chunkEnd
  }
  if (!sawIend) throw new Error('PNG is missing a terminal IEND chunk')
  if (!sawIdat) throw new Error('PNG is missing an IDAT chunk')

  return {
    width,
    height,
    byteLength: contents.byteLength,
    dataUri: `data:image/png;base64,${contents.toString('base64')}`,
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

export function loadGalleryModel(runDir: string): GalleryModel {
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
  const manifest = validateManifest(parsed, path.basename(runDir))

  // Validate every consumer-controlled path before reading any referenced file.
  for (const [index, entry] of manifest.shots.entries()) {
    validateRelativePath(entry.file, `shots[${index}].file`)
    if (entry.video !== null) validateRelativePath(entry.video, `shots[${index}].video`)
    if (entry.trace !== null) validateRelativePath(entry.trace, `shots[${index}].trace`)
  }

  const diagnostics: GalleryDiagnostic[] = []
  const artifactCache = new Map<string, ArtifactReference>()
  const galleryShots = manifest.shots.map((entry): GalleryShot => {
    let image: PngModel | null = null
    let imageError: string | null = null
    try {
      image = readPngModel(runDir, entry.file)
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
    manifestByteLength: manifestBytes.byteLength,
    specs,
    diagnostics,
  }
}
