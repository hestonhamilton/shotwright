import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { executableForPid, observeBrowser, runEnvironment } from '../../src/provenance.js'
import {
  assembleManifest,
  type AssembleInput,
  type BrowserObservation,
  type ShotSidecar,
} from '../../src/manifest.js'
import { validateManifest } from '../../src/gallery/model.js'

const linux = process.platform === 'linux'
const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const cacheRoot = () => path.dirname(path.dirname(path.dirname(chromium.executablePath())))

async function managedShellPath(): Promise<string> {
  const browser = await chromium.launch()
  try {
    const executable = (await observeBrowser(browser, null)).executable
    expect(executable).toMatchObject({
      kind: 'managed',
      path: expect.stringMatching(
        /^chromium_headless_shell-\d+\/chrome-headless-shell[^/]*\/chrome-headless-shell$/,
      ),
    })
    return path.join(cacheRoot(), executable!.path)
  } finally {
    await browser.close()
  }
}

describe('observed browser provenance', () => {
  it.skipIf(!linux)(
    'identifies the running managed headless shell, not the full Chromium proxy',
    async () => {
      const browser = await chromium.launch()
      try {
        const observed = await observeBrowser(browser, null)
        expect(observed.name).toBe('chromium')
        expect(observed.version).toBe(browser.version())
        expect(observed.executable?.kind).toBe('managed')
        expect(observed.executable?.path).toContain('chrome-headless-shell')
        expect(observed.executable?.path).not.toContain('/chrome-linux/')
        const cache = cacheRoot()
        expect(observed.executable?.sha256).toBe(
          digest(path.join(cache, observed.executable!.path)),
        )
      } finally {
        await browser.close()
      }
    },
  )

  it.skipIf(!linux || !process.env.DISPLAY || !fs.existsSync(chromium.executablePath()))(
    'identifies headed Chromium under a display (requires a display and full Chromium)',
    async () => {
      const browser = await chromium.launch({ headless: false })
      try {
        const observed = await observeBrowser(browser, null)
        expect(observed.executable?.kind).toBe('managed')
        expect(observed.executable?.path).toMatch(/chrome-linux.*\/chrome$/)
      } finally {
        await browser.close()
      }
    },
  )

  it.skipIf(!linux)('classifies a cache-selected binary by location across two PIDs', async () => {
    const executablePath = await managedShellPath()
    const [a, b] = await Promise.all([chromium.launch(), chromium.launch({ executablePath })])
    try {
      const [first, second] = await Promise.all([observeBrowser(a, null), observeBrowser(b, null)])
      expect(first.executable?.kind).toBe('managed')
      expect(second.executable).toMatchObject({
        kind: 'managed',
        path: expect.stringMatching(
          /^chromium_headless_shell-\d+\/chrome-headless-shell[^/]*\/chrome-headless-shell$/,
        ),
      })
      expect(second.executable).toEqual(first.executable)
    } finally {
      await Promise.all([a.close(), b.close()])
    }
  })

  it.skipIf(!linux)(
    'classifies an explicit executable outside the cache as overridden',
    async () => {
      const source = await managedShellPath()
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-provenance-'))
      try {
        // A symlinked executable resolves back into the cache through /proc/<pid>/exe.
        // Copy the binary, but link its sibling resources to keep setup small.
        for (const entry of fs.readdirSync(path.dirname(source))) {
          const from = path.join(path.dirname(source), entry)
          const to = path.join(temporary, entry)
          if (entry === path.basename(source))
            fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE)
          else fs.symlinkSync(from, to, fs.statSync(from).isDirectory() ? 'dir' : 'file')
        }
        const browser = await chromium.launch({
          executablePath: path.join(temporary, path.basename(source)),
        })
        try {
          const observed = await observeBrowser(browser, 'chrome')
          expect(observed.channel).toBe('chrome')
          expect(observed.executable?.kind).toBe('overridden')
          expect(observed.executable?.path).toBe('chrome-headless-shell')
          expect(observed.executable?.sha256).toBe(digest(source))
        } finally {
          await browser.close()
        }
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true })
      }
    },
    60_000,
  )

  it.skipIf(!linux)('honors a configured cache root including the special zero path', async () => {
    const browser = await chromium.launch()
    const prior = process.env.PLAYWRIGHT_BROWSERS_PATH
    const cache = cacheRoot()
    const require = createRequire(import.meta.resolve('@playwright/test'))
    const local = path.join(
      path.dirname(require.resolve('playwright-core/package.json')),
      '.local-browsers',
    )
    const created = !fs.existsSync(local)
    try {
      process.env.PLAYWRIGHT_BROWSERS_PATH = cache
      expect((await observeBrowser(browser, null)).executable?.kind).toBe('managed')
      if (created) fs.symlinkSync(cache, local, 'dir')
      process.env.PLAYWRIGHT_BROWSERS_PATH = '0'
      expect((await observeBrowser(browser, null)).executable?.kind).toBe('managed')
    } finally {
      if (created) fs.rmSync(local, { force: true })
      if (prior === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
      else process.env.PLAYWRIGHT_BROWSERS_PATH = prior
      await browser.close()
    }
  })

  it.skipIf(!linux)('returns unavailable for dead and foreign PIDs and empty CDP', async () => {
    expect(await executableForPid(99999999)).toBeNull()
    expect(await executableForPid(process.pid)).toBeNull()
    const browser = await chromium.launch()
    try {
      const fake = {
        browserType: () => ({ name: () => 'chromium' }),
        version: () => browser.version(),
        _connection: { isRemote: () => false },
        newBrowserCDPSession: async () => ({
          send: async () => ({ processInfo: [] }),
          detach: async () => {},
        }),
      } as unknown as Browser
      expect((await observeBrowser(fake, null)).executable).toBeNull()
      const remote = { ...fake, _connection: { isRemote: () => true } } as Browser
      expect((await observeBrowser(remote, null)).executable).toBeNull()
      const throwing = {
        ...fake,
        _connection: {
          isRemote: () => {
            throw new Error('broken')
          },
        },
      } as Browser
      expect(await observeBrowser(throwing, null)).toEqual({
        name: null,
        version: null,
        channel: null,
        executable: null,
      })
    } finally {
      await browser.close()
    }
  })

  it('accepts only distribution ID and VERSION_ID', () => {
    const environment = runEnvironment()
    expect(Object.keys(environment)).toEqual(['platform', 'distribution'])
    if (environment.distribution)
      expect(Object.keys(environment.distribution)).toEqual(['id', 'versionId'])
  })
})

