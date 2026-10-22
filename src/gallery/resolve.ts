// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'
import { listRuns } from '../runs.js'

export interface ResolvedGalleryRun {
  outputDir: string
  runDir: string
  runId: string
  selectedViaLatest: boolean
  selectedViaLast?: boolean
}

export interface ResolvedCompareRuns {
  outputDir: string
  a: ResolvedGalleryRun
  b: ResolvedGalleryRun
}

function realDirectory(value: string, label: string): string {
  let canonical: string
  try {
    canonical = fs.realpathSync(value)
  } catch {
    throw new Error(`shotwright gallery: ${label} is missing or unreadable: ${value}`)
  }
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error(`shotwright gallery: ${label} is not a directory: ${value}`)
  }
  return canonical
}

function isImmediateChild(parent: string, child: string): boolean {
  return path.dirname(child) === parent && path.basename(child) !== ''
}

export function validateRunId(runId: string): void {
  if (
    runId.length === 0 ||
    runId.includes('\0') ||
    runId.includes('/') ||
    runId.includes('\\') ||
    runId.includes('.') ||
    runId.includes('%') ||
    path.isAbsolute(runId) ||
    path.basename(runId) !== runId
  ) {
    throw new Error('shotwright gallery: run-id must be a single run directory basename')
  }
}

export function resolveGalleryRun(
  outputDir: string,
  explicitRunId: string | null,
): ResolvedGalleryRun {
  const canonicalOutput = realDirectory(outputDir, 'output directory')
  let candidate: string

  if (explicitRunId === '--last') {
    const newest = listRuns(canonicalOutput).find((run) => run.status !== 'incomplete')
    if (!newest) throw new Error('shotwright gallery: no run with a manifest for --last')
    candidate = newest.runDir
  } else if (explicitRunId === null) {
    candidate = path.join(canonicalOutput, 'latest')
    let latest: fs.Stats
    try {
      latest = fs.lstatSync(candidate)
    } catch {
      throw new Error(
        'shotwright gallery: latest is missing — run `shotwright run` successfully or pass a run-id',
      )
    }
    if (!latest.isSymbolicLink()) {
      throw new Error('shotwright gallery: latest must be a symlink to a completed run')
    }
  } else {
    validateRunId(explicitRunId)
    candidate = path.join(canonicalOutput, explicitRunId)
  }

  const canonicalRun = realDirectory(
    candidate,
    explicitRunId === null ? 'latest run' : `run "${explicitRunId}"`,
  )
  if (!isImmediateChild(canonicalOutput, canonicalRun)) {
    throw new Error('shotwright gallery: selected run escapes the output directory')
  }

  return {
    outputDir: canonicalOutput,
    runDir: canonicalRun,
    runId: path.basename(canonicalRun),
    selectedViaLatest: explicitRunId === null,
    ...(explicitRunId === '--last' ? { selectedViaLast: true } : {}),
  }
}

function containsSymlink(value: string): boolean {
  let current = path.resolve(value)
  while (current !== path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) return true
    current = path.dirname(current)
  }
  return false
}

function resolveCompareSelector(outputDir: string, selector: string): ResolvedGalleryRun {
  if (selector === 'latest') return resolveGalleryRun(outputDir, null)
  if (selector === '--last') return resolveGalleryRun(outputDir, '--last')
  if (!path.isAbsolute(selector) && !selector.includes('/') && !selector.includes('\\')) {
    return resolveGalleryRun(outputDir, selector)
  }
  const canonicalOutput = realDirectory(outputDir, 'output directory')
  const candidate = path.resolve(selector)
  if (containsSymlink(candidate)) {
    throw new Error('shotwright compare: run path contains a symlink')
  }
  const runDir = realDirectory(candidate, `run "${selector}"`)
  return {
    outputDir: canonicalOutput,
    runDir,
    runId: path.basename(runDir),
    selectedViaLatest: false,
  }
}

export function resolveCompareRuns(
  outputDir: string,
  aSelector: string,
  bSelector: string,
): ResolvedCompareRuns {
  const a = resolveCompareSelector(outputDir, aSelector)
  const b = resolveCompareSelector(outputDir, bSelector)
  for (const selected of [a, b]) {
    const manifest = fs.lstatSync(path.join(selected.runDir, 'manifest.json'), {
      throwIfNoEntry: false,
    })
    if (!manifest?.isFile() || manifest.isSymbolicLink()) {
      throw new Error(`shotwright compare: run ${selected.runId} has no manifest.json`)
    }
  }
  if (a.runDir === b.runDir) {
    throw new Error(`shotwright compare: A and B resolve to the same run: ${a.runId}`)
  }
  return { outputDir: a.outputDir, a, b }
}
