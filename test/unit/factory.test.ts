import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineShotsConfig } from '../../src/index.js'

afterEach(() => {
  vi.unstubAllEnvs()
  delete process.env.SHOTWRIGHT_RUN_DIR
  delete process.env.SHOTWRIGHT_CONFIG_PROBE_FILE
})

describe('defineShotsConfig', () => {
  it('sets the harness invariants', () => {
    const config = defineShotsConfig()
    expect(config.testDir).toBe('shots')
    expect(config.testMatch).toBe('**/*.shots.ts')
    expect(config.retries).toBe(0)
    expect(config.fullyParallel).toBe(true)
    expect(config.use?.screenshot).toBe('off')
    expect(config.use?.video).toBe('off')
    expect(config.use?.trace).toBe('off')
    const reporters = config.reporter as readonly (readonly [string, unknown?])[]
    expect(reporters[0]?.[0]).toBe('list')
    expect(String(reporters[1]?.[0])).toMatch(/reporter\.js$/)
  })

  it('use passthrough cannot override invariants, but its own keys survive', () => {
    const config = defineShotsConfig({
      use: { screenshot: 'on', baseURL: 'http://example.test' },
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
      defineShotsConfig({ outputDir: out })
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
      expect(fs.readFileSync(probeFile, 'utf8')).toBe(
        path.resolve(root, output ?? 'shots-output'),
      )
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
})
