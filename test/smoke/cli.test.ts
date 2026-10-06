// The demo smoke matrix pins filtering, parallel manifest assembly, video, and
// trace as independent CLI contracts. Requires `pnpm run build` first (the
// `smoke` script does) and an installed chromium.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net, { type AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import type { Manifest } from '../../src/manifest.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputDir = path.join(root, 'shots-output')
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const webmSignature = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const minimumArtifactBytes = 1_000
const failureSpec = path.join(root, 'demo/shots/induced-failure.shots.ts')
const failureMarker = 'induced smoke failure marker'
const stdoutMarker = 'induced smoke stdout marker'
const stderrMarker = 'induced smoke stderr marker'
const galleryFailureMarker = 'shotwright gallery: injected generator failure'
const intrinsicBadge = 'Published manifest · pass/fail status is not embedded'
const syntheticRunId = 'synthetic-gallery-60'
const corpusGenerator = path.join(root, 'test/fixtures/generate-gallery-corpus.mjs')
const consumerPnpmStore = path.join(os.tmpdir(), 'shotwright-consumer-pnpm-store')
const playwrightBrowsersPath = path.join(os.homedir(), '.cache', 'ms-playwright')

interface CliRun {
  manifest: Manifest
  runDir: string
  stdout: string
}

interface RunningGallery {
  child: ChildProcess
  url: string
  stdout: () => string
  stderr: () => string
}

type Flags = Manifest['flags']

interface PackedPackage {
  packDir: string
  tarball: string
  files: string[]
}

const runIds = new Set<string>()

let unfilteredRun: CliRun
let onlyRun: CliRun
let videoRun: CliRun
let traceRun: CliRun

function runDirectories(): string[] {
  if (!fs.existsSync(outputDir)) return []
  return fs.readdirSync(outputDir).filter((entry) => entry !== 'latest')
}

function filesUnder(directory: string, current = directory): string[] {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name)
    if (entry.isDirectory()) return filesUnder(directory, absolute)
    return [path.relative(directory, absolute).split(path.sep).join('/')]
  })
}

function fileInsideRun(runDir: string, relativePath: string): string {
  expect(path.isAbsolute(relativePath)).toBe(false)
  const absolute = path.resolve(runDir, relativePath)
  const fromRunDir = path.relative(runDir, absolute)
  expect(
    fromRunDir === '..' ||
      fromRunDir.startsWith(`..${path.sep}`) ||
      path.isAbsolute(fromRunDir),
  ).toBe(false)
  return absolute
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

function groupedNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function pngDimensions(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, pngSignature.byteLength)).toEqual(pngSignature)
  expect(png.readUInt32BE(8)).toBe(13)
  expect(png.toString('ascii', 12, 16)).toBe('IHDR')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function expectValidPng(png: Buffer): void {
  pngDimensions(png)
  let offset = pngSignature.byteLength
  let sawIend = false
  while (offset + 12 <= png.byteLength) {
    const length = png.readUInt32BE(offset)
    const end = offset + 12 + length
    expect(end).toBeLessThanOrEqual(png.byteLength)
    const typeAndData = png.subarray(offset + 4, offset + 8 + length)
    expect(png.readUInt32BE(offset + 8 + length)).toBe(crc32(typeAndData))
    const type = png.toString('ascii', offset + 4, offset + 8)
    offset = end
    if (type === 'IEND') {
      sawIend = true
      break
    }
  }
  expect(sawIend).toBe(true)
  expect(offset).toBe(png.byteLength)
}

function encodedManifestPath(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/')
}

function pointLatestAt(runId: string): void {
  const latest = path.join(outputDir, 'latest')
  fs.rmSync(latest, { force: true })
  fs.symlinkSync(runId, latest)
}

async function startGallery(runId: string | null): Promise<RunningGallery> {
  const args = [
    'dist/cli.js',
    'gallery',
    ...(runId === null ? [] : [runId]),
    '--config',
    'demo/shots.config.ts',
    '--port',
    '0',
  ]
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!child.stdout || !child.stderr) throw new Error('gallery child pipes unavailable')

  let stdout = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  let url: string
  try {
    url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `gallery server did not print a Local URL\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        )
      }, 30_000)
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        clearTimeout(timeout)
        reject(
          new Error(
            `gallery server exited before startup (code ${String(code)}, signal ${String(signal)})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        )
      }
      child.once('exit', onExit)
      child.stdout!.setEncoding('utf8')
      child.stdout!.on('data', (chunk: string) => {
        stdout += chunk
        const match = /^Local: (http:\/\/127\.0\.0\.1:\d+\/)$/m.exec(stdout)
        if (!match) return
        clearTimeout(timeout)
        child.removeListener('exit', onExit)
        resolve(match[1]!)
      })
    })
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGTERM')
    throw error
  }

  return { child, url, stdout: () => stdout, stderr: () => stderr }
}

async function stopGallery(
  running: RunningGallery,
  expectedCode = 0,
): Promise<void> {
  const exit =
    running.child.exitCode === null
      ? new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
          running.child.once('exit', (code, signal) => resolve({ code, signal }))
        })
      : Promise.resolve({ code: running.child.exitCode, signal: running.child.signalCode })
  if (running.child.exitCode === null) {
    expect(running.child.kill('SIGINT')).toBe(true)
  }
  let timeout: NodeJS.Timeout | undefined
  const result = await Promise.race([
    exit,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('gallery server did not exit after SIGINT')),
        15_000,
      )
    }),
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout)
  })
  expect(result).toEqual({ code: expectedCode, signal: null })
}

