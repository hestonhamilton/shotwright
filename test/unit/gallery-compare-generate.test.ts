import fs from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, expect, it, vi } from 'vitest'
import { generateCompareGallery } from '../../src/gallery/generate-compare.js'
import { makeManifest, makeShot } from '../fixtures/manifest.js'

const roots: string[] = []
const pixelmatchVersion = (
  JSON.parse(fs.readFileSync('node_modules/pixelmatch/package.json', 'utf8')) as {
    version: string
  }
).version
afterEach(() => {
  vi.restoreAllMocks()
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
    comparator: { name: 'pixelmatch', version: pixelmatchVersion },
    settings: { threshold: 0.1, includeAA: false, source: 'default' },
    pairs: [{ state: 'changed', totalPixels: 9, aSize: { width: 3, height: 3 } }],
  })
  expect(summary.runs).toEqual({
    a: { runId: 'run-a', pathDigest: createHash('sha256').update(a).digest('hex') },
    b: { runId: 'run-b', pathDigest: createHash('sha256').update(b).digest('hex') },
  })
  expect(fs.readFileSync(path.join(dir, 'run-a.vs.run-b.compare.json'), 'utf8')).not.toContain(a)
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
it('prunes only regular files owned by the stem', () => {
  const { a, b } = fixture()
  const first = generateCompareGallery(a, b)
  const dir = path.dirname(first.outputFile)
  const directory = path.join(dir, 'run-a.vs.run-b.diff-9.png')
  const symlink = path.join(dir, `.compare.run-a.vs.run-b.html.${process.pid}.tmp`)
  const target = path.join(dir, 'other-file')
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'keep'), 'nested')
  fs.writeFileSync(target, 'target')
  fs.symlinkSync(target, symlink)
  generateCompareGallery(a, b)
  expect(fs.readFileSync(path.join(directory, 'keep'), 'utf8')).toBe('nested')
  expect(fs.lstatSync(symlink).isSymbolicLink()).toBe(true)
  expect(fs.readFileSync(target, 'utf8')).toBe('target')
})
it('keeps the previous complete HTML, JSON and diff PNG when staging the new HTML fails', () => {
  const { a, b } = fixture(),
    first = generateCompareGallery(a, b)
  const dir = path.dirname(first.outputFile)
  const names = ['run-a.vs.run-b.html', 'run-a.vs.run-b.compare.json', 'run-a.vs.run-b.diff-0.png']
  const before = names.map((name) => fs.readFileSync(path.join(dir, name)))
  const write = fs.writeFileSync
  vi.spyOn(fs, 'writeFileSync').mockImplementation((file, contents, options) => {
    if (String(file).includes('.compare.run-a.vs.run-b.html.'))
      throw new Error('injected staging failure')
    write(file, contents, options)
  })
  fs.writeFileSync(path.join(a, 'shots/one.png'), fs.readFileSync(path.join(b, 'shots/one.png')))
  expect(() => generateCompareGallery(a, b)).toThrow('injected staging failure')
  expect(names.map((name) => fs.readFileSync(path.join(dir, name)))).toEqual(before)
  expect(fs.readdirSync(dir).filter((name) => name.startsWith('.compare.'))).toEqual([])
  vi.restoreAllMocks()
  const recovered = generateCompareGallery(a, b)
  expect(recovered.counts.identical).toBe(1)
  expect(fs.existsSync(path.join(dir, 'run-a.vs.run-b.diff-0.png'))).toBe(false)
  expect(fs.readdirSync(dir).filter((name) => name.startsWith('.compare.'))).toEqual([])
})
it('does not follow or remove a planted symlink at a temp path', () => {
  const { a, b } = fixture()
  const first = generateCompareGallery(a, b)
  const target = path.join(path.dirname(first.outputFile), 'protected')
  fs.writeFileSync(target, 'unchanged')
  const write = fs.writeFileSync
  let planted = ''
  vi.spyOn(fs, 'writeFileSync').mockImplementation((file, contents, options) => {
    if (!planted && String(file).includes('.compare.run-a.vs.run-b.diff-0.png.')) {
      planted = String(file)
      fs.symlinkSync(target, planted)
    }
    write(file, contents, options)
  })
  expect(() => generateCompareGallery(a, b)).toThrow(/EEXIST/)
  expect(fs.readFileSync(target, 'utf8')).toBe('unchanged')
  expect(fs.lstatSync(planted).isSymbolicLink()).toBe(true)
})
it('keeps the previous complete HTML when renaming the new HTML into place fails', () => {
  const { a, b } = fixture(),
    first = generateCompareGallery(a, b)
  const before = fs.readFileSync(first.outputFile)
  const rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === first.outputFile) throw new Error('injected rename failure')
    rename(from, to)
  })
  expect(() => generateCompareGallery(a, b, { threshold: 0.5 })).toThrow('injected rename failure')
  expect(fs.readFileSync(first.outputFile)).toEqual(before)
  expect(
    fs.readdirSync(path.dirname(first.outputFile)).filter((name) => name.startsWith('.compare.')),
  ).toEqual([])
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
    settings: { threshold: 0.25, includeAA: true, source: 'option' },
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
  expect(different.model.pairs.find((pair) => pair.name === 'page-10k.html')).toMatchObject({
    state: 'changed',
    diffFormat: 'source',
    diffText: '- <p>reviewable HTML</p>\n+ <p>reviewable HTMLX/p>',
  })
  expect(different.model.pairs.find((pair) => pair.name.endsWith('.xlsx'))?.diffText).toBeNull()
})

