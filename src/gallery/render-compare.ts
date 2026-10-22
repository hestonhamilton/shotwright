// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ArtifactEntry } from '../manifest.js'
import type { ComparePair, GalleryCompareModel } from './compare-model.js'
import type { GalleryShot } from './model.js'
import { escapeHtml } from './render.js'

function shotMedia(shot: GalleryShot | null, label: string): string {
  if (!shot) return `<div class="missing">${label}: no shot</div>`
  if (!shot.image)
    return `<div class="missing">${label}: ${escapeHtml(shot.imageError ?? 'image unavailable')}</div>`
  const alt = `${label} ${shot.entry.spec} ${shot.entry.name}`
  return `<figure><figcaption>${label} · ${shot.image.width}×${shot.image.height}</figcaption><img src="${escapeHtml(shot.image.dataUri)}" alt="${escapeHtml(alt)}"><a href="${escapeHtml(shot.image.dataUri)}" download="${escapeHtml(shot.entry.name)}.png">Download ${label}</a></figure>`
}
function status(shot: GalleryShot | null, model: GalleryCompareModel, side: 'a' | 'b'): string {
  if (!shot) return 'absent'
  const gallery = model[side]
  const test = gallery.manifest.tests.find((entry) => entry.id === shot.entry.testId)
  return gallery.sourceManifestVersion === 1 ? 'unknown (v1)' : (test?.status ?? 'unknown')
}
function renderPair(pair: ComparePair, model: GalleryCompareModel, index: number): string {
  const a = pair.kind === 'shot' ? (pair.a as GalleryShot | null) : null
  const b = pair.kind === 'shot' ? (pair.b as GalleryShot | null) : null
  const numbers =
    pair.verdict?.differentPixels === null || pair.verdict?.differentPixels === undefined
      ? ''
      : `<p>${pair.verdict.differentPixels} / ${pair.verdict.totalPixels} different pixels · ratio ${pair.verdict.ratio}</p>`
  const diff = pair.verdict?.diffPng
    ? `<figure><figcaption>Diff</figcaption><img src="data:image/png;base64,${pair.verdict.diffPng.toString('base64')}" alt="Diff for ${escapeHtml(pair.spec)} ${escapeHtml(pair.name)}"></figure>`
    : ''
  const artifact =
    pair.kind === 'artifact'
      ? `<p>MIME: ${escapeHtml(pair.contentType ?? (pair.b as ArtifactEntry | null)?.contentType ?? (pair.a as ArtifactEntry | null)?.contentType ?? 'unknown')}</p>${pair.diffText ? `<pre class="diff-text">${escapeHtml(pair.diffText)}</pre>` : ''}`
      : ''
  return `<article class="pair state-${pair.state}" id="pair-${index}">
    <header><h2>${escapeHtml(pair.spec)} / ${escapeHtml(pair.name)}</h2><span class="badge">${pair.kind} · ${pair.state}</span></header>
    ${pair.kind === 'shot' ? `<p>A test: ${escapeHtml(status(a, model, 'a'))} · B test: ${escapeHtml(status(b, model, 'b'))}</p><div class="images">${shotMedia(a, 'A')}${shotMedia(b, 'B')}${diff}</div>${numbers}` : artifact}
    ${pair.error ? `<p class="error">${escapeHtml(pair.error)}</p>` : ''}
  </article>`
}
export function renderCompare(model: GalleryCompareModel, failOnChange = false): string {
  const nonParity = model.pairs.filter(
    (pair) => pair.state !== 'identical' && pair.state !== 'similar',
  ).length
  const counts = Object.entries(model.counts)
    .map(([state, count]) => `<span class="badge">${state}: ${count}</span>`)
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'"><title>Shotwright compare — ${escapeHtml(model.a.manifest.runId)} vs ${escapeHtml(model.b.manifest.runId)}</title><style>
  :root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#17233b}main{max-width:1440px;margin:auto;padding:24px}header.top{padding:25px;background:#17233b;color:white;border-radius:16px}h1{margin:.2em 0}.counts{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.badge{display:inline-block;padding:5px 11px;border-radius:20px;background:#dbe6f6;color:#163968;font-size:.9em}.pair{padding:18px;margin:16px 0;background:white;border:1px solid #c6d2df;border-left:6px solid #4b729e;border-radius:12px;overflow-wrap:anywhere}.pair.state-changed,.pair.state-size-changed,.pair.state-unreadable{border-left-color:#b32c37}.pair.state-added,.pair.state-removed{border-left-color:#b47b11}.pair header{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap;align-items:center}.pair h2{font-size:1.15em;margin:0}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:12px}.images figure{margin:0;padding:10px;background:#f4f6f8;min-width:0}.images img{display:block;max-width:100%;max-height:420px;object-fit:contain;margin:auto}.images figcaption{font-weight:700;margin-bottom:8px}.missing{padding:40px;text-align:center;background:#f4f6f8}.diff-text{max-height:420px;overflow:auto;padding:12px;background:#152032;color:#f4f7fc;white-space:pre-wrap;overflow-wrap:anywhere}.error{color:#a31928}a{color:#195ca5}@media(max-width:600px){main{padding:10px}.pair{padding:12px}header.top{padding:17px}}
  </style></head><body><main><header class="top"><p>Shotwright · compare gallery</p><h1>${escapeHtml(model.a.manifest.runId)} vs ${escapeHtml(model.b.manifest.runId)}</h1><p>A run: ${escapeHtml(model.a.manifest.status)} · B run: ${escapeHtml(model.b.manifest.status)}</p><p>Pairing key: spec + name · threshold ${model.options.threshold} · includeAA ${model.options.includeAA}</p><p>Gate: ${nonParity} non-parity pair${nonParity === 1 ? '' : 's'} · fail-on-change ${failOnChange ? 'on' : 'off'}</p></header><section class="counts" aria-label="Verdict counts">${counts}</section>${model.pairs.map((pair, index) => renderPair(pair, model, index)).join('\n')}</main></body></html>\n`
}
