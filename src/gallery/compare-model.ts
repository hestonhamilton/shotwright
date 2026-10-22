// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'

import type { ArtifactEntry } from '../manifest.js'
import { compareImages } from './pixels.js'
import {
  shotKey,
  validateRelativePath,
  type CompareModel,
  type CompareOptions,
  type ComparePairState,
  type CompareVerdict,
  type GalleryModel,
  type GalleryShot,
} from './model.js'

export interface ComparePair {
  key: string
  spec: string
  name: string
  kind: 'shot' | 'artifact'
  state: ComparePairState
  a: GalleryShot | ArtifactEntry | null
  b: GalleryShot | ArtifactEntry | null
  verdict: CompareVerdict | null
  diffText: string | null
  contentType: string | null
  error: string | null
  order: number
}

export interface GalleryCompareModel extends Omit<CompareModel, 'pairs'> {
  pairs: ComparePair[]
  options: CompareOptions
}

export const compareStates: ComparePairState[] = [
  'identical',
  'similar',
  'changed',
  'size-changed',
  'added',
  'removed',
  'unreadable',
]

export function comparePairOrder(a: ComparePair, b: ComparePair): number {
  const rank = (state: ComparePairState): number =>
    state === 'changed'
      ? 0
      : state === 'size-changed'
        ? 1
        : state === 'unreadable'
          ? 2
          : state === 'added' || state === 'removed'
            ? 3
            : 4
  return rank(a.state) - rank(b.state) || a.order - b.order
}

function bytes(runDir: string | undefined, file: string, dataUri?: string): Buffer {
  if (runDir) {
    const root = fs.realpathSync(runDir)
    let target = root
    for (const segment of validateRelativePath(file)) {
      target = path.join(target, segment)
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error('symlink reference')
    }
    if (!fs.statSync(target).isFile()) throw new Error('referenced path is not a file')
    return fs.readFileSync(target)
  }
  if (dataUri?.startsWith('data:image/png;base64,'))
    return Buffer.from(dataUri.slice('data:image/png;base64,'.length), 'base64')
  throw new Error('referenced file unavailable')
}

function textLike(mime: string): boolean {
  return (
    mime.toLowerCase().startsWith('text/') ||
    /^(application|text)\/(?:[\w.+-]*\+)?(?:json|jsonl)(?:;|$)/i.test(mime)
  )
}

function lines(value: Buffer, mime: string): string[] {
  const source = value.toString('utf8')
  if (/\bjson\b|\+json\b/i.test(mime)) {
    try {
      return JSON.stringify(JSON.parse(source), null, 2).split('\n')
    } catch {
      /* compare source */
    }
  }
  return source.split('\n')
}

function lineDiff(a: string[], b: string[]): string {
  const max = Math.max(a.length, b.length)
  const out: string[] = []
  let size = 0
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) {
      const line = `- ${a[i]}`
      out.push(line)
      size += line.length
    }
    if (b[i] !== undefined) {
      const line = `+ ${b[i]}`
      out.push(line)
      size += line.length
    }
    if (size > 262144) {
      out.push('… diff truncated')
      break
    }
  }
  return out.join('\n')
}

export function buildCompareModel(
  a: GalleryModel,
  b: GalleryModel,
  options: Partial<CompareOptions> & { aRunDir?: string; bRunDir?: string } = {},
): GalleryCompareModel {
  const opts = { threshold: options.threshold ?? 0.1, includeAA: options.includeAA ?? false }
  const pairs: ComparePair[] = []
  const assemble = <T extends GalleryShot | ArtifactEntry>(
    kind: 'shot' | 'artifact',
    left: T[],
    right: T[],
  ): void => {
    const identity = (entry: T): [string, string] =>
      kind === 'shot'
        ? [(entry as GalleryShot).entry.spec, (entry as GalleryShot).entry.name]
        : [(entry as ArtifactEntry).spec, (entry as ArtifactEntry).name]
    const aMap = new Map(left.map((entry) => [shotKey(...identity(entry)), entry]))
    const bMap = new Map(right.map((entry) => [shotKey(...identity(entry)), entry]))
    for (const key of new Set([...aMap.keys(), ...bMap.keys()])) {
      const x = aMap.get(key) ?? null,
        y = bMap.get(key) ?? null
      const [spec, name] = identity((x ?? y)!)
      const pair: ComparePair = {
        key,
        spec,
        name,
        kind,
        a: x,
        b: y,
        state: x === null ? 'added' : y === null ? 'removed' : 'unreadable',
        verdict: null,
        diffText: null,
        contentType: null,
        error: null,
        order: pairs.length,
      }
      if (x && y) {
        try {
          if (kind === 'shot') {
            const ax = x as GalleryShot,
              by = y as GalleryShot
            const verdict = compareImages(
              bytes(options.aRunDir, ax.entry.file, ax.image?.dataUri),
              bytes(options.bRunDir, by.entry.file, by.image?.dataUri),
              opts,
            )
            pair.verdict = verdict
            pair.state = verdict.state
            pair.error = verdict.error ?? null
          } else {
            const ax = x as ArtifactEntry,
              by = y as ArtifactEntry
            const aBytes = bytes(options.aRunDir, ax.file),
              bBytes = bytes(options.bRunDir, by.file)
            pair.contentType = by.contentType
            if (textLike(ax.contentType) && textLike(by.contentType)) {
              pair.diffText = lineDiff(lines(aBytes, ax.contentType), lines(bBytes, by.contentType))
              pair.state = pair.diffText ? 'changed' : 'identical'
            } else pair.state = aBytes.equals(bBytes) ? 'identical' : 'changed'
          }
        } catch (error) {
          pair.error = error instanceof Error ? error.message : String(error)
          pair.state = 'unreadable'
        }
      }
      pairs.push(pair)
    }
  }
  assemble(
    'shot',
    a.specs.flatMap((spec) => spec.shots),
    b.specs.flatMap((spec) => spec.shots),
  )
  assemble('artifact', a.manifest.artifacts, b.manifest.artifacts)
  pairs.sort(comparePairOrder)
  const counts = Object.fromEntries(
    compareStates.map((state) => [state, pairs.filter((pair) => pair.state === state).length]),
  ) as Record<ComparePairState, number>
  return { a, b, pairs, counts, diagnostics: [...a.diagnostics, ...b.diagnostics], options: opts }
}
