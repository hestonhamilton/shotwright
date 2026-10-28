// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ArtifactEntry } from '../manifest.js'
import { isGatedPair, type ComparePair, type GalleryCompareModel } from './compare-model.js'
import type { CompareGenerationResult, GalleryShot } from './model.js'
import { escapeHtml, siblingHref, sourceLine } from './render.js'
import { VIEWER_CSS, VIEWER_DIALOG, VIEWER_SCRIPT } from './viewer.js'
import { compareProvenance, provenanceBanner, type CompareProvenance } from './provenance.js'

const stateLabels: Record<ComparePair['state'], string> = {
  identical: 'Identical',
  similar: 'Similar',
  changed: 'Changed',
  'size-changed': 'Size changed',
  added: 'Added',
  removed: 'Removed',
  unreadable: 'Unreadable',
}

const FILTER_SCRIPT = `(() => {
  const chips = [...document.querySelectorAll('[data-compare-filter]')];
  const cards = [...document.querySelectorAll('article.pair')];
  const entries = [...document.querySelectorAll('[data-compare-jump]')];
  const count = document.querySelector('#compare-result-count');
  const apply = (filter) => {
    if (location.hash.startsWith('#pair-')) {
      const target = document.getElementById(location.hash.slice(1));
      if (target && filter !== 'all' && target.dataset.compareState !== filter && !(filter === 'gated' && target.dataset.compareGated === 'true')) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
    let visible = 0;
    cards.forEach((card, index) => {
      const show = filter === 'all' || (filter === 'gated' ? card.dataset.compareGated === 'true' : card.dataset.compareState === filter);
      card.hidden = !show;
      entries[index].hidden = !show;
      if (show) visible++;
    });
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.compareFilter === filter)));
    count.textContent = visible + ' of ' + cards.length + ' pairs shown';
  };
  chips.forEach((chip) => { chip.addEventListener('click', () => apply(chip.dataset.compareFilter)); chip.disabled = false; });
  window.addEventListener('hashchange', () => {
    if (!/^#pair-\\d+$/.test(location.hash)) return;
    const target = document.getElementById(location.hash.slice(1));
    if (target && target.hidden) {
      apply('all');
      target.scrollIntoView();
    }
  });
})();`

/** Relative paths from the compare page to the A and B run directories. */
export interface CompareLinks {
  aBase?: string
  bBase?: string
}

