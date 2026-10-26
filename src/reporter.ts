// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from 'node:crypto'
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
import {
  assembleManifest,
  readSidecars,
  type FailureEntry,
  type TestArtifacts,
  type TestEntry,
} from './manifest.js'
import { publishManifest, updateLatestSymlink, SIDECAR_DIR } from './runs.js'
import { shotwrightVersion } from './version.js'
import { storageSpec } from './capture.js'

interface FinalResult {
  test: TestCase
  result: TestResult
}
export default class ShotwrightReporter implements Reporter {
  private startedAt = ''
  private playwrightVersion = ''
  private finals = new Map<string, FinalResult>()
  onBegin(config: FullConfig): void {
    this.startedAt = new Date().toISOString()
    this.playwrightVersion = config.version
  }
  onTestEnd(test: TestCase, result: TestResult): void {
    const prior = this.finals.get(test.id)
    if (!prior || result.retry >= prior.result.retry) this.finals.set(test.id, { test, result })
  }
  async onEnd(result: FullResult): Promise<void> {
    const runDir = process.env.SHOTWRIGHT_RUN_DIR
    if (!runDir) {
      console.warn('shotwright reporter: SHOTWRIGHT_RUN_DIR not set — skipping manifest assembly')
      return
    }
    const evidenceErrors: string[] = []
    let sidecars
    try {
      sidecars = readSidecars(runDir)
    } catch (error) {
      fs.rmSync(path.join(runDir, SIDECAR_DIR), { recursive: true, force: true })
      throw error
    }
    const tests: TestEntry[] = []
    const failures: FailureEntry[] = []
    const artifacts: TestArtifacts = new Map()
    const prefixes = new Map<string, string>()
    try {
      for (const [id, { test, result: attempt }] of this.finals) {
        let fileSuite = test.parent
        while (fileSuite.parent && fileSuite.type !== 'file') fileSuite = fileSuite.parent
        const spec = path
          .relative(
            test.parent.project()?.testDir ?? '',
            fileSuite.location?.file ?? test.location.file,
          )
          .split(path.sep)
          .join('/')
        const project = test.parent.project()?.name ?? ''
        const title = test.title
        const ancestors: string[] = []
        for (let suite = test.parent; suite && suite.type !== 'file'; suite = suite.parent!) {
          if (suite.type === 'describe') ancestors.unshift(suite.title)
          if (!suite.parent) break
        }
        const errorMessage = attempt.error?.message
          ?.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
          .split('\n')[0]
        tests.push({
          id,
          title,
          titlePath: [...ancestors, title],
          spec,
          project,
          status: attempt.status,
          retry: attempt.retry,
          durationMs: attempt.duration,
          ...(errorMessage ? { error: { message: errorMessage } } : {}),
        })
        const stem = this.stem(spec, title, id, project, prefixes)
        const media = { video: null as string | null, trace: null as string | null }
        const failed = attempt.status !== 'passed' && attempt.status !== 'skipped'
        const failure: FailureEntry = { testId: id, files: [] }
        const names = new Set<string>()
        for (const attachment of attempt.attachments) {
          const category =
            attachment.name === 'video'
              ? 'video'
              : attachment.name === 'trace'
                ? 'trace'
                : 'failure'
          if (category === 'failure' && !failed) continue
          const suffix = category === 'video' ? '.webm' : category === 'trace' ? '.zip' : ''
          const basename = this.attachmentName(attachment.name, attachment.path, names)
          const file =
            category === 'failure' ? `failures/${stem}/${basename}` : `${category}/${stem}${suffix}`
          try {
            const dest = path.join(runDir, file)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            if (attachment.path) fs.copyFileSync(attachment.path, dest)
            else if (attachment.body) fs.writeFileSync(dest, attachment.body)
            else throw new Error('attachment has no bytes')
            if (category === 'video') media.video = file
            if (category === 'trace') media.trace = file
            if (failed)
              failure.files.push({
                name: attachment.name,
                contentType: attachment.contentType,
                file,
              })
            if (attachment.name === 'error-context')
              console.error(`shotwright: copied error-context: ${path.join(runDir, file)}`)
          } catch (error) {
            evidenceErrors.push(
              `${file}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        artifacts.set(id, media)
        if (failed) failures.push(failure)
      }
    } finally {
      try {
        fs.rmSync(path.join(runDir, SIDECAR_DIR), { recursive: true, force: true })
      } catch (error) {
        evidenceErrors.push(
          `sidecar cleanup: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const evidence = evidenceErrors.length
      ? { ok: false, error: evidenceErrors.join('; ') }
      : { ok: true }
    // Sidecars are held in memory; cleanup precedes publication.
    const manifest = assembleManifest({
      runDir,
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
      status: result.status,
      publication: { evidence, gallery: { ok: true } },
      tests,
      failures,
      sidecars,
      artifacts,
    })
    let galleryError: string | null = null
    try {
      const generated = generateGallery(runDir, manifest)
      if (generated.diagnostics.length)
        galleryError = formatGalleryDiagnostics(generated.diagnostics)
    } catch (error) {
      galleryError = error instanceof Error ? error.message : String(error)
    }
    if (galleryError) {
      manifest.publication.gallery = { ok: false, error: galleryError }
      fs.rmSync(path.join(runDir, 'gallery.html'), { force: true })
      // A failed gallery still has a manifest for run discovery.
    }
    try {
      publishManifest(runDir, manifest)
    } catch (error) {
      fs.rmSync(path.join(runDir, 'gallery.html'), { force: true })
      fs.rmSync(path.join(runDir, 'manifest.json'), { force: true })
      fs.rmSync(path.join(runDir, '.manifest.tmp'), { force: true })
      throw error
    }
    if (
      manifest.status === 'passed' &&
      manifest.publication.gallery.ok &&
      manifest.publication.evidence.ok
    )
      updateLatestSymlink(path.dirname(runDir), path.basename(runDir))
    console.log(`shotwright: ${manifest.shots.length} shot(s) → ${runDir}`)
    if (galleryError) console.error(galleryError)
    if (evidenceErrors.length) console.error(evidenceErrors.join('\n'))
    if (!manifest.publication.gallery.ok || !manifest.publication.evidence.ok) {
      const failures = [
        !manifest.publication.gallery.ok
          ? `gallery publication failed: ${manifest.publication.gallery.error}`
          : null,
        !manifest.publication.evidence.ok
          ? `evidence publication failed: ${manifest.publication.evidence.error}`
          : null,
      ].filter(Boolean)
      throw new Error(`shotwright: ${failures.join('; ')}`)
    }
    if (manifest.runError) throw new Error(`shotwright: ${manifest.runError.message}`)
  }
  async onExit(): Promise<void> {
    const runDir = process.env.SHOTWRIGHT_RUN_DIR
    if (runDir)
      try {
        fs.rmSync(path.join(runDir, '.pw'), { recursive: true, force: true })
      } catch (error) {
        console.error(
          `shotwright: staging cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
  }
  private stem(
    spec: string,
    title: string,
    id: string,
    project: string,
    prefixes: Map<string, string>,
  ): string {
    const digest = this.digest(id, project)
    let short = digest.slice(0, 12)
    if (prefixes.has(short) && prefixes.get(short) !== digest) short = digest
    prefixes.set(short, digest)
    const slug =
      title
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'test'
    return `${storageSpec(spec)}/${slug}-${short}`
  }
  private digest(id: string, project: string): string {
    return crypto.createHash('sha256').update(id).update('\0').update(project).digest('hex')
  }
  private attachmentName(name: string, source: string | undefined, names: Set<string>): string {
    const extension = path.extname(source ?? name)
    const ext = /^\.[a-z0-9]+$/i.test(extension) ? extension.toLowerCase() : ''
    const stem = source ? name : name.slice(0, name.length - ext.length)
    const slug =
      stem
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'attachment'
    let basename = `${slug}${ext}`
    for (let suffix = 2; names.has(basename); suffix++) basename = `${slug}-${suffix}${ext}`
    names.add(basename)
    return basename
  }
  printsToStdio(): boolean {
    return false
  }
}