async function expectOccupiedPortDoesNotClaimServing(): Promise<void> {
  const occupied = net.createServer()
  await new Promise<void>((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen(0, '127.0.0.1', resolve)
  })
  const port = (occupied.address() as AddressInfo).port
  try {
    const result = spawnSync(
      process.execPath,
      [
        'dist/cli.js',
        'gallery',
        unfilteredRun.manifest.runId,
        '--config',
        'demo/shots.config.ts',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CI: '1' },
        timeout: 30_000,
      },
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(
      `shotwright gallery: selected run ${unfilteredRun.manifest.runId} explicitly (this run may be partial or failed)`,
    )
    expect(result.stdout).not.toContain('shotwright gallery: serving')
    expect(result.stdout).not.toContain('Local:')
    expect(result.stderr).toContain('EADDRINUSE')
  } finally {
    await new Promise<void>((resolve, reject) => {
      occupied.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function invokeCli(cliSpecificArgs: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  try {
    return execFileSync(
      process.execPath,
      ['dist/cli.js', 'run', '--config', 'demo/shots.config.ts', ...cliSpecificArgs],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CI: '1', ...extraEnv },
        stdio: 'pipe',
        timeout: 180_000,
      },
    )
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const childError = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer }
    const stdout = childError.stdout?.toString().trimEnd()
    const stderr = childError.stderr?.toString().trimEnd()
    const output = [
      stdout ? `stdout:\n${stdout}` : '',
      stderr ? `stderr:\n${stderr}` : '',
    ].filter(Boolean)
    if (output.length === 0) throw error
    throw new Error(`${error.message.trimEnd()}\n\nCaptured child output:\n${output.join('\n\n')}`, {
      cause: error,
    })
  }
}

function runCli(cliSpecificArgs: string[], expectedFlags: Flags): CliRun {
  const before = new Set(runDirectories())
  const stdout = invokeCli(cliSpecificArgs)
  const newRunIds = runDirectories().filter((entry) => !before.has(entry))
  expect(newRunIds).toHaveLength(1)

  const runId = newRunIds[0]!
  const runDir = path.join(outputDir, runId)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'),
  ) as Manifest

  expect(manifest.manifestVersion).toBe(1)
  expect(manifest.runId).toBe(runId)
  expect(manifest.playwrightVersion).toMatch(/^\d+\.\d+/)
  expect(manifest.flags).toEqual(expectedFlags)

  const manifestFiles = manifest.shots.flatMap((shot) => [
    shot.file,
    ...(shot.video === null ? [] : [shot.video]),
    ...(shot.trace === null ? [] : [shot.trace]),
  ])
  expect(new Set(manifestFiles)).toHaveLength(manifestFiles.length)
  for (const manifestFile of manifestFiles) fileInsideRun(runDir, manifestFile)
  expect(filesUnder(runDir).filter((file) => file !== 'manifest.json' && file !== 'gallery.html').sort()).toEqual(
    [...manifestFiles].sort(),
  )
  expect(fs.existsSync(path.join(runDir, 'gallery.html'))).toBe(true)

  for (const shot of manifest.shots) {
    const png = fs.readFileSync(fileInsideRun(runDir, shot.file))
    expect(png.byteLength).toBeGreaterThan(minimumArtifactBytes)
    expect(png.subarray(0, pngSignature.byteLength)).toEqual(pngSignature)
  }

  expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(runId)
  expect(fs.existsSync(path.join(runDir, '.sidecar'))).toBe(false)
  expect(fs.existsSync(path.join(runDir, '.pw'))).toBe(false)
  expect(fs.existsSync(path.join(runDir, '.manifest.tmp'))).toBe(false)
  expect(fs.readdirSync(runDir).some((entry) => entry.startsWith('.gallery.'))).toBe(false)

  runIds.add(runId)
  return { manifest, runDir, stdout }
}

