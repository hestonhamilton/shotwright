import fs from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, expect, it, vi } from 'vitest'
import { generateCompareGallery } from '../../src/gallery/generate-compare.js'
import { buildCompareModel } from '../../src/gallery/compare-model.js'
import { loadGalleryModel } from '../../src/gallery/model.js'
import { renderCompare } from '../../src/gallery/render-compare.js'
import { compare } from '../../src/cli.js'
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
  expect(result.gate).toEqual({
    measuredNonParity: 1,
    ignoredNonParity: 0,
    nonParity: 1,
    failOnChange: false,
  })
  expect((result.model.pairs[0]!.a as { image: { dataUri: string } }).image.dataUri).toBe('')
  expect((result.model.pairs[0]!.b as { image: { dataUri: string } }).image.dataUri).toBe('')
  expect(result.model.pairs[0]!.verdict?.diffPng).toBeNull()
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
it('keeps image verdict, counts, gate, and CLI exit unchanged when provenance differs', async () => {
  const { a, b } = fixture()
  const baseline = generateCompareGallery(a, b, { failOnChange: true })
  const before = {
    pairs: baseline.model.pairs.map((pair) => pair.state),
    counts: { ...baseline.counts },
    gate: { ...baseline.gate },
  }
  const set = (dir: string, version: string) => {
    const file = path.join(dir, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    manifest.environment = { platform: 'linux', distribution: { id: 'debian', versionId: '12' } }
    manifest.browsers = [
      {
        project: 'desktop',
        name: 'chromium',
        version,
        channel: null,
        executable: { kind: 'managed', path: 'chromium/chrome', sha256: 'a'.repeat(64) },
      },
    ]
    fs.writeFileSync(file, JSON.stringify(manifest))
  }
  set(a, '1.0')
  set(b, '2.0')
  const changed = generateCompareGallery(a, b, { failOnChange: true })
  const summary = JSON.parse(
    fs.readFileSync(changed.outputFile.replace(/\.html$/, '.compare.json'), 'utf8'),
  )
  expect(summary.provenance).toEqual({
    status: 'known-fields-differ',
    differences: ['desktop browser version: 1.0 → 2.0'],
    unavailable: [],
  })
  expect(fs.readFileSync(changed.outputFile, 'utf8')).toContain(
    `<p class="provenance">Render environments differ: ${summary.provenance.differences[0]}</p>`,
  )
  expect({
    pairs: changed.model.pairs.map((pair) => pair.state),
    counts: changed.counts,
    gate: changed.gate,
  }).toEqual(before)
  expect(
    await compare([a, b, '--config', 'demo/shots.config.ts', '--fail-on-change'], async () =>
      path.dirname(a),
    ),
  ).toBe(1)
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
it('keeps fresh foreign compare temps and prunes old ones', () => {
  const { a, b } = fixture()
  const dir = path.dirname(generateCompareGallery(a, b).outputFile)
  const fresh = path.join(dir, `.compare.run-a.vs.run-b.html.${process.pid}.${'a'.repeat(32)}.tmp`)
  const old = path.join(dir, `.compare.run-a.vs.run-b.html.${process.pid}.${'b'.repeat(32)}.tmp`)
  fs.writeFileSync(fresh, 'in flight')
  fs.writeFileSync(old, 'abandoned')
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
  fs.utimesSync(old, twoHoursAgo, twoHoursAgo)
  generateCompareGallery(a, b)
  expect(fs.readFileSync(fresh, 'utf8')).toBe('in flight')
  expect(fs.existsSync(old)).toBe(false)
})
it('marks a disappeared original unreadable in the final JSON, HTML, counts and gate', () => {
  const { a, b } = fixture()
  const bytes = fs.readFileSync(path.join(a, 'shots/one.png'))
  fs.writeFileSync(path.join(b, 'shots/one.png'), bytes)
  for (const run of [a, b]) {
    fs.writeFileSync(path.join(run, 'shots/two.png'), bytes)
    const manifestFile = path.join(run, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    manifest.shots.push(makeShot({ spec: 'home.shots.ts', name: 'two', file: 'shots/two.png' }))
    fs.writeFileSync(manifestFile, JSON.stringify(manifest))
  }
  const original = path.join(b, 'shots/one.png')
  const read = fs.readFileSync
  let reads = 0
  vi.spyOn(fs, 'readFileSync').mockImplementation(((
    file: fs.PathOrFileDescriptor,
    options?: unknown,
  ) => {
    if (file === original && ++reads === 2) fs.rmSync(original)
    return read(file, options as BufferEncoding)
  }) as typeof fs.readFileSync)
  const result = generateCompareGallery(a, b)
  const summary = JSON.parse(
    fs.readFileSync(result.outputFile.replace(/\.html$/, '.compare.json'), 'utf8'),
  )
  const html = fs.readFileSync(result.outputFile, 'utf8')
  const reason = 'B: unreadable file (shots/one.png): referenced file is missing or unreadable'
  expect(result.model.pairs).toMatchObject([
    { state: 'unreadable', error: reason },
    { state: 'identical' },
  ])
  expect(result.counts).toMatchObject({ identical: 1, unreadable: 1 })
  expect(result.gate).toEqual({
    measuredNonParity: 1,
    ignoredNonParity: 0,
    nonParity: 1,
    failOnChange: false,
  })
  expect(html).toContain('Gate: measured non-parity 1 · ignored non-parity 0 · gated pairs 1')
  expect(summary).toMatchObject({
    counts: { identical: 1, unreadable: 1 },
    gate: { measuredNonParity: 1, ignoredNonParity: 0, nonParity: 1, failOnChange: false },
    pairs: [
      { state: 'unreadable', diff: null, error: { message: reason } },
      { state: 'identical' },
    ],
  })
  expect(html).toContain(
    'data-compare-filter="unreadable" aria-pressed="false" disabled>Unreadable 1</button>',
  )
  expect(html).toContain('1 pair would count toward the gate')
  expect(
    [...html.matchAll(/<li data-compare-jump><a href="#(pair-\d+)">([^<]+)<\/a><\/li>/g)].map(
      (match) => [match[1], match[2]],
    ),
  ).toEqual([
    ['pair-0', 'home.shots.ts / one · Unreadable'],
    ['pair-1', 'home.shots.ts / two · Identical'],
  ])
  expect(
    [...html.matchAll(/<article class="pair [^>]+" id="(pair-\d+)"/g)].map((match) => match[1]),
  ).toEqual(['pair-0', 'pair-1'])
  expect(html).toContain('data-compare-filter="unreadable"')
  expect(html).not.toContain('data-viewer-open="pair-0-b"')
  expect(html).toContain(reason)
  expect(html).toContain('home.shots.ts / two')
})
it('uses final hydration counts for the CLI terminal and exit gate', async () => {
  const { a, b } = fixture()
  const original = path.join(b, 'shots/one.png')
  fs.writeFileSync(original, fs.readFileSync(path.join(a, 'shots/one.png')))
  const read = fs.readFileSync
  let reads = 0
  vi.spyOn(fs, 'readFileSync').mockImplementation(((
    file: fs.PathOrFileDescriptor,
    options?: unknown,
  ) => {
    if (file === original && ++reads === 2) fs.rmSync(original)
    return read(file, options as BufferEncoding)
  }) as typeof fs.readFileSync)
  const line = vi.spyOn(console, 'error').mockImplementation(() => {})
  const page = path.join(path.dirname(a), 'cli.html')
  expect(
    await compare(
      [a, b, '--config', 'demo/shots.config.ts', '--output', page, '--fail-on-change'],
      async () => path.dirname(a),
    ),
  ).toBe(1)
  expect(line).toHaveBeenCalledWith(expect.stringContaining('1 measured non-parity pair'))
  expect(line).toHaveBeenCalledWith(
    expect.stringContaining(
      'unreadable 1; ignored non-parity 0, gated 1; --fail-on-change: fail (exit 1)',
    ),
  )
  const summary = JSON.parse(read(page.replace(/\.html$/, '.compare.json'), 'utf8'))
  expect(summary.gate).toMatchObject({ measuredNonParity: 1, ignoredNonParity: 0, nonParity: 1 })
  expect(read(page, 'utf8')).toContain(
    'Gate: measured non-parity 1 · ignored non-parity 0 · gated pairs 1',
  )
})
it('publishes the full HTML when writeSync makes short writes', () => {
  const { a, b } = fixture()
  const expected = renderCompare(buildCompareModel(loadGalleryModel(a), loadGalleryModel(b)))
  const write = fs.writeSync
  vi.spyOn(fs, 'writeSync').mockImplementation(((
    fd: number,
    bytes: Buffer,
    offset: number,
    length: number,
  ) => write(fd, bytes, offset, Math.min(length, 7))) as typeof fs.writeSync)
  const result = generateCompareGallery(a, b)
  expect(fs.readFileSync(result.outputFile, 'utf8')).toBe(expected)
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
it('restores every replaced file and exits 2 without a wrote line when a later rename fails', async () => {
  const { a, b } = fixture()
  const page = path.join(path.dirname(a), 'cli.html')
  const run = (extra: string[]) =>
    compare([a, b, '--config', 'demo/shots.config.ts', '--output', page, ...extra], async () =>
      path.dirname(a),
    )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await run([])).toBe(0)
  const dir = path.dirname(page)
  const names = ['cli.html', 'cli.compare.json', 'cli.diff-0.png']
  const before = names.map((name) => fs.readFileSync(path.join(dir, name)))
  vi.restoreAllMocks()
  const rename = fs.renameSync
  const renamed: string[] = []
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === path.join(dir, 'cli.compare.json')) throw new Error('injected rename failure')
    renamed.push(path.basename(String(to)))
    rename(from, to)
  })
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await run(['--threshold', '0.5', '--fail-on-change'])).toBe(2)
  // The diff PNG was replaced before the failure and then restored from its backup.
  expect(renamed).toEqual(['cli.diff-0.png', 'cli.diff-0.png'])
  expect(names.map((name) => fs.readFileSync(path.join(dir, name)))).toEqual(before)
  expect(fs.readdirSync(dir).filter((name) => name.startsWith('.compare.'))).toEqual([])
  expect(log).not.toHaveBeenCalledWith(expect.stringContaining('wrote'))
  expect(error).toHaveBeenCalledWith('shotwright compare: injected rename failure')
  vi.restoreAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await run(['--threshold', '0.5'])).toBe(0)
  expect(fs.readFileSync(page)).not.toEqual(before[0])
})
it('names the files left holding new output when restoring a replaced file fails', () => {
  const { a, b } = fixture(),
    first = generateCompareGallery(a, b)
  const dir = path.dirname(first.outputFile)
  const diff = path.join(dir, 'run-a.vs.run-b.diff-0.png')
  const before = ['run-a.vs.run-b.html', 'run-a.vs.run-b.compare.json'].map((name) =>
    fs.readFileSync(path.join(dir, name)),
  )
  const rename = fs.renameSync
  let diffRenames = 0
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === path.join(dir, 'run-a.vs.run-b.compare.json'))
      throw new Error('injected rename failure')
    if (to === diff && ++diffRenames === 2) throw new Error('injected restore failure')
    rename(from, to)
  })
  expect(() => generateCompareGallery(a, b, { threshold: 0.5 })).toThrow(
    `injected rename failure; compare output partially published: could not restore the previous ${diff}`,
  )
  expect(
    ['run-a.vs.run-b.html', 'run-a.vs.run-b.compare.json'].map((name) =>
      fs.readFileSync(path.join(dir, name)),
    ),
  ).toEqual(before)
})
it('reports a prune failure after a complete publish as a diagnostic and keeps the gate exit', async () => {
  const { a, b } = fixture()
  const page = path.join(path.dirname(a), 'cli.html')
  const stale = path.join(path.dirname(a), 'cli.diff-99.png')
  fs.writeFileSync(stale, 'stale')
  const unlink = fs.unlinkSync
  vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
    if (file === stale) throw Object.assign(new Error('EACCES: injected'), { code: 'EACCES' })
    unlink(file)
  })
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(
    await compare(
      [a, b, '--config', 'demo/shots.config.ts', '--output', page, '--fail-on-change'],
      async () => path.dirname(a),
    ),
  ).toBe(1)
  expect(log).toHaveBeenCalledWith(`shotwright compare: wrote ${page}`)
  expect(error).toHaveBeenCalledWith(
    `shotwright compare: ${stale}: stale compare output not pruned: EACCES: injected`,
  )
  expect(error).toHaveBeenCalledWith(expect.stringContaining('--fail-on-change: fail (exit 1)'))
  expect(fs.readFileSync(stale, 'utf8')).toBe('stale')
  const summary = JSON.parse(fs.readFileSync(page.replace(/\.html$/, '.compare.json'), 'utf8'))
  expect(summary.gate.nonParity).toBe(1)
})
it('backs up by copy where hard links fail, and still rolls back from the copy', () => {
  const { a, b } = fixture()
  vi.spyOn(fs, 'linkSync').mockImplementation(() => {
    throw Object.assign(new Error('EPERM: injected'), { code: 'EPERM' })
  })
  const first = generateCompareGallery(a, b)
  const dir = path.dirname(first.outputFile)
  const names = ['run-a.vs.run-b.html', 'run-a.vs.run-b.compare.json', 'run-a.vs.run-b.diff-0.png']
  const second = generateCompareGallery(a, b, { threshold: 0.5 })
  expect(second.diagnostics).toEqual([])
  const json = (): { settings: { threshold: number } } =>
    JSON.parse(fs.readFileSync(path.join(dir, 'run-a.vs.run-b.compare.json'), 'utf8'))
  expect(json().settings.threshold).toBe(0.5)
  expect(fs.readdirSync(dir).filter((name) => name.startsWith('.compare.'))).toEqual([])
  const before = names.map((name) => fs.readFileSync(path.join(dir, name)))
  const rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === path.join(dir, 'run-a.vs.run-b.compare.json'))
      throw new Error('injected rename failure')
    rename(from, to)
  })
  expect(() => generateCompareGallery(a, b, { threshold: 0.25 })).toThrow(
    /^injected rename failure$/,
  )
  expect(names.map((name) => fs.readFileSync(path.join(dir, name)))).toEqual(before)
  expect(json().settings.threshold).toBe(0.5)
  expect(fs.readdirSync(dir).filter((name) => name.startsWith('.compare.'))).toEqual([])
})
it('does not report a stale file a concurrent run already removed', () => {
  const { a, b } = fixture()
  const dir = path.dirname(generateCompareGallery(a, b).outputFile)
  const stale = path.join(dir, 'run-a.vs.run-b.diff-99.png')
  fs.writeFileSync(stale, 'stale')
  const unlink = fs.unlinkSync
  vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
    unlink(file)
    if (file === stale) throw Object.assign(new Error('ENOENT: injected'), { code: 'ENOENT' })
  })
  expect(generateCompareGallery(a, b).diagnostics).toEqual([])
  expect(fs.existsSync(stale)).toBe(false)
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
  expect(result.gate).toEqual({
    measuredNonParity: 1,
    ignoredNonParity: 0,
    nonParity: 1,
    failOnChange: true,
  })
})

