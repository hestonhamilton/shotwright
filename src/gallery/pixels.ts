// SPDX-License-Identifier: AGPL-3.0-or-later
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { CompareOptions, CompareVerdict } from './model.js'

export const compareImages: typeof import('./model.js').compareImages = (
  aPng: Buffer,
  bPng: Buffer,
  opts: CompareOptions,
): CompareVerdict => {
  let a: PNG, b: PNG
  try {
    a = PNG.sync.read(aPng)
    b = PNG.sync.read(bPng)
  } catch (error) {
    return {
      state: 'unreadable',
      differentPixels: null,
      totalPixels: null,
      ratio: null,
      aSize: null,
      bSize: null,
      diffPng: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const aSize = { width: a.width, height: a.height },
    bSize = { width: b.width, height: b.height }
  if (a.width !== b.width || a.height !== b.height)
    return {
      state: 'size-changed',
      differentPixels: null,
      totalPixels: null,
      ratio: null,
      aSize,
      bSize,
      diffPng: null,
    }
  const totalPixels = a.width * a.height
  if (a.data.equals(b.data))
    return {
      state: 'identical',
      differentPixels: 0,
      totalPixels,
      ratio: 0,
      aSize,
      bSize,
      diffPng: null,
    }
  const diff = new PNG({ width: a.width, height: a.height })
  const differentPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: opts.threshold,
    includeAA: opts.includeAA,
  })
  return {
    state: differentPixels === 0 ? 'similar' : 'changed',
    differentPixels,
    totalPixels,
    ratio: differentPixels / totalPixels,
    aSize,
    bSize,
    diffPng: differentPixels === 0 ? null : PNG.sync.write(diff),
  }
}