function expectCompareGallery(): void {
  const compareDir = path.join(outputDir, 'compare')
  const comparePath = path.join(
    compareDir,
    `${unfilteredRun.manifest.runId}.vs.${videoRun.manifest.runId}.html`,
  )
  try {
    const result = spawnSync(
      process.execPath,
      [
        'dist/cli.js',
        'compare',
        unfilteredRun.manifest.runId,
        videoRun.manifest.runId,
        '--config',
        'demo/shots.config.ts',
      ],
      {
        cwd: root,
        env: { ...process.env, CI: '1' },
        encoding: 'utf8',
        timeout: 60_000,
      },
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(
      `shotwright compare: selected A ${unfilteredRun.manifest.runId} explicitly`,
    )
    expect(result.stdout).toContain(
      `shotwright compare: selected B ${videoRun.manifest.runId} explicitly`,
    )
    expect(result.stdout).toContain(`shotwright compare: wrote ${comparePath}`)
    expect(fs.existsSync(comparePath)).toBe(true)

    const html = fs.readFileSync(comparePath, 'utf8')
    expect(html).toContain(unfilteredRun.manifest.runId)
    expect(html).toContain(videoRun.manifest.runId)
    expect(html).toContain('Review artifact · no verdicts')
    expect(html).toContain('5 name buckets')
    expect(html).toContain('unmatched by name')
    expect(html).toContain('renames appear unmatched')
    expect(html).toContain('form-filled')
    expect(html).toContain('about-desktop')
    expect(occurrences(html, 'data:image/png;base64,')).toBe(7)
    expect(Buffer.byteLength(html)).toBeLessThan(8_000_000)
  } finally {
    fs.rmSync(compareDir, { recursive: true, force: true })
  }
}

async function expectFailedRunPreservesLatest(): Promise<void> {
  const previousLatest = fs.readlinkSync(path.join(outputDir, 'latest'))
  const before = new Set(runDirectories())
  fs.writeFileSync(
    failureSpec,
    `import { shot, walkthrough } from 'shotwright/capture'

walkthrough('induced smoke failure', async ({ page }) => {
  console.log('${stdoutMarker}')
  console.error('${stderrMarker}')
  await page.goto('/')
  await shot(page, 'induced-failure-captured')
  throw new Error('${failureMarker}')
})
`,
  )

  let failure: unknown
  try {
    invokeCli(['--', '--grep', 'induced smoke failure'])
  } catch (error) {
    failure = error
  } finally {
    fs.rmSync(failureSpec, { force: true })
  }

  const failedRunIds = runDirectories().filter((entry) => !before.has(entry))
  let running: RunningGallery | null = null
  try {
    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    const capturedOutput = message.split('Captured child output:\n')[1] ?? ''
    expect(message).toContain(failureMarker)
    expect(capturedOutput).toContain('stdout:')
    expect(capturedOutput).toContain(stdoutMarker)
    expect(capturedOutput).toContain('stderr:')
    expect(capturedOutput).toContain(stderrMarker)
    expect(failedRunIds).toHaveLength(1)
    const failedRunId = failedRunIds[0]!
    const failedRunDir = path.join(outputDir, failedRunId)
    const failedManifest = JSON.parse(
      fs.readFileSync(path.join(failedRunDir, 'manifest.json'), 'utf8'),
    ) as Manifest
    expect(failedManifest.runId).toBe(failedRunId)
    expect(failedManifest.shots).toHaveLength(1)
    expect(failedManifest.shots[0]!.name).toBe('induced-failure-captured')
    expect(failedManifest.shots[0]!.video).toBeNull()
    expect(failedManifest.shots[0]!.trace).toBeNull()
    const autoGallery = fs.readFileSync(path.join(failedRunDir, 'gallery.html'), 'utf8')
    expect(occurrences(autoGallery, '<article class="card')).toBe(1)
    expect(autoGallery).toContain('induced-failure-captured')
    expect(autoGallery).toContain(intrinsicBadge)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(previousLatest)

    running = await startGallery(failedRunId)
    expect(running.stdout()).toContain(
      `shotwright gallery: selected run ${failedRunId} explicitly (this run may be partial or failed)`,
    )
    expect(running.stdout()).toContain(`shotwright gallery: serving ${failedRunId}`)
    const response = await fetch(running.url)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('induced-failure-captured')
    await stopGallery(running)
    running = null
  } finally {
    if (running !== null && running.child.exitCode === null) {
      await stopGallery(running)
    }
    for (const runId of failedRunIds) {
      fs.rmSync(path.join(outputDir, runId), { recursive: true, force: true })
    }
  }
}

function expectInjectedGalleryFailurePreservesRunContract(): void {
  const previousLatest = fs.readlinkSync(path.join(outputDir, 'latest'))
  const before = new Set(runDirectories())
  let failure: unknown
  try {
    invokeCli(['--only', 'theme-dark'], { SHOTWRIGHT_INJECT_GALLERY_FAILURE: '1' })
  } catch (error) {
    failure = error
  }

  const failedRunIds = runDirectories().filter((entry) => !before.has(entry))
  try {
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(galleryFailureMarker)
    expect(failedRunIds).toHaveLength(1)
    const runId = failedRunIds[0]!
    const runDir = path.join(outputDir, runId)
    const published = JSON.parse(
      fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'),
    ) as Manifest

    // RT-4: manifest remains published, passed status advances latest, the child
    // exits nonzero with diagnostics, and both reporter staging areas are cleaned.
    expect(published.runId).toBe(runId)
    expect(published.shots.map((shot) => shot.name)).toEqual(['theme-dark'])
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(runId)
    expect(fs.existsSync(path.join(runDir, '.sidecar'))).toBe(false)
    expect(fs.existsSync(path.join(runDir, '.pw'))).toBe(false)
    expect(fs.existsSync(path.join(runDir, 'gallery.html'))).toBe(false)
  } finally {
    fs.rmSync(path.join(outputDir, 'latest'), { force: true })
    fs.symlinkSync(previousLatest, path.join(outputDir, 'latest'))
    for (const runId of failedRunIds) {
      fs.rmSync(path.join(outputDir, runId), { recursive: true, force: true })
    }
  }
}

function expectNoArtifacts(run: CliRun): void {
  for (const shot of run.manifest.shots) {
    expect(shot.video).toBeNull()
    expect(shot.trace).toBeNull()
  }
}

function expectDistinctArtifacts(run: CliRun, artifact: 'video' | 'trace'): void {
  const paths = run.manifest.shots.map((shot) => shot[artifact])
  expect(paths).toHaveLength(2)
  expect(paths.every((artifactPath) => artifactPath !== null)).toBe(true)
  expect(new Set(paths)).toHaveLength(2)
  const signature = artifact === 'video' ? webmSignature : zipSignature
  const contents: Buffer[] = []
  for (const artifactPath of paths) {
    const contentsForShot = fs.readFileSync(fileInsideRun(run.runDir, artifactPath!))
    expect(contentsForShot.byteLength).toBeGreaterThan(minimumArtifactBytes)
    expect(contentsForShot.subarray(0, signature.byteLength)).toEqual(signature)
    contents.push(contentsForShot)
  }
  expect(contents[0]!.equals(contents[1]!)).toBe(false)
}

function expectFiveShotGallery(): void {
  const manifestPath = path.join(unfilteredRun.runDir, 'manifest.json')
  const galleryPath = path.join(unfilteredRun.runDir, 'gallery.html')
  expect(fs.existsSync(manifestPath)).toBe(true)
  expect(fs.existsSync(galleryPath)).toBe(true)
  expect(fs.existsSync(path.join(unfilteredRun.runDir, '.manifest.tmp'))).toBe(false)
  expect(fs.readdirSync(unfilteredRun.runDir).some((entry) => entry.startsWith('.gallery.'))).toBe(
    false,
  )

  const html = fs.readFileSync(galleryPath, 'utf8')
  const cards = Array.from(
    html.matchAll(/<article class="card[^"]*"[^>]*>[\s\S]*?<\/article>/g),
    (match) => match[0],
  )
  const dataUris = Array.from(
    html.matchAll(/href="(data:image\/png;base64,([^"]+))"/g),
    (match) => ({ uri: match[1]!, base64: match[2]! }),
  )
  expect(cards).toHaveLength(5)
  expect(dataUris).toHaveLength(5)
  expect(new Set(dataUris.map(({ uri }) => uri))).toHaveLength(5)

  expect(html).toContain(unfilteredRun.manifest.runId)
  expect(html).toContain(unfilteredRun.manifest.startedAt)
  expect(html).toContain(unfilteredRun.manifest.finishedAt)
  expect(html).toContain(
    `shotwright ${unfilteredRun.manifest.shotwrightVersion} · Playwright ${unfilteredRun.manifest.playwrightVersion}`,
  )
  expect(html).toContain('<dt>Only filter</dt><dd>None</dd>')
  expect(html).toContain('<dt>Video flag</dt><dd>Off</dd>')
  expect(html).toContain('<dt>Trace flag</dt><dd>Off</dd>')
  expect(html).toContain('<span class="badge">5 shots</span>')
  expect(html).toContain('<span class="badge">2 specs</span>')
  expect(occurrences(html, 'Video and trace absent in this run')).toBe(1)
  expect(occurrences(html, intrinsicBadge)).toBe(1)

  for (const [index, shot] of unfilteredRun.manifest.shots.entries()) {
    const card = cards[index]!
    const png = fs.readFileSync(fileInsideRun(unfilteredRun.runDir, shot.file))
    const intrinsic = pngDimensions(png)
    expect(Buffer.from(dataUris[index]!.base64, 'base64')).toEqual(png)
    expect(card).toContain(`<h3>${shot.name}</h3>`)
    expect(card).toContain(`data-search="${shot.name.toLowerCase()} ${shot.spec.toLowerCase()}"`)
    if (shot.viewport === null) {
      expect(card).toContain('Viewport unavailable')
    } else {
      expect(card).toContain(`${shot.viewport.width}×${shot.viewport.height}`)
    }
    expect(card).toContain(
      shot.deviceScaleFactor === null ? 'DSF unavailable' : `DSF ${shot.deviceScaleFactor}`,
    )
    expect(card).toContain(
      `<span class="kind">${shot.fullPage ? 'full page' : 'not full page'}</span>`,
    )
    expect(card).toContain(`<dt>Captured</dt><dd>${shot.capturedAt}</dd>`)
    expect(card).toContain(`${groupedNumber(shot.durationMs)} ms`)
    expect(card).toContain(`data-width="${intrinsic.width}" data-height="${intrinsic.height}"`)
    expect(card).toContain(
      `${groupedNumber(intrinsic.width)}×${groupedNumber(intrinsic.height)} derived`,
    )
  }

  const modal = unfilteredRun.manifest.shots.find((shot) => shot.name === 'modal-open')!
  expect(modal.viewport).toEqual({ width: 1440, height: 960 })
  expect(modal.deviceScaleFactor).toBe(2)
  expect(pngDimensions(fs.readFileSync(fileInsideRun(unfilteredRun.runDir, modal.file)))).toEqual({
    width: 1040,
    height: 816,
  })
}