function sidecar(testId: string, browser: BrowserObservation): ShotSidecar {
  return {
    kind: 'shot',
    testId,
    browser,
    name: testId,
    spec: 'flow.shots.ts',
    file: `shots/flow/${testId}.png`,
    viewport: null,
    deviceScaleFactor: null,
    fullPage: true,
    capturedAt: '2026-10-26T00:00:00.000Z',
    durationMs: 1,
    checked: false,
    retry: 0,
  }
}

it('aggregates per captured project, nulls conflicts, and validates optional v2 fields', () => {
  const browser: BrowserObservation = {
    name: 'chromium',
    version: '156.0',
    channel: null,
    executable: null,
  }
  const input: AssembleInput = {
    runId: 'run',
    startedAt: '2026-10-26T00:00:00.000Z',
    finishedAt: '2026-10-26T00:00:01.000Z',
    shotwrightVersion: '0.2.0',
    playwrightVersion: '1.64.1',
    flags: { only: [], video: false, trace: false },
    status: 'passed',
    publication: { gallery: { ok: true }, evidence: { ok: true } },
    tests: ['a', 'b', 'c'].map((id) => ({
      id,
      title: id,
      spec: 'flow.shots.ts',
      project: id === 'c' ? 'z' : 'a',
      status: 'passed' as const,
      retry: 0,
      durationMs: 1,
    })),
    failures: [],
    sidecars: [
      sidecar('a', browser),
      sidecar('b', { ...browser, version: '157.0' }),
      sidecar('c', browser),
    ],
    artifacts: new Map(),
    runDir: 'unused',
    environment: { platform: 'linux', distribution: { id: 'ubuntu', versionId: '24.04' } },
  }
  const manifest = assembleManifest(input)
  expect(manifest.shots.every((shot) => !Object.hasOwn(shot, 'browser'))).toBe(true)
  expect(manifest.browsers).toEqual([
    { project: 'a', name: 'chromium', version: null, channel: null, executable: null },
    { project: 'z', ...browser },
  ])
  expect(validateManifest(manifest).environment).toEqual(input.environment)
  const old = { ...manifest, environment: undefined, browsers: undefined }
  expect(validateManifest(old).environment).toBeNull()
  expect(validateManifest(old).browsers).toEqual([])
  expect(() =>
    validateManifest({
      ...manifest,
      browsers: [
        {
          ...manifest.browsers![0],
          executable: { kind: 'managed', path: '../browser', sha256: '0'.repeat(64) },
        },
      ],
    }),
  ).toThrow(/browsers/)
  expect(() =>
    validateManifest({
      ...manifest,
      environment: { platform: 'linux', distribution: { id: 'ubuntu', versionId: '../private' } },
    }),
  ).toThrow(/environment/)
})
