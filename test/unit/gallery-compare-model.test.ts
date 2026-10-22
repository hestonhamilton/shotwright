import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCompareModel } from '../../src/gallery/compare-model.js'
import { loadGalleryModel } from '../../src/gallery/model.js'
import { compareImageFiles, compareImages } from '../../src/gallery/pixels.js'
import { makeManifest, makeShot } from '../fixtures/manifest.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-pairs-'))
  roots.push(value)
  return value
}
function png(color: number, width = 4, height = 4): Buffer {
  const image = new PNG({ width, height })
  image.data.fill(255)
  for (let i = 0; i < image.data.length; i += 4) image.data[i] = color
  return PNG.sync.write(image)
}
function withTextChunk(source: Buffer): Buffer {
  const typeAndData = Buffer.from('tEXtcomment\0same pixels')
  let crc = 0xffffffff
  for (const byte of typeAndData) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const chunk = Buffer.alloc(typeAndData.length + 8)
  chunk.writeUInt32BE(typeAndData.length - 4, 0)
  typeAndData.copy(chunk, 4)
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4)
  return Buffer.concat([
    source.subarray(0, source.length - 12),
    chunk,
    source.subarray(source.length - 12),
  ])
}
function writeShots(dir: string, rows: { spec: string; name: string; png: Buffer }[]): string[] {
  return rows.map(({ spec, name, png: image }) => {
    const file = `shots/${spec}/${name}.png`
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), image)
    return file
  })
}
function run(
  base: string,
  id: string,
  rows: { spec: string; name: string; png: Buffer }[],
): string {
  const dir = path.join(base, id)
  fs.mkdirSync(dir)
  const files = writeShots(dir, rows)
  const shots = rows.map(({ spec, name }, index) => makeShot({ spec, name, file: files[index]! }))
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(makeManifest({ runId: id, shots })),
  )
  return dir
}
/** A genuine v1 manifest as 0.1 wrote it: no status, tests, artifacts, failures or publication; shots carry no testId, checked or retry. */
function runV1(
  base: string,
  id: string,
  rows: { spec: string; name: string; png: Buffer }[],
): string {
  const dir = path.join(base, id)
  fs.mkdirSync(dir)
  const files = writeShots(dir, rows)
  const manifest = {
    manifestVersion: 1,
    runId: id,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.50.0',
    flags: { only: [], video: false, trace: false },
    shots: rows.map(({ spec, name }, index) => ({
      name,
      spec,
      file: files[index]!,
      viewport: { width: 4, height: 4 },
      deviceScaleFactor: 1,
      fullPage: true,
      capturedAt: '2026-01-01T00:00:00.500Z',
      durationMs: 5,
      video: null,
      trace: null,
    })),
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  return dir
}

describe('seven-state compare model', () => {
  it('pins decoded byte equality, similar threshold, changed counts, dimensions and unreadable decoding', () => {
    const a = png(0),
      identical = withTextChunk(a),
      similar = png(1),
      changed = png(255)
    expect(identical.equals(a)).toBe(false)
    expect(compareImages(a, identical, { threshold: 0.1, includeAA: false }).state).toBe(
      'identical',
    )
    expect(compareImages(a, similar, { threshold: 1, includeAA: false }).state).toBe('similar')
    const verdict = compareImages(a, changed, { threshold: 0.1, includeAA: false })
    expect(verdict).toMatchObject({
      state: 'changed',
      differentPixels: 16,
      totalPixels: 16,
      ratio: 1,
      aSize: { width: 4, height: 4 },
      bSize: { width: 4, height: 4 },
    })
    expect(PNG.sync.read(verdict.diffPng!).width).toBe(4)
    // Size change: no diff PNG, no pixel counts, and each side's dimensions as decoded (no pad or crop).
    expect(compareImages(png(0, 4, 4), png(0, 5, 3), { threshold: 0.1, includeAA: false })).toEqual(
      {
        state: 'size-changed',
        differentPixels: null,
        totalPixels: null,
        ratio: null,
        aSize: { width: 4, height: 4 },
        bSize: { width: 5, height: 3 },
        diffPng: null,
      },
    )
    expect(compareImages(a, Buffer.from('broken'), { threshold: 0.1, includeAA: false })).toEqual({
      state: 'unreadable',
      differentPixels: null,
      totalPixels: null,
      ratio: null,
      aSize: null,
      bSize: null,
      diffPng: null,
      error: 'B: unreadable PNG: not a PNG file (missing PNG signature)',
    })
    expect(
      compareImageFiles(
        a.subarray(0, a.length - 20),
        a,
        { threshold: 0.1, includeAA: false },
        {
          a: 'shots/x/cut.png',
          b: 'shots/x/whole.png',
        },
      ),
    ).toEqual({
      verdict: expect.objectContaining({
        state: 'unreadable',
        error: 'A: unreadable PNG (shots/x/cut.png): truncated PNG (data ends early)',
      }),
      errorDetail: 'A: There are some read requests waitng on finished stream',
    })
  })
  it('pins composite identity across v1 and v2 runs with a shared name in two specs', () => {
    const base = root(),
      rows = [
        { spec: 'a.shots.ts', name: 'shared', png: png(0) },
        { spec: 'b.shots.ts', name: 'shared', png: png(255) },
      ]
    const a = runV1(base, 'run-a', rows),
      b = run(base, 'run-b', rows)
    const raw = JSON.parse(fs.readFileSync(path.join(a, 'manifest.json'), 'utf8')) as Record<
      string,
      unknown
    >
    for (const key of ['status', 'tests', 'artifacts', 'failures', 'publication'])
      expect(raw).not.toHaveProperty(key)
    for (const entry of raw.shots as Record<string, unknown>[])
      for (const key of ['testId', 'checked', 'retry']) expect(entry).not.toHaveProperty(key)
    const model = buildCompareModel(loadGalleryModel(a), loadGalleryModel(b), {
      aRunDir: a,
      bRunDir: b,
    })
    expect(model.pairs).toHaveLength(2)
    expect(model.pairs.map((pair) => [pair.spec, pair.name, pair.state])).toEqual([
      ['a.shots.ts', 'shared', 'identical'],
      ['b.shots.ts', 'shared', 'identical'],
    ])
    expect(model.a.sourceManifestVersion).toBe(1)
  })
  it('pins added, removed, and unreadable states using composite keys', () => {
    const base = root(),
      a = run(base, 'run-a', [
        { spec: 'x', name: 'old', png: png(0) },
        { spec: 'x', name: 'bad', png: Buffer.from('not png') },
      ]),
      b = run(base, 'run-b', [
        { spec: 'x', name: 'new', png: png(0) },
        { spec: 'x', name: 'bad', png: png(0) },
      ])
    const model = buildCompareModel(loadGalleryModel(a), loadGalleryModel(b), {
      aRunDir: a,
      bRunDir: b,
    })
    expect(Object.fromEntries(model.pairs.map((pair) => [pair.name, pair.state]))).toEqual({
      bad: 'unreadable',
      new: 'added',
      old: 'removed',
    })
    expect(model.pairs.find((pair) => pair.name === 'bad')).toMatchObject({
      error: 'A: unreadable PNG (shots/x/bad.png): not a PNG file (missing PNG signature)',
      errorDetail: 'A: There are some read requests waitng on finished stream',
    })
  })
})
