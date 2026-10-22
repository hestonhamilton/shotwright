import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { expect, it } from 'vitest'
import { buildCompareModel } from '../../src/gallery/compare-model.js'
import { loadGalleryModel } from '../../src/gallery/model.js'
import { renderCompare } from '../../src/gallery/render-compare.js'
import { makeManifest, makeShot } from '../fixtures/manifest.js'

it('renders all seven verdict labels, gate summary, diff image, and run status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-compare-render-'))
  try {
    const write = (id: string, statuses: string[]): string => {
      const dir = path.join(root, id)
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
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
          makeManifest({ runId: id, status: id === 'a' ? 'failed' : 'passed', shots }),
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
