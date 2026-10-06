import fs from 'node:fs'
import path from 'node:path'

import { buildCompareModel, type CompareModel } from './compare-model.js'
import { loadGalleryModel, type GalleryDiagnostic } from './model.js'
import { renderCompare } from './render-compare.js'

let generationCounter = 0

export interface CompareGenerationResult {
  comparePath: string
  diagnostics: GalleryDiagnostic[]
  model: CompareModel
}

export function generateCompareGallery(
  outputDir: string,
  aRunDir: string,
  bRunDir: string,
): CompareGenerationResult {
  const compareDir = path.join(outputDir, 'compare')
  fs.mkdirSync(compareDir, { recursive: true })

  const model = buildCompareModel(loadGalleryModel(aRunDir), loadGalleryModel(bRunDir))
  const html = renderCompare(model)
  const comparePath = path.join(
    compareDir,
    `${model.a.manifest.runId}.vs.${model.b.manifest.runId}.html`,
  )
  const tempPath = path.join(
    compareDir,
    `.compare.${process.pid}-${++generationCounter}.tmp`,
  )
  try {
    fs.writeFileSync(tempPath, html)
    fs.renameSync(tempPath, comparePath)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }

  return { comparePath, diagnostics: model.diagnostics, model }
}
