// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CompareModel, ComparePair, ComparePairState } from './compare-model.js'
import type { GalleryShot } from './model.js'
import { escapeHtml } from './render.js'

type CompareSide = 'a' | 'b'
type MediaSize = 'tile' | 'detail'

const COMPARE_CSS = String.raw`
:root{color-scheme:light dark;--bg:#f4f5f7;--panel:#fff;--panel-2:#eef1f5;--text:#18202b;--muted:#5d6876;--line:#cbd2dc;--accent:#2855c7;--accent-soft:#e7edff;--warn:#9a4b09;--bad:#ae2535;--good:#1d704d;--shadow:0 10px 28px rgb(28 37 53 / 10%)}
@media(prefers-color-scheme:dark){:root{--bg:#11151b;--panel:#1a2029;--panel-2:#222a35;--text:#edf1f7;--muted:#aab4c2;--line:#3b4655;--accent:#91adff;--accent-soft:#25345f;--warn:#ffc080;--bad:#ff9aa8;--good:#78d9ae;--shadow:0 12px 32px rgb(0 0 0 / 28%)}}
*{box-sizing:border-box}html,body{overflow-x:hidden}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a,button,input{min-height:44px;font:inherit}a{display:inline-flex;align-items:center;color:var(--accent);overflow-wrap:anywhere}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.skip{position:fixed;left:12px;top:-60px;z-index:20;padding:8px 12px;background:var(--panel);border:2px solid var(--accent);border-radius:8px}.skip:focus{top:12px}.shell{width:min(1560px,100%);margin:0 auto;padding:20px}.topbar{padding:22px;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--shadow)}.eyebrow{margin:0 0 5px;color:var(--accent);font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;overflow-wrap:anywhere;font-size:clamp(22px,4vw,34px);line-height:1.1}.status,.chips,.meta,.actions,.asset-links{display:flex;flex-wrap:wrap;gap:8px}.status{margin-top:12px}.badge,.chip{display:inline-flex;align-items:center;min-height:32px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel-2);color:var(--text);font-size:13px}.badge.review{color:var(--good);border-color:currentColor;font-weight:700}.badge.warn{color:var(--warn);border-color:currentColor;font-weight:700}.badge.bad{color:var(--bad);border-color:currentColor;font-weight:700}.runfacts{display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:10px;margin:18px 0 0}.runfacts div{min-width:0;padding:10px;border-left:2px solid var(--line)}dt{color:var(--muted);font-size:12px}dd{margin:2px 0 0;overflow-wrap:anywhere;font-weight:650}.controls{position:sticky;z-index:5;top:0;display:grid;grid-template-columns:minmax(230px,1fr) auto;gap:12px;margin:16px 0;padding:12px;border:1px solid var(--line);border-radius:13px;background:color-mix(in srgb,var(--panel) 94%,transparent);backdrop-filter:blur(10px)}.search{width:100%;border:1px solid var(--line);border-radius:9px;padding:0 13px;background:var(--panel);color:var(--text)}.chip{min-height:44px;cursor:pointer}.chip[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}.note{grid-column:1/-1;color:var(--muted);font-size:12px}.keyboard{grid-column:1/-1;color:var(--muted);font-size:12px}kbd{padding:2px 5px;border:1px solid var(--line);border-radius:4px;background:var(--panel-2)}.state-copy{margin:16px 0;padding:13px 16px;border-left:5px solid var(--warn);border-radius:9px;background:var(--panel)}.board{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(360px,.85fr);gap:16px;align-items:start}.sheet,.detail{border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:clip}.sheet-head,.detail-head{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line)}.sheet-head h2,.detail-head h2{margin:0;font-size:20px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:14px}.grid:empty{display:none}.tile{display:block;min-width:0;border:1px solid var(--line);border-radius:13px;background:var(--panel);overflow:hidden;text-decoration:none;color:var(--text)}.tile[aria-current="true"]{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.tile.problem{border-left:5px solid var(--bad)}.tile.unmatched{border-left:5px solid var(--warn)}.tile-head{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;border-bottom:1px solid var(--line)}.tile-head strong{overflow-wrap:anywhere}.thumbs{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)}.thumb{min-height:132px;display:grid;place-items:center;padding:8px;background:linear-gradient(45deg,var(--panel-2) 25%,transparent 25%) 0 0/16px 16px,var(--bg)}.thumb img{display:block;max-width:100%;max-height:118px;border:1px solid var(--line);background:var(--panel)}.queued{text-align:center;color:var(--muted);font-size:12px}.blank{min-height:132px;display:grid;place-items:center;padding:10px;text-align:center;background:var(--panel);color:var(--muted)}.blank strong{display:block;color:var(--bad)}.tile-meta{display:flex;flex-wrap:wrap;gap:6px;padding:9px 10px}.tile-meta span{padding:3px 6px;border-radius:6px;background:var(--panel-2);color:var(--muted);font-size:12px}.detail-stack{position:sticky;top:96px}.pair-large{display:grid;grid-template-columns:1fr 1fr}.pane{border-right:1px solid var(--line);min-width:0}.pane:last-child{border-right:0}.pane-title{display:flex;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);color:var(--muted);font-size:12px}.media{display:grid;place-items:center;min-height:260px;padding:18px;background:linear-gradient(45deg,var(--panel-2) 25%,transparent 25%) 0 0/18px 18px,linear-gradient(-45deg,var(--panel-2) 25%,transparent 25%) 0 0/18px 18px,var(--bg)}.media img{display:block;width:100%;max-width:560px;max-height:380px;object-fit:contain;border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow)}.missing{min-height:260px;display:grid;place-items:center;padding:22px;text-align:center;border-left:5px solid var(--bad);background:var(--panel);overflow-wrap:anywhere}.missing strong{color:var(--bad)}.meta{margin:10px 12px 12px}.meta span{padding:4px 7px;border-radius:6px;background:var(--panel-2);font-size:12px}.detail-body{padding:14px;border-top:1px solid var(--line)}.detail-body p{margin:0 0 12px;color:var(--muted)}.action{justify-content:center;padding:7px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--accent);text-decoration:none;font-weight:650;cursor:pointer}.section-label{margin:18px 0 8px;padding-left:14px;color:var(--muted);font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.empty{margin:16px 0;padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}.empty h2{margin-top:0}footer{margin:26px 0 8px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted)}dialog{width:min(94vw,1300px);max-height:92vh;padding:0;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text)}dialog::backdrop{background:rgb(0 0 0 / 72%)}.dialog-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel)}.dialog-head h2{margin:0}.inspection-surface{min-height:70vh;overflow:auto;padding:18px;background:var(--bg)}.inspection-surface img{display:block;max-width:none}.no-results{padding:0 14px 14px;color:var(--muted)}[hidden]{display:none!important}
.tile-head strong{flex:1 0 min-content;min-width:min-content;overflow-wrap:normal;word-break:normal;hyphens:manual}
.tile-head .badge{flex:0 1 auto;min-width:0;text-align:center;white-space:normal}
.missing strong{display:block}
@media(max-width:1100px){.board{grid-template-columns:1fr}.detail-stack{position:static}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.shell{padding:10px}.topbar{padding:16px}.runfacts{grid-template-columns:repeat(2,minmax(0,1fr))}.controls{grid-template-columns:1fr}.chips{flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px}.chip{flex:0 0 auto}.grid{grid-template-columns:1fr;padding:10px}.pair-large{grid-template-columns:1fr}.pane{border-right:0;border-bottom:1px solid var(--line)}.pane:last-child{border-bottom:0}}
`

