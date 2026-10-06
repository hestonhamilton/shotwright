import fs from 'node:fs'
import path from 'node:path'

import { loadGalleryModel, type GalleryDiagnostic } from './model.js'
import { renderGallery } from './render.js'

let generationCounter = 0

export interface GalleryGenerationResult {
  galleryPath: string
  diagnostics: GalleryDiagnostic[]
}

export function formatGalleryDiagnostics(diagnostics: GalleryDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => `shotwright gallery: ${diagnostic.path}: ${diagnostic.message}`)
    .join('\n')
}

export function generateGallery(runDir: string): GalleryGenerationResult {
  if (process.env.SHOTWRIGHT_INJECT_GALLERY_FAILURE === '1') {
    throw new Error('shotwright gallery: injected generator failure')
  }
  const model = loadGalleryModel(runDir)
  const html = renderGallery(model)
  const galleryPath = path.join(runDir, 'gallery.html')
  const tempPath = path.join(
    runDir,
    `.gallery.${process.pid}-${++generationCounter}.tmp`,
  )
  try {
    fs.writeFileSync(tempPath, html)
    fs.renameSync(tempPath, galleryPath)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
  return { galleryPath, diagnostics: model.diagnostics }
}
