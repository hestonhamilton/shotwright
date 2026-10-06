import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generateCompareGallery } from '../../src/gallery/generate-compare.js'
import { MANIFEST_VERSION, type Manifest, type ShotEntry } from '../../src/manifest.js'
import { makePng } from '../fixtures/png.js'

const tmpDirs: string[] = []

function tmpDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-compare-generate-'))
  tmpDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function entry(name: string, spec: string, index: number): ShotEntry {
  return {
    name,
    spec,
    file: `shots/${spec}/${name}.png`,
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    fullPage: true,
    capturedAt: `2026-07-31T00:00:0${index}.000Z`,
    durationMs: 50 + index,
    video: null,
    trace: null,
  }
}

function manifest(runId: string, shots: ShotEntry[]): Manifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: '2026-07-31T00:00:00.000Z',
    finishedAt: '2026-07-31T00:00:10.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    shots,
  }
}

function writeRun(
  runDir: string,
  value: Manifest,
  options: { omit?: string[] } = {},
): void {
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(value, null, 2) + '\n')
  for (const [index, shot] of value.shots.entries()) {
    if (options.omit?.includes(shot.file)) continue
    const target = path.join(runDir, ...shot.file.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, makePng(100 + index, 80 + index, index))
  }
}

function fixture(root: string): { output: string; a: string; b: string } {
  const output = path.join(root, 'output')
  const a = path.join(output, 'run-a')
  const b = path.join(output, 'run-b')
  writeRun(a, manifest('run-a', [entry('shared', 'home.shots.ts', 0), entry('a-only', 'home.shots.ts', 1)]))
  writeRun(b, manifest('run-b', [entry('shared', 'home.shots.ts', 2), entry('b-only', 'about.shots.ts', 3)]))
  return { output, a, b }
}

describe('compare gallery generation', () => {
  it('publishes the accepted dot-separated artifact path and result model', () => {
    const { output, a, b } = fixture(tmpDir())
    const result = generateCompareGallery(output, a, b)

    expect(result.comparePath).toBe(path.join(output, 'compare', 'run-a.vs.run-b.html'))
    expect(fs.existsSync(result.comparePath)).toBe(true)
    expect(result.model.counts).toMatchObject({ total: 3, comparable: 1, aOnly: 1, bOnly: 1 })
    expect(result.diagnostics).toEqual([])
  })

  it('produces byte-identical HTML from identical inputs in different temp roots', () => {
    const first = fixture(path.join(tmpDir(), 'first'))
    const second = fixture(path.join(tmpDir(), 'second'))
    const firstResult = generateCompareGallery(first.output, first.a, first.b)
    const secondResult = generateCompareGallery(second.output, second.a, second.b)

    expect(fs.readFileSync(firstResult.comparePath)).toEqual(fs.readFileSync(secondResult.comparePath))
  })

  it('regenerates atomically without leaving compare writer temp files', () => {
    const { output, a, b } = fixture(tmpDir())
    const first = generateCompareGallery(output, a, b)
    const bytes = fs.readFileSync(first.comparePath)
    const second = generateCompareGallery(output, a, b)

    expect(fs.readFileSync(second.comparePath)).toEqual(bytes)
    expect(fs.readdirSync(path.join(output, 'compare')).filter((name) => name.startsWith('.compare.'))).toEqual([])
  })

  it('does not overwrite an existing artifact when either manifest is missing or invalid', () => {
    for (const [side, contents] of [
      ['a', null],
      ['b', '{nope'],
    ] as const) {
      const { output, a, b } = fixture(path.join(tmpDir(), side))
      const compareDir = path.join(output, 'compare')
      const comparePath = path.join(compareDir, 'run-a.vs.run-b.html')
      fs.mkdirSync(compareDir)
      fs.writeFileSync(comparePath, 'keep me')
      const manifestPath = path.join(side === 'a' ? a : b, 'manifest.json')
      if (contents === null) fs.rmSync(manifestPath)
      else fs.writeFileSync(manifestPath, contents)

      expect(() => generateCompareGallery(output, a, b)).toThrow(/invalid manifest/)
      expect(fs.readFileSync(comparePath, 'utf8')).toBe('keep me')
      expect(fs.readdirSync(compareDir).filter((name) => name.startsWith('.compare.'))).toEqual([])
    }
  })

  it('returns diagnostics and still writes HTML for an unreadable screenshot', () => {
    const root = tmpDir()
    const output = path.join(root, 'output')
    const a = path.join(output, 'run-a')
    const b = path.join(output, 'run-b')
    const shared = entry('shared', 'home.shots.ts', 0)
    writeRun(a, manifest('run-a', [shared]), { omit: [shared.file] })
    writeRun(b, manifest('run-b', [shared]))

    const result = generateCompareGallery(output, a, b)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.model.pairs[0]?.state).toBe('not-comparable')
    expect(fs.readFileSync(result.comparePath, 'utf8')).toContain('not comparable · unreadable image')
  })
})