const COMPARE_SCRIPT = String.raw`
(() => {
  const tiles = [...document.querySelectorAll('.tile')]
  const details = [...document.querySelectorAll('.detail')]
  const selectedBadge = document.querySelector('[data-selected-badge]')
  const search = document.querySelector('#compare-search')
  const chips = [...document.querySelectorAll('.chip')]
  const noResults = document.querySelector('.no-results')
  const dialog = document.querySelector('#inspection-dialog')
  const inspectionSurface = dialog?.querySelector('.inspection-surface')
  const liveTiles = []
  let selected = 0
  let activeFilter = 'all'

  function source(assetId) {
    return document.getElementById(assetId)
  }

  function loadSlot(slot) {
    if (slot.querySelector('img')) return
    const original = source(slot.dataset.assetId)
    if (!original) return
    const image = document.createElement('img')
    image.src = original.href
    image.alt = original.dataset.alt
    image.loading = slot.dataset.size === 'tile' ? 'lazy' : 'eager'
    slot.replaceChildren(image)
  }

  function clearSlots(container) {
    for (const slot of container.querySelectorAll('[data-asset-id]')) {
      if (!slot.querySelector('img')) continue
      const queued = document.createElement('span')
      queued.className = 'queued'
      queued.textContent = slot.dataset.queued
      slot.replaceChildren(queued)
    }
  }

  function loadTile(tile) {
    for (const slot of tile.querySelectorAll('[data-asset-id]')) loadSlot(slot)
    const previous = liveTiles.indexOf(tile)
    if (previous !== -1) liveTiles.splice(previous, 1)
    liveTiles.push(tile)
    while (liveTiles.length > 3) {
      const removableIndex = liveTiles.findIndex((candidate) => candidate.getAttribute('aria-current') !== 'true')
      if (removableIndex === -1) break
      clearSlots(liveTiles.splice(removableIndex, 1)[0])
    }
  }

  function select(index) {
    selected = index
    for (const [tileIndex, tile] of tiles.entries()) {
      tile.setAttribute('aria-current', tileIndex === index ? 'true' : 'false')
    }
    for (const [detailIndex, detail] of details.entries()) {
      const show = detailIndex === index
      detail.hidden = !show
      if (show) {
        for (const slot of detail.querySelectorAll('[data-asset-id]')) loadSlot(slot)
      } else {
        clearSlots(detail)
      }
    }
    if (selectedBadge) selectedBadge.textContent = 'selected: ' + tiles[index].dataset.key
    loadTile(tiles[index])
  }

  function applyFilters() {
    const query = search.value.trim().toLowerCase()
    let visible = 0
    for (const tile of tiles) {
      const tags = tile.dataset.tags.split(' ')
      const matchesFilter = activeFilter === 'all' || tags.includes(activeFilter)
      const matchesSearch = tile.dataset.search.includes(query)
      tile.hidden = !(matchesFilter && matchesSearch)
      if (!tile.hidden) visible++
    }
    if (noResults) noResults.hidden = visible !== 0
  }

  for (const [index, tile] of tiles.entries()) {
    tile.addEventListener('click', (event) => {
      event.preventDefault()
      select(index)
    })
    tile.addEventListener('focus', () => loadTile(tile))
    tile.addEventListener('pointerenter', () => loadTile(tile))
  }

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter
      for (const candidate of chips) candidate.setAttribute('aria-pressed', String(candidate === chip))
      applyFilters()
    })
  }

  search?.addEventListener('input', applyFilters)
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== search) {
      event.preventDefault()
      search?.focus()
    } else if (event.key === 'Escape' && document.activeElement === search) {
      search.value = ''
      applyFilters()
    }
  })

  for (const button of document.querySelectorAll('[data-inspect-asset]')) {
    button.addEventListener('click', () => {
      const original = source(button.dataset.inspectAsset)
      if (!original || !dialog || !inspectionSurface) return
      const image = document.createElement('img')
      image.src = original.href
      image.alt = original.dataset.alt
      inspectionSurface.replaceChildren(image)
      dialog.showModal()
    })
  }

  dialog?.addEventListener('close', () => inspectionSurface?.replaceChildren())
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) loadTile(entry.target)
    }, { rootMargin: '100px' })
    for (const tile of tiles) observer.observe(tile)
  }
  if (tiles.length > 0) select(selected)
})()
`