function shotMedia(shot: GalleryShot | null, label: string, base: string, index: number): string {
  if (!shot) return `<div class="missing">${label}: no shot</div>`
  if (!shot.image)
    return `<div class="missing">${label}: ${escapeHtml(shot.imageError ?? 'image unavailable')}</div>`
  const alt = `${label} ${shot.entry.spec} ${shot.entry.name}`
  const href = siblingHref([base, shot.entry.file].join('/'))
  const filename = shot.entry.file.split('/').at(-1)!
  const id = `pair-${index}-${label.toLowerCase()}`
  return `<figure><figcaption>${label} · ${shot.image.width}×${shot.image.height}</figcaption><button class="compare-viewer-open viewer-open" type="button" disabled data-viewer-open="${id}" aria-label="View ${escapeHtml(label)} screenshot: ${escapeHtml(shot.entry.name)}"><img id="${id}" data-name="${escapeHtml(shot.entry.name)}" src="${escapeHtml(shot.image.dataUri)}" alt="${escapeHtml(alt)}"></button><a href="${escapeHtml(href)}" download="${escapeHtml(filename)}">Download ${label}</a></figure>`
}
function status(shot: GalleryShot | null, model: GalleryCompareModel, side: 'a' | 'b'): string {
  if (!shot) return 'absent'
  const gallery = model[side]
  const test = gallery.manifest.tests.find((entry) => entry.id === shot.entry.testId)
  return gallery.sourceManifestVersion === 1 ? 'unknown (v1)' : (test?.status ?? 'unknown')
}
function runBase(links: CompareLinks, model: GalleryCompareModel, side: 'a' | 'b'): string {
  // Default layout (ADR 0009): `<outputDir>/compare/<stem>.html` beside `<outputDir>/<runId>/`.
  return (side === 'a' ? links.aBase : links.bBase) ?? `../${model[side].manifest.runId}`
}
function artifactDownloads(
  pair: ComparePair,
  model: GalleryCompareModel,
  links: CompareLinks,
): string {
  const anchors = (['a', 'b'] as const).flatMap((side) => {
    const entry = pair[side] as ArtifactEntry | null
    if (!entry) return []
    const href = siblingHref([runBase(links, model, side), entry.file].join('/'))
    return [
      `<a class="download" href="${escapeHtml(href)}" download>Download ${side.toUpperCase()}</a>`,
    ]
  })
  return `<p class="downloads">${anchors.join(' · ')}</p>${pairWarning()}`
}
function pairWarning(): string {
  return '<p class="artifact-warning"><strong>File location:</strong> Keep this comparison page in the same position relative to the run folders it links to, so the download links work.</p>'
}
function renderPair(
  pair: ComparePair,
  model: GalleryCompareModel,
  index: number,
  links: CompareLinks,
  strict: boolean,
  failOnChange: boolean,
): string {
  const gated = isGatedPair(pair, strict)
  const a = pair.kind === 'shot' ? (pair.a as GalleryShot | null) : null
  const b = pair.kind === 'shot' ? (pair.b as GalleryShot | null) : null
  const numbers =
    pair.verdict?.differentPixels === null || pair.verdict?.differentPixels === undefined
      ? ''
      : `<p>${pair.verdict.differentPixels} / ${pair.verdict.totalPixels} different pixels · ratio ${pair.verdict.ratio}</p>`
  const diff = pair.verdict?.diffPng
    ? `<figure><figcaption>Diff</figcaption><button class="compare-viewer-open viewer-open" type="button" disabled data-viewer-open="pair-${index}-diff" aria-label="View Diff screenshot: ${escapeHtml(pair.name)}"><img id="pair-${index}-diff" data-name="Diff for ${escapeHtml(pair.name)}" src="data:image/png;base64,${pair.verdict.diffPng.toString('base64')}" alt="Diff for ${escapeHtml(pair.spec)} ${escapeHtml(pair.name)}"></button></figure>`
    : ''
  const artifact =
    pair.kind === 'artifact'
      ? `<p>MIME: ${escapeHtml(pair.contentType ?? (pair.b as ArtifactEntry | null)?.contentType ?? (pair.a as ArtifactEntry | null)?.contentType ?? 'unknown')}</p>${artifactDownloads(pair, model, links)}${pair.diffFormat === 'pretty-json' ? '<p class="diff-note">Diff shown pretty-printed: both JSON values are re-serialized for display. The verdict compares the source bytes.</p>' : ''}${pair.diffText ? `<pre class="diff-text">${escapeHtml(pair.diffText)}</pre>` : ''}`
      : ''
  return `<article class="pair state-${pair.state}${pair.ignored ? ' ignored' : ''}${gated ? ' gated' : ''}" id="pair-${index}" data-compare-state="${pair.state}" data-compare-gated="${gated}">
    <header><h2>${escapeHtml(pair.spec)} / ${escapeHtml(pair.name)}</h2><span class="badge">${pair.kind} · ${pair.state}${pair.ignored ? ' · ignored for gate' : ''}${gated ? (failOnChange ? ' · counted by gate' : ' · would count toward gate') : ''}</span></header>
    ${pair.kind === 'shot' ? `<p>A test: ${escapeHtml(status(a, model, 'a'))} · B test: ${escapeHtml(status(b, model, 'b'))}</p><div class="images">${shotMedia(a, 'A', runBase(links, model, 'a'), index)}${shotMedia(b, 'B', runBase(links, model, 'b'), index)}${diff}</div>${pairWarning()}${numbers}` : artifact}
    ${pair.error ? `<p class="error">${escapeHtml(pair.error)}</p>` : ''}
  </article>`
}
export function renderCompare(
  model: GalleryCompareModel,
  failOnChange = false,
  links: CompareLinks = {},
  strict = false,
): string {
  return [...renderCompareChunks(model, failOnChange, links, strict)].join('')
}

/** Yield the same bytes as renderCompare without retaining all pair sections. */
export function* renderCompareChunks(
  model: GalleryCompareModel,
  failOnChange = false,
  links: CompareLinks = {},
  strict = false,
  preparePair?: (pair: ComparePair) => () => void,
): Generator<string> {
  yield renderCompareHeader(model, failOnChange, undefined, strict)
  yield* renderComparePairChunks(model, links, strict, preparePair, failOnChange)
  yield renderCompareTail()
}

/** Close the compare page: the source-offer footer, then the document. */
export function renderCompareTail(): string {
  return `<footer>${sourceLine()}</footer></main>${VIEWER_DIALOG}<script>${VIEWER_SCRIPT}\n${FILTER_SCRIPT}</script></body></html>\n`
}

