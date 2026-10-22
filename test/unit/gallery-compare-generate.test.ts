import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, expect, it } from 'vitest'
import { generateCompareGallery } from '../../src/gallery/generate-compare.js'
import { makeManifest, makeShot } from '../fixtures/manifest.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture(): { a: string; b: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-compare-generate-'))
  roots.push(root)
  const write = (id: string, fill: number): string => {
    const dir = path.join(root, id)
    fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
    const image = new PNG({ width: 3, height: 3 })
    image.data.fill(fill)
    fs.writeFileSync(path.join(dir, 'shots/one.png'), PNG.sync.write(image))
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        makeManifest({
          runId: id,
          shots: [makeShot({ spec: 'home.shots.ts', name: 'one', file: 'shots/one.png' })],
        }),
      ),
    )
    return dir
  }
  return { a: write('run-a', 0), b: write('run-b', 255) }
}
it('pins compare.json numbers, default settings, diff PNG and generation result gate', () => {
  const { a, b } = fixture(),
    result = generateCompareGallery(a, b)
  const dir = path.dirname(result.outputFile),
    summary = JSON.parse(fs.readFileSync(path.join(dir, 'run-a.vs.run-b.compare.json'), 'utf8'))
  expect(result.outputFile).toBe(path.join(dir, 'run-a.vs.run-b.html'))
  expect(result.counts.changed).toBe(1)
  expect(result.gate).toEqual({ nonParity: 1, failOnChange: false })
  expect(summary).toMatchObject({
    tool: 'shotwright',
    comparator: 'pixelmatch',
    threshold: 0.1,
    includeAA: false,
    pairs: [{ state: 'changed', totalPixels: 9, aSize: { width: 3, height: 3 } }],
  })
  expect(PNG.sync.read(fs.readFileSync(path.join(dir, summary.pairs[0].diff))).width).toBe(3)
})
it('pins recovery from partial prior write and atomic temp cleanup', () => {
  const { a, b } = fixture(),
    result = generateCompareGallery(a, b)
  const dir = path.dirname(result.outputFile)
  fs.writeFileSync(path.join(dir, 'run-a.vs.run-b.compare.json'), '{partial')
  fs.writeFileSync(path.join(dir, 'run-a.vs.run-b.diff-99.png'), 'stale')
  generateCompareGallery(a, b)
  expect(
    JSON.parse(fs.readFileSync(path.join(dir, 'run-a.vs.run-b.compare.json'), 'utf8')).counts
      .changed,
  ).toBe(1)
  expect(fs.existsSync(path.join(dir, 'run-a.vs.run-b.diff-99.png'))).toBe(false)
  expect(fs.readdirSync(dir).filter((name) => name.startsWith('.compare.'))).toEqual([])
})
it('records caller threshold and includeAA and echoes the optional parity gate', () => {
  const { a, b } = fixture()
  const result = generateCompareGallery(a, b, {
    threshold: 0.25,
    includeAA: true,
    failOnChange: true,
  })
  const summary = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(result.outputFile), 'run-a.vs.run-b.compare.json'),
      'utf8',
    ),
  )
  expect(summary).toMatchObject({
    threshold: 0.25,
    includeAA: true,
    gate: { nonParity: 1, failOnChange: true },
  })
  expect(result.gate).toEqual({ nonParity: 1, failOnChange: true })
})

it('pins the artifact corpus: text and JSON line diffs, binary byte equality, and changed pairs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-corpus-'))
  roots.push(root)
  const corpus = path.join('test', 'fixtures', 'compare-corpus')
  const names = [
    'page-10k.html',
    'page-600k.html',
    'reading-2k.json',
    'reading-300k.jsonl',
    'workbook-50k.xlsx',
  ]
  const mime = (name: string): string =>
    name.endsWith('.html')
      ? 'text/html'
      : name.endsWith('.json')
        ? 'application/json'
        : name.endsWith('.jsonl')
          ? 'text/plain'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const makeRun = (id: string, side: string): string => {
    const dir = path.join(root, id)
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    const artifacts = names.map((name) => {
      const file = `data/${name}`,
        bytes = fs.readFileSync(path.join(corpus, side, name))
      fs.writeFileSync(path.join(dir, file), bytes)
      return {
        spec: 'data.shots.ts',
        name,
        file,
        contentType: mime(name),
        bytes: bytes.length,
        testId: 'test-data',
      }
    })
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(makeManifest({ runId: id, artifacts })),
    )
    return dir
  }
  const a = makeRun('a', 'a'),
    identical = makeRun('identical', 'identical'),
    changed = makeRun('changed', 'changed')
  const same = generateCompareGallery(a, identical)
  expect(same.counts.identical).toBe(5)
  expect(same.gate.nonParity).toBe(0)
  const different = generateCompareGallery(a, changed)
  expect(different.counts.changed).toBe(5)
  expect(different.model.pairs.filter((pair) => pair.diffText?.includes('- '))).toHaveLength(4)
  expect(different.model.pairs.find((pair) => pair.name.endsWith('.xlsx'))?.diffText).toBeNull()
})
