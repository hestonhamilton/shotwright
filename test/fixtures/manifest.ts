import { MANIFEST_VERSION, type Manifest, type ShotEntry } from '../../src/manifest.js'

/** Valid v2 defaults for tests that vary only the fields under review. */
export function makeShot(overrides: Partial<ShotEntry> = {}): ShotEntry {
  return {
    name: 'shot', spec: 'home.shots.ts', file: 'shots/home/shot.png',
    viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2,
    fullPage: true, capturedAt: '2026-07-29T00:00:00.000Z', durationMs: 0,
    video: null, trace: null, testId: null, checked: false, retry: 0,
    ...overrides,
  }
}

export function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    manifestVersion: MANIFEST_VERSION, runId: 'run',
    startedAt: '2026-07-29T00:00:00.000Z', finishedAt: '2026-07-29T00:00:01.000Z',
    shotwrightVersion: '0.1.0', playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false }, status: 'passed',
    publication: { gallery: { ok: true }, evidence: { ok: true } },
    tests: [], shots: [], artifacts: [], failures: [],
    ...overrides,
  }
}