/** Render the header after pair preparation has settled any late read failures. */
export function renderCompareHeader(
  model: GalleryCompareModel,
  failOnChange = false,
  gate?: CompareGenerationResult['gate'],
  strict = false,
  provenance?: CompareProvenance,
): string {
  const provenanceResult = provenance ?? compareProvenance(model.a.manifest, model.b.manifest)
  const banner = provenanceBanner(provenanceResult)
  const provenanceStatus =
    provenanceResult.status === 'known-fields-differ'
      ? 'Render environments differ'
      : provenanceResult.status === 'unavailable'
        ? 'Render environment details incomplete'
        : 'No known render environment difference'
  const measured =
    gate?.measuredNonParity ??
    model.pairs.filter((pair) => pair.state !== 'identical' && pair.state !== 'similar').length
  const ignored =
    gate?.ignoredNonParity ??
    model.pairs.filter(
      (pair) => pair.ignored && pair.state !== 'identical' && pair.state !== 'similar',
    ).length
  const gated = model.pairs.filter((pair) => isGatedPair(pair, strict)).length
  const chips = [
    ['all', 'All', model.pairs.length],
    ...(gated ? [['gated', failOnChange ? 'Gated' : 'Would gate', gated]] : []),
    ...(Object.entries(model.counts) as [ComparePair['state'], number][])
      .filter(([, count]) => count > 0)
      .map(([state, count]) => [state, stateLabels[state], count]),
  ]
    .map(
      ([filter, label, count]) =>
        `<button type="button" class="compare-chip" data-compare-filter="${filter}" aria-pressed="${filter === 'all'}" disabled>${label} ${count}</button>`,
    )
    .join('')
  const jumps = model.pairs
    .map(
      (pair, index) =>
        `<li data-compare-jump><a href="#pair-${index}">${escapeHtml(pair.spec)} / ${escapeHtml(pair.name)} · ${stateLabels[pair.state]}</a></li>`,
    )
    .join('')
  const other = measured - model.counts.changed
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Shotwright compare — ${escapeHtml(model.a.manifest.runId)} vs ${escapeHtml(model.b.manifest.runId)}</title><style>
  :root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif;--bg:#eef2f6;--text:#17233b;--header-bg:#17233b;--header-text:white;--badge-bg:#dbe6f6;--badge-text:#163968;--panel:white;--line:#c6d2df;--state-default:#4b729e;--state-bad:#b32c37;--state-added:#b47b11;--state-gated:#7a3fa0;--gated-badge-bg:#ecdcf6;--gated-badge-text:#4a1f6b;--panel-2:#f4f6f8;--diff-bg:#152032;--diff-text:#f4f7fc;--error:#a31928;--muted:#4a5872;--accent:#195ca5}
  @media (prefers-color-scheme: dark){:root{--bg:#11151b;--text:#edf1f7;--header-bg:#1a2029;--header-text:#edf1f7;--badge-bg:#25345f;--badge-text:#edf1f7;--panel:#1a2029;--line:#3b4655;--state-default:#91adff;--state-bad:#ff9aa8;--state-added:#ffd081;--state-gated:#c99bff;--gated-badge-bg:#3a2a51;--gated-badge-text:#e6c9ff;--panel-2:#222a35;--diff-bg:#11151b;--diff-text:#edf1f7;--error:#ff9aa8;--muted:#aab4c2;--accent:#91adff}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1440px;margin:auto;padding:24px}header.top{padding:25px;background:var(--header-bg);color:var(--header-text);border-radius:16px}h1{margin:.2em 0}.badge{display:inline-block;padding:5px 11px;border-radius:20px;background:var(--badge-bg);color:var(--badge-text);font-size:.9em}.pair{padding:18px;margin:16px 0;background:var(--panel);border:1px solid var(--line);border-left:6px solid var(--state-default);border-radius:12px;overflow-wrap:anywhere}.pair[hidden],[data-compare-jump][hidden]{display:none}.pair.state-changed,.pair.state-size-changed,.pair.state-unreadable{border-left-color:var(--state-bad)}.pair.state-added,.pair.state-removed{border-left-color:var(--state-added)}.pair.state-similar.gated{border-left-color:var(--state-gated)}.pair.state-similar.gated .badge{background:var(--gated-badge-bg);color:var(--gated-badge-text)}.pair header{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap;align-items:center}.pair h2{font-size:1.15em;margin:0}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:12px}.images figure{margin:0;padding:10px;background:var(--panel-2);min-width:0}.images img{display:block;max-width:100%;max-height:420px;object-fit:contain;margin:auto}.images figcaption{font-weight:700;margin-bottom:8px}.missing{padding:40px;text-align:center;background:var(--panel-2)}.diff-text{max-height:420px;overflow:auto;padding:12px;background:var(--diff-bg);color:var(--diff-text);white-space:pre-wrap;overflow-wrap:anywhere}.error{color:var(--error)}.artifact-warning,.diff-note{font-size:.9em;color:var(--muted)}a{color:var(--accent)}footer{margin-top:24px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted)}footer .source{margin:0;font-size:.9em;overflow-wrap:anywhere;color:var(--muted)}.compare-summary{font-size:1.1em;font-weight:650;margin:10px 0}.compare-detail,.compare-jumps{margin:12px 0}.compare-detail summary,.compare-jumps summary{cursor:pointer;min-height:44px;padding:8px 0}.compare-controls{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.compare-chip{min-height:44px;padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--text);font:inherit;cursor:pointer}.compare-chip[aria-pressed="true"]{border-color:var(--accent);background:var(--badge-bg);color:var(--badge-text)}.compare-chip:disabled{opacity:.65;cursor:default}.compare-jumps ul{margin:0;padding-left:24px}.compare-jumps li{padding:5px 0;overflow-wrap:anywhere}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}@media(max-width:600px){main{padding:10px}.pair{padding:12px}header.top{padding:17px}}
  ${VIEWER_CSS}
  .compare-viewer-open{display:block;width:100%;min-height:44px;padding:0;border:0;background:transparent;border-radius:8px}.compare-viewer-open:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.viewer-dialog .action{min-height:44px;padding:7px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--accent);font:inherit;font-weight:650;cursor:pointer}.viewer-dialog .inspection-image{max-width:none;max-height:none}
  </style></head><body><main><header class="top"><p>Shotwright · compare gallery</p><h1>${escapeHtml(model.a.manifest.runId)} vs ${escapeHtml(model.b.manifest.runId)}</h1><p>A run: ${escapeHtml(model.a.manifest.status)} · B run: ${escapeHtml(model.b.manifest.status)}</p><p class="compare-summary">${gated} ${gated === 1 ? 'pair' : 'pairs'} ${failOnChange ? 'counted by gate' : 'would count toward the gate'}${model.counts.changed > 0 ? ` · Changed ${model.counts.changed}` : ''}${other > 0 ? ` · Other non-parity ${other}` : ''}</p>${strict ? `<p>Strict mode: similar pairs ${failOnChange ? 'count toward the gate' : 'would count toward the gate'} unless ignored.</p>` : ''}<p class="provenance-status">${provenanceStatus}</p><details class="compare-detail"><summary>Run and comparison details</summary><p class="provenance">${escapeHtml(banner)}</p><p>Pairing key: spec + name · threshold ${model.options.threshold} · includeAA ${model.options.includeAA} · strict ${strict ? 'on' : 'off'}</p><p>Gate: measured non-parity ${measured} · ignored non-parity ${ignored} · ${failOnChange ? 'gated pairs' : 'pairs that would count toward the gate'} ${gated} · fail-on-change ${failOnChange ? 'on' : 'off'}</p></details></header><nav aria-label="Compare filters" class="compare-controls">${chips}</nav><p id="compare-result-count" role="status">${model.pairs.length} of ${model.pairs.length} pairs shown</p>${model.pairs.length ? `<details class="compare-jumps"><summary>Jump to pair</summary><ul>${jumps}</ul></details>` : '<section class="pair"><h2>No pairs to compare</h2><p>These runs contain no matching screenshots or artifacts to compare.</p></section>'}`
}

/** Stream pair sections without retaining their inlined image bytes. */
export function* renderComparePairChunks(
  model: GalleryCompareModel,
  links: CompareLinks = {},
  strict = false,
  preparePair?: (pair: ComparePair) => () => void,
  failOnChange = false,
): Generator<string> {
  for (const [index, pair] of model.pairs.entries()) {
    if (index) yield '\n'
    const release = preparePair?.(pair)
    try {
      yield renderPair(pair, model, index, links, strict, failOnChange)
    } finally {
      release?.()
    }
  }
}
