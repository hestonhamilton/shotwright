import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveCompareRuns, resolveGalleryRun, validateRunId } from '../../src/gallery/resolve.js'
import { makeManifest } from '../fixtures/manifest.js'

const tmpDirs: string[] = []

function tmpDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-gallery-resolve-'))
  tmpDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function addManifest(runDir: string): void {
  fs.writeFileSync(
    path.join(runDir, 'manifest.json'),
    JSON.stringify(makeManifest({ runId: path.basename(runDir) })),
  )
}

describe('validateRunId', () => {
  it('accepts the generated run-id shape', () => {
    expect(() => validateRunId('2026-07-29T12-00-00_abcd')).not.toThrow()
  })

  it.each([
    '',
    '.',
    '..',
    'run.id',
    '/absolute',
    'nested/run',
    'nested\\run',
    'nul\0run',
    '%2e%2e',
    '%252e%252e',
    '%2fetc',
  ])('rejects unsafe id %j', (runId) => {
    expect(() => validateRunId(runId)).toThrow(/single run directory basename/)
  })
})

describe('resolveGalleryRun', () => {
  it('--last selects newest manifest run while latest stays on last passed', () => {
    const output = tmpDir()
    const passed = '2026-07-29T10-00-00_aaaa'
    const failed = '2026-07-29T11-00-00_bbbb'
    const incomplete = '2026-07-29T12-00-00_cccc'
    for (const id of [passed, failed, incomplete]) fs.mkdirSync(path.join(output, id))
    addManifest(path.join(output, passed))
    addManifest(path.join(output, failed))
    fs.utimesSync(path.join(output, passed), new Date(3_000), new Date(3_000))
    fs.utimesSync(path.join(output, failed), new Date(2_000), new Date(2_000))
    fs.utimesSync(path.join(output, incomplete), new Date(4_000), new Date(4_000))
    fs.symlinkSync(passed, path.join(output, 'latest'))
    expect(resolveGalleryRun(output, '--last')).toMatchObject({
      runId: failed,
      selectedViaLast: true,
    })
    expect(resolveGalleryRun(output, null).runId).toBe(passed)
  })
  it('resolves an explicit immediate child canonically', () => {
    const output = tmpDir()
    fs.mkdirSync(path.join(output, 'run_abcd'))
    expect(resolveGalleryRun(output, 'run_abcd')).toEqual({
      outputDir: fs.realpathSync(output),
      runDir: fs.realpathSync(path.join(output, 'run_abcd')),
      runId: 'run_abcd',
      selectedViaLatest: false,
    })
  })

  it('requires latest to be a symlink to an immediate child', () => {
    const output = tmpDir()
    fs.mkdirSync(path.join(output, 'run_abcd'))
    fs.symlinkSync('run_abcd', path.join(output, 'latest'))
    expect(resolveGalleryRun(output, null)).toMatchObject({
      runId: 'run_abcd',
      selectedViaLatest: true,
    })
  })

  it('fails closed for missing, dangling, non-symlink, and escaping latest', () => {
    const root = tmpDir()
    const output = path.join(root, 'output')
    fs.mkdirSync(output)
    expect(() => resolveGalleryRun(output, null)).toThrow(/latest is missing/)

    fs.symlinkSync('missing', path.join(output, 'latest'))
    expect(() => resolveGalleryRun(output, null)).toThrow(/missing or unreadable/)
    fs.rmSync(path.join(output, 'latest'))

    fs.mkdirSync(path.join(output, 'latest'))
    expect(() => resolveGalleryRun(output, null)).toThrow(/must be a symlink/)
    fs.rmSync(path.join(output, 'latest'), { recursive: true })

    fs.mkdirSync(path.join(root, 'outside'))
    fs.symlinkSync(path.join(root, 'outside'), path.join(output, 'latest'))
    expect(() => resolveGalleryRun(output, null)).toThrow(/escapes/)
  })

  it('rejects an explicit symlink escape', () => {
    const root = tmpDir()
    const output = path.join(root, 'output')
    fs.mkdirSync(output)
    fs.mkdirSync(path.join(root, 'outside'))
    fs.symlinkSync(path.join(root, 'outside'), path.join(output, 'alias'))
    expect(() => resolveGalleryRun(output, 'alias')).toThrow(/escapes/)
  })
})

