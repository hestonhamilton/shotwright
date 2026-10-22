// SPDX-License-Identifier: AGPL-3.0-or-later
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { pngStructureReason, type CompareOptions, type CompareVerdict } from './model.js'

/**
 * A reviewer-facing reason for a PNG the decoder rejected. A structural defect
 * gets the same reason the gallery placeholder shows for that file
 * ({@link pngStructureReason}), so a compare pair describes it one way. Only a
 * structurally sound file the decoder still rejects (bad compressed data, an
 * unsupported format) falls back to classifying pngjs's message, whose
 * stream-level text ("There are some read requests waitng on finished stream")
 * says nothing about the file; the raw text is kept separately as the detail.
 */
export function pngDecodeReason(bytes: Buffer, raw: string): string {
  const structural = pngStructureReason(bytes)
  if (structural !== null) return structural
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
