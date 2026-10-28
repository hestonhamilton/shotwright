// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'
import { GALLERY_CSS, GALLERY_SCRIPT } from './assets.js'
import { VIEWER_CSS, VIEWER_DIALOG, VIEWER_SCRIPT } from './viewer.js'
import type { TestEntry } from '../manifest.js'
import type { ArtifactReference, GalleryModel, GalleryShot, GallerySpec } from './model.js'
import { validateRelativePath } from './model.js'
import { shotwrightSource, type ShotwrightSource } from '../version.js'

export const siblingWarning = 'requires this gallery beside the run directory'

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  )
}

function number(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function count(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`
}

export function siblingHref(relativePath: string): string {
  return relativePath
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/')
}

function elapsed(startedAt: string, finishedAt: string): string {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt)
  return Number.isFinite(duration) && duration >= 0
    ? `${(duration / 1000).toFixed(3)} s`
    : 'Unavailable'
}

function viewportLabel(shot: GalleryShot): string {
  const viewport = shot.entry.viewport
  if (viewport === null) return 'Viewport unavailable'
  return `${viewport.width}×${viewport.height}`
}

function deviceScaleFactorLabel(shot: GalleryShot): string {
  return shot.entry.deviceScaleFactor === null
    ? 'Device scale factor unavailable'
    : `Device scale factor ${shot.entry.deviceScaleFactor}`
}

function viewportFilterLabel(shot: GalleryShot): string {
  return `${viewportLabel(shot)} · ${deviceScaleFactorLabel(shot)}`
}

interface ViewportFilter {
  key: string
  label: string
  count: number
}

function viewportFilters(model: GalleryModel): {
  filters: ViewportFilter[]
  keyFor: (shot: GalleryShot) => string
} {
  const filters: ViewportFilter[] = []
  const keys = new Map<string, string>()
  for (const spec of model.specs) {
    for (const shot of spec.shots) {
      const signature = JSON.stringify([
        shot.entry.viewport?.width ?? null,
        shot.entry.viewport?.height ?? null,
        shot.entry.deviceScaleFactor,
      ])
      let key = keys.get(signature)
      if (key === undefined) {
        key = `viewport-${filters.length}`
        keys.set(signature, key)
        filters.push({ key, label: viewportFilterLabel(shot), count: 0 })
      }
      filters.find((filter) => filter.key === key)!.count++
    }
  }
  return {
    filters,
    keyFor: (shot) =>
      keys.get(
        JSON.stringify([
          shot.entry.viewport?.width ?? null,
          shot.entry.viewport?.height ?? null,
          shot.entry.deviceScaleFactor,
        ]),
      )!,
  }
}

function renderCard(
  shot: GalleryShot,
  index: number,
  viewportKey: string,
  testStatus: string,
  test: TestEntry | undefined,
): string {
  const entry = shot.entry
  const tags = `${viewportKey}${entry.fullPage ? '' : ' cropped'}`
  const title = test?.titlePath?.join(' › ') ?? test?.title
  const search = `${entry.name} ${entry.spec} ${title ?? ''} ${entry.note ?? ''}`
    .trim()
    .toLowerCase()
  const kind = entry.fullPage ? 'full page' : 'not full page'
  const image = shot.image
  const media =
    image === null
      ? `<div class="media broken"><div><strong>Screenshot unavailable</strong><p>${escapeHtml(entry.file)}</p><p>${escapeHtml(shot.imageError ?? 'Referenced PNG is unavailable')}</p></div></div>`
      : `<button class="media viewer-open" type="button" disabled data-viewer-open="download-${index}" aria-label="View full screenshot: ${escapeHtml(entry.name)}">
            <div class="placeholder" style="aspect-ratio:${image.width}/${image.height}">
              <div class="placeholder-copy">Original available to download · ${number(image.width)}×${number(image.height)} intrinsic pixels</div>
            </div>
          </button>`
  const actions =
    image === null
      ? ''
      : `<div class="actions">
              <button class="action load-action" type="button" disabled>Load screenshot</button>
              <button class="action" type="button" disabled data-viewer-open="download-${index}" data-inspect="download-${index}">View full screenshot</button>
              <a class="action" id="download-${index}" data-original
                data-name="${escapeHtml(entry.name)}"
                data-alt="${escapeHtml(`Screenshot ${entry.name} from ${entry.spec}`)}"
                data-width="${image.width}" data-height="${image.height}"
                href="${image.dataUri}" download="${escapeHtml(entry.file.split('/').at(-1)!)}">Download original</a>
            </div>`
  const derived =
    image === null
      ? '<span>Intrinsic unavailable</span>'
      : `<span>${number(image.width)}×${number(image.height)} derived</span><span>${number(image.byteLength)} B derived</span>`
  return `<article class="card${image === null ? ' broken-reference' : ''}" data-search="${escapeHtml(search)}" data-tags="${tags}">
          ${media}
          <div class="card-body">
            <div class="card-title"><h3>${escapeHtml(entry.name)}</h3><span class="kind">${kind}</span><span class="badge test-status-${escapeHtml(testStatus)}">test: ${escapeHtml(testStatus)}</span>${entry.checked ? '<span class="badge">checked</span>' : ''}</div>
            ${title === undefined ? '' : `<p class="test-title">${escapeHtml(title)}</p>`}
            ${entry.note === undefined ? '' : `<div class="shot-note" tabindex="0" role="group" aria-label="${escapeHtml(`Note for ${entry.name}`)}">${escapeHtml(entry.note)}</div>`}
            <div class="meta"><span>${escapeHtml(viewportLabel(shot))}</span><span>${escapeHtml(deviceScaleFactorLabel(shot))}</span><span>${number(entry.durationMs)} ms</span>${derived}</div>
            ${actions}
            <details>
              <summary>All metadata</summary>
              <dl class="detailgrid">
                <div><dt>Captured</dt><dd>${escapeHtml(entry.capturedAt)}</dd></div>
                <div><dt>File</dt><dd>${escapeHtml(entry.file)}</dd></div>
                <div><dt>Capture kind</dt><dd>${entry.fullPage ? 'Full page' : 'Unknown: locator or clip'}</dd></div>
                <div><dt>Logical viewport</dt><dd>${escapeHtml(viewportLabel(shot))}</dd></div>
                <div><dt>Device scale factor</dt><dd>${entry.deviceScaleFactor === null ? 'Unavailable' : number(entry.deviceScaleFactor)}</dd></div>
                <div><dt>Screenshot duration</dt><dd>${number(entry.durationMs)} ms</dd></div>
                <div><dt>Intrinsic</dt><dd>${image === null ? 'Unavailable' : `${number(image.width)}×${number(image.height)} derived`}</dd></div>
              </dl>
            </details>
          </div>
        </article>`
}

interface ArtifactGroup {
  video: ArtifactReference | null
  trace: ArtifactReference | null
  shotCount: number
}

function artifactGroups(spec: GallerySpec): ArtifactGroup[] {
  const groups: ArtifactGroup[] = []
  const byPaths = new Map<string, ArtifactGroup>()
  for (const shot of spec.shots) {
    const key = JSON.stringify([shot.video?.path ?? null, shot.trace?.path ?? null])
    const existing = byPaths.get(key)
    if (existing) {
      existing.shotCount++
    } else {
      const group = { video: shot.video, trace: shot.trace, shotCount: 1 }
      groups.push(group)
      byPaths.set(key, group)
    }
  }
  return groups
}

function artifactLink(artifact: ArtifactReference, kind: 'video' | 'trace'): string {
  const label = kind === 'video' ? 'Download sibling video' : 'Download sibling trace'
  if (!artifact.available) {
    return `<span class="artifact-preview broken">Broken ${kind} reference: ${escapeHtml(artifact.path)}</span>`
  }
  return `<a class="action" href="${escapeHtml(siblingHref(artifact.path))}" download>${label}</a>`
}

function renderArtifactGroup(group: ArtifactGroup): string {
  if (group.video === null && group.trace === null) {
    return `<div class="artifact-group"><div class="artifact-row">
            <span class="artifact-preview absent">Video not captured</span>
            <span class="artifact-preview absent">Trace not captured</span>
          </div></div>`
  }
  const sharedLabel = `shared by ${group.shotCount} shots by identical manifest path; test title unavailable`
  const links = [
    ...(group.video === null ? [] : [artifactLink(group.video, 'video')]),
    ...(group.trace === null ? [] : [artifactLink(group.trace, 'trace')]),
  ].join('')
  const warning = `<p class="artifact-warning"><strong>Sibling-file warning:</strong> ${siblingWarning}.</p>`
  if (group.video !== null) {
    const player = group.video.available
      ? `<video controls preload="metadata" aria-label="Shared captured video" src="${escapeHtml(siblingHref(group.video.path))}"></video>`
      : `<div class="broken">Video unavailable: ${escapeHtml(group.video.path)}</div>`
    return `<figure class="artifact-group video-layout">
            <div class="video-frame">${player}</div>
            <figcaption>
              <p><strong>${sharedLabel}</strong></p>
              <div class="actions">${links}</div>
              ${warning}
            </figcaption>
          </figure>`
  }
  return `<div class="artifact-group">
          <p><strong>${sharedLabel}</strong></p>
          <div class="actions">${links}</div>
          ${warning}
        </div>`
}

function renderSpec(
  spec: GallerySpec,
  specIndex: number,
  startIndex: number,
  keyFor: (shot: GalleryShot) => string,
  testStatus: (shot: GalleryShot) => string,
  testFor: (shot: GalleryShot) => TestEntry | undefined,
  dataArtifacts: string,
): string {
  const cards = spec.shots
    .map((shot, index) =>
      renderCard(shot, startIndex + index, keyFor(shot), testStatus(shot), testFor(shot)),
    )
    .join('\n')
  const groups = artifactGroups(spec)
  const artifacts = groups.map(renderArtifactGroup).join('\n')
  return `<section class="spec" data-spec="${escapeHtml(spec.name)}" aria-labelledby="spec-${specIndex}">
      <header class="spec-head">
        <div><h2 id="spec-${specIndex}">${escapeHtml(spec.name)}</h2><p>${count(spec.shots.length, 'capture')} · manifest order</p></div>
        <a class="action" href="#artifacts-${specIndex}">Group artifacts</a>
      </header>
      <div class="cards">${cards}</div>
      <aside class="artifacts" id="artifacts-${specIndex}" aria-label="Deduplicated artifacts for ${escapeHtml(spec.name)}">
        <h3>Deduplicated artifact ${groups.length === 1 ? 'set' : 'sets'}</h3>
        <p>Exact manifest paths are shown once per shared video/trace pair.</p>
        ${artifacts}
      </aside>
      ${dataArtifacts}
    </section>`
}

const PREVIEW_CAP = 256 * 1024

function safeFile(runDir: string, file: string): string {
  const segments = validateRelativePath(file)
  const root = fs.realpathSync(runDir)
  let candidate = root
  for (const segment of segments) {
    candidate = path.join(candidate, segment)
    if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error('symlink reference')
  }
  if (!fs.statSync(candidate).isFile()) throw new Error('not a file')
  return candidate
}

function renderDataArtifacts(
  model: GalleryModel,
  runDir: string | undefined,
  spec: string,
): string {
  const artifacts = model.manifest.artifacts.filter((entry) => entry.spec === spec)
  if (artifacts.length === 0) return ''
  const cards = artifacts
    .map((entry) => {
      const href = escapeHtml(siblingHref(entry.file))
      let preview = ''
      const isText =
        entry.contentType.toLowerCase().startsWith('text/') ||
        /(?:\/|\+)json(?:;|$)/i.test(entry.contentType)
      if (isText && runDir) {
        try {
          const file = safeFile(runDir, entry.file)
          const fd = fs.openSync(file, 'r')
          const buffer = Buffer.alloc(PREVIEW_CAP + 1)
          let read: number
          try {
            read = fs.readSync(fd, buffer, 0, buffer.length, 0)
          } finally {
            fs.closeSync(fd)
          }
          let body = buffer.subarray(0, Math.min(read, PREVIEW_CAP)).toString('utf8')
          if (/(?:\/|\+)json(?:;|$)/i.test(entry.contentType) && read <= PREVIEW_CAP) {
            try {
              body = JSON.stringify(JSON.parse(body), null, 2)
            } catch {
              /* show source */
            }
          }
          const bodyBytes = Buffer.from(body)
          const truncated = read > PREVIEW_CAP || bodyBytes.length > PREVIEW_CAP
          if (bodyBytes.length > PREVIEW_CAP)
            body = bodyBytes.subarray(0, PREVIEW_CAP).toString('utf8')
          preview = `<pre class="data-preview">${escapeHtml(body)}</pre>${truncated ? '<p>Preview truncated at 256 KiB. Download the full file.</p>' : ''}`
        } catch {
          preview = '<p>Preview unavailable.</p>'
        }
      }
      return `<article class="artifact-group"><h4>${escapeHtml(entry.name)}</h4><p>${escapeHtml(entry.contentType)} · ${number(entry.bytes)} bytes</p>${preview}<a class="action" href="${href}" download>Download full file</a></article>`
    })
    .join('\n')
  return `<section class="artifacts" aria-label="Data artifacts for ${escapeHtml(spec)}"><h3>Data artifacts</h3>${cards}</section>`
}

function renderFailures(model: GalleryModel): string {
  if (model.manifest.failures.length === 0) return ''
  const tests = new Map(model.manifest.tests.map((test) => [test.id, test]))
  const rows = model.manifest.failures
    .map((failure) => {
      const test = tests.get(failure.testId)
      const files = failure.files
        .map(
          (file) =>
            `<li><a href="${escapeHtml(siblingHref(file.file))}" download>${escapeHtml(file.name)}</a> · ${escapeHtml(file.contentType)}</li>`,
        )
        .join('')
      return `<article class="artifact-group"><h3>${escapeHtml(test?.title ?? failure.testId)} · ${escapeHtml(test?.status ?? 'failed')}</h3>${test?.error ? `<p>${escapeHtml(test.error.message)}</p>` : ''}<ul>${files || '<li>No copied files</li>'}</ul></article>`
    })
    .join('\n')
  return `<section class="artifacts" aria-label="Failure evidence"><h2>Failure evidence</h2>${rows}</section>`
}

/**
 * The one-line source offer (AGPL-3.0 section 13): the generating version, licence and a plain
 * link to the repository, all from the package's own package.json. Nothing is
 * fetched; the link is only followed if a reader clicks it.
 */
export function sourceLine(source: ShotwrightSource = shotwrightSource()): string {
  const url = source.url
  const link = url
    ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(url)}</a>`
    : 'not recorded'
  return `<p class="source">Generated by shotwright ${escapeHtml(source.version)} · ${escapeHtml(source.license)} · source: ${link}</p>`
}

export function renderGallery(model: GalleryModel, runDir?: string): string {
  const { manifest } = model
  const shotCount = manifest.shots.length
  const hasArtifacts = manifest.shots.some((shot) => shot.video !== null || shot.trace !== null)
  const croppedCount = manifest.shots.filter((shot) => !shot.fullPage).length
  const { filters, keyFor } = viewportFilters(model)
  const chips = [
    `<button class="chip" type="button" data-filter="all" aria-pressed="true" disabled>All · ${shotCount}</button>`,
    ...filters.map(
      (filter) =>
        `<button class="chip" type="button" data-filter="${filter.key}" aria-pressed="false" disabled>${escapeHtml(filter.label)} · ${filter.count}</button>`,
    ),
    ...(croppedCount === 0
      ? []
      : [
          `<button class="chip" type="button" data-filter="cropped" aria-pressed="false" disabled>Not full page · ${croppedCount}</button>`,
        ]),
  ].join('\n')
  let shotIndex = 0
  const testsById = new Map(manifest.tests.map((test) => [test.id, test]))
  const testFor = (shot: GalleryShot): TestEntry | undefined =>
    shot.entry.testId === null ? undefined : testsById.get(shot.entry.testId)
  const testStatus = (shot: GalleryShot): string =>
    model.sourceManifestVersion === 1 ? 'unrecorded' : (testFor(shot)?.status ?? 'unknown')
  const specs = model.specs
    .map((spec, specIndex) => {
      const rendered = renderSpec(
        spec,
        specIndex,
        shotIndex,
        keyFor,
        testStatus,
        testFor,
        renderDataArtifacts(model, runDir, spec.name),
      )
      shotIndex += spec.shots.length
      return rendered
    })
    .join('\n')
  const artifactOnlySpecs = [...new Set(manifest.artifacts.map((entry) => entry.spec))]
    .filter((spec) => !model.specs.some((existing) => existing.name === spec))
    .map(
      (spec) =>
        `<section class="spec"><h2>${escapeHtml(spec)}</h2>${renderDataArtifacts(model, runDir, spec)}</section>`,
    )
    .join('\n')
  const content =
    shotCount === 0
      ? `<section class="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">No screenshots in this run</h2>
          <p>The manifest is valid and contains <code>shots: []</code>. This run recorded no screenshots. Check the capture configuration or run without <code>--only</code>.</p>
        </section>`
      : specs
  const only = manifest.flags.only.length === 0 ? 'None' : manifest.flags.only.join(', ')
  const publication =
    [
      !manifest.publication.gallery.ok ? 'gallery failed' : null,
      !manifest.publication.evidence.ok ? 'evidence failed' : null,
    ]
      .filter(Boolean)
      .join(', ') || 'ok'
  const statusLine =
    model.sourceManifestVersion === 1
      ? 'Run status: unrecorded (manifest v1) · publication: unrecorded'
      : `Run status: ${manifest.status} · tests: ${manifest.tests.filter((test) => test.status === 'passed').length}/${manifest.tests.length} · publication: ${publication}`
  const environment = manifest.environment
    ? `${manifest.environment.platform}${manifest.environment.distribution ? ` · ${manifest.environment.distribution.id} ${manifest.environment.distribution.versionId}` : ''}`
    : 'unavailable'
  const browsers = manifest.browsers?.length
    ? manifest.browsers
        .map(
          (browser) =>
            `${browser.project}: ${browser.name ?? 'unavailable'} ${browser.version ?? 'unavailable'}${browser.channel ? ` · configured channel ${browser.channel}` : ''} · executable ${browser.executable ? `${browser.executable.kind} ${browser.executable.path} · SHA-256 prefix ${browser.executable.sha256.slice(0, 12)}…` : 'unavailable'}`,
        )
        .join('; ')
    : 'unavailable'

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Shotwright gallery — ${escapeHtml(manifest.runId)}</title>
  <style>${GALLERY_CSS}
  ${VIEWER_CSS}
  .badge.durable.bad-status,.badge.test-status-failed,.badge.test-status-timedOut,.badge.test-status-interrupted{color:var(--bad);border-color:currentColor}
  .badge.test-status-passed{color:var(--good);border-color:currentColor}
  .data-preview{max-height:28rem;overflow:auto;padding:12px;border:1px solid #8999ad;border-radius:8px;background:#f2f5f9;color:#18202b;white-space:pre-wrap;overflow-wrap:anywhere}
  .artifact-group{overflow-wrap:anywhere}
  </style>
</head>
<body>
  <a class="skip" href="#main">Skip to gallery</a>
  <main class="shell" id="main" tabindex="-1">
    <header class="topbar" role="banner">
      <p class="eyebrow">Gallery · spec workbench</p>
      <h1>${escapeHtml(manifest.runId)}</h1>
      <div class="status">
        <span class="badge durable${manifest.status === 'failed' || manifest.status === 'timedout' || manifest.status === 'interrupted' ? ' bad-status' : ''}">${escapeHtml(statusLine)}</span>
        <span class="badge">${count(shotCount, 'shot')}</span>
        <span class="badge">${count(model.specs.length, 'spec')}</span>
        <span class="badge">${hasArtifacts ? 'Sibling artifacts grouped by identical manifest path' : 'Video and trace absent in this run'}</span>
      </div>
      ${manifest.runError ? `<p class="artifact-warning" role="alert">${escapeHtml(manifest.runError.message)}</p>` : ''}
      <details class="run-facts-disclosure">
        <summary>Run facts</summary>
        <dl class="runfacts">
        <div><dt>Started</dt><dd>${escapeHtml(manifest.startedAt)}</dd></div>
        <div><dt>Finished</dt><dd>${escapeHtml(manifest.finishedAt)}</dd></div>
        <div><dt>Elapsed</dt><dd>${elapsed(manifest.startedAt, manifest.finishedAt)}</dd></div>
        <div><dt>Versions</dt><dd>shotwright ${escapeHtml(manifest.shotwrightVersion)} · Playwright ${escapeHtml(manifest.playwrightVersion)}</dd></div>
        <div><dt>Environment</dt><dd>${escapeHtml(environment)}</dd></div>
        <div><dt>Browsers</dt><dd>${escapeHtml(browsers)}</dd></div>
        <div><dt>Only filter</dt><dd>${escapeHtml(only)}</dd></div>
        <div><dt>Video flag</dt><dd>${manifest.flags.video ? 'On' : 'Off'}</dd></div>
        <div><dt>Trace flag</dt><dd>${manifest.flags.trace ? 'On' : 'Off'}</dd></div>
        <div><dt>Manifest</dt><dd>v${manifest.manifestVersion} · ${number(model.manifestByteLength)} bytes</dd></div>
        </dl>
      </details>
      <script>
        (() => {
          const facts = document.querySelector('.run-facts-disclosure');
          const mobile = matchMedia('(max-width: 760px)');
          facts.open = !mobile.matches;
          mobile.addEventListener('change', (event) => { facts.open = !event.matches; });
          document.documentElement.classList.add('run-facts-ready');
        })();
      </script>
    </header>
    <section class="controls" aria-label="Gallery filters">
      <label><span class="eyebrow">Find a shot</span><input id="search" class="search" type="search" placeholder="Shot, spec, or test title" disabled></label>
      <div class="chips" aria-label="Viewport filters">${chips}</div>
      <p id="result-count" class="result-count" role="status">${shotCount} of ${shotCount} shots shown</p>
      <div class="keyboard" hidden><kbd>/</kbd> search · <kbd>Esc</kbd> clear · <kbd>Tab</kbd> actions. Every touch target is at least 44 px high.</div>
    </section>
    <noscript><p class="artifact-warning"><strong>JavaScript is off.</strong> Screenshot metadata and original download links remain available; overview loading, filters, and the screenshot viewer require JavaScript.</p></noscript>
    <section id="no-match" class="empty hidden" aria-live="polite"><h2>No matching screenshots</h2><p>Try another search or viewport filter.</p><button class="action" type="button" data-clear-search>Clear search</button> <button class="action" type="button" data-clear-filter>Clear filter</button></section>
    <div id="gallery-content">${content}${artifactOnlySpecs}${renderFailures(model)}</div>
    <footer role="contentinfo">Original PNGs are embedded once as download links. Sibling video and trace links require this gallery beside the run directory.${sourceLine()}</footer>
  </main>
  ${VIEWER_DIALOG}
  <div class="debug" id="debug-overlay" role="status" aria-live="polite"></div>
  <script>${VIEWER_SCRIPT}
${GALLERY_SCRIPT}</script>
</body>
</html>
`
}
