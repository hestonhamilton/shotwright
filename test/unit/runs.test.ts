import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MANIFEST_VERSION, type Manifest } from '../../src/manifest.js'
import {
  createRunDir,
  generateRunId,
  isCompleteRun,
  publishManifest,
  updateLatestSymlink,
  SIDECAR_DIR,
} from '../../src/runs.js'

const tmpDirs: string[] = []
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-test-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function fakeManifest(runId: string): Manifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:00:01.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    shots: [],
  }
}

describe('generateRunId', () => {
  it('formats as <UTC timestamp>_<4 hex>', () => {
    const id = generateRunId(new Date('2026-07-29T14:02:11.500Z'))
    expect(id).toMatch(/^2026-07-29T14-02-11_[0-9a-f]{4}$/)
  })
})

describe('createRunDir', () => {
  it('creates the run dir and its sidecar staging dir', () => {
    const out = tmpDir()
    const { runId, runDir } = createRunDir(out)
    expect(runDir).toBe(path.join(out, runId))
    expect(fs.statSync(runDir).isDirectory()).toBe(true)
    expect(fs.statSync(path.join(runDir, SIDECAR_DIR)).isDirectory()).toBe(true)
  })

  it('regenerates the id on collision with an existing dir', () => {
    const out = tmpDir()
    const ids = ['collide_aaaa', 'collide_aaaa', 'collide_bbbb']
    fs.mkdirSync(path.join(out, 'collide_aaaa'), { recursive: true })
    const { runId } = createRunDir(out, () => ids.shift()!)
    expect(runId).toBe('collide_bbbb')
  })
})

describe('publishManifest', () => {
  it('publishes atomically: manifest lands, no temp file remains', () => {
    const out = tmpDir()
    const { runDir, runId } = createRunDir(out)
    publishManifest(runDir, fakeManifest(runId))
    const parsed = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'))
    expect(parsed.manifestVersion).toBe(1)
    expect(fs.existsSync(path.join(runDir, '.manifest.tmp'))).toBe(false)
    expect(isCompleteRun(runDir)).toBe(true)
  })

  it('a run dir without manifest.json is incomplete', () => {
    const out = tmpDir()
    const { runDir } = createRunDir(out)
    expect(isCompleteRun(runDir)).toBe(false)
  })
})

describe('updateLatestSymlink', () => {
  it('flips latest between runs', () => {
    const out = tmpDir()
    const a = createRunDir(out)
    const b = createRunDir(out)
    updateLatestSymlink(out, a.runId)
    expect(fs.readlinkSync(path.join(out, 'latest'))).toBe(a.runId)
    updateLatestSymlink(out, b.runId)
    expect(fs.readlinkSync(path.join(out, 'latest'))).toBe(b.runId)
    expect(fs.realpathSync(path.join(out, 'latest'))).toBe(fs.realpathSync(b.runDir))
  })
})
