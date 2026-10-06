import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { FullConfig, FullResult } from '@playwright/test/reporter'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeSidecar } from '../../src/manifest.js'
import ShotwrightReporter from '../../src/reporter.js'
import { createRunDir, updateLatestSymlink } from '../../src/runs.js'
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
  const file = 'shots/home.shots.ts/example.png'
  fs.mkdirSync(path.join(run.runDir, 'shots/home.shots.ts'), { recursive: true })
  fs.writeFileSync(path.join(run.runDir, file), makePng(100, 80))
  writeSidecar(run.runDir, {
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
  await reporter.onEnd({ status } as FullResult)
}

describe('ShotwrightReporter gallery publication', () => {
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

  it('keeps a partial gallery, advances latest, cleans staging, and fails loudly for a broken PNG', async () => {
    const outputDir = tmpDir()
    const run = prepareRun(outputDir)
    const relativePath = 'shots/home.shots.ts/example.png'
    fs.writeFileSync(path.join(run.runDir, relativePath), 'corrupt')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(endRun(run.runDir, 'passed')).rejects.toThrow(
      `shotwright gallery: ${relativePath}: screenshot unavailable`,
    )

    expect(fs.existsSync(path.join(run.runDir, 'manifest.json'))).toBe(true)
    expect(fs.readFileSync(path.join(run.runDir, 'gallery.html'), 'utf8')).toContain(
      'Screenshot unavailable',
    )
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(run.runId)
    expect(fs.existsSync(path.join(run.runDir, '.sidecar'))).toBe(false)
  })
})
