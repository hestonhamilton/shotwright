import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { validateManifest } from '../../src/gallery/model.js'
import type { Manifest } from '../../src/manifest.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixture = path.join(root, 'test/fixtures/contract-consumer')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-contract-'))
afterAll(() => fs.rmSync(out, { recursive: true, force: true }))
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [
      path.join(root, 'dist/cli.js'),
      'run',
      '--config',
      path.join(fixture, 'shots.config.ts'),
      '--',
      ...args,
    ],
    { cwd: fixture, env: { ...process.env, CONTRACT_OUTPUT_DIR: out, ...env }, encoding: 'utf8' },
  )
}
function newest(): { dir: string; manifest: Manifest } {
  const names = fs
    .readdirSync(out)
    .filter((x) => x !== 'latest')
    .sort(
      (a, b) =>
        fs.statSync(path.join(out, a)).birthtimeMs - fs.statSync(path.join(out, b)).birthtimeMs,
    )
  const dir = path.join(out, names.at(-1)!)
  return {
    dir,
    manifest: validateManifest(
      JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
      path.basename(dir),
    ),
  }
}
describe('real Playwright contract consumer', () => {
  it.skipIf(process.platform !== 'linux')(
    'keeps the PNG when browser internals throw during observation',
    () => {
      const result = run(['--grep', 'provenance internals fail after capture'])
      expect(result.status, result.stdout + result.stderr).toBe(0)
      const { dir, manifest } = newest()
      expect(manifest.shots).toHaveLength(1)
      const file = path.join(dir, manifest.shots[0]!.file)
      expect(fs.readFileSync(file).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )
      expect(manifest.browsers?.[0]?.executable).toBeNull()
    },
  )
  it('aggregates two worker and project browser observations without host paths', () => {
    const result = run(['--grep', 'provenance across projects', '--workers=2'], {
      CONTRACT_TWO_PROJECTS: '1',
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const { dir, manifest } = newest()
    expect(manifest.browsers?.map((browser) => browser.project)).toEqual(['one', 'two'])
    for (const browser of manifest.browsers ?? []) {
      expect(browser.name).toBe('chromium')
      expect(browser.version).toMatch(/^\d+(?:\.\d+)*$/)
      if (process.platform === 'linux') expect(browser.executable?.kind).toBe('managed')
    }
    const published =
      fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8') +
      fs.readFileSync(path.join(dir, 'gallery.html'), 'utf8')
    expect(published).not.toContain(os.homedir())
    expect(published).not.toContain('--remote-debugging-pipe')
  })
  it('passes screenshot options through and preserves page and locator PNG bytes', () => {
    const result = run(['--grep', 'shot screenshot options preserve Playwright bytes'])
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const { manifest } = newest()
    expect(manifest.shots.map((shot) => shot.name).sort()).toEqual([
      'default-options',
      'full-page-options',
      'locator-options',
    ])
  })
  it('uses the loaded spec for a helper-registered nested test', () => {
    const result = run(['--grep', 'helper registered capture'])
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const { manifest } = newest()
    expect(manifest.shots[0]).toMatchObject({
      spec: 'loaded.shots.ts',
      file: 'shots/loaded/helper-shot.png',
    })
    expect(manifest.tests[0]?.titlePath).toEqual(['helper group', 'helper registered capture'])
  })
  it('writes v2 and allows the same name in two canonical specs with nested suffix layout', () => {
    const result = run(['--grep', 'same name'])
    expect(result.status, result.stderr).toBe(0)
    const { dir, manifest } = newest()
    expect(manifest.manifestVersion).toBe(2)
    expect(manifest.status).toBe('passed')
    expect(
      manifest.shots
        .filter((s) => s.name === 'shared')
        .map((s) => s.spec)
        .sort(),
    ).toEqual(['a.shots.ts', 'sub/b.shots.ts'])
    expect(manifest.shots.map((s) => s.file).sort()).toEqual([
      'shots/a/shared.png',
      'shots/sub/b/shared.png',
    ])
    expect(fs.existsSync(path.join(dir, manifest.artifacts[0]!.file))).toBe(true)
    expect(fs.readlinkSync(path.join(out, 'latest'))).toBe(path.basename(dir))
    expect(fs.existsSync(path.join(dir, '.pw'))).toBe(false)
    expect(fs.existsSync(path.join(dir, '.sidecar'))).toBe(false)
  })
  it('rejects same-spec duplicate even when separate tests captured it', () => {
    const previous = fs.readlinkSync(path.join(out, 'latest'))
    const result = run(['--grep', 'duplicate'])
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('duplicate shot name')
    const failed = newest()
    expect(failed.manifest.status).toBe('failed')
    expect(failed.manifest.shots).toHaveLength(1)
    expect(failed.manifest.shots[0]?.name).toBe('collision')
    expect(fs.readFileSync(path.join(failed.dir, failed.manifest.shots[0]!.file))).toEqual(
      fs.readFileSync(path.join(failed.dir, 'first-expected.png')),
    )
    expect(fs.readlinkSync(path.join(out, 'latest'))).toBe(previous)
  })
  it('keeps the first claimant PNG bytes and fails the loser under parallel workers', () => {
    const result = run(['--grep', 'duplicate', '--fully-parallel', '--workers=2'])
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('duplicate shot name')
    const { dir, manifest } = newest()
    expect(manifest.status).toBe('failed')
    expect(manifest.shots).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, manifest.shots[0]!.file))).toEqual(
      fs.readFileSync(path.join(dir, 'first-expected.png')),
    )
    expect(fs.readFileSync(path.join(dir, manifest.shots[0]!.file))).not.toEqual(
      fs.readFileSync(path.join(dir, 'second-expected.png')),
    )
    expect(manifest.tests.find((entry) => entry.title === 'duplicate two')?.status).toBe('failed')
  })
  it('keeps one PNG when two projects claim the same shot', () => {
    for (const [args, env] of [
      [['--grep', 'helper registered capture', '--workers=2'], { CONTRACT_TWO_PROJECTS: '1' }],
    ] as const) {
      const result = run([...args], env)
      expect(result.status).not.toBe(0)
      const { dir, manifest } = newest()
      expect(manifest.status).toBe('failed')
      expect(manifest.shots).toHaveLength(1)
      const file = path.join(dir, manifest.shots[0]!.file)
      expect(fs.readFileSync(file).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )
    }
  })

  it('exits nonzero after publishing a gallery failure without moving latest', () => {
    const previous = fs.readlinkSync(path.join(out, 'latest'))
    const result = run(['--grep', 'same name'], { SHOTWRIGHT_INJECT_GALLERY_FAILURE: '1' })
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('gallery publication failed')
    const { dir, manifest } = newest()
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true)
    expect(manifest.status).toBe('passed')
    expect(manifest.publication.gallery).toMatchObject({
      ok: false,
      error: expect.stringContaining('injected'),
    })
    expect(fs.existsSync(path.join(dir, 'gallery.html'))).toBe(false)
    expect(fs.readlinkSync(path.join(out, 'latest'))).toBe(previous)
  })

  it('keeps failure evidence and leaves latest at the passed run', () => {
    const prior = fs.readlinkSync(path.join(out, 'latest'))
    const result = run(['--grep', 'fails after capture'])
    expect(result.status).not.toBe(0)
    const { dir, manifest } = newest()
    expect(manifest.status).toBe('failed')
    expect(
      manifest.failures[0]?.files.some(
        (f) =>
          f.name === 'error-context' &&
          f.contentType === 'text/markdown' &&
          fs.existsSync(path.join(dir, f.file)),
      ),
    ).toBe(true)
    expect(result.stderr + result.stdout).toContain('shotwright: copied error-context:')
    expect(fs.existsSync(path.join(dir, '.pw'))).toBe(false)
    expect(fs.existsSync(path.join(dir, '.sidecar'))).toBe(false)
    expect(fs.readlinkSync(path.join(out, 'latest'))).toBe(prior)
  })
  it('no-op check records checked, filtered and thrown callbacks fail without capture, and fullPage bytes match', () => {
    const good = run(['--grep', 'no-op check'], { SHOTWRIGHT_ONLY: 'tall' })
    expect(good.status, good.stdout + good.stderr).toBe(0)
    const { dir, manifest } = newest()
    expect(manifest.shots[0]?.checked).toBe(true)
    expect(fs.readFileSync(path.join(dir, manifest.shots[0]!.file))).toEqual(
      fs.readFileSync(path.join(dir, 'explicit.png')),
    )
    expect(manifest.artifacts.map((a) => [a.name, a.bytes]).sort()).toEqual([
      ['path.txt', 9],
      ['utf8.txt', 6],
    ])
    const filtered = run(['--grep', 'filtered callback'], { SHOTWRIGHT_ONLY: 'tall' })
    expect(filtered.status).not.toBe(0)
    expect(filtered.stdout + filtered.stderr).toContain('filtered callback executed')
    const filteredRun = newest()
    expect(filteredRun.manifest.shots).toEqual([])
    expect(fs.existsSync(path.join(filteredRun.dir, 'shots/check/excluded.png'))).toBe(false)
    const thrown = run(['--grep', 'thrown callback'])
    expect(thrown.status).not.toBe(0)
    expect(newest().manifest.shots).toEqual([])
  })

  it('final retry omits stale shot and artifact files, while recapture owns retry-1 bytes', () => {
    const omitted = run(['--grep', 'retry omit', '--retries=1'])
    expect(omitted.status, omitted.stderr).toBe(0)
    const first = newest()
    expect(first.manifest.shots).toEqual([])
    expect(first.manifest.artifacts).toEqual([])
    expect(fs.existsSync(path.join(first.dir, 'shots/retry/retry-shot.png'))).toBe(false)
    expect(fs.existsSync(path.join(first.dir, 'data/retry/retry.txt'))).toBe(false)
    const recaptured = run(['--grep', 'retry recapture', '--retries=1'])
    expect(recaptured.status, recaptured.stderr).toBe(0)
    const second = newest()
    expect(second.manifest.shots[0]?.retry).toBe(1)
    expect(second.manifest.artifacts).toHaveLength(1)
    expect(fs.readFileSync(path.join(second.dir, second.manifest.artifacts[0]!.file), 'utf8')).toBe(
      'new',
    )
  })
  it('removes only its failed retry claim and never publishes the earlier attempt', () => {
    const result = run(['--grep', 'retry failed capture', '--retries=1'])
    expect(result.status).not.toBe(0)
    const { dir, manifest } = newest()
    expect(manifest.status).toBe('failed')
    expect(manifest.shots).toEqual([])
    expect(fs.existsSync(path.join(dir, 'shots/retry/retry-failed-shot.png'))).toBe(false)
  })
  it('keeps ownership through a CLI retries=2 override', () => {
    const result = run(['--grep', 'retry twice', '--retries=2'])
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const { manifest } = newest()
    expect(manifest.shots).toHaveLength(1)
    expect(manifest.shots[0]?.retry).toBe(2)
    expect(manifest.status).toBe('passed')
  })

  it('artifact MIME, path traversal and duplicate rejection preserve the first bytes', () => {
    const result = run(['--grep', 'data validation'])
    expect(result.status, result.stderr).toBe(0)
    const { dir, manifest } = newest()
    expect(manifest.artifacts).toHaveLength(2)
    expect(manifest.artifacts.find((entry) => entry.name === 'once.txt')).toMatchObject({
      name: 'once.txt',
      contentType: 'text/plain',
      bytes: 5,
    })
    expect(fs.readFileSync(path.join(dir, 'data/data/once.txt'), 'utf8')).toBe('first')
    expect(fs.readFileSync(path.join(dir, 'data/data/logs/network.json'), 'utf8')).toBe(
      '{"ok":true}',
    )
  })

  it('bare runner preserves a sentinel and --list succeeds', () => {
    const sentinel = path.join(fixture, 'test-results', 'sentinel.txt')
    fs.mkdirSync(path.dirname(sentinel), { recursive: true })
    fs.writeFileSync(sentinel, 'keep')
    try {
      const env = { ...process.env, CONTRACT_OUTPUT_DIR: out, SHOTWRIGHT_RUN: '0' }
      const bare = spawnSync(
        process.execPath,
        [
          path.join(root, 'node_modules/@playwright/test/cli.js'),
          'test',
          '-c',
          'shots.config.ts',
          '--grep',
          'same name',
        ],
        { cwd: fixture, env, encoding: 'utf8' },
      )
      expect(bare.status).not.toBe(0)
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep')
      const listed = spawnSync(
        process.execPath,
        [
          path.join(root, 'node_modules/@playwright/test/cli.js'),
          'test',
          '-c',
          'shots.config.ts',
          '--list',
        ],
        { cwd: fixture, env, encoding: 'utf8' },
      )
      expect(listed.status, listed.stderr).toBe(0)
    } finally {
      fs.rmSync(path.join(fixture, 'test-results'), { recursive: true, force: true })
    }
  })
})
