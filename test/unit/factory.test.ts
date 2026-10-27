import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defineShotsConfig } from '../../src/index.js'

import type { ShotsConfigOptions } from '../../src/index.js'

afterEach(() => {
  vi.unstubAllEnvs()
  delete process.env.SHOTWRIGHT_RUN_DIR
  delete process.env.SHOTWRIGHT_CONFIG_PROBE_FILE
})

describe('defineShotsConfig', () => {
  beforeEach(() => {
    vi.stubEnv('SHOTWRIGHT_RUN', '1')
  })
  it('passes setup, workers, expect and project use while enforcing owned capture keys', () => {
    const options: ShotsConfigOptions = {
      globalSetup: './setup.ts',
      workers: 1,
      expect: { timeout: 1234 },
      forbidOnly: true,
      globalTeardown: './t.ts',
      projects: [
        {
          name: 'custom',
          use: { baseURL: 'http://example.test', video: 'on', trace: 'on', screenshot: 'on' },
        },
      ],
    }
    const rejectedOwnedUse: ShotsConfigOptions = {
      use: {
        // @ts-expect-error trace is harness-owned
        trace: 'on',
      },
    }
    void rejectedOwnedUse
    const config = defineShotsConfig(options)
    expect(config.globalSetup).toBe('./setup.ts')
    expect(config.workers).toBe(1)
    expect(config.expect?.timeout).toBe(1234)
    expect(config.forbidOnly).toBe(true)
    expect(config.globalTeardown).toBe('./t.ts')
    expect(config.projects?.[0]?.use).toMatchObject({
      baseURL: 'http://example.test',
      video: 'off',
      trace: 'off',
      screenshot: 'off',
    })
    expect(config.reporter).toBeDefined()
  })
  it('preserves consumer launch arguments and executable overrides exactly', () => {
    const launchOptions = { args: ['--disable-features=Translate'], executablePath: 'browser-bin' }
    const config = defineShotsConfig({
      use: { launchOptions },
      projects: [{ name: 'one', use: { launchOptions, channel: 'chrome' } }],
    })
    expect(config.use?.launchOptions).toEqual(launchOptions)
    expect(config.projects?.[0]?.use?.launchOptions).toEqual(launchOptions)
    expect(defineShotsConfig().use?.launchOptions).toBeUndefined()
    expect(defineShotsConfig().projects?.[0]?.use?.launchOptions).toBeUndefined()
  })
  it.each([
    [{ viewport: { width: 800, height: 600 } }, /shotwright: viewport.*project\.use/],
    [{ deviceScaleFactor: 1 }, /shotwright: deviceScaleFactor.*project\.use/],
    [
      { viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 },
      /shotwright: viewport and deviceScaleFactor.*project\.use/,
    ],
  ])(
    'rejects explicit projects with top-level device settings before creating a run',
    (device, error) => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-conflict-'))
      try {
        expect(() =>
          defineShotsConfig({ outputDir: out, projects: [{ name: 'mobile' }], ...device }),
        ).toThrow(error)
        expect(process.env.SHOTWRIGHT_RUN_DIR).toBeUndefined()
        expect(fs.readdirSync(out)).toEqual([])
      } finally {
        fs.rmSync(out, { recursive: true, force: true })
      }
    },
  )

  it('preserves explicit project use and project grep, plus top-level grep filters', () => {
    const config = defineShotsConfig({
      grep: /safe/,
      grepInvert: /blocked/,
      projects: [
        {
          name: 'mobile',
          grep: /mobile-safe/,
          grepInvert: /mobile-blocked/,
          use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
        },
      ],
    })
    expect(config.grep).toEqual(/safe/)
    expect(config.grepInvert).toEqual(/blocked/)
    expect(config.projects?.[0]?.grep).toEqual(/mobile-safe/)
    expect(config.projects?.[0]?.grepInvert).toEqual(/mobile-blocked/)
    expect(config.projects?.[0]?.use).toMatchObject({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
    })
  })

  it('sets default-project device values above values carried by global use', () => {
    const config = defineShotsConfig({
      use: { viewport: { width: 320, height: 480 }, deviceScaleFactor: 1 },
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    })
    expect(config.use?.viewport).toEqual({ width: 320, height: 480 })
    expect(config.use?.deviceScaleFactor).toBe(1)
    expect(config.projects?.[0]?.use?.viewport).toEqual({ width: 1280, height: 720 })
    expect(config.projects?.[0]?.use?.deviceScaleFactor).toBe(2)
  })
  it('guard refuses bare config evaluation before run directory creation', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-guard-'))
    try {
      vi.stubEnv('SHOTWRIGHT_RUN', '0')
      expect(() => defineShotsConfig({ outputDir: out })).toThrow(/shotwright run/)
      expect(fs.readdirSync(out)).toEqual([])
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  })

  it('sets the harness invariants', () => {
    const config = defineShotsConfig()
    expect(config.testDir).toBe('shots')
    expect(config.testMatch).toBe('**/*.shots.ts')
    expect(config.retries).toBe(0)
    expect(config.fullyParallel).toBe(false)
    expect(config.use?.screenshot).toBe('off')
    expect(config.use?.video).toBe('off')
    expect(config.use?.trace).toBe('off')
    const reporters = config.reporter as readonly (readonly [string, unknown?])[]
    expect(reporters[0]?.[0]).toBe('list')
    expect(String(reporters[1]?.[0])).toMatch(/reporter\.js$/)
  })

  it('use passthrough cannot override invariants, but its own keys survive', () => {
    const config = defineShotsConfig({
      use: {
        screenshot: 'on',
        baseURL: 'http://example.test',
      } as unknown as ShotsConfigOptions['use'],
    })
    expect(config.use?.screenshot).toBe('off')
    expect(config.use?.baseURL).toBe('http://example.test')
  })

  it('passes webServer through untouched', () => {
    const webServer = { command: 'node demo/serve.mjs', url: 'http://127.0.0.1:4173/' }
    const config = defineShotsConfig({ webServer })
    expect(config.webServer).toEqual(webServer)
  })

  it('defaults the single shots project with viewport 1440×960 @2x', () => {
    const projects = defineShotsConfig().projects!
    expect(projects).toHaveLength(1)
    expect(projects[0]?.name).toBe('shots')
    expect(projects[0]?.use?.viewport).toEqual({ width: 1440, height: 960 })
    expect(projects[0]?.use?.deviceScaleFactor).toBe(2)
  })

  it('env toggles flip video/trace at config-eval time', () => {
    vi.stubEnv('SHOTWRIGHT_VIDEO', '1')
    vi.stubEnv('SHOTWRIGHT_TRACE', '1')
    const config = defineShotsConfig()
    expect(config.use?.video).toBe('on')
    expect(config.use?.trace).toBe('on')
  })

  it('creates the run dir only under SHOTWRIGHT_RUN=1 and exports it via env', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-factory-'))
    try {
      vi.stubEnv('SHOTWRIGHT_RUN', '0')
      expect(() => defineShotsConfig({ outputDir: out })).toThrow(/shotwright run/)
      expect(process.env.SHOTWRIGHT_RUN_DIR).toBeUndefined()
      expect(fs.readdirSync(out)).toEqual([])

      vi.stubEnv('SHOTWRIGHT_RUN', '1')
      const config = defineShotsConfig({ outputDir: out })
      const runDir = process.env.SHOTWRIGHT_RUN_DIR
      expect(runDir).toBeDefined()
      expect(path.dirname(runDir!)).toBe(out)
      expect(fs.statSync(runDir!).isDirectory()).toBe(true)
      expect(config.outputDir).toBe(path.join(runDir!, '.pw'))

      // A second eval (worker process re-eval) reuses the same run dir.
      defineShotsConfig({ outputDir: out })
      expect(process.env.SHOTWRIGHT_RUN_DIR).toBe(runDir)
      expect(fs.readdirSync(out).filter((f) => f !== 'latest')).toHaveLength(1)
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  })

  it.each([
    ['default', undefined],
    ['custom', 'custom-output'],
  ])('probe mode writes the canonical %s outputDir with no run side effects', (_label, output) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-factory-probe-'))
    const probeFile = path.join(root, 'probe-output')
    const priorCwd = process.cwd()
    try {
      process.chdir(root)
      vi.stubEnv('SHOTWRIGHT_RUN', '1')
      vi.stubEnv('SHOTWRIGHT_CONFIG_PROBE_FILE', probeFile)
      const config = defineShotsConfig({
        outputDir: output,
        webServer: { command: 'must-not-run', port: 9999 },
      })
      expect(fs.readFileSync(probeFile, 'utf8')).toBe(path.resolve(root, output ?? 'shots-output'))
      expect(config.testMatch).toEqual([])
      expect(config.webServer).toBeUndefined()
      expect(config.reporter).toBeUndefined()
      expect(config.outputDir).toBeUndefined()
      expect(process.env.SHOTWRIGHT_RUN_DIR).toBeUndefined()
      expect(fs.readdirSync(root)).toEqual(['probe-output'])
    } finally {
      process.chdir(priorCwd)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('probes a conflicting config without allocating a run', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-conflict-probe-'))
    const probeFile = path.join(root, 'probe-output')
    try {
      vi.stubEnv('SHOTWRIGHT_CONFIG_PROBE_FILE', probeFile)
      expect(() =>
        defineShotsConfig({
          outputDir: path.join(root, 'runs'),
          projects: [{ name: 'mobile' }],
          viewport: { width: 800, height: 600 },
          deviceScaleFactor: 1,
        }),
      ).not.toThrow()
      expect(fs.readFileSync(probeFile, 'utf8')).toBe(path.join(root, 'runs'))
      expect(process.env.SHOTWRIGHT_RUN_DIR).toBeUndefined()
      expect(fs.readdirSync(root)).toEqual(['probe-output'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
