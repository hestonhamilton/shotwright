import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { expect, it } from 'vitest'
import { buildCompareModel } from '../../src/gallery/compare-model.js'
import { loadGalleryModel } from '../../src/gallery/model.js'
import { generateCompareGallery } from '../../src/gallery/generate-compare.js'
import { renderCompare } from '../../src/gallery/render-compare.js'
import { makeManifest, makeShot } from '../fixtures/manifest.js'

it('renders all seven verdict labels, gate summary, diff image, and run status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-compare-render-'))
  try {
    const write = (id: string, statuses: string[]): string => {
      const dir = path.join(root, id)
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'data'))
      fs.writeFileSync(path.join(dir, 'data', 'note.txt'), id === 'a' ? 'before' : 'after')
      const shots = statuses.map((name, index) => {
        const file = `shots/${name}.png`,
          image = new PNG({ width: name === 'size-changed' && id === 'b' ? 3 : 2, height: 2 })
        image.data.fill(
          index +
            (id === 'b' && name === 'changed' ? 200 : id === 'b' && name === 'similar' ? 1 : 0),
        )
        fs.writeFileSync(
          path.join(dir, file),
          name === 'unreadable' && id === 'a' ? Buffer.from('bad') : PNG.sync.write(image),
        )
        return makeShot({ name, spec: 'example.shots.ts', file })
      })
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify(
          makeManifest({
            runId: id,
            status: id === 'a' ? 'failed' : 'passed',
            shots,
            artifacts: [
              {
                spec: 'example.shots.ts',
                name: 'note',
                file: 'data/note.txt',
                contentType: 'text/plain',
                bytes: id === 'a' ? 6 : 5,
                testId: 'test-note',
              },
            ],
          }),
        ),
      )
      return dir
    }
    const a = write('a', [
      'identical',
      'similar',
      'changed',
      'size-changed',
      'removed',
      'unreadable',
    ])
    const b = write('b', ['identical', 'similar', 'changed', 'size-changed', 'added', 'unreadable'])
    const model = buildCompareModel(loadGalleryModel(a), loadGalleryModel(b), {
      aRunDir: a,
      bRunDir: b,
    })
    const html = renderCompare(model, true)
    const generated = generateCompareGallery(a, b, { failOnChange: true })
    const page = fs.readFileSync(generated.outputFile, 'utf8')
    expect(page).toBe(html)
    const summary = JSON.parse(
      fs.readFileSync(generated.outputFile.replace(/\.html$/, '.compare.json'), 'utf8'),
    ) as { runs: { a: { pathDigest: string }; b: { pathDigest: string } } }
    summary.runs.a.pathDigest = 'PATH'
    summary.runs.b.pathDigest = 'PATH'
    const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
    expect(sha256(page)).toMatchInlineSnapshot(
      `"d049def9f8ca558ff43dba9495ef192083b805210b538a53214130cab5ff40a2"`,
    )
    expect(sha256(JSON.stringify(summary, null, 2) + '\n')).toMatchInlineSnapshot(
      `"65aa1130e5ef88f8665144ea79b0ee4a7fce7d16a55a993a4bb6213621a71984"`,
    )
    for (const state of [
      'identical',
      'similar',
      'changed',
      'size-changed',
      'added',
      'removed',
      'unreadable',
    ])
      expect(html).toContain(`state-${state}`)
    expect(model.pairs[0]?.state).toBe('changed')
    expect(html).toContain('Gate:')
    expect(html).toContain('A run: failed · B run: passed')
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('fail-on-change on')
    expect(html).toContain(
      '<a href="../a/shots/identical.png" download="identical.png">Download A</a>',
    )
    expect(html).toContain(
      '<a href="../b/shots/identical.png" download="identical.png">Download B</a>',
    )
    expect(html.match(/Sibling-file warning:/g)).toHaveLength(model.pairs.length)
    const custom = renderCompare(model, true, { aBase: '../run a', bBase: '../run b' })
    expect(custom).toContain(
      '<a href="../run%20a/shots/identical.png" download="identical.png">Download A</a>',
    )
    expect(custom).toContain(
      '<a href="../run%20b/shots/identical.png" download="identical.png">Download B</a>',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('links Download A / Download B to the sibling files for text, JSON and binary artifact pairs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-compare-links-'))
  try {
    const files = {
      'page.html': ['text/html', '<p>a</p>', '<p>b</p>'],
      'reading.json': ['application/json', '{"a":1}', '{"a":2}'],
      'book of sheets.xlsx': ['application/octet-stream', 'PK-a', 'PK-b'],
    } as const
    const write = (id: string, side: 1 | 2): string => {
      const dir = path.join(root, id)
      fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
      const artifacts = Object.entries(files).map(([name, row]) => {
        fs.writeFileSync(path.join(dir, 'data', name), row[side])
        return {
          spec: 'data.shots.ts',
          name,
          file: `data/${name}`,
          contentType: row[0],
          bytes: row[side].length,
          testId: 'test-data',
        }
      })
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify(makeManifest({ runId: id, artifacts })),
      )
      return dir
    }
    const a = write('run-a', 1),
      b = write('run-b', 2)
    const model = buildCompareModel(loadGalleryModel(a), loadGalleryModel(b), {
      aRunDir: a,
      bRunDir: b,
    })
    expect(model.pairs.map((pair) => pair.state)).toEqual(['changed', 'changed', 'changed'])
    const links = (html: string): string[] =>
      [...html.matchAll(/<a class="download" href="([^"]+)" download>(Download [AB])<\/a>/g)].map(
        (match) => `${match[2]} ${match[1]}`,
      )
    // Default layout: the page lives in <outputDir>/compare/ beside the run directories.
    const html = renderCompare(model)
    expect(links(html)).toEqual([
      'Download A ../run-a/data/page.html',
      'Download B ../run-b/data/page.html',
      'Download A ../run-a/data/reading.json',
      'Download B ../run-b/data/reading.json',
      'Download A ../run-a/data/book%20of%20sheets.xlsx',
      'Download B ../run-b/data/book%20of%20sheets.xlsx',
    ])
    expect(html.match(/Sibling-file warning:/g)).toHaveLength(3)
    expect(html).toContain(
      'Each download link requires this gallery beside the run directory for its side.',
    )
    // A caller-chosen output file gets paths relative to where it was written.
    fs.mkdirSync(path.join(root, 'review'))
    const generated = generateCompareGallery(a, b, {
      outputFile: path.join(root, 'review', 'compare.html'),
    })
    expect(links(fs.readFileSync(generated.outputFile, 'utf8')).slice(0, 2)).toEqual([
      'Download A ../run-a/data/page.html',
      'Download B ../run-b/data/page.html',
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
