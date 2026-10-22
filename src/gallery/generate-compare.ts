// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

import { buildCompareModel, type GalleryCompareModel } from './compare-model.js'
import {
  loadGalleryModel,
  readPngModel,
  type CompareGenerationResult,
  type GalleryDiagnostic,
  type GalleryShot,
} from './model.js'
import { renderCompareChunks } from './render-compare.js'

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
  return path.join(
    path.dirname(file),
    `.compare.${path.basename(file)}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`,
  )
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
type Staged = { file: string; temp: string }

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
  const a = loadGalleryModel(aRun, false),
    b = loadGalleryModel(bRun, false)
  const outputDir = legacy ? first : path.dirname(aRun)
  // The page's own name is the stem: its compare.json sidecar and diff PNGs land
  // beside it as `<stem>.compare.json` and `<stem>.diff-<n>.png`, wherever it is.
  const requestedOutputFile =
    options.outputFile ??
    path.join(outputDir, 'compare', `${a.manifest.runId}.vs.${b.manifest.runId}.html`)
  const outputFile = path.resolve(requestedOutputFile)
  const htmlName = path.basename(outputFile)
  const stem = path.basename(outputFile, path.extname(outputFile))
  const compareDir = path.dirname(outputFile)
  fs.mkdirSync(compareDir, { recursive: true })
  const staged: Staged[] = []
  const stage = (file: string, contents: string | Buffer): string => {
    const temp = tempPath(file)
    fs.writeFileSync(temp, contents, { flag: 'wx' })
    staged.push({ file, temp })
    return temp
  }
  try {
    const model = buildCompareModel(a, b, {
      aRunDir: aRun,
      bRunDir: bRun,
      threshold: options.threshold,
      includeAA: options.includeAA,
      stageDiff: (png, order) => stage(path.join(compareDir, `${stem}.diff-${order}.png`), png),
    })
    const gate = {
      nonParity: model.pairs.filter(
        (pair) => pair.state !== 'identical' && pair.state !== 'similar',
      ).length,
      failOnChange: options.failOnChange ?? false,
    }
    const jsonFile = path.join(compareDir, `${stem}.compare.json`)
    const diffFiles = model.pairs.flatMap((pair, index) => {
      if (!pair.diffTemp) return []
      const file = path.join(compareDir, `${stem}.diff-${index}.png`)
      staged.find((entry) => entry.temp === pair.diffTemp)!.file = file
      return [{ file }]
    })
    const packageInfo = JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    const json = {
      tool: 'shotwright',
      version: packageInfo.version,
      comparator: { name: 'pixelmatch', version: pixelmatchVersion() },
      runs: {
        a: { runId: a.manifest.runId, pathDigest: createHash('sha256').update(aRun).digest('hex') },
        b: { runId: b.manifest.runId, pathDigest: createHash('sha256').update(bRun).digest('hex') },
      },
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
        diff: pair.diffTemp
          ? path.basename(
              diffFiles.find((entry) => entry.file.endsWith(`.diff-${index}.png`))!.file,
            )
          : null,
        error: pair.error === null ? null : { message: pair.error, detail: pair.errorDetail },
      })),
    }
    const siblingBase = (runDir: string): string | undefined => {
      const relative = path.relative(path.dirname(outputFile), runDir)
      return path.isAbsolute(relative) ? undefined : relative.split(path.sep).join('/')
    }
    const links = {
      aBase: siblingBase(aRun),
      bBase: siblingBase(bRun),
    }
    stage(jsonFile, JSON.stringify(json, null, 2) + '\n')
    const htmlTemp = tempPath(outputFile)
    fs.writeFileSync(htmlTemp, '', { flag: 'wx' })
    staged.push({ file: outputFile, temp: htmlTemp })
    const fd = fs.openSync(htmlTemp, 'a')
    try {
      for (const chunk of renderCompareChunks(model, gate.failOnChange, links, (pair) => {
        const hydrated: GalleryShot[] = []
        for (const [side, run] of [
          ['a', aRun],
          ['b', bRun],
        ] as const) {
          if (pair.kind !== 'shot') break
          const shot = pair[side] as GalleryShot | null
          if (shot?.image) {
            shot.image.dataUri = readPngModel(run, shot.entry.file).dataUri
            hydrated.push(shot)
          }
        }
        if (pair.diffTemp && pair.verdict) pair.verdict.diffPng = fs.readFileSync(pair.diffTemp)
        return () => {
          for (const shot of hydrated) shot.image!.dataUri = ''
          if (pair.verdict) pair.verdict.diffPng = null
        }
      }))
        fs.writeSync(fd, chunk)
    } finally {
      fs.closeSync(fd)
    }
    for (const { file, temp } of staged) fs.renameSync(temp, file)
    // Only after the new HTML is in place: prune diff PNGs and temps a previous run of this stem left.
    const keep = new Set(diffFiles.map((entry) => path.basename(entry.file)))
    const stale = new RegExp(
      `^(?:${escapeRegExp(stem)}\\.diff-\\d+\\.png|\\.compare\\.(?:${escapeRegExp(htmlName)}|${escapeRegExp(stem)}\\.(?:compare\\.json|diff-\\d+\\.png))\\.\\d+(?:\\.[0-9a-f]{32})?\\.tmp)$`,
    )
    for (const name of fs.readdirSync(compareDir)) {
      if (!stale.test(name) || keep.has(name)) continue
      const candidate = path.join(compareDir, name)
      if (fs.lstatSync(candidate).isFile()) fs.unlinkSync(candidate)
    }
    return {
      outputFile: legacy ? requestedOutputFile : outputFile,
      comparePath: outputFile,
      counts: model.counts,
      gate,
      diagnostics: model.diagnostics,
      model,
    }
  } catch (error) {
    for (const { temp } of staged) {
      try {
        fs.rmSync(temp, { force: true })
      } catch {
        /* next run prunes abandoned temps */
      }
    }
    throw error
  }
}