describe('resolveCompareRuns', () => {
  it('accepts external paths, requires manifests, rejects symlink paths and canonical duplicates', () => {
    const root = tmpDir()
    const output = path.join(root, 'output')
    const external = path.join(root, 'downloaded')
    fs.mkdirSync(output)
    fs.mkdirSync(external)
    fs.mkdirSync(path.join(output, 'local'))
    addManifest(path.join(output, 'local'))
    addManifest(external)
    expect(resolveCompareRuns(output, 'local', external).b.runDir).toBe(fs.realpathSync(external))
    expect(() => resolveCompareRuns(output, external, external)).toThrow(/same run/)
    fs.symlinkSync(external, path.join(root, 'alias'))
    expect(() => resolveCompareRuns(output, 'local', path.join(root, 'alias'))).toThrow(/symlink/)
    fs.unlinkSync(path.join(external, 'manifest.json'))
    expect(() => resolveCompareRuns(output, 'local', external)).toThrow(/no manifest/)
  })
  it('resolves two explicit run ids through the gallery resolver', () => {
    const output = tmpDir()
    fs.mkdirSync(path.join(output, 'run-a'))
    fs.mkdirSync(path.join(output, 'run-b'))
    addManifest(path.join(output, 'run-a'))
    addManifest(path.join(output, 'run-b'))

    expect(resolveCompareRuns(output, 'run-a', 'run-b')).toEqual({
      outputDir: fs.realpathSync(output),
      a: {
        outputDir: fs.realpathSync(output),
        runDir: fs.realpathSync(path.join(output, 'run-a')),
        runId: 'run-a',
        selectedViaLatest: false,
      },
      b: {
        outputDir: fs.realpathSync(output),
        runDir: fs.realpathSync(path.join(output, 'run-b')),
        runId: 'run-b',
        selectedViaLatest: false,
      },
    })
  })

  it.each([
    ['A', 'latest', 'run-b'],
    ['B', 'run-b', 'latest'],
  ])('resolves latest independently for side %s', (_side, aSelector, bSelector) => {
    const output = tmpDir()
    fs.mkdirSync(path.join(output, 'run-a'))
    fs.mkdirSync(path.join(output, 'run-b'))
    addManifest(path.join(output, 'run-a'))
    addManifest(path.join(output, 'run-b'))
    fs.symlinkSync('run-a', path.join(output, 'latest'))

    const result = resolveCompareRuns(output, aSelector, bSelector)
    expect(result.a.selectedViaLatest).toBe(aSelector === 'latest')
    expect(result.b.selectedViaLatest).toBe(bSelector === 'latest')
    expect(result.a.runId).toBe(aSelector === 'latest' ? 'run-a' : 'run-b')
    expect(result.b.runId).toBe(bSelector === 'latest' ? 'run-a' : 'run-b')
  })

  it.each([
    ['the same explicit id twice', 'run-a', 'run-a'],
    ['latest and its target basename', 'latest', 'run-a'],
    ['the target basename and latest', 'run-a', 'latest'],
  ])('rejects identical canonical runs selected via %s', (_label, aSelector, bSelector) => {
    const output = tmpDir()
    fs.mkdirSync(path.join(output, 'run-a'))
    addManifest(path.join(output, 'run-a'))
    fs.symlinkSync('run-a', path.join(output, 'latest'))

    expect(() => resolveCompareRuns(output, aSelector, bSelector)).toThrow(
      'shotwright compare: A and B resolve to the same run: run-a',
    )
  })
})