async function expectLatestGalleryServer(): Promise<void> {
  const previousLatest = fs.readlinkSync(path.join(outputDir, 'latest'))
  const galleryPath = path.join(unfilteredRun.runDir, 'gallery.html')
  const autoPublished = fs.readFileSync(galleryPath)
  let running: RunningGallery | null = null
  try {
    pointLatestAt(unfilteredRun.manifest.runId)
    running = await startGallery(null)
    expect(running.stdout()).toContain(
      `shotwright gallery: selected run ${unfilteredRun.manifest.runId} via latest (last fully passed run)`,
    )
    expect(running.stdout()).toContain(
      `shotwright gallery: serving ${unfilteredRun.manifest.runId}`,
    )
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(fs.readFileSync(galleryPath)).toEqual(autoPublished)

    const rootResponse = await fetch(running.url)
    expect(rootResponse.status).toBe(200)
    expect(rootResponse.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(rootResponse.headers.get('cache-control')).toBe('no-store')
    expect(rootResponse.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await rootResponse.arrayBuffer())).toEqual(autoPublished)

    const firstShot = unfilteredRun.manifest.shots[0]!
    const pngResponse = await fetch(`${running.url}${encodedManifestPath(firstShot.file)}`)
    expect(pngResponse.status).toBe(200)
    expect(pngResponse.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await pngResponse.arrayBuffer())).toEqual(
      fs.readFileSync(fileInsideRun(unfilteredRun.runDir, firstShot.file)),
    )

    expect((await fetch(`${running.url}manifest.json`)).status).toBe(404)
    expect((await fetch(`${running.url}..%2fmanifest.json`)).status).toBe(404)
    const post = await fetch(running.url, { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')

    await stopGallery(running)
    running = null
  } finally {
    if (running !== null && running.child.exitCode === null) await stopGallery(running)
    pointLatestAt(previousLatest)
  }
}

async function expectVideoRange(): Promise<void> {
  const shot = videoRun.manifest.shots.find((candidate) => candidate.video !== null)!
  const relativePath = shot.video!
  const webm = fs.readFileSync(fileInsideRun(videoRun.runDir, relativePath))
  const start = 17
  const end = 83
  let running: RunningGallery | null = null
  try {
    running = await startGallery(videoRun.manifest.runId)
    const response = await fetch(`${running.url}${encodedManifestPath(relativePath)}`, {
      headers: { Range: `bytes=${start}-${end}` },
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('video/webm')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${webm.byteLength}`)
    expect(response.headers.get('content-length')).toBe(String(end - start + 1))
    expect(Buffer.from(await response.arrayBuffer())).toEqual(webm.subarray(start, end + 1))
    await stopGallery(running)
    running = null
  } finally {
    if (running !== null && running.child.exitCode === null) await stopGallery(running)
  }
}

async function expectSyntheticGallery(): Promise<void> {
  const syntheticDir = path.join(outputDir, syntheticRunId)
  let running: RunningGallery | null = null
  try {
    execFileSync(process.execPath, [corpusGenerator, unfilteredRun.runDir, syntheticDir], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    })
    const manifest = JSON.parse(
      fs.readFileSync(path.join(syntheticDir, 'manifest.json'), 'utf8'),
    ) as Manifest
    expect(manifest.manifestVersion).toBe(1)
    expect(manifest.runId).toBe(syntheticRunId)
    expect(manifest.startedAt).toBe('2020-01-02T03:04:05.000Z')
    expect(manifest.finishedAt).toBe('2020-01-02T03:05:05.000Z')
    expect(manifest.shots).toHaveLength(60)
    expect(new Set(manifest.shots.map((shot) => shot.name))).toHaveLength(60)
    expect(manifest.shots.every((shot) => shot.video === null && shot.trace === null)).toBe(true)

    const pngs = manifest.shots.map((shot) =>
      fs.readFileSync(fileInsideRun(syntheticDir, shot.file)),
    )
    for (const png of pngs) expectValidPng(png)
    expect(new Set(pngs.map((png) => png.toString('base64')))).toHaveLength(60)

    for (const [index, shot] of manifest.shots.entries()) {
      const source = unfilteredRun.manifest.shots[index % 5]!
      expect({
        spec: shot.spec,
        viewport: shot.viewport,
        deviceScaleFactor: shot.deviceScaleFactor,
        fullPage: shot.fullPage,
        durationMs: shot.durationMs,
      }).toEqual({
        spec: source.spec,
        viewport: source.viewport,
        deviceScaleFactor: source.deviceScaleFactor,
        fullPage: source.fullPage,
        durationMs: source.durationMs,
      })
      expect(shot.capturedAt).toBe(
        new Date(Date.parse('2020-01-02T03:04:05.000Z') + index * 1_000).toISOString(),
      )
    }

    running = await startGallery(syntheticRunId)
    const html = fs.readFileSync(path.join(syntheticDir, 'gallery.html'), 'utf8')
    const dataUris = Array.from(
      html.matchAll(/href="(data:image\/png;base64,[^"]+)"/g),
      (match) => match[1]!,
    )
    expect(occurrences(html, '<article class="card')).toBe(60)
    expect(dataUris).toHaveLength(60)
    expect(new Set(dataUris)).toHaveLength(60)
    process.stdout.write(
      `shotwright smoke: synthetic 60-shot gallery = ${Buffer.byteLength(html)} bytes\n`,
    )
    await stopGallery(running)
    running = null
  } finally {
    if (running !== null && running.child.exitCode === null) await stopGallery(running)
    fs.rmSync(syntheticDir, { recursive: true, force: true })
  }
}

function expectPackInventory(): void {
  const packed = packShotwrightPackage('shotwright-pack-check-')
  try {
    expect(packed.files.filter((file) => /^dist\/gallery\/[^/]+\.js$/.test(file)).sort()).toEqual([
      'dist/gallery/assets.js',
      'dist/gallery/compare-model.js',
      'dist/gallery/generate-compare.js',
      'dist/gallery/generate.js',
      'dist/gallery/model.js',
      'dist/gallery/render-compare.js',
      'dist/gallery/render.js',
      'dist/gallery/resolve.js',
      'dist/gallery/server.js',
    ])
    expect(packed.files).toEqual(expect.arrayContaining([
      'templates/init/shots.config.ts',
      'templates/init/shots/example.shots.ts',
      'templates/init/gitignore.snippet',
      'templates/github/shotwright.yml',
      'templates/skills/shots-harness/SKILL.md',
    ]))
    expect(packed.files.some((file) => file.startsWith('docs/'))).toBe(false)
    expect(packed.files.some((file) => file.includes('mockup'))).toBe(false)
    expect(packed.files.some((file) => file.startsWith('test/'))).toBe(false)
    expect(packed.files).not.toContain('test/fixtures/generate-gallery-corpus.mjs')
  } finally {
    fs.rmSync(packed.packDir, { recursive: true, force: true })
  }
}

function packShotwrightPackage(prefix: string): PackedPackage {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  })
  const parsed = JSON.parse(output) as
    | { filename?: string; files: Array<{ path: string }> }
    | Array<{ filename?: string; files: Array<{ path: string }> }>
  const entry = Array.isArray(parsed) ? parsed[0]! : parsed
  const tarball = entry.filename
    ? path.resolve(root, entry.filename)
    : path.join(packDir, fs.readdirSync(packDir).find((file) => file.endsWith('.tgz'))!)
  return { packDir, tarball, files: entry.files.map((file) => file.path) }
}

function createConsumerApp(prefix: string, packageJson: Record<string, unknown>): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    JSON.stringify({ name: 'shotwright-consumer', private: true, type: 'module', ...packageJson }, null, 2) + '\n',
  )
  fs.writeFileSync(
    path.join(cwd, 'index.html'),
    '<!doctype html><html><head><title>Shotwright Consumer</title></head><body><main><h1>Shotwright Consumer</h1></main><script type="module" src="/src/main.js"></script></body></html>\n',
  )
  fs.mkdirSync(path.join(cwd, 'src'))
  fs.writeFileSync(
    path.join(cwd, 'src', 'main.js'),
    "document.querySelector('main')?.append(' ready')\n",
  )
  return cwd
}

function runPnpm(cwd: string, args: string[], timeout = 180_000): string {
  fs.mkdirSync(consumerPnpmStore, { recursive: true })
  try {
    return execFileSync('pnpm', args, {
      cwd,
      encoding: 'utf8',
      env: consumerEnv(),
      stdio: 'pipe',
      timeout,
    })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const childError = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer }
    const stdout = childError.stdout?.toString().trimEnd()
    const stderr = childError.stderr?.toString().trimEnd()
    throw new Error(
      [
        error.message.trimEnd(),
        stdout ? `stdout:\n${stdout}` : '',
        stderr ? `stderr:\n${stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      { cause: error },
    )
  }
}

function runPnpmStatus(cwd: string, args: string[], timeout = 120_000): ReturnType<typeof spawnSync> {
  fs.mkdirSync(consumerPnpmStore, { recursive: true })
  return spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    env: consumerEnv(),
    timeout,
  })
}

async function startConsumerGallery(cwd: string): Promise<RunningGallery> {
  const child = spawn('pnpm', ['shots:gallery'], {
    cwd,
    env: consumerEnv(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!child.stdout || !child.stderr) throw new Error('consumer gallery child pipes unavailable')
  let stdout = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`consumer gallery did not print a Local URL\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 60_000)
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timeout)
      reject(
        new Error(
          `consumer gallery exited before startup (code ${String(code)}, signal ${String(signal)})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      )
    }
    child.once('exit', onExit)
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      stdout += chunk
      const match = /^Local: (http:\/\/127\.0\.0\.1:\d+\/)$/m.exec(stdout)
      if (!match) return
      clearTimeout(timeout)
      child.removeListener('exit', onExit)
      resolve(match[1]!)
    })
  }).catch((error) => {
    if (child.exitCode === null) child.kill('SIGTERM')
    throw error
  })
  return { child, url, stdout: () => stdout, stderr: () => stderr }
}