it('keeps ignored artifact measurements and diagnostics, including added, removed and unreadable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-ignore-'))
  roots.push(root)
  const write = (id: string, names: string[]): string => {
    const dir = path.join(root, id)
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    const artifacts = names.map((name) => {
      const file = `data/${name.replaceAll('/', '-')}`
      if (name !== 'unreadable') fs.writeFileSync(path.join(dir, file), `${id}/${name}`)
      return {
        spec: 'nested/report.shots.ts',
        name,
        file,
        contentType: 'text/plain',
        bytes: 8,
        testId: 'test-data',
      }
    })
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(makeManifest({ runId: id, artifacts })),
    )
    return dir
  }
  const a = write('a', ['changed/subpath', 'removed', 'unreadable'])
  const b = write('b', ['changed/subpath', 'added', 'unreadable'])
  const ignore = [
    'nested/report.shots.ts/removed',
    'nested/report.shots.ts/changed/subpath',
    'nested/report.shots.ts/unreadable',
    'nested/report.shots.ts/added',
  ]
  const result = generateCompareGallery(a, b, { ignore, failOnChange: true })
  const summary = JSON.parse(
    fs.readFileSync(result.outputFile.replace(/\.html$/, '.compare.json'), 'utf8'),
  )
  const html = fs.readFileSync(result.outputFile, 'utf8')
  expect(result.model.pairs.map((pair) => [pair.name, pair.state, pair.ignored])).toEqual([
    ['changed/subpath', 'changed', true],
    ['unreadable', 'unreadable', true],
    ['removed', 'removed', true],
    ['added', 'added', true],
  ])
  expect(result.gate).toEqual({
    measuredNonParity: 4,
    ignoredNonParity: 4,
    nonParity: 0,
    failOnChange: true,
  })
  expect(summary.settings.ignore).toEqual([...ignore].sort())
  expect(summary.pairs.find((pair: { name: string }) => pair.name === 'unreadable')).toMatchObject({
    ignored: true,
    state: 'unreadable',
    error: { message: expect.any(String) },
  })
  expect(html).toContain('Gate: measured non-parity 4 · ignored non-parity 4 · gated pairs 0')
  expect(html).toContain('ignored for gate')
  expect(html).not.toContain('parity (every pair')
  expect(() => generateCompareGallery(a, b, { ignore: ['nested/report.shots.ts/typo'] })).toThrow(
    '--ignore did not match an artifact',
  )
  expect(() => generateCompareGallery(a, b, { ignore: ['nested/report.shots.ts'] })).toThrow(
    '--ignore did not match an artifact',
  )
})

