// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'

import { buildCompareModel, type GalleryCompareModel } from './compare-model.js'
import { loadGalleryModel, type CompareGenerationResult, type GalleryDiagnostic } from './model.js'
import { renderCompare } from './render-compare.js'

export interface CompareGenerationOptions {
  outputFile?: string
  threshold?: number
  includeAA?: boolean
  failOnChange?: boolean
}
export interface CompatibleCompareGenerationResult extends CompareGenerationResult {
  comparePath: string
  diagnostics: GalleryDiagnostic[]
  model: GalleryCompareModel
}
let sequence = 0
function atomic(file: string, contents: string | Buffer): void {
  const temp = path.join(path.dirname(file), `.compare.${process.pid}-${++sequence}.tmp`)
  try {
    fs.writeFileSync(temp, contents)
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}
export function generateCompareGallery(
  aRun: string,
  bRun: string,
  options?: CompareGenerationOptions,
): CompatibleCompareGenerationResult
export function generateCompareGallery(
  outputDir: string,
  aRun: string,
  bRun: string,
): CompatibleCompareGenerationResult
export function generateCompareGallery(
  first: string,
  second: string,
  third: CompareGenerationOptions | string = {},
): CompatibleCompareGenerationResult {
  const legacy = typeof third === 'string'
  const aRun = legacy ? second : first
  const bRun = legacy ? third : second
  const options = legacy ? {} : third
  if (
    options.threshold !== undefined &&
    (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1)
  )
    throw new Error('threshold must be between 0 and 1')
  const a = loadGalleryModel(aRun),
    b = loadGalleryModel(bRun)
  const outputDir = legacy ? first : path.dirname(aRun)
  const stem = `${a.manifest.runId}.vs.${b.manifest.runId}`
  const compareDir = path.join(outputDir, 'compare')
  fs.mkdirSync(compareDir, { recursive: true })
  const outputFile = options.outputFile ?? path.join(compareDir, `${stem}.html`)
  const model = buildCompareModel(a, b, {
    aRunDir: aRun,
    bRunDir: bRun,
    threshold: options.threshold,
    includeAA: options.includeAA,
  })
  const gate = {
    nonParity: model.pairs.filter((pair) => pair.state !== 'identical' && pair.state !== 'similar')
      .length,
    failOnChange: options.failOnChange ?? false,
  }
  const jsonFile = path.join(compareDir, `${stem}.compare.json`)
  const diffFiles = model.pairs.flatMap((pair, index) =>
    pair.verdict?.diffPng
      ? [{ file: path.join(compareDir, `${stem}.diff-${index}.png`), bytes: pair.verdict.diffPng }]
      : [],
  )
  const packageInfo = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  const json = {
    tool: 'shotwright',
    version: packageInfo.version,
    comparator: 'pixelmatch',
    threshold: model.options.threshold,
    includeAA: model.options.includeAA,
    counts: model.counts,
    gate,
    pairs: model.pairs.map((pair, index) => ({
      kind: pair.kind,
      spec: pair.spec,
      name: pair.name,
      state: pair.state,
      differentPixels: pair.verdict?.differentPixels ?? null,
      totalPixels: pair.verdict?.totalPixels ?? null,
      ratio: pair.verdict?.ratio ?? null,
      aSize: pair.verdict?.aSize ?? null,
      bSize: pair.verdict?.bSize ?? null,
      diff: pair.verdict?.diffPng
        ? path.basename(diffFiles.find((entry) => entry.file.endsWith(`.diff-${index}.png`))!.file)
        : null,
      error: pair.error,
    })),
  }
  const html = renderCompare(model, gate.failOnChange)
  // Publish the index last; on interruption, the next run removes stale pair artifacts.
  fs.rmSync(outputFile, { force: true })
  for (const name of fs.readdirSync(compareDir))
    if (
      name.startsWith(`${stem}.diff-`) ||
      name === `${stem}.compare.json` ||
      (name.startsWith('.compare.') && name.endsWith('.tmp'))
    )
      fs.rmSync(path.join(compareDir, name), { force: true })
  for (const entry of diffFiles) atomic(entry.file, entry.bytes)
  atomic(jsonFile, JSON.stringify(json, null, 2) + '\n')
  atomic(outputFile, html)
  return {
    outputFile,
    comparePath: outputFile,
    counts: model.counts,
    gate,
    diagnostics: model.diagnostics,
    model,
  }
}