function consumerEnv(): NodeJS.ProcessEnv {
  fs.mkdirSync(consumerPnpmStore, { recursive: true })
  return {
    ...process.env,
    CI: '1',
    npm_config_store_dir: consumerPnpmStore,
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
  }
}

function runGeneratedShotsInstall(cwd: string): boolean {
  try {
    runPnpm(cwd, ['shots:install'], 30_000)
    return true
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ETIMEDOUT')) throw error
    expect(error.message).toContain('playwright install chromium')
    // Build numbers move with the Playwright peer (>=1.60 <2), so match the prefix —
    // pinning an exact `chromium-<build>` would turn a routine dependency bump into a
    // misleading failure of the acceptance smoke.
    const cached = fs.readdirSync(playwrightBrowsersPath)
    expect(cached.some((entry) => entry.startsWith('chromium-'))).toBe(true)
    expect(cached.some((entry) => entry.startsWith('chromium_headless_shell-'))).toBe(true)
    process.stdout.write(
      'shotwright smoke: consumer shots:install timed out after invoking playwright install chromium; continuing with existing browser cache\n',
    )
    return false
  }
}

async function stopConsumerGallery(running: RunningGallery): Promise<void> {
  const exit =
    running.child.exitCode === null
      ? new Promise<void>((resolve) => {
          running.child.once('exit', () => resolve())
        })
      : Promise.resolve()
  if (running.child.exitCode === null && running.child.pid !== undefined) {
    process.kill(-running.child.pid, 'SIGTERM')
  }
  await Promise.race([
    exit,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        if (running.child.exitCode === null && running.child.pid !== undefined) {
          process.kill(-running.child.pid, 'SIGKILL')
        }
        resolve()
      }, 15_000)
    }),
  ])
}

