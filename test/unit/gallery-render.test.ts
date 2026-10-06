import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { GALLERY_SCRIPT } from '../../src/gallery/assets.js'
import { generateGallery } from '../../src/gallery/generate.js'
import { loadGalleryModel } from '../../src/gallery/model.js'
import { renderGallery } from '../../src/gallery/render.js'
import { MANIFEST_VERSION, type Manifest, type ShotEntry } from '../../src/manifest.js'
import { makePng } from '../fixtures/png.js'

const tmpDirs: string[] = []

function tmpDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-gallery-render-'))
  tmpDirs.push(directory)
  return directory
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of tmpDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function shot(name: string, spec: string, index: number, overrides: Partial<ShotEntry> = {}): ShotEntry {
  return {
    name,
    spec,
    file: `shots/${spec}/${name}.png`,
    viewport: { width: index === 1 ? 390 : 1440, height: index === 1 ? 844 : 960 },
    deviceScaleFactor: 2,
    fullPage: index !== 3,
    capturedAt: `2026-07-29T00:00:0${index}.000Z`,
    durationMs: 50 + index,
    video: null,
    trace: null,
    ...overrides,
  }
}

function manifest(runId: string, shots: ShotEntry[]): Manifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:00:10.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: ['theme'], video: false, trace: false },
    shots,
  }
}

function writeRun(
  runDir: string,
  value: Manifest,
  options: { omit?: string[]; corrupt?: string[] } = {},
): void {
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(value, null, 2) + '\n')
  for (const [index, entry] of value.shots.entries()) {
    if (options.omit?.includes(entry.file)) continue
    const target = path.join(runDir, ...entry.file.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(
      target,
      options.corrupt?.includes(entry.file)
        ? Buffer.from('not png')
        : makePng(100 + index, 80 + index, index),
    )
  }
  const artifactPaths = new Set(
    value.shots.flatMap((entry) => [entry.video, entry.trace]).filter((item): item is string => item !== null),
  )
  for (const artifactPath of artifactPaths) {
    const target = path.join(runDir, ...artifactPath.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `artifact:${artifactPath}`)
  }
}

function fiveShots(): ShotEntry[] {
  return [
    shot('about-desktop', 'about.shots.ts', 0),
    shot('mobile-layout', 'about.shots.ts', 1),
    shot('form-filled', 'home.shots.ts', 2),
    shot('modal-open', 'home.shots.ts', 3),
    shot('theme-dark', 'home.shots.ts', 4),
  ]
}

describe('deterministic gallery publication', () => {
  it('produces byte-identical HTML from identical inputs in two run locations', () => {
    const root = tmpDir()
    const first = path.join(root, 'first/run')
    const second = path.join(root, 'second/run')
    const value = manifest('run', fiveShots())
    writeRun(first, value)
    writeRun(second, value)
    generateGallery(first)
    generateGallery(second)
    expect(fs.readFileSync(path.join(first, 'gallery.html'))).toEqual(
      fs.readFileSync(path.join(second, 'gallery.html')),
    )
  })

  it('regenerates atomically without leaving any writer temp file', () => {
    const runDir = path.join(tmpDir(), 'run')
    writeRun(runDir, manifest('run', fiveShots()))
    const first = generateGallery(runDir)
    const bytes = fs.readFileSync(first.galleryPath)
    const second = generateGallery(runDir)
    expect(fs.readFileSync(second.galleryPath)).toEqual(bytes)
    expect(fs.readdirSync(runDir).filter((name) => name.startsWith('.gallery.'))).toEqual([])
  })

  it('does not overwrite an existing gallery for missing, invalid JSON, or wrong-version manifests', () => {
    for (const [name, contents] of [
      ['missing', null],
      ['json', '{nope'],
      ['version', JSON.stringify({ ...manifest('version', []), manifestVersion: 2 })],
    ] as const) {
      const runDir = path.join(tmpDir(), name)
      fs.mkdirSync(runDir)
      fs.writeFileSync(path.join(runDir, 'gallery.html'), 'keep me')
      if (contents !== null) fs.writeFileSync(path.join(runDir, 'manifest.json'), contents)
      expect(() => generateGallery(runDir)).toThrow(/invalid manifest/)
      expect(fs.readFileSync(path.join(runDir, 'gallery.html'), 'utf8')).toBe('keep me')
    }
  })
})