function number(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function count(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`
}

function viewportLabel(shot: GalleryShot): string {
  const viewport = shot.entry.viewport
  return viewport === null ? 'Viewport unavailable' : `${viewport.width}×${viewport.height}`
}

function deviceScaleFactorLabel(shot: GalleryShot): string {
  return shot.entry.deviceScaleFactor === null
    ? 'DSF unavailable'
    : `DSF ${shot.entry.deviceScaleFactor}`
}

function assetId(index: number, side: CompareSide): string {
  return `compare-asset-${index}-${side}`
}

function pairStateLabel(state: ComparePairState): string {
  if (state === 'a-only') return 'unmatched by name · A only'
  if (state === 'b-only') return 'unmatched by name · B only'
  if (state === 'not-comparable') return 'not comparable · unreadable image'
  return 'paired'
}

function badgeClass(state: ComparePairState): string {
  if (state === 'not-comparable') return 'badge bad'
  if (state === 'a-only' || state === 'b-only') return 'badge warn'
  return 'badge'
}

function filterToken(kind: string, value: string): string {
  return `${kind}-${encodeURIComponent(value)}`
}

function pairViewportLabels(pair: ComparePair): string[] {
  return [...new Set([pair.a, pair.b].filter((shot): shot is GalleryShot => shot !== null).map(
    (shot) => `${viewportLabel(shot)} · ${deviceScaleFactorLabel(shot)}`,
  ))]
}

function pairFilterTags(pair: ComparePair): string {
  return [
    ...(pair.state === 'paired' ? [] : ['problem']),
    filterToken('spec', pair.spec),
    ...pairViewportLabels(pair).map((label) => filterToken('viewport', label)),
  ].join(' ')
}

function renderHeader(model: CompareModel): string {
  const { a, b, counts, pairs } = model
  const aManifest = a.manifest
  const bManifest = b.manifest
  const selected = pairs[0]
  const status = [
    '<span class="badge review">Review artifact · no verdicts</span>',
    `<span class="badge">${counts.total} name buckets</span>`,
    ...(counts.unmatchedByName === 0
      ? []
      : [`<span class="badge warn">${counts.unmatchedByName} unmatched by name</span>`]),
    ...(counts.notComparable === 0
      ? []
      : [`<span class="badge bad">${count(counts.notComparable, 'unreadable image')}</span>`]),
    ...(selected === undefined
      ? []
      : [`<span class="badge" data-selected-badge>selected: ${escapeHtml(selected.key)}</span>`]),
  ].join('\n')
  const onlyLabel = (values: string[]): string => values.length === 0 ? 'none' : values.join(', ')
  const emptySide =
    aManifest.shots.length === 0 && bManifest.shots.length > 0
      ? `<div><dt>Empty side</dt><dd>${escapeHtml(aManifest.runId)} has no shots</dd></div>`
      : bManifest.shots.length === 0 && aManifest.shots.length > 0
        ? `<div><dt>Empty side</dt><dd>${escapeHtml(bManifest.runId)} has no shots</dd></div>`
        : ''

  return `<header class="topbar" role="banner">
      <p class="eyebrow">Compare gallery · contact sheet triage</p>
      <h1>${escapeHtml(aManifest.runId)} compared with ${escapeHtml(bManifest.runId)}</h1>
      <div class="status">${status}</div>
      <dl class="runfacts">
        <div><dt>A run</dt><dd>${escapeHtml(aManifest.runId)} · ${count(aManifest.shots.length, 'shot')}</dd></div>
        <div><dt>B run</dt><dd>${escapeHtml(bManifest.runId)} · ${count(bManifest.shots.length, 'shot')}</dd></div>
        <div><dt>Pairing key</dt><dd>exact shot name</dd></div>
        <div><dt>Ordering</dt><dd>attention states first, then spec order</dd></div>
        <div><dt>Manifest</dt><dd>v${aManifest.manifestVersion} · A ${number(a.manifestByteLength)} bytes · B ${number(b.manifestByteLength)} bytes</dd></div>
        <div><dt>Versions</dt><dd>A shotwright ${escapeHtml(aManifest.shotwrightVersion)} / Playwright ${escapeHtml(aManifest.playwrightVersion)} · B shotwright ${escapeHtml(bManifest.shotwrightVersion)} / Playwright ${escapeHtml(bManifest.playwrightVersion)}</dd></div>
        <div><dt>Flags</dt><dd>A only ${escapeHtml(onlyLabel(aManifest.flags.only))} · video ${aManifest.flags.video ? 'on' : 'off'} · trace ${aManifest.flags.trace ? 'on' : 'off'}; B only ${escapeHtml(onlyLabel(bManifest.flags.only))} · video ${bManifest.flags.video ? 'on' : 'off'} · trace ${bManifest.flags.trace ? 'on' : 'off'}</dd></div>
        <div><dt>Rename copy</dt><dd>visible in the sheet and selected detail</dd></div>
        ${emptySide}
      </dl>
    </header>`
}

function renderControls(model: CompareModel): string {
  const specs = [...new Set(model.pairs.map((pair) => pair.spec))]
  const viewports = [...new Set(model.pairs.flatMap(pairViewportLabels))]
  const problemCount = model.counts.unmatchedByName + model.counts.notComparable
  const chips = [
    `<button class="chip" type="button" data-filter="all" aria-pressed="true">All · ${model.counts.total}</button>`,
    `<button class="chip" type="button" data-filter="problem" aria-pressed="false">Problem states · ${problemCount}</button>`,
    ...specs.map((spec) => {
      const token = filterToken('spec', spec)
      const specCount = model.pairs.filter((pair) => pair.spec === spec).length
      return `<button class="chip" type="button" data-filter="${escapeHtml(token)}" aria-pressed="false">${escapeHtml(spec)} · ${specCount}</button>`
    }),
    ...viewports.map((label) => {
      const token = filterToken('viewport', label)
      const viewportCount = model.pairs.filter((pair) => pairViewportLabels(pair).includes(label)).length
      return `<button class="chip" type="button" data-filter="${escapeHtml(token)}" aria-pressed="false">${escapeHtml(label)} · ${viewportCount}</button>`
    }),
  ].join('\n')

  return `<section class="controls" aria-label="Compare filters">
      <label><span class="eyebrow">Find a shot</span><input id="compare-search" class="search" type="search" placeholder="Search name or spec"></label>
      <div class="chips">${chips}</div>
      <p class="note">The sheet surfaces unusual states first without computing whether pixels are good or bad. It labels presence, pairing, and readability only.</p>
      <div class="keyboard"><kbd>/</kbd> search · <kbd>Esc</kbd> clear · <kbd>Tab</kbd> select a pair or action.</div>
    </section>`
}

function renderSideMedia(
  side: CompareSide,
  pair: ComparePair,
  size: MediaSize,
  index: number,
): string {
  const shot = pair[side]
  const sideLabel = side.toUpperCase()
  if (shot === null) {
    return `<div class="${size === 'tile' ? 'blank' : 'missing'}"><span><strong>${sideLabel} has no name match</strong>unmatched by name</span></div>`
  }
  if (shot.image === null) {
    return `<div class="${size === 'tile' ? 'blank' : 'missing'}"><span><strong>${sideLabel} image unavailable</strong>${escapeHtml(shot.entry.file)}<br>${escapeHtml(shot.imageError ?? 'Referenced PNG is unavailable')}</span></div>`
  }
  const queued = `Original queued · ${number(shot.image.width)}×${number(shot.image.height)} intrinsic pixels`
  return `<div class="${size === 'tile' ? 'thumb' : 'media'}" data-asset-id="${assetId(index, side)}" data-size="${size}" data-queued="${escapeHtml(queued)}"><span class="queued">${queued}</span></div>`
}

function renderSideMeta(shot: GalleryShot | null): string {
  if (shot === null) return '<div class="meta"><span>No manifest entry</span></div>'
  const imageMeta = shot.image === null
    ? '<span>Intrinsic unavailable</span>'
    : `<span>${number(shot.image.width)}×${number(shot.image.height)} intrinsic</span><span>${number(shot.image.byteLength)} B</span>`
  return `<div class="meta"><span>${escapeHtml(viewportLabel(shot))}</span><span>${escapeHtml(deviceScaleFactorLabel(shot))}</span><span>${shot.entry.fullPage ? 'full page' : 'cropped'}</span><span>${number(shot.entry.durationMs)} ms</span>${imageMeta}</div>`
}

function renderActions(pair: ComparePair, index: number): string {
  const actions = (['a', 'b'] as const).flatMap((side) => {
    const shot = pair[side]
    if (shot?.image === null || shot === null) return []
    const id = assetId(index, side)
    const sideLabel = side.toUpperCase()
    const filename = shot.entry.file.split('/').at(-1)!
    return [
      `<button class="action" type="button" data-inspect-asset="${id}">Inspect ${sideLabel} 1:1</button>`,
      `<a class="action" id="${id}" data-alt="${escapeHtml(`${sideLabel} screenshot ${shot.entry.name} from ${shot.entry.spec}`)}" href="${shot.image.dataUri}" download="${escapeHtml(filename)}">Download ${sideLabel} original</a>`,
    ]
  })
  return actions.length === 0 ? '' : `<div class="actions">${actions.join('\n')}</div>`
}

function renderPairTile(pair: ComparePair, index: number): string {
  const cssState = pair.state === 'not-comparable'
    ? ' problem'
    : pair.state === 'paired'
      ? ''
      : ' unmatched'
  const search = `${pair.key} ${pair.spec}`.toLowerCase()
  const representative = pair.a ?? pair.b
  return `<a class="tile${cssState}" href="#pair-${index}" aria-current="${index === 0 ? 'true' : 'false'}" data-key="${escapeHtml(pair.key)}" data-search="${escapeHtml(search)}" data-tags="${escapeHtml(pairFilterTags(pair))}">
      <div class="tile-head"><strong>${escapeHtml(pair.key)}</strong><span class="${badgeClass(pair.state)}">${pairStateLabel(pair.state)}</span></div>
      <div class="thumbs">${renderSideMedia('a', pair, 'tile', index)}${renderSideMedia('b', pair, 'tile', index)}</div>
      <div class="tile-meta"><span>${escapeHtml(pair.spec)}</span>${representative === null ? '' : `<span>${escapeHtml(viewportLabel(representative))}</span><span>${escapeHtml(deviceScaleFactorLabel(representative))}</span>`}</div>
    </a>`
}

function renderDetail(pair: ComparePair, index: number): string {
  const reason = pair.notComparableReason === null
    ? ''
    : `<p><strong>Unreadable detail:</strong> ${escapeHtml(pair.notComparableReason)}</p>`
  return `<aside class="detail" id="pair-${index}" aria-labelledby="detail-title-${index}"${index === 0 ? '' : ' hidden'}>
      <header class="detail-head"><div><h2 id="detail-title-${index}">${escapeHtml(pair.key)}</h2><p class="note">Selected pair detail</p></div><span class="${badgeClass(pair.state)}">${pairStateLabel(pair.state)}</span></header>
      <div class="pair-large">
        <section class="pane"><div class="pane-title"><strong>A</strong><span>${pair.a === null ? 'no name match' : pair.a.entry.fullPage ? 'full page' : 'cropped'}</span></div>${renderSideMedia('a', pair, 'detail', index)}${renderSideMeta(pair.a)}</section>
        <section class="pane"><div class="pane-title"><strong>B</strong><span>${pair.b === null ? 'no name match' : pair.b.entry.fullPage ? 'full page' : 'cropped'}</span></div>${renderSideMedia('b', pair, 'detail', index)}${renderSideMeta(pair.b)}</section>
      </div>
      <div class="detail-body">
        ${reason}
        <p>A-only and B-only shots are unmatched by name. A rename appears as two unmatched buckets because manifests contain no rename lineage.</p>
        <p>Unreadable images stay in the sheet with a red state and are not presented as successful visual comparisons.</p>
        ${renderActions(pair, index)}
      </div>
    </aside>`
}

function renderSheet(model: CompareModel): string {
  const attention = model.pairs
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair }) => pair.state !== 'paired')
  const context = model.pairs
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair }) => pair.state === 'paired')
  const renderSection = (
    label: string,
    entries: { pair: ComparePair; index: number }[],
  ): string => entries.length === 0
    ? ''
    : `<p class="section-label">${label}</p>
        <div class="grid">${entries.map(({ pair, index }) => renderPairTile(pair, index)).join('\n')}</div>`
  return `<div class="board">
      <section class="sheet" aria-labelledby="sheet-title">
        <header class="sheet-head"><div><h2 id="sheet-title">Triage sheet</h2><p class="note">Scan the tiles, then inspect the selected pair.</p></div><span class="badge warn">renames appear unmatched</span></header>
        ${renderSection('Needs eyeballs first', attention)}
        ${renderSection('Paired context', context)}
        <p class="no-results" hidden>No name buckets match the active filters.</p>
      </section>
      <div class="detail-stack">${model.pairs.map(renderDetail).join('\n')}</div>
    </div>`
}

function degenerateCopy(model: CompareModel): string {
  if (model.counts.total === 0) {
    return 'Both runs are empty. There is nothing to compare.'
  }
  if (model.counts.nameMatched === 0) {
    return 'These two runs share no shot names, so nothing could be paired. Every shot below is unmatched by name.'
  }
  if (model.counts.comparable === 0) {
    return 'Every name-matched pair has an unreadable image on at least one side. Nothing here was visually compared.'
  }
  return ''
}

export function renderCompare(model: CompareModel): string {
  const stateCopy = degenerateCopy(model)
  const body = model.counts.total === 0
    ? `<section class="empty" aria-labelledby="empty-title"><h2 id="empty-title">Empty compare</h2><p>${stateCopy}</p></section>`
    : `${renderControls(model)}${stateCopy === '' ? '' : `<p class="state-copy">${stateCopy}</p>`}${renderSheet(model)}`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Shotwright compare — ${escapeHtml(model.a.manifest.runId)} with ${escapeHtml(model.b.manifest.runId)}</title>
  <style>${COMPARE_CSS}</style>
</head>
<body>
  <a class="skip" href="#main">Skip to compare gallery</a>
  <main class="shell" id="main" tabindex="-1">
    ${renderHeader(model)}
    ${body}
    <footer role="contentinfo">Original PNGs are embedded once per readable side. At most three tile pairs keep live previews while the selected detail remains available.</footer>
  </main>
  <dialog id="inspection-dialog" aria-labelledby="inspection-title">
    <div class="dialog-head"><h2 id="inspection-title">1:1 inspection</h2><form method="dialog"><button class="action" type="submit">Close</button></form></div>
    <div class="inspection-surface" tabindex="0"></div>
  </dialog>
  <script>${COMPARE_SCRIPT}</script>
</body>
</html>
`
}