function expectNoDuplicateGeneratedState(cwd: string): void {
  const gitignore = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')
  expect(occurrences(gitignore, '# shotwright review artifacts')).toBe(1)
  expect(occurrences(gitignore, 'shots-output/')).toBe(1)
  expect(occurrences(gitignore, 'playwright-report/')).toBe(1)
  expect(occurrences(gitignore, 'test-results/')).toBe(1)

  const packageRaw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
  const pkg = JSON.parse(packageRaw) as { scripts: Record<string, string> }
  expect(pkg.scripts.shots).toBe('shotwright run')
  expect(pkg.scripts['shots:gallery']).toBe('shotwright gallery')
  expect(pkg.scripts['shots:install']).toBe('playwright install chromium')
  expect(Array.from(packageRaw.matchAll(/"shots"\s*:/g))).toHaveLength(1)
  expect(Array.from(packageRaw.matchAll(/"shots:gallery"\s*:/g))).toHaveLength(1)
  expect(Array.from(packageRaw.matchAll(/"shots:install"\s*:/g))).toHaveLength(1)
}

beforeAll(() => {
  fs.rmSync(failureSpec, { force: true })
  fs.rmSync(outputDir, { recursive: true, force: true })
  unfilteredRun = runCli(['--', '--workers=2'], {
    only: [],
    video: false,
    trace: false,
  })
  onlyRun = runCli(['--only', 'theme-dark'], {
    only: ['theme-dark'],
    video: false,
    trace: false,
  })
  videoRun = runCli(['--only', 'form-filled,about-desktop', '--video'], {
    only: ['form-filled', 'about-desktop'],
    video: true,
    trace: false,
  })
  traceRun = runCli(['--only', 'theme-dark,mobile-layout', '--trace'], {
    only: ['theme-dark', 'mobile-layout'],
    video: false,
    trace: true,
  })

  expect(runDirectories()).toHaveLength(4)
  expect(runIds).toHaveLength(4)
}, 240_000)

