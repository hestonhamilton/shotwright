// SPDX-License-Identifier: AGPL-3.0-or-later
import { GALLERY_CSS, GALLERY_SCRIPT } from './assets.js'
import type {
  ArtifactReference,
  GalleryModel,
  GalleryShot,
  GallerySpec,
} from './model.js'

const siblingWarning = 'requires this gallery beside the run directory'

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

function siblingHref(relativePath: string): string {
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
  return Number.isFinite(duration) && duration >= 0 ? `${(duration / 1000).toFixed(3)} s` : 'Unavailable'
}

function viewportLabel(shot: GalleryShot): string {
  const viewport = shot.entry.viewport
  if (viewport === null) return 'Viewport unavailable'
  return `${viewport.width}×${viewport.height}`
}

function deviceScaleFactorLabel(shot: GalleryShot): string {
  return shot.entry.deviceScaleFactor === null
    ? 'DSF unavailable'
    : `DSF ${shot.entry.deviceScaleFactor}`
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

function renderCard(shot: GalleryShot, index: number, viewportKey: string): string {
  const entry = shot.entry
  const tags = `${viewportKey}${entry.fullPage ? '' : ' cropped'}`
  const search = `${entry.name} ${entry.spec}`.toLowerCase()
  const kind = entry.fullPage ? 'full page' : 'not full page'
  const image = shot.image
  const media =
    image === null
      ? `<div class="media broken"><div><strong>Screenshot unavailable</strong><p>${escapeHtml(entry.file)}</p><p>${escapeHtml(shot.imageError ?? 'Referenced PNG is unavailable')}</p></div></div>`
      : `<div class="media">
            <div class="placeholder" style="aspect-ratio:${image.width}/${image.height}">
              <div class="placeholder-copy">Original queued · ${number(image.width)}×${number(image.height)} intrinsic pixels</div>
            </div>
          </div>`
  const actions =
    image === null
      ? ''
      : `<div class="actions">
              <button class="action load-action" type="button">Load screenshot</button>
              <button class="action" type="button" data-inspect="download-${index}">Inspect 1:1</button>
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
            <div class="card-title"><h3>${escapeHtml(entry.name)}</h3><span class="kind">${kind}</span></div>
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

function artifactLink(
  artifact: ArtifactReference,
  kind: 'video' | 'trace',
): string {
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
): string {
  const cards = spec.shots
    .map((shot, index) => renderCard(shot, startIndex + index, keyFor(shot)))
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
    </section>`
}

export function renderGallery(model: GalleryModel): string {
  const { manifest } = model
  const shotCount = manifest.shots.length
  const hasArtifacts = manifest.shots.some((shot) => shot.video !== null || shot.trace !== null)
  const croppedCount = manifest.shots.filter((shot) => !shot.fullPage).length
  const { filters, keyFor } = viewportFilters(model)
  const chips = [
    `<button class="chip" type="button" data-filter="all" aria-pressed="true">All · ${shotCount}</button>`,
    ...filters.map(
      (filter) =>
        `<button class="chip" type="button" data-filter="${filter.key}" aria-pressed="false">${escapeHtml(filter.label)} · ${filter.count}</button>`,
    ),
    ...(croppedCount === 0
      ? []
      : [
          `<button class="chip" type="button" data-filter="cropped" aria-pressed="false">Not full page · ${croppedCount}</button>`,
        ]),
  ].join('\n')
  let shotIndex = 0
  const specs = model.specs
    .map((spec, specIndex) => {
      const rendered = renderSpec(spec, specIndex, shotIndex, keyFor)
      shotIndex += spec.shots.length
      return rendered
    })
    .join('\n')
  const content =
    shotCount === 0
      ? `<section class="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">No screenshots in this run</h2>
          <p>The manifest is valid and contains <code>shots: []</code>. Try a run without <code>--only</code>, or check the active filter.</p>
        </section>`
      : specs
  const only = manifest.flags.only.length === 0 ? 'None' : manifest.flags.only.join(', ')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Shotwright gallery — ${escapeHtml(manifest.runId)}</title>
  <style>${GALLERY_CSS}</style>
</head>
<body>
  <a class="skip" href="#main">Skip to gallery</a>
  <main class="shell" id="main" tabindex="-1">
    <header class="topbar" role="banner">
      <p class="eyebrow">Gallery · spec workbench</p>
      <h1>${escapeHtml(manifest.runId)}</h1>
      <div class="status">
        <span class="badge durable">Published manifest · pass/fail status is not embedded</span>
        <span class="badge">${count(shotCount, 'shot')}</span>
        <span class="badge">${count(model.specs.length, 'spec')}</span>
        <span class="badge">${hasArtifacts ? 'Sibling artifacts grouped by identical manifest path' : 'Video and trace absent in this run'}</span>
      </div>
      <dl class="runfacts">
        <div><dt>Started</dt><dd>${escapeHtml(manifest.startedAt)}</dd></div>
        <div><dt>Finished</dt><dd>${escapeHtml(manifest.finishedAt)}</dd></div>
        <div><dt>Elapsed</dt><dd>${elapsed(manifest.startedAt, manifest.finishedAt)}</dd></div>
        <div><dt>Versions</dt><dd>shotwright ${escapeHtml(manifest.shotwrightVersion)} · Playwright ${escapeHtml(manifest.playwrightVersion)}</dd></div>
        <div><dt>Only filter</dt><dd>${escapeHtml(only)}</dd></div>
        <div><dt>Video flag</dt><dd>${manifest.flags.video ? 'On' : 'Off'}</dd></div>
        <div><dt>Trace flag</dt><dd>${manifest.flags.trace ? 'On' : 'Off'}</dd></div>
        <div><dt>Manifest</dt><dd>v${manifest.manifestVersion} · ${number(model.manifestByteLength)} bytes</dd></div>
      </dl>
    </header>
    <section class="controls" aria-label="Gallery filters">
      <label><span class="eyebrow">Find a shot</span><input id="search" class="search" type="search" placeholder="Name or spec, press / to focus"></label>
      <div class="chips" aria-label="Viewport filters">${chips}</div>
      <div class="keyboard"><kbd>/</kbd> search · <kbd>Esc</kbd> clear · <kbd>Tab</kbd> actions. Every touch target is at least 44 px high.</div>
    </section>
    <noscript><p class="artifact-warning"><strong>JavaScript is off.</strong> Screenshot metadata and original download links remain available; overview loading, filters, and 1:1 inspection require JavaScript.</p></noscript>
    <div id="gallery-content">${content}</div>
    <footer role="contentinfo">Original PNGs are embedded once as download links. Sibling video and trace links ${siblingWarning}.</footer>
  </main>
  <dialog id="inspection-dialog" aria-labelledby="inspection-title">
    <div class="dialog-head"><h2 id="inspection-title">1:1 inspection</h2><form method="dialog"><button class="action" type="submit" data-close>Close</button></form></div>
    <div class="inspection-surface" tabindex="0"></div>
  </dialog>
  <div class="debug" id="debug-overlay" role="status" aria-live="polite"></div>
  <script>${GALLERY_SCRIPT}</script>
</body>
</html>
`
}
