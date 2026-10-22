// SPDX-License-Identifier: AGPL-3.0-or-later
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { CompareOptions, CompareVerdict } from './model.js'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * A reviewer-facing reason for a PNG the decoder rejected. pngjs reports
 * stream-level errors ("There are some read requests waitng on finished
 * stream") that say nothing about the file; the raw text is kept separately as
 * the detail.
 */
export function pngDecodeReason(bytes: Buffer, raw: string): string {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    return 'not a PNG file (missing PNG signature)'
  if (/crc/i.test(raw)) return 'corrupt chunk (CRC mismatch)'
  if (/waiti?ng on finished stream|unexpected end/i.test(raw))
    return 'truncated PNG (data ends early)'
  if (/unrecognised content at end of stream/i.test(raw))
    return 'corrupt or trailing data after the image'
  return 'the PNG decoder rejected the file'
}

export interface ImageComparison {
  verdict: CompareVerdict
  /** Raw decoder messages, `A: …; B: …`, when a side was unreadable. */
  errorDetail: string | null
}

export function compareImageFiles(
  aPng: Buffer,
  bPng: Buffer,
  opts: CompareOptions,
  paths: { a?: string; b?: string } = {},
): ImageComparison {
  const decoded: Partial<Record<'A' | 'B', PNG>> = {}
  const messages: string[] = [],
    details: string[] = []
  for (const [side, bytes, file] of [
    ['A', aPng, paths.a],
    ['B', bPng, paths.b],
  ] as const) {
    try {
      decoded[side] = PNG.sync.read(bytes)
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      messages.push(
        `${side}: unreadable PNG${file === undefined ? '' : ` (${file})`}: ${pngDecodeReason(bytes, raw)}`,
      )
      details.push(`${side}: ${raw}`)
    }
  }
  const a = decoded.A,
    b = decoded.B
  if (!a || !b)
    return {
      verdict: {
        state: 'unreadable',
        differentPixels: null,
        totalPixels: null,
        ratio: null,
        aSize: null,
        bSize: null,
        diffPng: null,
        error: messages.join('; '),
      },
      errorDetail: details.join('; '),
    }
  return { verdict: compareDecoded(a, b, opts), errorDetail: null }
}

function compareDecoded(a: PNG, b: PNG, opts: CompareOptions): CompareVerdict {
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

export const compareImages: typeof import('./model.js').compareImages = (
  aPng: Buffer,
  bPng: Buffer,
  opts: CompareOptions,
): CompareVerdict => compareImageFiles(aPng, bPng, opts).verdict
