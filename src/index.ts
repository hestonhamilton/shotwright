// shotwright — public entry: the Playwright config factory.
//
// defineShotsConfig() wraps the consumer's defineConfig (peer resolution guarantees
// a single @playwright/test instance) and hard-sets the harness invariants; the
// consumer passes only its webServer and deltas. Run-dir creation happens here at
// config-eval time in the main process (workers inherit SHOTWRIGHT_RUN_DIR via env)
// and only under `shotwright run` (SHOTWRIGHT_RUN=1) so stray config evals (IDE
// integrations, --list) don't litter empty run dirs.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'
import type { PlaywrightTestConfig } from '@playwright/test'

import { createRunDir } from './runs.js'

export type { Manifest, ShotEntry, Viewport } from './manifest.js'

let configProbeCounter = 0

export interface ShotsConfigOptions {
  /** Spec directory (relative to the config file). Default: 'shots'. */
  shotsDir?: string
  /** Where run directories are created (relative to cwd). Default: 'shots-output'. */
  outputDir?: string
  /** Default project viewport. Default: 1440×960. */
  viewport?: { width: number; height: number }
  /** Default project device scale factor. Default: 2. */
  deviceScaleFactor?: number
  /** Passthrough `use` (e.g. baseURL, the executablePath escape hatch). Harness invariants win. */
  use?: PlaywrightTestConfig['use']
  /** Passthrough, untouched — shotwright is stack-agnostic. */
  webServer?: PlaywrightTestConfig['webServer']
  /** Replaces the default single 'shots' Desktop Chrome project. */
  projects?: PlaywrightTestConfig['projects']
}

export function defineShotsConfig(opts: ShotsConfigOptions = {}): PlaywrightTestConfig {
  const outputDir = path.resolve(opts.outputDir ?? 'shots-output')
  const probeFile = process.env.SHOTWRIGHT_CONFIG_PROBE_FILE
  if (probeFile) {
    const tempFile = `${probeFile}.${process.pid}-${++configProbeCounter}.tmp`
    try {
      fs.writeFileSync(tempFile, outputDir, { flag: 'wx' })
      fs.renameSync(tempFile, probeFile)
    } finally {
      fs.rmSync(tempFile, { force: true })
    }
    return defineConfig({
      testDir: opts.shotsDir ?? 'shots',
      testMatch: [],
    })
  }
  if (process.env.SHOTWRIGHT_RUN === '1' && !process.env.SHOTWRIGHT_RUN_DIR) {
    process.env.SHOTWRIGHT_RUN_DIR = createRunDir(outputDir).runDir
  }
  const runDir = process.env.SHOTWRIGHT_RUN_DIR

  const config: PlaywrightTestConfig = {
    testDir: opts.shotsDir ?? 'shots',
    testMatch: '**/*.shots.ts',
    fullyParallel: true,
    retries: 0,
    reporter: [['list'], [fileURLToPath(new URL('./reporter.js', import.meta.url))]],
    use: {
      ...opts.use,
      screenshot: 'off',
      video: process.env.SHOTWRIGHT_VIDEO === '1' ? 'on' : 'off',
      trace: process.env.SHOTWRIGHT_TRACE === '1' ? 'on' : 'off',
    },
    projects: opts.projects ?? [
      {
        name: 'shots',
        use: {
          ...devices['Desktop Chrome'],
          viewport: opts.viewport ?? { width: 1440, height: 960 },
          deviceScaleFactor: opts.deviceScaleFactor ?? 2,
        },
      },
    ],
  }
  // Playwright's own staging (raw videos/traces) lives inside the run dir and is
  // swept by the reporter after it copies artifacts into the contract layout.
  if (runDir) config.outputDir = path.join(runDir, '.pw')
  if (opts.webServer) config.webServer = opts.webServer
  return defineConfig(config)
}
