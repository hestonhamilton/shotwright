// SPDX-License-Identifier: AGPL-3.0-or-later
// In-spec capture API — public as 'shotwright/capture'.
//
// shot() writes the PNG into the run layout and records a manifest sidecar; the
// shotwright reporter assembles sidecars into manifest.json at run end. Requires
// SHOTWRIGHT_RUN_DIR (set by `shotwright run` via the config factory) — bare
// `playwright test` runs are unsupported in v1.

import fs from 'node:fs'
import path from 'node:path'
import { constants } from 'node:fs'

import { test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { parseOnly, shouldCapture } from './filter.js'
import { readSidecars, writeSidecar } from './manifest.js'

export { parseOnly, shouldCapture }

/** Alias of the consumer's `test` — specs read as walkthroughs, not assertions. */
export const walkthrough = test

export interface ShotOptions {
  /** Full-page capture. Default: true, unless `clip` or `locator` is given. */
  fullPage?: boolean
  clip?: { x: number; y: number; width: number; height: number }
  /** Capture this element instead of the page. */
  locator?: Locator
  check?: () => void | Promise<void>
}

function unsafePathReason(value: string): string | null {
  if (value === '') return 'is empty'
  if (value.includes('\0')) return 'contains a NUL byte'
  if (value.includes('\\')) return 'contains a backslash'
  return null
}

/** The file suite is the loaded spec; TestInfo.file is only the declaration site. */
function loadedSpec(info: ReturnType<typeof test.info>): string {
  const loaded = info.titlePath[0]
  if (!loaded) throw new Error('shotwright: loaded spec is unavailable')
  const spec = path
    .relative(info.project.testDir, path.resolve(info.project.testDir, loaded))
    .split(path.sep)
    .join('/')
  validateSpecPath(spec)
  return spec
}

export function validateArtifactName(name: string): void {
  const reason =
    unsafePathReason(name) ??
    (path.isAbsolute(name) || name.split('/').some((part) => /^[a-z][a-z0-9+.-]*:/i.test(part))
      ? 'is absolute or drive-like'
      : null) ??
    (name.split('/').some((part) => !part || part === '.' || part === '..')
      ? 'has an empty or dot path segment'
      : null)
  if (reason)
    throw new Error(`shotwright: invalid artifact name ${JSON.stringify(name)} — it ${reason}`)
}

function safeParent(runDir: string, relativeFile: string): string {
  validateArtifactName(relativeFile)
  let current = runDir
  if (!fs.lstatSync(current).isDirectory())
    throw new Error('shotwright: artifact parent is not a directory or is a symlink')
  for (const segment of relativeFile.split('/').slice(0, -1)) {
    current = path.join(current, segment)
    try {
      fs.mkdirSync(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (!fs.lstatSync(current).isDirectory())
      throw new Error('shotwright: artifact parent is not a directory or is a symlink')
  }
  return current
}

/** Check every parent immediately before opening a final file. */
function openWrite(runDir: string, file: string): number {
  safeParent(runDir, file)
  return fs.openSync(
    path.join(runDir, file),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  )
}

function claimShot(
  runDir: string,
  file: string,
  spec: string,
  name: string,
  testId: string,
  retry: number,
): number {
  const abs = path.join(runDir, file)
  try {
    return openWrite(runDir, file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const previous = readSidecars(runDir).filter(
    (s) => s.kind === 'shot' && s.spec === spec && s.name === name,
  )
  if (
    retry > 0 &&
    previous.length > 0 &&
    previous.every((s) => s.testId === testId && s.retry < retry) &&
    Math.max(...previous.map((s) => s.retry)) === retry - 1
  ) {
    const before = fs.lstatSync(abs)
    if (!before.isFile() || before.isSymbolicLink())
      throw new Error(`shotwright: unsafe prior shot claim in ${spec}`)
    fs.unlinkSync(abs)
    return openWrite(runDir, file)
  }
  throw new Error(`shotwright: duplicate shot name "${name}" in ${spec}`)
}

/** A shot name is one file-name segment: no separators, no `.`/`..`, no NUL. */
export function validateShotName(name: string): void {
  const reason =
    unsafePathReason(name) ??
    (name.includes('/') ? 'contains a slash' : null) ??
    (name === '.' || name === '..' ? 'is a relative path segment' : null)
  if (reason !== null) {
    throw new Error(`shotwright: invalid shot name ${JSON.stringify(name)} — it ${reason}`)
  }
}

/** A spec path is relative to testDir and must stay inside it once joined under `shots/`. */
export function validateSpecPath(spec: string): void {
  const reason =
    unsafePathReason(spec) ??
    (spec.startsWith('/') ? 'is absolute' : null) ??
    (spec.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      ? 'has an empty, "." or ".." path segment'
      : null)
  if (reason !== null) {
    throw new Error(`shotwright: invalid spec path ${JSON.stringify(spec)} — it ${reason}`)
  }
}

/** Capture `<runDir>/shots/<spec>/<name>.png` and record its manifest sidecar. */
export async function shot(page: Page, name: string, opts: ShotOptions = {}): Promise<void> {
  const runDir = process.env.SHOTWRIGHT_RUN_DIR
  if (!runDir) {
    throw new Error(
      'shotwright: SHOTWRIGHT_RUN_DIR is not set — run specs via `shotwright run` ' +
        '(bare `playwright test` runs are not supported)',
    )
  }
  validateShotName(name)
  if (!shouldCapture(name, parseOnly(process.env.SHOTWRIGHT_ONLY))) return

  const info = test.info()
  const spec = loadedSpec(info)
  const file = `shots/${storageSpec(spec)}/${name}.png`
  const abs = path.join(runDir, file)
  if (opts.check) await opts.check()
  const fullPage = opts.fullPage ?? (opts.clip === undefined && opts.locator === undefined)
  const started = Date.now()
  const fd = claimShot(runDir, file, spec, name, info.testId, info.retry)
  const claimed = fs.fstatSync(fd)
  let completed = false
  try {
    const bytes = opts.locator
      ? await opts.locator.screenshot({ type: 'png' })
      : await page.screenshot({ type: 'png', fullPage, ...(opts.clip ? { clip: opts.clip } : {}) })
    fs.writeFileSync(fd, bytes)
    writeSidecar(runDir, {
      kind: 'shot',
      name,
      spec,
      file,
      viewport: page.viewportSize(),
      deviceScaleFactor: (info.project.use.deviceScaleFactor as number | undefined) ?? null,
      fullPage,
      capturedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      testId: info.testId,
      checked: opts.check !== undefined,
      retry: info.retry,
    })
    completed = true
  } finally {
    fs.closeSync(fd)
    if (!completed) {
      try {
        const current = fs.lstatSync(abs)
        if (current.isFile() && current.ino === claimed.ino && current.dev === claimed.dev)
          fs.unlinkSync(abs)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.error('shotwright: failed to remove incomplete screenshot claim')
      }
    }
  }

  console.log(`shot ${name}`)
}

/** Strip only the final matched suffix; the manifest retains the canonical spec. */
export function storageSpec(spec: string): string {
  validateSpecPath(spec)
  if (!spec.endsWith('.shots.ts')) throw new Error(`shotwright: unsupported spec match ${spec}`)
  return spec.slice(0, -'.shots.ts'.length)
}
export type ArtifactOptions =
  | { body: string | Buffer; path?: never; contentType: string }
  | { path: string; body?: never; contentType: string }
export async function artifact(name: string, opts: ArtifactOptions): Promise<void> {
  const runDir = process.env.SHOTWRIGHT_RUN_DIR
  if (!runDir) throw new Error('shotwright: SHOTWRIGHT_RUN_DIR is not set — use `shotwright run`')
  validateArtifactName(name)
  if (!opts || !opts.contentType || !/^[^\s/]+\/[^\s/]+$/.test(opts.contentType))
    throw new Error('shotwright: artifact contentType must be a MIME type')
  if ('body' in opts === 'path' in opts)
    throw new Error('shotwright: artifact needs exactly one body or path')
  const info = test.info()
  const spec = loadedSpec(info)
  const file = `data/${storageSpec(spec)}/${name}`
  const dest = path.join(runDir, file)
  const bytes =
    'body' in opts
      ? typeof opts.body === 'string'
        ? Buffer.from(opts.body)
        : opts.body
      : fs.readFileSync(opts.path!)
  if (!bytes) throw new Error('shotwright: artifact body is missing')
  safeParent(runDir, file)
  if (fs.existsSync(dest)) {
    const previous = readSidecars(runDir).filter(
      (s) => s.kind === 'artifact' && s.spec === spec && s.name === name,
    )
    if (!previous.length || previous.some((s) => s.testId !== info.testId || s.retry >= info.retry))
      throw new Error(`shotwright: duplicate artifact name "${name}" in ${spec}`)
    safeParent(runDir, file)
    const prior = fs.lstatSync(dest)
    if (!prior.isFile() || prior.isSymbolicLink())
      throw new Error('shotwright: unsafe prior artifact claim')
    fs.unlinkSync(dest)
  }
  const fd = openWrite(runDir, file)
  try {
    fs.writeFileSync(fd, bytes)
  } finally {
    fs.closeSync(fd)
  }
  writeSidecar(runDir, {
    kind: 'artifact',
    name,
    spec,
    file,
    contentType: opts.contentType,
    bytes: bytes.length,
    testId: info.testId,
    retry: info.retry,
  })
}
