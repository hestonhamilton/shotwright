import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  assembleManifest,
  shotKey,
  type AssembleInput,
  type ShotSidecar,
} from '../../src/manifest.js'

function sidecar(overrides: Partial<ShotSidecar>): ShotSidecar {
  const spec = overrides.spec ?? 'a.shots.ts'
  const name = overrides.name ?? 'shot'
  return {
    name: 'shot',
    spec: 'a.shots.ts',
    file: overrides.file ?? `shots/${spec.slice(0, -'.shots.ts'.length)}/${name}.png`,
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    fullPage: true,
    capturedAt: '2026-07-29T00:00:00.000Z',
    durationMs: 100,
    kind: 'shot',
    checked: false,
    retry: 0,
    testId: 't1',
    ...overrides,
  }
}

function input(
  sidecars: ShotSidecar[],
  artifacts: AssembleInput['artifacts'] = new Map(),
): AssembleInput {
  return {
    runId: 'run',
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:01:00.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    sidecars,
    artifacts,
    runDir: '/tmp/shotwright-unit',
    status: 'passed',
    publication: { gallery: { ok: true }, evidence: { ok: true } },
    failures: [],
    tests: [...new Set(sidecars.map((s) => s.testId))].map((id) => ({
      id,
      title: id,
      spec: 'a.shots.ts',
      project: 'shots',
      status: 'passed' as const,
      retry: 0,
      durationMs: 1,
    })),
  }
}

describe('assembleManifest', () => {
  it('length-prefixed composite shot keys cannot alias across delimiter boundaries', () => {
    expect(shotKey('a:b', 'c')).not.toBe(shotKey('a', 'b:c'))
  })
  it('an empty run assembles to shots: []', () => {
    expect(assembleManifest(input([])).shots).toEqual([])
  })

  it('sorts by (spec, capturedAt), not capture order', () => {
    const shots = assembleManifest(
      input([
        sidecar({ name: 'z', spec: 'b.shots.ts', capturedAt: '2026-07-29T00:00:01.000Z' }),
        sidecar({ name: 'late', spec: 'a.shots.ts', capturedAt: '2026-07-29T00:00:05.000Z' }),
        sidecar({ name: 'early', spec: 'a.shots.ts', capturedAt: '2026-07-29T00:00:02.000Z' }),
      ]),
    ).shots
    expect(shots.map((s) => s.name)).toEqual(['early', 'late', 'z'])
  })

  it('same name across specs has distinct composite identity', () => {
    const shots = assembleManifest(
      input([
        sidecar({ name: 'shared', spec: 'a.shots.ts' }),
        sidecar({ name: 'shared', spec: 'b.shots.ts', testId: 't2' }),
      ]),
    ).shots
    expect(shots.map((s) => s.spec)).toEqual(['a.shots.ts', 'b.shots.ts'])
  })

  it('final retry removes stale capture and retry recapture wins', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-retry-'))
    try {
      const old = sidecar({ name: 'old', retry: 0, file: 'shots/a/old.png' })
      const newer = sidecar({ name: 'new', retry: 1, file: 'shots/a/new.png' })
      for (const s of [old, newer]) {
        fs.mkdirSync(path.dirname(path.join(dir, s.file)), { recursive: true })
        fs.writeFileSync(path.join(dir, s.file), s.name)
      }
      const value = input([old, newer])
      value.runDir = dir
      value.tests[0]!.retry = 1
      const result = assembleManifest(value)
      expect(result.shots.map((s) => s.name)).toEqual(['new'])
      expect(fs.existsSync(path.join(dir, old.file))).toBe(false)
      expect(fs.readFileSync(path.join(dir, newer.file), 'utf8')).toBe('new')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('retry-1 recapture owns the same path and final sidecar metadata', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-recapture-'))
    try {
      const old = sidecar({
        name: 'same',
        retry: 0,
        file: 'shots/a/same.png',
        capturedAt: '2026-07-29T00:00:00.000Z',
      })
      const newer = sidecar({
        name: 'same',
        retry: 1,
        file: 'shots/a/same.png',
        capturedAt: '2026-07-29T00:00:01.000Z',
        checked: true,
      })
      fs.mkdirSync(path.dirname(path.join(dir, newer.file)), { recursive: true })
      fs.writeFileSync(path.join(dir, newer.file), 'retry-one')
      const value = input([old, newer])
      value.runDir = dir
      value.tests[0]!.retry = 1
      const result = assembleManifest(value)
      expect(result.shots).toHaveLength(1)
      expect(result.shots[0]).toMatchObject({
        retry: 1,
        checked: true,
        capturedAt: newer.capturedAt,
      })
      expect(fs.readFileSync(path.join(dir, newer.file), 'utf8')).toBe('retry-one')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('late duplicate omits ambiguous captures and fails the run', () => {
    const result = assembleManifest(
      input([
        sidecar({ name: 'dup', spec: 'a.shots.ts' }),
        sidecar({ name: 'dup', spec: 'a.shots.ts' }),
        sidecar({ name: 'kept', spec: 'a.shots.ts' }),
      ]),
    )
    expect(result.shots.map((shot) => shot.name)).toEqual(['kept'])
    expect(result.status).toBe('failed')
    expect(result.runError).toEqual({
      code: 'DUPLICATE_SHOT',
      message: 'Duplicate shot identity found during manifest assembly',
    })
  })

  it.each([
    ['wrong file', sidecar({ file: 'data/a/wrong.txt' }), /file must equal shots\/a\/shot.png/],
    [
      'missing field',
      (() => {
        const value = sidecar({})
        delete (value as Partial<ShotSidecar>).checked
        return value
      })(),
      /invalid checked/,
    ],
    ['traversal spec', sidecar({ spec: '../a.shots.ts' }), /invalid canonical spec/],
  ])('rejects a sidecar with %s before trusting its path', (_label, invalid, message) => {
    expect(() => assembleManifest(input([invalid]))).toThrow(message)
  })

  it('rejects a sidecar linked to an unknown testId', () => {
    const value = input([sidecar({ testId: 'missing' })])
    value.tests = []
    expect(() => assembleManifest(value)).toThrow(/unknown testId/)
  })

  it('video/trace keys are always present: null without artifacts, paths with', () => {
    const artifacts = new Map([['t1', { video: 'video/t1.webm', trace: null }]])
    const shots = assembleManifest(
      input(
        [
          sidecar({ name: 'with', testId: 't1' }),
          sidecar({ name: 'without-media', spec: 'b.shots.ts', testId: 'other-test' }),
        ],
        artifacts,
      ),
    ).shots
    const withArtifacts = shots.find((s) => s.name === 'with')!
    const withoutMedia = shots.find((s) => s.name === 'without-media')!
    expect(withArtifacts.video).toBe('video/t1.webm')
    expect(withArtifacts.trace).toBeNull()
    expect(withoutMedia.video).toBeNull()
    expect(withoutMedia.trace).toBeNull()
  })

  it('shots from the same test share its video path', () => {
    const artifacts = new Map([['t1', { video: 'video/t1.webm', trace: null }]])
    const shots = assembleManifest(
      input(
        [
          sidecar({ name: 'first', testId: 't1', capturedAt: '2026-07-29T00:00:01.000Z' }),
          sidecar({ name: 'second', testId: 't1', capturedAt: '2026-07-29T00:00:02.000Z' }),
        ],
        artifacts,
      ),
    ).shots
    expect(shots.map((s) => s.video)).toEqual(['video/t1.webm', 'video/t1.webm'])
  })
})
