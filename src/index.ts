// SPDX-License-Identifier: AGPL-3.0-or-later
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

export type HarnessOwnedKeys = 'testDir' | 'testMatch' | 'retries' | 'reporter' | 'outputDir'
export type ShotsConfigOptions = Omit<PlaywrightTestConfig, HarnessOwnedKeys | 'use'> & {
  shotsDir?: string
  outputDir?: string
  viewport?: { width: number; height: number }
  deviceScaleFactor?: number
  use?: Omit<NonNullable<PlaywrightTestConfig['use']>, 'screenshot' | 'video' | 'trace'>
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
  if (process.env.SHOTWRIGHT_RUN !== '1' && !process.argv.includes('--list')) {
    throw new Error('shotwright: use `shotwright run` to execute capture specs')
  }
  if (process.env.SHOTWRIGHT_RUN === '1' && !process.env.SHOTWRIGHT_RUN_DIR) {
    process.env.SHOTWRIGHT_RUN_DIR = createRunDir(outputDir).runDir
    const runDirFile = process.env.SHOTWRIGHT_RUN_DIR_FILE
    if (runDirFile) {
      const temp = `${runDirFile}.${process.pid}.tmp`
      try {
        fs.writeFileSync(temp, process.env.SHOTWRIGHT_RUN_DIR)
        fs.renameSync(temp, runDirFile)
      } finally {
        fs.rmSync(temp, { force: true })
      }
    }
  }
  const runDir = process.env.SHOTWRIGHT_RUN_DIR

  const config: PlaywrightTestConfig = {
    ...opts,
    testDir: opts.shotsDir ?? 'shots',
    testMatch: '**/*.shots.ts',
    fullyParallel: opts.fullyParallel ?? false,
    retries: 0,
    reporter: [['list'], [fileURLToPath(new URL('./reporter.js', import.meta.url))]],
    use: {
      ...opts.use,
      screenshot: 'off',
      video: process.env.SHOTWRIGHT_VIDEO === '1' ? 'on' : 'off',
      trace: process.env.SHOTWRIGHT_TRACE === '1' ? 'on' : 'off',
    },
    projects: opts.projects?.map((project) => ({
      ...project,
      use: {
        ...project.use,
        screenshot: 'off',
        video: process.env.SHOTWRIGHT_VIDEO === '1' ? 'on' : 'off',
        trace: process.env.SHOTWRIGHT_TRACE === '1' ? 'on' : 'off',
      },
    })) ?? [
      {
        name: 'shots',
        use: {
          ...devices['Desktop Chrome'],
          viewport: opts.viewport ?? { width: 1440, height: 960 },
          deviceScaleFactor: opts.deviceScaleFactor ?? 2,
          screenshot: 'off',
          video: process.env.SHOTWRIGHT_VIDEO === '1' ? 'on' : 'off',
          trace: process.env.SHOTWRIGHT_TRACE === '1' ? 'on' : 'off',
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
