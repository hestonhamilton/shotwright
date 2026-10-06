import { describe, expect, it } from 'vitest'

import {
  buildCompareModel,
  type CompareModel,
} from '../../src/gallery/compare-model.js'
import type {
  GalleryDiagnostic,
  GalleryModel,
  GalleryShot,
  PngModel,
} from '../../src/gallery/model.js'
import { MANIFEST_VERSION, type Manifest, type ShotEntry } from '../../src/manifest.js'

const readableImage: PngModel = {
  width: 100,
  height: 80,
  byteLength: 128,
  dataUri: 'data:image/png;base64,readable',
}

function entry(name: string, spec: string): ShotEntry {
  return {
    name,
    spec,
    file: `shots/${name}.png`,
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    fullPage: true,
    capturedAt: '2026-07-31T00:00:00.000Z',
    durationMs: 42,
    video: null,
    trace: null,
  }
}

function galleryShot(
  name: string,
  spec: string,
  readable = true,
  imageError: string | null = null,
): GalleryShot {
  return {
    entry: entry(name, spec),
    image: readable ? readableImage : null,
    imageError,
    video: null,
    trace: null,
  }
}

function gallery(
  runId: string,
  galleryShots: GalleryShot[],
  diagnostics: GalleryDiagnostic[] = [],
): GalleryModel {
  const manifest: Manifest = {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: '2026-07-31T00:00:00.000Z',
    finishedAt: '2026-07-31T00:00:01.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    shots: galleryShots.map((shot) => shot.entry),
  }
  const specs = [...new Set(galleryShots.map((shot) => shot.entry.spec))].map((spec) => ({
    name: spec,
    shots: galleryShots.filter((shot) => shot.entry.spec === spec),
  }))
  return { manifest, manifestByteLength: 100, specs, diagnostics }
}

function expectCountInvariants(model: CompareModel): void {
  expect(model.counts.nameMatched).toBe(
    model.counts.comparable + model.counts.notComparable,
  )
  expect(model.counts.total).toBe(
    model.counts.nameMatched + model.counts.unmatchedByName,
  )
}

