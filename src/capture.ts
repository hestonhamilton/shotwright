// In-spec capture API — public as 'shotwright/capture'.
//
// shot() writes the PNG into the run layout and records a manifest sidecar; the
// shotwright reporter assembles sidecars into manifest.json at run end. Requires
// SHOTWRIGHT_RUN_DIR (set by `shotwright run` via the config factory) — bare
// `playwright test` runs are unsupported in v1.

import fs from 'node:fs'
import path from 'node:path'

import { test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { parseOnly, shouldCapture } from './filter.js'
import { writeSidecar } from './manifest.js'

export { parseOnly, shouldCapture }

/** Alias of the consumer's `test` — specs read as walkthroughs, not assertions. */
export const walkthrough = test

export interface ShotOptions {
  /** Full-page capture. Default: true, unless `clip` or `locator` is given. */
  fullPage?: boolean
  clip?: { x: number; y: number; width: number; height: number }
  /** Capture this element instead of the page. */
  locator?: Locator
}

function unsafePathReason(value: string): string | null {
  if (value === '') return 'is empty'
  if (value.includes('\0')) return 'contains a NUL byte'
  if (value.includes('\\')) return 'contains a backslash'
  return null
}

/** A shot name is one file-name segment: no separators, no `.`/`..`, no NUL. */
export function validateShotName(name: string): void {
  const reason =
    unsafePathReason(name) ??
    (name.includes('/') ? 'contains a slash' : null) ??
    (name === '.' || name === '..' ? 'is a relative path segment' : null)
  if (reason !== null) {
    throw new Error(`shotwright: invalid shot name ${JSON.stringify(name)} — it ${reason}`)
  }
}

/** A spec path is relative to testDir and must stay inside it once joined under `shots/`. */
export function validateSpecPath(spec: string): void {
  const reason =
    unsafePathReason(spec) ??
    (spec.startsWith('/') ? 'is absolute' : null) ??
    (spec.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      ? 'has an empty, "." or ".." path segment'
      : null)
  if (reason !== null) {
    throw new Error(`shotwright: invalid spec path ${JSON.stringify(spec)} — it ${reason}`)
  }
}

/** Capture `<runDir>/shots/<spec>/<name>.png` and record its manifest sidecar. */
export async function shot(page: Page, name: string, opts: ShotOptions = {}): Promise<void> {
  const runDir = process.env.SHOTWRIGHT_RUN_DIR
  if (!runDir) {
    throw new Error(
      'shotwright: SHOTWRIGHT_RUN_DIR is not set — run specs via `shotwright run` ' +
        '(bare `playwright test` runs are not supported)',
    )
  }
  validateShotName(name)
  if (!shouldCapture(name, parseOnly(process.env.SHOTWRIGHT_ONLY))) return

  const info = test.info()
  const spec = path.relative(info.project.testDir, info.file).split(path.sep).join('/')
  validateSpecPath(spec)
  const file = `shots/${spec}/${name}.png`
  const abs = path.join(runDir, file)
  fs.mkdirSync(path.dirname(abs), { recursive: true })

  const fullPage = opts.fullPage ?? (opts.clip === undefined && opts.locator === undefined)
  const started = Date.now()
  if (opts.locator) {
    await opts.locator.screenshot({ path: abs })
  } else {
    await page.screenshot({ path: abs, fullPage, ...(opts.clip ? { clip: opts.clip } : {}) })
  }

  writeSidecar(runDir, {
    name,
    spec,
    file,
    viewport: page.viewportSize(),
    deviceScaleFactor: (info.project.use.deviceScaleFactor as number | undefined) ?? null,
    fullPage,
    capturedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    testId: info.testId,
  })
  console.log(`shot ${name}`)
}
