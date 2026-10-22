import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCompareModel } from '../../src/gallery/compare-model.js'
import { loadGalleryModel } from '../../src/gallery/model.js'
import { compareImages } from '../../src/gallery/pixels.js'
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
function run(
  base: string,
  id: string,
  rows: { spec: string; name: string; png: Buffer }[],
  legacy = false,
): string {
  const dir = path.join(base, id)
  fs.mkdirSync(dir)
  const shots = rows.map(({ spec, name, png: image }) => {
    const file = `shots/${spec}/${name}.png`
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), image)
    return makeShot({ spec, name, file })
  })
  const manifest = makeManifest({ runId: id, shots })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(legacy ? { ...manifest, manifestVersion: 1 } : manifest),
  )
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
    expect(compareImages(a, png(0, 5), { threshold: 0.1, includeAA: false }).state).toBe(
      'size-changed',
    )
    expect(
      compareImages(a, Buffer.from('broken'), { threshold: 0.1, includeAA: false }),
    ).toMatchObject({ state: 'unreadable', error: expect.any(String) })
  })
  it('pins composite identity across v1 and v2 runs with a shared name in two specs', () => {
    const base = root(),
      rows = [
        { spec: 'a.shots.ts', name: 'shared', png: png(0) },
        { spec: 'b.shots.ts', name: 'shared', png: png(255) },
      ]
    const a = run(base, 'run-a', rows, true),
      b = run(base, 'run-b', rows)
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
  })
})