describe('compare model', () => {
  it('builds every pair state, combines diagnostics, and keeps count semantics truthful', () => {
    const aDiagnostic = { path: 'shots/a-broken.png', message: 'A unreadable' }
    const bDiagnostic = { path: 'shots/b-broken.png', message: 'B unreadable' }
    const model = buildCompareModel(
      gallery(
        'run-a',
        [
          galleryShot('paired', 'first.shots.ts'),
          galleryShot('a-only', 'first.shots.ts'),
          galleryShot('a-broken', 'second.shots.ts', false, 'A PNG is corrupt'),
          galleryShot('b-broken', 'second.shots.ts'),
        ],
        [aDiagnostic],
      ),
      gallery(
        'run-b',
        [
          galleryShot('paired', 'other-name-for-same-position.shots.ts'),
          galleryShot('a-broken', 'second.shots.ts'),
          galleryShot('b-broken', 'second.shots.ts', false, 'B PNG is missing'),
          galleryShot('b-only', 'third.shots.ts'),
        ],
        [bDiagnostic],
      ),
    )

    expect(model.pairs.map(({ key, state }) => ({ key, state }))).toEqual([
      { key: 'a-broken', state: 'not-comparable' },
      { key: 'b-broken', state: 'not-comparable' },
      { key: 'a-only', state: 'a-only' },
      { key: 'b-only', state: 'b-only' },
      { key: 'paired', state: 'paired' },
    ])
    expect(model.pairs.find((pair) => pair.key === 'paired')?.spec).toBe('first.shots.ts')
    expect(model.pairs.find((pair) => pair.key === 'a-broken')?.notComparableReason).toBe(
      'A: A PNG is corrupt',
    )
    expect(model.pairs.find((pair) => pair.key === 'b-broken')?.notComparableReason).toBe(
      'B: B PNG is missing',
    )
    expect(model.counts).toEqual({
      total: 5,
      nameMatched: 3,
      comparable: 1,
      aOnly: 1,
      bOnly: 1,
      unmatchedByName: 2,
      notComparable: 2,
    })
    expect(model.diagnostics).toEqual([aDiagnostic, bDiagnostic])
    expectCountInvariants(model)
  })

  it('orders attention states by state then stable union order, followed by paired context', () => {
    const model = buildCompareModel(
      gallery('run-a', [
        galleryShot('paired-first', 'z.shots.ts'),
        galleryShot('a-first', 'a.shots.ts'),
        galleryShot('broken-second', 'b.shots.ts', false, 'bad A'),
        galleryShot('broken-first', 'a.shots.ts', false, 'bad A'),
        galleryShot('a-second', 'b.shots.ts'),
        galleryShot('paired-second', 'a.shots.ts'),
      ]),
      gallery('run-b', [
        galleryShot('paired-first', 'z.shots.ts'),
        galleryShot('broken-second', 'b.shots.ts'),
        galleryShot('broken-first', 'a.shots.ts'),
        galleryShot('paired-second', 'a.shots.ts'),
        galleryShot('b-first', 'b.shots.ts'),
        galleryShot('b-second', 'a.shots.ts'),
      ]),
    )

    expect(model.pairs.map((pair) => pair.key)).toEqual([
      'broken-first',
      'broken-second',
      'a-first',
      'a-second',
      'b-first',
      'b-second',
      'paired-first',
      'paired-second',
    ])
    expectCountInvariants(model)
  })

  it.each([
    {
      name: 'empty compare',
      a: [],
      b: [],
      counts: { total: 0, nameMatched: 0, comparable: 0, unmatchedByName: 0, notComparable: 0 },
    },
    {
      name: 'no common names',
      a: [galleryShot('only-a', 'a.shots.ts')],
      b: [galleryShot('only-b', 'b.shots.ts')],
      counts: { total: 2, nameMatched: 0, comparable: 0, unmatchedByName: 2, notComparable: 0 },
    },
    {
      name: 'all not-comparable',
      a: [galleryShot('same', 'a.shots.ts', false, 'bad A')],
      b: [galleryShot('same', 'a.shots.ts')],
      counts: { total: 1, nameMatched: 1, comparable: 0, unmatchedByName: 0, notComparable: 1 },
    },
    {
      name: 'one side empty',
      a: [],
      b: [galleryShot('only-b', 'b.shots.ts')],
      counts: { total: 1, nameMatched: 0, comparable: 0, unmatchedByName: 1, notComparable: 0 },
    },
  ])('covers the $name state', ({ a, b, counts }) => {
    const model = buildCompareModel(gallery('run-a', a), gallery('run-b', b))
    expect(model.counts).toMatchObject(counts)
    expectCountInvariants(model)
  })

  it('uses unmatched-by-name states without added or removed labels', () => {
    const model = buildCompareModel(
      gallery('run-a', [galleryShot('only-a', 'a.shots.ts')]),
      gallery('run-b', [galleryShot('only-b', 'b.shots.ts')]),
    )
    expect(model.pairs.map((pair) => pair.state)).toEqual(['a-only', 'b-only'])
    expect(JSON.stringify(model)).not.toMatch(/added|removed/i)
  })

  it('does not revalidate duplicate names already owned by manifest and gallery validation', () => {
    const duplicateA = gallery('run-a', [
      galleryShot('same', 'first.shots.ts'),
      galleryShot('same', 'second.shots.ts'),
    ])
    const model = buildCompareModel(
      duplicateA,
      gallery('run-b', [galleryShot('same', 'third.shots.ts')]),
    )
    expect(model.pairs).toHaveLength(1)
    expect(model.pairs[0]?.a?.entry.spec).toBe('second.shots.ts')
  })
})