describe('shotwright run against the demo app', () => {
  it('keeps the published run contract intact when automatic gallery generation fails', () => {
    expectInjectedGalleryFailurePreservesRunContract()
  })

  it(
    'keeps latest on the previous completed run and serves its one-shot partial gallery',
    async () => {
      await expectFailedRunPreservesLatest()
    },
    60_000,
  )

  it('captures all five shots in a sorted manifest using two workers', () => {
    expect(unfilteredRun.stdout).toMatch(/Running 2 tests using 2 workers/)
    expect(unfilteredRun.manifest.shots.map((shot) => [shot.spec, shot.name])).toEqual([
      ['about.shots.ts', 'about-desktop'],
      ['about.shots.ts', 'mobile-layout'],
      ['home.shots.ts', 'form-filled'],
      ['home.shots.ts', 'modal-open'],
      ['home.shots.ts', 'theme-dark'],
    ])
    expectNoArtifacts(unfilteredRun)
  })

  it('publishes an atomic five-shot gallery with byte-exact originals and real metadata', () => {
    expectFiveShotGallery()
  })

  it('writes a review-only compare gallery from two existing runs and exits zero', () => {
    expectCompareGallery()
  })

  it(
    'regenerates the latest gallery byte-identically and serves only allowlisted files',
    async () => {
      await expectLatestGalleryServer()
    },
    60_000,
  )

  it('does not claim to be serving when the selected port is occupied', async () => {
    await expectOccupiedPortDoesNotClaimServing()
  })

  it('filters to a standalone late-walkthrough shot', () => {
    expect(onlyRun.manifest.shots.map((shot) => shot.name)).toEqual(['theme-dark'])
    expectNoArtifacts(onlyRun)
  })

  it('records distinct videos across both specs with traces disabled', () => {
    expect(videoRun.manifest.shots.map((shot) => [shot.spec, shot.name])).toEqual([
      ['about.shots.ts', 'about-desktop'],
      ['home.shots.ts', 'form-filled'],
    ])
    expectDistinctArtifacts(videoRun, 'video')
    for (const shot of videoRun.manifest.shots) {
      expect(shot.trace).toBeNull()
    }
  })

  it(
    'serves an exact byte range from a real captured WebM',
    async () => {
      await expectVideoRange()
    },
    60_000,
  )

  it('records distinct traces across both specs with videos disabled', () => {
    expect(traceRun.manifest.shots.map((shot) => [shot.spec, shot.name])).toEqual([
      ['about.shots.ts', 'mobile-layout'],
      ['home.shots.ts', 'theme-dark'],
    ])
    expectDistinctArtifacts(traceRun, 'trace')
    for (const shot of traceRun.manifest.shots) {
      expect(shot.video).toBeNull()
    }
  })

  it('records full-page, locator, viewport, and DSF metadata', () => {
    const formFilled = unfilteredRun.manifest.shots.find((shot) => shot.name === 'form-filled')!
    expect(formFilled.viewport).toEqual({ width: 1440, height: 960 })
    expect(formFilled.deviceScaleFactor).toBe(2)
    expect(formFilled.fullPage).toBe(true)

    const modalOpen = unfilteredRun.manifest.shots.find((shot) => shot.name === 'modal-open')!
    expect(modalOpen.fullPage).toBe(false)

    const aboutDesktop = unfilteredRun.manifest.shots.find(
      (shot) => shot.name === 'about-desktop',
    )!
    expect(aboutDesktop.viewport).toEqual({ width: 1440, height: 960 })

    const mobileLayout = unfilteredRun.manifest.shots.find(
      (shot) => shot.name === 'mobile-layout',
    )!
    expect(mobileLayout.viewport).toEqual({ width: 390, height: 844 })
  })

  it(
    'generates a gallery for a deterministic byte-unique 60-shot corpus',
    async () => {
      await expectSyntheticGallery()
    },
    60_000,
  )

  it('packs gallery runtime modules without docs, mockups, or test fixtures', () => {
    expectPackInventory()
  })

  it(
    'packs, installs, initializes, captures, galleries, and re-runs idempotently in a fresh vite app',
    async () => {
      const packed = packShotwrightPackage('shotwright-consumer-pack-')
      const cwd = createConsumerApp('shotwright-consumer-vite-', {
        scripts: { dev: 'vite' },
      })
      let running: RunningGallery | null = null
      try {
        runPnpm(cwd, ['add', '-D', packed.tarball, '@playwright/test@~1.62.0', 'vite@~8.1.5'])
        const initOutput = runPnpm(cwd, ['exec', 'shotwright', 'init'])
        expect(initOutput).toContain('shotwright init: detected vite')
        expect(initOutput).toContain('shots.config.ts')
        expect(initOutput).toContain('shots/example.shots.ts')
        expect(initOutput).toContain('.gitignore (+3 entries)')
        expect(initOutput).toContain('pnpm shots:install')
        expect(initOutput).not.toContain('Edit shots.config.ts')

        runGeneratedShotsInstall(cwd)
        runPnpm(cwd, ['shots'], 240_000)
        const latest = fs.readlinkSync(path.join(cwd, 'shots-output', 'latest'))
        const runDir = path.join(cwd, 'shots-output', latest)
        const manifest = JSON.parse(
          fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'),
        ) as Manifest
        expect(manifest.shots.map((shot) => shot.name)).toEqual(['home'])
        expect(fs.existsSync(path.join(runDir, 'gallery.html'))).toBe(true)

        running = await startConsumerGallery(cwd)
        expect(running.stdout()).toContain(`shotwright gallery: serving ${latest}`)
        const response = await fetch(running.url)
        expect(response.status).toBe(200)
        expect(await response.text()).toContain('home')
        await stopConsumerGallery(running)
        running = null

        const configPath = path.join(cwd, 'shots.config.ts')
        const customizedConfig = fs
          .readFileSync(configPath, 'utf8')
          .replace('http://127.0.0.1:5173', 'http://127.0.0.1:4173')
        fs.writeFileSync(configPath, customizedConfig)
        const rerunOutput = runPnpm(cwd, ['exec', 'shotwright', 'init'])
        expect(rerunOutput).toContain('shotwright init: already set up — nothing to change')
        expect(rerunOutput).toContain('Left alone (yours)')
        expect(fs.readFileSync(configPath, 'utf8')).toBe(customizedConfig)
        expectNoDuplicateGeneratedState(cwd)
      } finally {
        if (running !== null && running.child.exitCode === null) await stopConsumerGallery(running)
        fs.rmSync(cwd, { recursive: true, force: true })
        fs.rmSync(packed.packDir, { recursive: true, force: true })
      }
    },
    420_000,
  )

  it('fails init without overwriting an existing shots script', () => {
    const packed = packShotwrightPackage('shotwright-collision-pack-')
    const cwd = createConsumerApp('shotwright-consumer-collision-', {})
    try {
      runPnpm(cwd, ['add', '-D', packed.tarball, '@playwright/test@~1.62.0'])
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >
      pkg.scripts = { shots: 'playwright test' }
      fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(pkg))
      const before = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
      const result = runPnpmStatus(cwd, ['exec', 'shotwright', 'init'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('cannot claim the `shots` script')
      expect(result.stdout).toContain('"shots": "playwright test"')
      expect(result.stdout).not.toContain('package.json had no indented property lines')
      expect(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).toBe(before)
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
      fs.rmSync(packed.packDir, { recursive: true, force: true })
    }
  })

  it('prints edit-first next steps for a non-vite init scaffold', () => {
    const packed = packShotwrightPackage('shotwright-non-vite-pack-')
    const cwd = createConsumerApp('shotwright-consumer-non-vite-', {})
    try {
      runPnpm(cwd, ['add', '-D', packed.tarball, '@playwright/test@~1.62.0'])
      const output = runPnpm(cwd, ['exec', 'shotwright', 'init'])
      expect(output).toContain('shotwright init: wrote scaffold with a commented webServer placeholder')
      expect(output).toContain('  1. Edit shots.config.ts - uncomment and set webServer for your app')
      expect(output.indexOf('Edit shots.config.ts')).toBeLessThan(output.indexOf('pnpm shots'))
      expect(output).toContain('  4. pnpm shots:gallery')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
      fs.rmSync(packed.packDir, { recursive: true, force: true })
    }
  })

  it('reports a symlinked skill destination and writes the skill into the target', () => {
    const packed = packShotwrightPackage('shotwright-symlink-pack-')
    const cwd = createConsumerApp('shotwright-consumer-symlink-', {})
    try {
      runPnpm(cwd, ['add', '-D', packed.tarball, '@playwright/test@~1.62.0'])
      fs.mkdirSync(path.join(cwd, '.agents', 'skills'), { recursive: true })
      fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true })
      fs.symlinkSync('../.agents/skills', path.join(cwd, '.claude', 'skills'))

      const output = runPnpm(cwd, ['exec', 'shotwright', 'init'])
      expect(output.indexOf('Note: .claude/skills is a symlink to .agents/skills')).toBeLessThan(
        output.indexOf('shotwright init: wrote scaffold'),
      )
      expect(output).toContain('the skill will be written to .agents/skills/shots-harness/SKILL.md')
      expect(fs.existsSync(path.join(cwd, '.agents', 'skills', 'shots-harness', 'SKILL.md'))).toBe(
        true,
      )
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
      fs.rmSync(packed.packDir, { recursive: true, force: true })
    }
  })
})

describe('shotwright help', () => {
  // shotwright-746.18.12: `pnpm exec shotwright --help` is the release runbook's
  // post-publish smoke test, so it must exit 0 and print usage on stdout.
  it.each([['--help'], ['-h'], ['help']])('%s exits 0 with usage on stdout', (flag) => {
    const result = spawnSync(process.execPath, ['dist/cli.js', flag], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: shotwright run')
    expect(result.stderr).toBe('')
  })

  it('an unknown command still exits 1 with usage on stderr', () => {
    const result = spawnSync(process.execPath, ['dist/cli.js', 'nope'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unknown command "nope"')
    expect(result.stderr).toContain('Usage: shotwright run')
  })
})
