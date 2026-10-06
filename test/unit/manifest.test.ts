import { describe, expect, it } from 'vitest'

import {
  assembleManifest,
  type AssembleInput,
  type ShotSidecar,
} from '../../src/manifest.js'

function sidecar(overrides: Partial<ShotSidecar>): ShotSidecar {
  return {
    name: 'shot',
    spec: 'a.shots.ts',
    file: 'shots/a.shots.ts/shot.png',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    fullPage: true,
    capturedAt: '2026-07-29T00:00:00.000Z',
    durationMs: 100,
    testId: 't1',
    ...overrides,
  }
}

function input(sidecars: ShotSidecar[], artifacts: AssembleInput['artifacts'] = new Map()): AssembleInput {
  return {
    runId: 'run',
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:01:00.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    sidecars,
    artifacts,
  }
}

describe('assembleManifest', () => {
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

  it('duplicate shot names are a run-level error', () => {
    expect(() =>
      assembleManifest(
        input([sidecar({ name: 'dup', spec: 'a.shots.ts' }), sidecar({ name: 'dup', spec: 'b.shots.ts' })]),
      ),
    ).toThrow(/duplicate shot name "dup"/)
  })

  it('video/trace keys are always present: null without artifacts, paths with', () => {
    const artifacts = new Map([['t1', { video: 'video/t1.webm', trace: null }]])
    const shots = assembleManifest(
      input(
        [
          sidecar({ name: 'with', testId: 't1' }),
          sidecar({ name: 'orphan', spec: 'b.shots.ts', testId: 'crashed-worker-test' }),
        ],
        artifacts,
      ),
    ).shots
    const withArtifacts = shots.find((s) => s.name === 'with')!
    const orphan = shots.find((s) => s.name === 'orphan')!
    expect(withArtifacts.video).toBe('video/t1.webm')
    expect(withArtifacts.trace).toBeNull()
    // Orphan sidecars (crashed worker → no artifact record) still assemble.
    expect(orphan.video).toBeNull()
    expect(orphan.trace).toBeNull()
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
