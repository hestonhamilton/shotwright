import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { FullConfig, FullResult } from '@playwright/test/reporter'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeSidecar } from '../../src/manifest.js'
import ShotwrightReporter from '../../src/reporter.js'
import { createRunDir, updateLatestSymlink } from '../../src/runs.js'
import { listRuns } from '../../src/runs.js'
import { makePng } from '../fixtures/png.js'

const tmpDirs: string[] = []

function tmpDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-reporter-gallery-'))
  tmpDirs.push(directory)
  return directory
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete process.env.SHOTWRIGHT_RUN_DIR
  for (const directory of tmpDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function prepareRun(outputDir: string): { runDir: string; runId: string } {
  const run = createRunDir(outputDir)
  const file = 'shots/home/example.png'
  fs.mkdirSync(path.join(run.runDir, 'shots/home'), { recursive: true })
  fs.writeFileSync(path.join(run.runDir, file), makePng(100, 80))
  writeSidecar(run.runDir, {
    kind: 'shot',
    checked: false,
    retry: 0,
    name: 'example',
    spec: 'home.shots.ts',
    file,
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    fullPage: true,
    capturedAt: '2026-07-29T00:00:00.000Z',
    durationMs: 50,
    testId: 'test-id',
  })
  return run
}

async function endRun(runDir: string, status: FullResult['status']): Promise<void> {
  vi.stubEnv('SHOTWRIGHT_RUN_DIR', runDir)
  const reporter = new ShotwrightReporter()
  reporter.onBegin({ version: '1.62.0' } as FullConfig)
  reporter.onTestEnd(
    {
      id: 'test-id',
      title: 'example',
      location: { file: 'shots/home.shots.ts' },
      parent: { project: () => ({ testDir: 'shots', name: 'shots' }) },
    } as never,
    { status: 'passed', retry: 0, duration: 1, attachments: [] } as never,
  )
  await reporter.onEnd({ status } as FullResult)
}

describe('reporter identity layout', () => {
  it('same title gets distinct digest paths and a forced short-prefix collision uses full digest', () => {
    const reporter = new ShotwrightReporter() as unknown as {
      stem: (
        spec: string,
        title: string,
        id: string,
        project: string,
        prefixes: Map<string, string>,
      ) => string
    }
    const prefixes = new Map<string, string>()
    const first = reporter.stem('sub/a.shots.ts', 'Équal title', 'one', 'project', prefixes)
    const second = reporter.stem('sub/a.shots.ts', 'Équal title', 'two', 'project', prefixes)
    expect(first).toMatch(/^sub\/a\/e-qual-title-[0-9a-f]{12}$/)
    expect(second).not.toBe(first)
    const digest = crypto
      .createHash('sha256')
      .update('three')
      .update('\0')
      .update('project')
      .digest('hex')
    prefixes.set(digest.slice(0, 12), 'other-digest')
    expect(reporter.stem('sub/a.shots.ts', 'Équal title', 'three', 'project', prefixes)).toBe(
      `sub/a/e-qual-title-${digest}`,
    )
  })
  it('copies distinct attachment bytes for colliding names and equal-title digest prefixes', async () => {
    const run = createRunDir(tmpDir())
    vi.stubEnv('SHOTWRIGHT_RUN_DIR', run.runDir)
    const reporter = new ShotwrightReporter()
    reporter.onBegin({ version: '1.62.0' } as FullConfig)
    const digests = {
      first: 'a'.repeat(12) + 'b'.repeat(52),
      second: 'a'.repeat(12) + 'c'.repeat(52),
    }
    ;(reporter as unknown as { digest: (id: string) => string }).digest = (id) =>
      digests[id as keyof typeof digests]
    const sources = ['first.txt', 'second.txt', 'third.txt'].map((name, index) => {
      const file = path.join(run.runDir, name)
      fs.writeFileSync(file, `source-${index}`)
      return file
    })
    const test = (id: string) =>
      ({
        id,
        title: 'Same title',
        location: { file: 'shots/home.shots.ts' },
        parent: { project: () => ({ testDir: 'shots', name: 'shots' }) },
      }) as never
    reporter.onTestEnd(test('first'), {
      status: 'failed',
      retry: 0,
      duration: 1,
      attachments: [
        { name: 'foo-2', contentType: 'text/plain', path: sources[0] },
        { name: 'foo', contentType: 'text/plain', path: sources[1] },
        { name: 'foo', contentType: 'text/plain', path: sources[2] },
        { name: 'report.json', contentType: 'application/json', body: Buffer.from('body-one') },
        { name: 'report.json', contentType: 'application/json', body: Buffer.from('body-two') },
      ],
    } as never)
    reporter.onTestEnd(test('second'), {
      status: 'failed',
      retry: 0,
      duration: 1,
      attachments: [{ name: 'other', contentType: 'text/plain', body: Buffer.from('second-test') }],
    } as never)
    await reporter.onEnd({ status: 'failed' } as FullResult)
    const manifest = JSON.parse(fs.readFileSync(path.join(run.runDir, 'manifest.json'), 'utf8'))
    const first = manifest.failures.find((entry: { testId: string }) => entry.testId === 'first')
    const second = manifest.failures.find((entry: { testId: string }) => entry.testId === 'second')
    expect(first.files.map((entry: { file: string }) => path.basename(entry.file))).toEqual([
      'foo-2.txt',
      'foo.txt',
      'foo-3.txt',
      'report.json',
      'report-2.json',
    ])
    expect(new Set(first.files.map((entry: { file: string }) => entry.file)).size).toBe(5)
    expect(
      first.files.map((entry: { file: string }) =>
        fs.readFileSync(path.join(run.runDir, entry.file), 'utf8'),
      ),
    ).toEqual(['source-0', 'source-1', 'source-2', 'body-one', 'body-two'])
    expect(first.files[0].file).toContain(`same-title-${digests.first.slice(0, 12)}/`)
    expect(second.files[0].file).toContain(`same-title-${digests.second}/`)
    expect(fs.readFileSync(path.join(run.runDir, second.files[0].file), 'utf8')).toBe('second-test')
  })
})

describe('ShotwrightReporter gallery publication', () => {
  it('publishes a Playwright-passed late duplicate as one structural failed run', async () => {
    const outputDir = tmpDir()
    const prior = createRunDir(outputDir)
    updateLatestSymlink(outputDir, prior.runId)
    const run = prepareRun(outputDir)
    writeSidecar(run.runDir, {
      kind: 'shot',
      checked: false,
      retry: 0,
      name: 'example',
      spec: 'home.shots.ts',
      file: 'shots/home/example.png',
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 2,
      fullPage: true,
      capturedAt: '2026-07-29T00:00:00.000Z',
      durationMs: 1,
      testId: 'test-id',
    })
    const safe = 'shots/home/safe.png'
    fs.writeFileSync(path.join(run.runDir, safe), makePng(40, 30))
    writeSidecar(run.runDir, {
      kind: 'shot',
      checked: false,
      retry: 0,
      name: 'safe',
      spec: 'home.shots.ts',
      file: safe,
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 2,
      fullPage: true,
      capturedAt: '2026-07-29T00:00:01.000Z',
      durationMs: 1,
      testId: 'test-id',
    })
    await expect(endRun(run.runDir, 'passed')).rejects.toThrow(/Duplicate shot identity/)
    const manifest = JSON.parse(fs.readFileSync(path.join(run.runDir, 'manifest.json'), 'utf8'))
    expect(manifest.status).toBe('failed')
    expect(manifest.runError).toEqual({
      code: 'DUPLICATE_SHOT',
      message: 'Duplicate shot identity found during manifest assembly',
    })
    expect(manifest.shots.map((entry: { name: string }) => entry.name)).toEqual(['safe'])
    expect(fs.existsSync(path.join(run.runDir, 'shots/home/example.png'))).toBe(false)
    const gallery = fs.readFileSync(path.join(run.runDir, 'gallery.html'), 'utf8')
    expect(gallery).toContain('Duplicate shot identity found during manifest assembly')
    expect(gallery).not.toContain(outputDir)
    expect(listRuns(outputDir).find((entry) => entry.runId === run.runId)).toMatchObject({
      status: 'failed',
      runError: { message: 'Duplicate shot identity found during manifest assembly' },
    })
    const config = path.resolve('test/fixtures/contract-consumer/shots.config.ts')
    const cli = path.resolve('dist/cli.js')
    const fixture = path.dirname(config)
    const env = { ...process.env, CONTRACT_OUTPUT_DIR: outputDir }
    const textRuns = spawnSync(process.execPath, [cli, 'runs', '--config', config], {
      cwd: fixture,
      env,
      encoding: 'utf8',
    })
    expect(textRuns.status, textRuns.stderr).toBe(0)
    expect(textRuns.stdout).toContain('Duplicate shot identity found during manifest assembly')
    expect(textRuns.stdout).not.toContain(outputDir)
    const jsonRuns = spawnSync(process.execPath, [cli, 'runs', '--config', config, '--json'], {
      cwd: fixture,
      env,
      encoding: 'utf8',
    })
    expect(jsonRuns.status, jsonRuns.stderr).toBe(0)
    const runError = JSON.parse(jsonRuns.stdout).find(
      (entry: { runId: string }) => entry.runId === run.runId,
    ).runError
    expect(runError).toEqual(manifest.runError)
    expect(JSON.stringify(runError)).not.toContain(outputDir)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(prior.runId)
  })
  it('publishes manifest and gallery atomically, then advances latest for a passed result', async () => {
    const outputDir = tmpDir()
    const run = prepareRun(outputDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await endRun(run.runDir, 'passed')

    expect(fs.existsSync(path.join(run.runDir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(run.runDir, 'gallery.html'))).toBe(true)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(run.runId)
    expect(fs.existsSync(path.join(run.runDir, '.sidecar'))).toBe(false)
    expect(fs.readdirSync(run.runDir).filter((name) => name.startsWith('.gallery.'))).toEqual([])
  })

  it('publishes manifest and gallery for a failed result without advancing latest', async () => {
    const outputDir = tmpDir()
    const previous = createRunDir(outputDir)
    updateLatestSymlink(outputDir, previous.runId)
    const failed = prepareRun(outputDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await endRun(failed.runDir, 'failed')

    expect(fs.existsSync(path.join(failed.runDir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(failed.runDir, 'gallery.html'))).toBe(true)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(previous.runId)
    expect(fs.existsSync(path.join(failed.runDir, '.sidecar'))).toBe(false)
  })

  it('gallery injection records failure and keeps latest at prior fully published run', async () => {
    const outputDir = tmpDir(),
      prior = createRunDir(outputDir),
      run = prepareRun(outputDir)
    updateLatestSymlink(outputDir, prior.runId)
    vi.stubEnv('SHOTWRIGHT_INJECT_GALLERY_FAILURE', '1')
    await expect(endRun(run.runDir, 'passed')).rejects.toThrow('gallery publication failed')
    const manifest = JSON.parse(fs.readFileSync(path.join(run.runDir, 'manifest.json'), 'utf8'))
    expect(manifest.publication.gallery).toMatchObject({
      ok: false,
      error: expect.stringContaining('injected'),
    })
    expect(fs.existsSync(path.join(run.runDir, 'gallery.html'))).toBe(false)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(prior.runId)
  })

  it('evidence copy failure records publication failure and does not flip latest', async () => {
    const outputDir = tmpDir(),
      prior = createRunDir(outputDir),
      run = prepareRun(outputDir)
    updateLatestSymlink(outputDir, prior.runId)
    vi.stubEnv('SHOTWRIGHT_RUN_DIR', run.runDir)
    const reporter = new ShotwrightReporter()
    reporter.onBegin({ version: '1.62.0' } as FullConfig)
    reporter.onTestEnd(
      {
        id: 'test-id',
        title: 'fails',
        location: { file: 'shots/home.shots.ts' },
        parent: { project: () => ({ testDir: 'shots', name: 'shots' }) },
      } as never,
      {
        status: 'failed',
        retry: 0,
        duration: 1,
        attachments: [
          { name: 'error-context', contentType: 'text/markdown', path: 'missing-context.md' },
        ],
      } as never,
    )
    await expect(reporter.onEnd({ status: 'failed' } as FullResult)).rejects.toThrow(
      'evidence publication failed',
    )
    const manifest = JSON.parse(fs.readFileSync(path.join(run.runDir, 'manifest.json'), 'utf8'))
    expect(manifest.publication.evidence).toMatchObject({
      ok: false,
      error: expect.stringContaining('error-context'),
    })
    expect(manifest.failures[0].files).toEqual([])
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(prior.runId)
  })

  it('leaves a malformed sidecar run incomplete and cleans staging', async () => {
    const outputDir = tmpDir(),
      run = prepareRun(outputDir)
    writeSidecar(run.runDir, {
      kind: 'shot',
      name: 'wrong',
      spec: 'home.shots.ts',
      file: 'data/home/wrong.txt',
      viewport: null,
      deviceScaleFactor: null,
      fullPage: true,
      capturedAt: '2026-07-29T00:00:00.000Z',
      durationMs: 0,
      testId: 'test-id',
      checked: false,
      retry: 0,
    })
    await expect(endRun(run.runDir, 'passed')).rejects.toThrow(/invalid sidecar.*file must equal/)
    expect(fs.existsSync(path.join(run.runDir, 'manifest.json'))).toBe(false)
    expect(fs.existsSync(path.join(run.runDir, '.sidecar'))).toBe(false)
    expect(fs.existsSync(path.join(outputDir, 'latest'))).toBe(false)
  })

  it('late onExit cleanup error logs without changing manifest gallery or latest', async () => {
    const outputDir = tmpDir(),
      run = prepareRun(outputDir)
    await endRun(run.runDir, 'passed')
    const before = fs.readFileSync(path.join(run.runDir, 'manifest.json'), 'utf8')
    const original = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((target, ...args) => {
      if (String(target).endsWith('/.pw')) throw new Error('injected cleanup')
      return original(target, ...args)
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await new ShotwrightReporter().onExit()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('injected cleanup'))
    expect(fs.readFileSync(path.join(run.runDir, 'manifest.json'), 'utf8')).toBe(before)
    expect(fs.existsSync(path.join(run.runDir, 'gallery.html'))).toBe(true)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(run.runId)
  })

  it('manifest rename failure leaves no manifest or gallery and does not flip latest', async () => {
    const outputDir = tmpDir(),
      prior = createRunDir(outputDir),
      run = prepareRun(outputDir)
    updateLatestSymlink(outputDir, prior.runId)
    const original = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to).endsWith('/manifest.json')) throw new Error('injected rename')
      return original(from, to)
    })
    await expect(endRun(run.runDir, 'passed')).rejects.toThrow('injected rename')
    expect(fs.existsSync(path.join(run.runDir, 'manifest.json'))).toBe(false)
    expect(fs.existsSync(path.join(run.runDir, 'gallery.html'))).toBe(false)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(prior.runId)
  })

  it('records gallery failure without advancing latest for a broken PNG', async () => {
    const outputDir = tmpDir()
    const run = prepareRun(outputDir)
    const relativePath = 'shots/home/example.png'
    fs.writeFileSync(path.join(run.runDir, relativePath), 'corrupt')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(endRun(run.runDir, 'passed')).rejects.toThrow('gallery publication failed')

    expect(fs.existsSync(path.join(run.runDir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(run.runDir, 'gallery.html'))).toBe(false)
    expect(fs.existsSync(path.join(outputDir, 'latest'))).toBe(false)
    expect(fs.existsSync(path.join(run.runDir, '.sidecar'))).toBe(false)
  })
})
