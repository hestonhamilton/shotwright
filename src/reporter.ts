// The shotwright reporter — the manifest's single writer. Collects the per-shot
// sidecars written by workers, maps each test's video/trace attachments into the
// run layout, and publishes manifest.json atomically in onEnd. The `latest`
// symlink flips only after a successful publish.

import fs from 'node:fs'
import path from 'node:path'

import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

import { parseOnly } from './filter.js'
import { formatGalleryDiagnostics, generateGallery } from './gallery/generate.js'
import { assembleManifest, type TestArtifacts } from './manifest.js'
import { publishManifest, updateLatestSymlink, SIDECAR_DIR } from './runs.js'
import { readSidecars } from './manifest.js'

function shotwrightVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  return pkg.version
}

export default class ShotwrightReporter implements Reporter {
  private startedAt = ''
  private playwrightVersion = ''
  private artifactSources = new Map<string, { video: string | null; trace: string | null }>()

  onBegin(config: FullConfig): void {
    this.startedAt = new Date().toISOString()
    this.playwrightVersion = config.version
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const video = result.attachments.find((a) => a.name === 'video' && a.path)?.path ?? null
    const trace = result.attachments.find((a) => a.name === 'trace' && a.path)?.path ?? null
    if (video || trace) this.artifactSources.set(test.id, { video, trace })
  }

  async onEnd(result: FullResult): Promise<void> {
    const runDir = process.env.SHOTWRIGHT_RUN_DIR
    if (!runDir) {
      console.warn('shotwright reporter: SHOTWRIGHT_RUN_DIR not set — skipping manifest assembly')
      return
    }
    const sidecars = readSidecars(runDir)

    // Copy per-test videos/traces into the run layout, keyed by testId.
    const artifacts: TestArtifacts = new Map()
    for (const [testId, src] of this.artifactSources) {
      const entry = { video: null as string | null, trace: null as string | null }
      if (src.video && fs.existsSync(src.video)) {
        entry.video = `video/${testId}${path.extname(src.video) || '.webm'}`
        this.copyIn(runDir, src.video, entry.video)
      }
      if (src.trace && fs.existsSync(src.trace)) {
        entry.trace = `trace/${testId}${path.extname(src.trace) || '.zip'}`
        this.copyIn(runDir, src.trace, entry.trace)
      }
      artifacts.set(testId, entry)
    }

    const manifest = assembleManifest({
      runId: path.basename(runDir),
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      shotwrightVersion: shotwrightVersion(),
      playwrightVersion: this.playwrightVersion,
      flags: {
        only: parseOnly(process.env.SHOTWRIGHT_ONLY),
        video: process.env.SHOTWRIGHT_VIDEO === '1',
        trace: process.env.SHOTWRIGHT_TRACE === '1',
      },
      sidecars,
      artifacts,
    })
    publishManifest(runDir, manifest)

    let galleryFailure: string | null = null
    try {
      const generated = generateGallery(runDir)
      if (generated.diagnostics.length > 0) {
        galleryFailure = formatGalleryDiagnostics(generated.diagnostics)
      }
    } catch (error) {
      galleryFailure = error instanceof Error ? error.message : String(error)
    }

    try {
      if (result.status === 'passed') {
        updateLatestSymlink(path.dirname(runDir), path.basename(runDir))
      }
    } finally {
      // Staging areas are not part of the contract — drop them. (.pw is swept in
      // onExit instead: the runner writes .last-run.json into outputDir after onEnd.)
      fs.rmSync(path.join(runDir, SIDECAR_DIR), { recursive: true, force: true })
    }

    console.log(`shotwright: ${manifest.shots.length} shot(s) → ${runDir}`)
    if (galleryFailure !== null) {
      console.error(galleryFailure)
      throw new Error(galleryFailure)
    }
  }

  async onExit(): Promise<void> {
    const runDir = process.env.SHOTWRIGHT_RUN_DIR
    if (runDir) fs.rmSync(path.join(runDir, '.pw'), { recursive: true, force: true })
  }

  private copyIn(runDir: string, src: string, relDest: string): void {
    const dest = path.join(runDir, relDest)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }

  printsToStdio(): boolean {
    return false
  }
}
