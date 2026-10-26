// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

import { buildCompareModel, type GalleryCompareModel } from './compare-model.js'
import {
  loadGalleryModel,
  readPngModel,
  shotKey,
  type CompareGenerationResult,
  type GalleryDiagnostic,
  type GalleryShot,
} from './model.js'
import { renderCompareHeader, renderComparePairChunks } from './render-compare.js'

export interface CompareGenerationOptions {
  outputFile?: string
  /** Publish every file only if absent; used for a first page beside run A. */
  exclusiveCreate?: boolean
  /** Existing stem files may be pruned only when a prior sidecar owns this pair. */
  pruneStale?: boolean
  /** Temp files have no sidecar ownership proof in the beside-run-A fallback. */
  pruneTemps?: boolean
  threshold?: number
  includeAA?: boolean
  failOnChange?: boolean
  ignore?: string[]
  strict?: boolean
}
export interface CompatibleCompareGenerationResult extends CompareGenerationResult {
  comparePath: string
  diagnostics: GalleryDiagnostic[]
  /** Final verdicts and paths only: image.dataUri is empty and diffPng is null after generation. */
  model: GalleryCompareModel
}
export class InvalidCompareIgnoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCompareIgnoreError'
  }
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
 * Stage every output to a temp path first, then rename the diff PNGs and JSON
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
  const ignore = [...new Set(options.ignore ?? [])].sort()
  const artifactKeys = new Map<string, Map<string, { spec: string; name: string }>>()
  for (const entry of [...a.manifest.artifacts, ...b.manifest.artifacts]) {
    const key = `${entry.spec}/${entry.name}`
    const candidates = artifactKeys.get(key) ?? new Map()
    candidates.set(shotKey(entry.spec, entry.name), { spec: entry.spec, name: entry.name })
    artifactKeys.set(key, candidates)
  }
  const ignoredPairs = new Set<string>()
  for (const key of ignore) {
    const candidates = artifactKeys.get(key)
    if (!candidates)
      throw new InvalidCompareIgnoreError(`--ignore did not match an artifact: ${key}`)
    if (candidates.size > 1) {
      const details = [...candidates.values()]
        .map(({ spec, name }) => `(spec: ${JSON.stringify(spec)}, name: ${JSON.stringify(name)})`)
        .sort()
        .join(', ')
      throw new InvalidCompareIgnoreError(`--ignore is ambiguous: ${key}; candidates: ${details}`)
    }
    ignoredPairs.add(candidates.keys().next().value!)
  }
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
  const created: string[] = []
  let bodyTemp: string | undefined
  const stage = (file: string, contents: string | Buffer): string => {
    const temp = tempPath(file)
    fs.writeFileSync(temp, contents, { flag: 'wx' })
    staged.push({ file, temp })
    return temp
  }
  const writeAll = (fd: number, chunk: string | Buffer): void => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    for (let offset = 0; offset < bytes.length;) {
      const written = fs.writeSync(fd, bytes, offset, bytes.length - offset)
      if (written === 0) throw new Error('compare HTML write made no progress')
      offset += written
    }
  }
  try {
    const model = buildCompareModel(a, b, {
      aRunDir: aRun,
      bRunDir: bRun,
      threshold: options.threshold,
      includeAA: options.includeAA,
      stageDiff: (png, order) => stage(path.join(compareDir, `${stem}.diff-${order}.png`), png),
    })
    for (const pair of model.pairs)
      pair.ignored = pair.kind === 'artifact' && ignoredPairs.has(pair.key)
    const gate = {
      measuredNonParity: 0,
      ignoredNonParity: 0,
      nonParity: 0,
      failOnChange: options.failOnChange ?? false,
    }
    const updateGate = (): void => {
      gate.measuredNonParity = model.pairs.filter(
        (pair) => pair.state !== 'identical' && pair.state !== 'similar',
      ).length
      gate.ignoredNonParity = model.pairs.filter(
        (pair) => pair.ignored && pair.state !== 'identical' && pair.state !== 'similar',
      ).length
      gate.nonParity = model.pairs.filter(
        (pair) =>
          !pair.ignored &&
          ((pair.state !== 'identical' && pair.state !== 'similar') ||
            (options.strict && pair.state === 'similar')),
      ).length
    }
    updateGate()
    const jsonFile = path.join(compareDir, `${stem}.compare.json`)
    const packageInfo = JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    const buildJson = () => ({
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
        ignore,
        strict: options.strict ?? false,
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
        ignored: pair.ignored,
        differentPixels: pair.verdict?.differentPixels ?? null,
        totalPixels: pair.verdict?.totalPixels ?? null,
        ratio: pair.verdict?.ratio ?? null,
        aSize: pair.verdict?.aSize ?? null,
        bSize: pair.verdict?.bSize ?? null,
        diff: pair.diffTemp ? `${stem}.diff-${index}.png` : null,
        error: pair.error === null ? null : { message: pair.error, detail: pair.errorDetail },
      })),
    })
    const siblingBase = (runDir: string): string | undefined => {
      const relative = path.relative(path.dirname(outputFile), runDir)
      return path.isAbsolute(relative) ? undefined : relative.split(path.sep).join('/')
    }
    const links = {
      aBase: siblingBase(aRun),
      bBase: siblingBase(bRun),
    }
    const bodyPath = tempPath(outputFile)
    fs.writeFileSync(bodyPath, '', { flag: 'wx' })
    bodyTemp = bodyPath
    const bodyFd = fs.openSync(bodyTemp, 'a')
    try {
      for (const chunk of renderComparePairChunks(model, links, (pair) => {
        const hydrated: GalleryShot[] = []
        for (const [side, run] of [
          ['a', aRun],
          ['b', bRun],
        ] as const) {
          if (pair.kind !== 'shot') break
          const shot = pair[side] as GalleryShot | null
          if (shot?.image) {
            try {
              shot.image.dataUri = readPngModel(run, shot.entry.file).dataUri
              hydrated.push(shot)
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error)
              pair.error = `${side.toUpperCase()}: unreadable file (${shot.entry.file}): ${reason}`
              pair.errorDetail = `${side.toUpperCase()}: ${reason}`
              model.counts[pair.state]--
              model.counts.unreadable++
              pair.state = 'unreadable'
              pair.verdict = null
              shot.image = null
              shot.imageError = reason
              if (pair.diffTemp) {
                const index = staged.findIndex((entry) => entry.temp === pair.diffTemp)
                if (index !== -1) staged.splice(index, 1)
                fs.rmSync(pair.diffTemp, { force: true })
                pair.diffTemp = undefined
              }
              break
            }
          }
        }
        if (pair.diffTemp && pair.verdict) pair.verdict.diffPng = fs.readFileSync(pair.diffTemp)
        return () => {
          for (const shot of hydrated) shot.image!.dataUri = ''
          if (pair.verdict) pair.verdict.diffPng = null
        }
      }))
        writeAll(bodyFd, chunk)
    } finally {
      fs.closeSync(bodyFd)
    }
    updateGate()
    const diffFiles = model.pairs.flatMap((pair, index) => {
      if (!pair.diffTemp) return []
      const file = path.join(compareDir, `${stem}.diff-${index}.png`)
      staged.find((entry) => entry.temp === pair.diffTemp)!.file = file
      return [{ file }]
    })
    const htmlTemp = tempPath(outputFile)
    fs.writeFileSync(htmlTemp, '', { flag: 'wx' })
    staged.push({ file: outputFile, temp: htmlTemp })
    const fd = fs.openSync(htmlTemp, 'a')
    try {
      writeAll(fd, renderCompareHeader(model, gate.failOnChange, gate, options.strict ?? false))
      const input = fs.openSync(bodyTemp, 'r')
      try {
        const buffer = Buffer.alloc(64 * 1024)
        for (let read; (read = fs.readSync(input, buffer, 0, buffer.length, null)) > 0;) {
          writeAll(fd, buffer.subarray(0, read))
        }
      } finally {
        fs.closeSync(input)
      }
      writeAll(fd, '</main></body></html>\n')
    } finally {
      fs.closeSync(fd)
    }
    fs.rmSync(bodyTemp)
    bodyTemp = undefined
    stage(jsonFile, JSON.stringify(buildJson(), null, 2) + '\n')
    if (options.exclusiveCreate) {
      for (const { file, temp } of staged) {
        fs.linkSync(temp, file)
        created.push(file)
      }
      for (const { temp } of staged) fs.unlinkSync(temp)
    } else {
      for (const { file, temp } of staged) fs.renameSync(temp, file)
    }
    // Only after the new HTML is in place: prune diff PNGs and temps a previous run of this stem left.
    const keep = new Set(diffFiles.map((entry) => path.basename(entry.file)))
    const stale = new RegExp(
      `^(?:${escapeRegExp(stem)}\\.diff-\\d+\\.png|\\.compare\\.(?:${escapeRegExp(htmlName)}|${escapeRegExp(stem)}\\.(?:compare\\.json|diff-\\d+\\.png))\\.\\d+(?:\\.[0-9a-f]{32})?\\.tmp)$`,
    )
    for (const name of options.pruneStale === false ? [] : fs.readdirSync(compareDir)) {
      if (!stale.test(name) || keep.has(name)) continue
      if (options.pruneTemps === false && name.startsWith('.compare.')) continue
      const candidate = path.join(compareDir, name)
      const stat = fs.lstatSync(candidate)
      if (!stat.isFile()) continue
      if (name.startsWith('.compare.') && Date.now() - stat.mtimeMs <= 60 * 60 * 1000) continue
      fs.unlinkSync(candidate)
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
    for (const file of created) fs.rmSync(file, { force: true })
    if (bodyTemp) fs.rmSync(bodyTemp, { force: true })
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