it('rejects ambiguous artifact ignores and selects each distinct pair by an unambiguous key', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-ignore-identity-'))
  roots.push(root)
  const identities = [
    { spec: 'a.shots.ts', name: 'b.shots.ts/x' },
    { spec: 'a.shots.ts/b.shots.ts', name: 'x' },
  ]
  const write = (id: string): string => {
    const dir = path.join(root, id)
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    const artifacts = identities.map(({ spec, name }, index) => {
      const file = `data/${index}.txt`
      fs.writeFileSync(path.join(dir, file), `${id}/${index}`)
      return { spec, name, file, contentType: 'text/plain', bytes: 3, testId: `test-${index}` }
    })
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(makeManifest({ runId: id, artifacts })),
    )
    return dir
  }
  const a = write('a')
  const b = write('b')
  const config = path.join(root, 'shots.config.ts')
  fs.writeFileSync(config, '')
  const output = path.join(root, 'compare.html')
  const ambiguous = 'a.shots.ts/b.shots.ts/x'
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(
    await compare(
      [a, b, '--config', config, '--output', output, '--ignore', ambiguous, '--fail-on-change'],
      async () => root,
    ),
  ).toBe(2)
  expect(error).toHaveBeenCalledWith(expect.stringContaining('--ignore is ambiguous'))
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('spec: "a.shots.ts", name: "b.shots.ts/x"'),
  )
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('spec: "a.shots.ts/b.shots.ts", name: "x"'),
  )
  expect(fs.existsSync(output)).toBe(false)
  expect(fs.existsSync(path.join(root, 'compare.compare.json'))).toBe(false)

  for (const [key, expected] of [
    ['a.shots.ts/b.shots.ts/x/one', { spec: 'a.shots.ts', name: 'b.shots.ts/x/one' }],
    ['a.shots.ts/b.shots.ts/x/two', { spec: 'a.shots.ts/b.shots.ts', name: 'x/two' }],
  ] as const) {
    for (const id of ['a', 'b']) {
      const dir = path.join(root, id)
      const manifestFile = path.join(dir, 'manifest.json')
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
      const file = `data/${expected.name.endsWith('one') ? 'one' : 'two'}.txt`
      fs.writeFileSync(path.join(dir, file), `${id}/${key}`)
      manifest.artifacts.push({
        ...expected,
        file,
        contentType: 'text/plain',
        bytes: 3,
        testId: key,
      })
      fs.writeFileSync(manifestFile, JSON.stringify(manifest))
    }
    const result = generateCompareGallery(a, b, {
      ignore: [key],
      failOnChange: true,
      outputFile: output,
    })
    expect(
      result.model.pairs.filter((pair) => pair.ignored).map((pair) => [pair.spec, pair.name]),
    ).toEqual([[expected.spec, expected.name]])
    expect(result.gate.ignoredNonParity).toBe(1)
    expect(result.gate.nonParity).toBe(result.gate.measuredNonParity - 1)
  }
})

it('gates similar only in strict mode and preserves its measured state', () => {
  const { a, b } = fixture()
  const image = PNG.sync.read(fs.readFileSync(path.join(a, 'shots/one.png')))
  image.data[0] = 1
  fs.writeFileSync(path.join(b, 'shots/one.png'), PNG.sync.write(image))
  const normal = generateCompareGallery(a, b)
  const strict = generateCompareGallery(a, b, { strict: true, failOnChange: true, threshold: 1 })
  const summary = JSON.parse(
    fs.readFileSync(strict.outputFile.replace(/\.html$/, '.compare.json'), 'utf8'),
  )
  expect(normal.model.pairs[0]!.state).toBe('similar')
  expect(normal.gate.nonParity).toBe(0)
  expect(strict.model.pairs[0]!.state).toBe('similar')
  expect(strict.gate).toEqual({
    measuredNonParity: 0,
    ignoredNonParity: 0,
    nonParity: 1,
    failOnChange: true,
  })
  expect(summary.settings).toMatchObject({ threshold: 1, strict: true })
  expect(summary.gate.nonParity).toBe(1)
  expect(fs.readFileSync(strict.outputFile, 'utf8')).toContain('strict on')
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