it('decides JSON parity on source bytes: a formatting-only change is changed and counts toward the gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-json-parity-'))
  roots.push(root)
  const makeRun = (id: string, source: string): string => {
    const dir = path.join(root, id)
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'data/value.json'), source)
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        makeManifest({
          runId: id,
          artifacts: [
            {
              spec: 'data.shots.ts',
              name: 'value.json',
              file: 'data/value.json',
              contentType: 'application/json',
              bytes: Buffer.byteLength(source),
              testId: 'test-data',
            },
          ],
        }),
      ),
    )
    return dir
  }
  const a = makeRun('compact', '{"a":1}'),
    spaced = makeRun('spaced', '{ "a": 1 }'),
    same = makeRun('same', '{"a":1}'),
    valueChanged = makeRun('value-changed', '{"a":2}')
  const formatting = generateCompareGallery(a, spaced)
  expect(formatting.model.pairs[0]).toMatchObject({
    state: 'changed',
    diffFormat: 'source',
    diffText: '- {"a":1}\n+ { "a": 1 }',
  })
  expect(formatting.gate.nonParity).toBe(1)
  expect(formatting.counts.changed).toBe(1)
  expect(generateCompareGallery(a, same).model.pairs[0]).toMatchObject({
    state: 'identical',
    diffText: null,
  })
  const semantic = generateCompareGallery(a, valueChanged)
  expect(semantic.model.pairs[0]).toMatchObject({
    state: 'changed',
    diffFormat: 'pretty-json',
    diffText: '-   "a": 1\n+   "a": 2',
  })
  expect(fs.readFileSync(semantic.outputFile, 'utf8')).toContain('Diff shown pretty-printed')
  expect(fs.readFileSync(formatting.outputFile, 'utf8')).not.toContain('Diff shown pretty-printed')
})

it('writes the compare.json sidecar and diff PNGs beside an explicit outputFile', () => {
  const { a, b } = fixture()
  const target = path.join(path.dirname(a), 'reviews', 'nested', 'parity.html')
  const result = generateCompareGallery(a, b, { outputFile: target })
  expect(result.outputFile).toBe(target)
  expect(fs.readdirSync(path.dirname(target)).sort()).toEqual([
    'parity.compare.json',
    'parity.diff-0.png',
    'parity.html',
  ])
  const summary = JSON.parse(
    fs.readFileSync(path.join(path.dirname(target), 'parity.compare.json'), 'utf8'),
  )
  expect(summary.pairs[0]).toMatchObject({ state: 'changed', diff: 'parity.diff-0.png' })
  // Nothing lands in the default compare directory when the page is placed elsewhere.
  expect(fs.existsSync(path.join(path.dirname(a), 'compare'))).toBe(false)
})

it('keeps the legacy relative outputFile return while writing to its absolute path', () => {
  const { a, b } = fixture()
  const relative = path.relative(process.cwd(), path.dirname(a))
  const result = generateCompareGallery(relative, a, b)
  expect(result.outputFile).toBe(path.join(relative, 'compare', 'run-a.vs.run-b.html'))
  expect(fs.existsSync(path.resolve(result.outputFile))).toBe(true)
  expect(result.comparePath).toBe(path.resolve(result.outputFile))
})
