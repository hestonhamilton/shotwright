import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Manifest } from '../../src/manifest.js'
import { makeManifest } from '../fixtures/manifest.js'
import {
  createRunDir,
  generateRunId,
  isCompleteRun,
  listRuns,
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
  return makeManifest({
    runId,
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:00:01.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    shots: [],
  })
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
    expect(parsed.manifestVersion).toBe(2)
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

describe('listRuns', () => {
  it('lists manifestless and malformed directories as incomplete with unknown count and time', () => {
    const output = tmpDir()
    fs.mkdirSync(path.join(output, 'run-empty'))
    fs.mkdirSync(path.join(output, 'run-malformed'))
    fs.writeFileSync(path.join(output, 'run-malformed', 'manifest.json'), '{broken')
    fs.mkdirSync(path.join(output, 'compare'))
    fs.mkdirSync(path.join(output, '.hidden'))
    fs.symlinkSync('run-empty', path.join(output, 'latest'))
    const rows = listRuns(output)
    expect(rows.map((row) => row.runId).sort()).toEqual(['run-empty', 'run-malformed'])
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'incomplete', shotCount: null, startedAt: null })
    }
  })

  it('reads v2 status/count, adapts v1 to unknown, and sorts newest first', () => {
    const output = tmpDir()
    const oldDir = path.join(output, 'old')
    const newDir = path.join(output, 'new')
    fs.mkdirSync(oldDir)
    fs.mkdirSync(newDir)
    const legacy = { ...fakeManifest('old'), manifestVersion: 1 }
    delete (legacy as Partial<typeof legacy>).status
    delete (legacy as Partial<typeof legacy>).publication
    delete (legacy as Partial<typeof legacy>).tests
    delete (legacy as Partial<typeof legacy>).artifacts
    delete (legacy as Partial<typeof legacy>).failures
    fs.writeFileSync(path.join(oldDir, 'manifest.json'), JSON.stringify(legacy))
    fs.writeFileSync(
      path.join(newDir, 'manifest.json'),
      JSON.stringify({ ...fakeManifest('new'), status: 'failed' }),
    )
    fs.utimesSync(oldDir, new Date(1_000), new Date(1_000))
    fs.utimesSync(newDir, new Date(2_000), new Date(2_000))
    expect(
      listRuns(output).map(({ runId, status, shotCount }) => ({ runId, status, shotCount })),
    ).toEqual([
      { runId: 'new', status: 'failed', shotCount: 0 },
      { runId: 'old', status: 'unknown', shotCount: 0 },
    ])
  })
})
