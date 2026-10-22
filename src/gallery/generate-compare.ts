// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import { createRequire } from 'node:module'
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
function tempPath(file: string): string {
  return path.join(path.dirname(file), `.compare.${path.basename(file)}.${process.pid}.tmp`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The pixelmatch version actually loaded, read from its package.json at generation time. */
function pixelmatchVersion(): string {
  const require = createRequire(import.meta.url)
  const manifest = JSON.parse(
    fs.readFileSync(require.resolve('pixelmatch/package.json'), 'utf8'),
  ) as { version: string }
  return manifest.version
}

/**
 * Stage every output to a temp path first, then rename the JSON and diff PNGs
 * into place and the HTML last. Nothing from a previous run is removed until
 * the new HTML is published, so a failed write or rename leaves the previous
 * complete page in place.
 */
function publish(outputs: Array<{ file: string; contents: string | Buffer }>): void {
  const staged: Array<{ file: string; temp: string }> = []
  const discard = (): void => {
    for (const { temp } of staged)
      try {
        fs.rmSync(temp, { force: true })
      } catch {
        /* leave it for the next run's prune */
      }
  }
  try {
    for (const { file, contents } of outputs) {
      const temp = tempPath(file)
      staged.push({ file, temp })
      fs.writeFileSync(temp, contents)
    }
    for (const { file, temp } of staged) fs.renameSync(temp, file)
  } catch (error) {
    discard()
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
    comparator: { name: 'pixelmatch', version: pixelmatchVersion() },
    settings: {
      threshold: model.options.threshold,
      includeAA: model.options.includeAA,
      // 'option' when the caller supplied either setting; otherwise both are defaults.
      source:
        options.threshold !== undefined || options.includeAA !== undefined ? 'option' : 'default',
    },
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
      error: pair.error === null ? null : { message: pair.error, detail: pair.errorDetail },
    })),
  }
  const siblingBase = (runDir: string): string | undefined => {
    const relative = path.relative(path.dirname(outputFile), runDir)
    return path.isAbsolute(relative) ? undefined : relative.split(path.sep).join('/')
  }
  const html = renderCompare(model, gate.failOnChange, {
    aBase: siblingBase(aRun),
    bBase: siblingBase(bRun),
  })
  publish([
    ...diffFiles.map((entry) => ({ file: entry.file, contents: entry.bytes })),
    { file: jsonFile, contents: JSON.stringify(json, null, 2) + '\n' },
    { file: outputFile, contents: html },
  ])
  // Only after the new HTML is in place: prune diff PNGs and temps a previous run of this stem left.
  const keep = new Set(diffFiles.map((entry) => path.basename(entry.file)))
  const stale = new RegExp(
    `^(?:${escapeRegExp(stem)}\\.diff-\\d+\\.png|\\.compare\\.${escapeRegExp(stem)}\\.(?:html|compare\\.json|diff-\\d+\\.png)\\.\\d+\\.tmp)$`,
  )
  for (const name of fs.readdirSync(compareDir))
    if (stale.test(name) && !keep.has(name))
      fs.rmSync(path.join(compareDir, name), { recursive: true, force: true })
  return {
    outputFile,
    comparePath: outputFile,
    counts: model.counts,
    gate,
    diagnostics: model.diagnostics,
    model,
  }
}