describe('gallery rendering', () => {
  it('renders the five-shot fixture in manifest/spec order with complete metadata and one URI per shot', () => {
    const runDir = path.join(tmpDir(), 'run')
    writeRun(runDir, manifest('run', fiveShots()))
    const html = renderGallery(loadGalleryModel(runDir))
    expect((html.match(/data:image\/png;base64,/g) ?? [])).toHaveLength(5)
    expect((html.match(/<article class="card/g) ?? [])).toHaveLength(5)
    expect(html.indexOf('about.shots.ts')).toBeLessThan(html.indexOf('home.shots.ts'))
    for (const entry of fiveShots()) {
      expect(html).toContain(entry.name)
      expect(html).toContain(entry.file)
      expect(html).toContain(entry.capturedAt)
      expect(html).toContain(`${entry.durationMs} ms`)
    }
    expect(html).toContain('104×84 derived')
    expect(html).toContain('Published manifest · pass/fail status is not embedded')
    expect(html).toContain('<noscript>')
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`,
    )
  })

  it('escapes injection strings and percent-encodes sibling path segments', () => {
    const runDir = path.join(tmpDir(), 'run')
    const hostile = `<script>alert("x")</script>'</style>\u202e`
    const value = manifest('run', [
      shot(hostile, `spec-${hostile}`, 0, {
        file: `shots/<script>/quote"'.png`,
        video: `video/<script>quote"'.webm`,
        trace: `trace/</style>/trace'.zip`,
      }),
    ])
    writeRun(runDir, value)
    const html = renderGallery(loadGalleryModel(runDir))
    expect((html.match(/<script>/g) ?? [])).toHaveLength(1)
    expect((html.match(/<\/style>/g) ?? [])).toHaveLength(1)
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;&lt;/style&gt;')
    expect(html).toContain('video/%3Cscript%3Equote%22%27.webm')
    expect(html).toContain('trace/%3C/style%3E/trace%27.zip')
    expect(html).not.toContain('href="video/<script>')
    expect(html).not.toContain('localStorage')
    expect(html).not.toContain('innerHTML')
  })

  it('renders a valid empty manifest as an explicit empty state', () => {
    const runDir = path.join(tmpDir(), 'run')
    writeRun(runDir, manifest('run', []))
    const html = renderGallery(loadGalleryModel(runDir))
    expect(html).toContain('No screenshots in this run')
    expect(html).toContain('shots: []')
    expect(html).not.toContain('<article class="card')
  })

  it('renders DSF independently when the logical viewport is unavailable', () => {
    const runDir = path.join(tmpDir(), 'run')
    writeRun(
      runDir,
      manifest('run', [
        shot('native-viewport', 'home.shots.ts', 0, {
          viewport: null,
          deviceScaleFactor: 2,
        }),
      ]),
    )
    const html = renderGallery(loadGalleryModel(runDir))
    expect(html).toContain('Viewport unavailable · DSF 2')
    expect(html).toContain(
      '<div class="meta"><span>Viewport unavailable</span><span>DSF 2</span>',
    )
    expect(html).toContain('<dt>Logical viewport</dt><dd>Viewport unavailable</dd>')
    expect(html).toContain('<dt>Device scale factor</dt><dd>2</dd>')
  })

  it('publishes a partial gallery and path-specific diagnostics for missing and corrupt PNGs', () => {
    const runDir = path.join(tmpDir(), 'run')
    const shots = [shot('missing', 'a.shots.ts', 0), shot('corrupt', 'a.shots.ts', 1)]
    writeRun(runDir, manifest('run', shots), {
      omit: [shots[0]!.file],
      corrupt: [shots[1]!.file],
    })
    const generated = generateGallery(runDir)
    const html = fs.readFileSync(generated.galleryPath, 'utf8')
    expect(html).toContain('Screenshot unavailable')
    expect(html).toContain(shots[0]!.file)
    expect(html).toContain(shots[1]!.file)
    expect(generated.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      shots[0]!.file,
      shots[1]!.file,
    ])
  })

  it('deduplicates one exact video/trace pair shared by three shots into one artifact group', () => {
    const runDir = path.join(tmpDir(), 'run')
    const pair = { video: 'video/shared.webm', trace: 'trace/shared.zip' }
    const shots = [
      shot('one', 'home.shots.ts', 0, pair),
      shot('two', 'home.shots.ts', 1, pair),
      shot('three', 'home.shots.ts', 2, pair),
    ]
    writeRun(runDir, manifest('run', shots))
    const html = renderGallery(loadGalleryModel(runDir))
    expect((html.match(/<video /g) ?? [])).toHaveLength(1)
    expect((html.match(/shared by 3 shots by identical manifest path; test title unavailable/g) ?? [])).toHaveLength(1)
    expect((html.match(/Download sibling trace/g) ?? [])).toHaveLength(1)
    expect(html).toContain('requires this gallery beside the run directory')
  })

  it('renders a typed broken artifact affordance and reports its relative path', () => {
    const runDir = path.join(tmpDir(), 'run')
    const value = manifest('run', [
      shot('one', 'home.shots.ts', 0, { video: 'video/missing.webm' }),
    ])
    writeRun(runDir, value)
    fs.rmSync(path.join(runDir, 'video/missing.webm'))
    const generated = generateGallery(runDir)
    const html = fs.readFileSync(generated.galleryPath, 'utf8')
    expect(html).toContain('Broken video reference: video/missing.webm')
    expect(html).toContain('Video unavailable: video/missing.webm')
    expect(generated.diagnostics).toEqual([
      {
        path: 'video/missing.webm',
        message: 'artifact unavailable: referenced file is missing or unreadable',
      },
    ])
  })

  it('states the all-null artifact state once for a spec and omits video layout', () => {
    const runDir = path.join(tmpDir(), 'run')
    writeRun(runDir, manifest('run', fiveShots().slice(0, 2)))
    const html = renderGallery(loadGalleryModel(runDir))
    expect((html.match(/Video not captured/g) ?? [])).toHaveLength(1)
    expect((html.match(/Trace not captured/g) ?? [])).toHaveLength(1)
    expect(html).not.toContain('<video ')
    expect(html).toContain('Video and trace absent in this run')
  })

  it('keeps the browser image-window and focus-management seams explicit', () => {
    expect(GALLERY_SCRIPT).toContain('while (live.length > 3)')
    expect(GALLERY_SCRIPT).toContain('getBoundingClientRect()')
    expect(GALLERY_SCRIPT).toContain("'IntersectionObserver' in window")
    expect(GALLERY_SCRIPT).toContain('load(cards.find')
    expect(GALLERY_SCRIPT).toContain('returnFocus?.focus()')
    expect(GALLERY_SCRIPT).toContain("location.hash === '#debug'")
    expect(GALLERY_SCRIPT).toContain("querySelectorAll('.overview-image').length")
  })
})
