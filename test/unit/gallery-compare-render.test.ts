import { describe, expect, it } from 'vitest'

import { buildCompareModel, type CompareModel } from '../../src/gallery/compare-model.js'
import type { GalleryModel, GalleryShot, PngModel } from '../../src/gallery/model.js'
import { renderCompare } from '../../src/gallery/render-compare.js'
import { MANIFEST_VERSION, type Manifest, type ShotEntry } from '../../src/manifest.js'

function entry(name: string, spec: string, index: number): ShotEntry {
  return {
    name,
    spec,
    file: `shots/${name}.png`,
    viewport: index % 2 === 0 ? { width: 1440, height: 960 } : { width: 390, height: 844 },
    deviceScaleFactor: 2,
    fullPage: index !== 3,
    capturedAt: `2026-07-31T00:00:0${index}.000Z`,
    durationMs: 50 + index,
    video: null,
    trace: null,
  }
}

function galleryShot(
  name: string,
  spec: string,
  index: number,
  readable = true,
  hostileDataUri?: string,
): GalleryShot {
  const image: PngModel | null = readable
    ? {
        width: 100 + index,
        height: 80 + index,
        byteLength: 128 + index,
        dataUri: hostileDataUri ?? `data:image/png;base64,image${index}`,
      }
    : null
  return {
    entry: entry(name, spec, index),
    image,
    imageError: readable ? null : `PNG ${name} is unreadable`,
    video: null,
    trace: null,
  }
}

function gallery(runId: string, galleryShots: GalleryShot[]): GalleryModel {
  const manifest: Manifest = {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: '2026-07-31T00:00:00.000Z',
    finishedAt: '2026-07-31T00:00:10.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: ['theme'], video: false, trace: false },
    shots: galleryShots.map((shot) => shot.entry),
  }
  const specs = [...new Set(galleryShots.map((shot) => shot.entry.spec))].map((spec) => ({
    name: spec,
    shots: galleryShots.filter((shot) => shot.entry.spec === spec),
  }))
  return { manifest, manifestByteLength: 2_155, specs, diagnostics: [] }
}

function mixedModel(): CompareModel {
  return buildCompareModel(
    gallery('run-a', [
      galleryShot('paired', 'home.shots.ts', 0),
      galleryShot('unreadable', 'home.shots.ts', 1, false),
      galleryShot('a-only', 'about.shots.ts', 2),
    ]),
    gallery('run-b', [
      galleryShot('paired', 'home.shots.ts', 3),
      galleryShot('unreadable', 'home.shots.ts', 4),
      galleryShot('b-only', 'about.shots.ts', 5),
    ]),
  )
}

describe('compare rendering', () => {
  it('renders the signed-off contact sheet, selected detail, facts, and review-only copy', () => {
    const html = renderCompare(mixedModel())

    expect(html).toContain('Compare gallery · contact sheet triage')
    expect(html).toContain('run-a compared with run-b')
    expect(html).toContain('Review artifact · no verdicts')
    expect(html).toContain('<dt>Pairing key</dt><dd>exact shot name</dd>')
    expect(html).toContain('<dt>Ordering</dt><dd>attention states first, then spec order</dd>')
    expect(html).toContain('Needs eyeballs first')
    expect(html).toContain('Paired context')
    expect(html).toContain('renames appear unmatched')
    expect(html).toContain('<section class="sheet"')
    expect(html).toContain('<aside class="detail"')
    expect(html).toContain('selected: unreadable')
    expect(html).toContain(
      'A-only and B-only shots are unmatched by name. A rename appears as two unmatched buckets because manifests contain no rename lineage.',
    )
    expect(html).toContain(
      'Unreadable images stay in the sheet with a red state and are not presented as successful visual comparisons.',
    )
  })

  it('pins a CSP that allows only inline style/script and data: images', () => {
    const html = renderCompare(mixedModel())
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`,
    )
    expect(html).not.toMatch(/<(?:video|iframe|object|embed)\b/)
    expect(html).not.toMatch(/<img[^>]*src="(?!data:)/)
  })

  it('uses only presence/readability labels and exposes no comparison metric hook', () => {
    const html = renderCompare(mixedModel())
    expect(html).toContain('paired')
    expect(html).toContain('unmatched by name · A only')
    expect(html).toContain('unmatched by name · B only')
    expect(html).toContain('not comparable · unreadable image')
    expect(html).not.toMatch(/\b(?:Difference|threshold|tolerance|baseline|expected|pass|fail)\b/i)
    expect(html).not.toMatch(/data-(?:diff|score|similarity|delta)/i)
    expect(html).not.toMatch(/\b(?:swipe|onion-skin|overlay|pixel delta)\b/i)
  })

  it('embeds one PNG URI per readable side and renders unavailable placeholders', () => {
    const html = renderCompare(mixedModel())
    expect((html.match(/data:image\/png;base64,/g) ?? [])).toHaveLength(5)
    expect((html.match(/data-asset-id=/g) ?? [])).toHaveLength(10)
    expect(html).toContain('A image unavailable')
    expect(html).toContain('PNG unreadable is unreadable')
    expect(html).toContain('Intrinsic unavailable')
    expect(html).toContain('At most three')
  })

  it('escapes hostile names, specs, file paths, errors, and run ids', () => {
    const hostile = `<script>alert("x")</script>'</style>\u202e`
    const aShot = galleryShot(hostile, `spec-${hostile}`, 0, false)
    aShot.entry.file = `shots/<script>/quote"'.png`
    aShot.imageError = hostile
    const bShot = galleryShot(hostile, `other-${hostile}`, 1)
    const html = renderCompare(
      buildCompareModel(gallery(`a-${hostile}`, [aShot]), gallery(`b-${hostile}`, [bShot])),
    )

    expect((html.match(/<script>/g) ?? [])).toHaveLength(1)
    expect((html.match(/<\/style>/g) ?? [])).toHaveLength(1)
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;&lt;/style&gt;')
    expect(html).not.toContain('href="shots/<script>')
    expect(html).not.toContain('innerHTML')
    expect(html).not.toContain('localStorage')
  })

  it('renders the exact empty-compare copy without a sheet, detail pane, or selected badge', () => {
    const html = renderCompare(buildCompareModel(gallery('empty-a', []), gallery('empty-b', [])))
    expect(html).toContain('Both runs are empty. There is nothing to compare.')
    expect(html).not.toContain('<section class="sheet"')
    expect(html).not.toContain('<aside class="detail"')
    expect(html).not.toMatch(/<span[^>]+data-selected-badge/)
  })

  it('renders the exact no-common-names copy and every bucket as unmatched by name', () => {
    const html = renderCompare(
      buildCompareModel(
        gallery('run-a', [galleryShot('only-a', 'a.shots.ts', 0)]),
        gallery('run-b', [galleryShot('only-b', 'b.shots.ts', 1)]),
      ),
    )
    expect(html).toContain(
      'These two runs share no shot names, so nothing could be paired. Every shot below is unmatched by name.',
    )
    expect(html).not.toContain('0 comparable')
    expect(html).toContain('unmatched by name · A only')
    expect(html).toContain('unmatched by name · B only')
    expect(html).toContain('Needs eyeballs first')
    expect(html).not.toContain('Paired context')
  })

  it('omits the attention heading when every pair is paired', () => {
    const html = renderCompare(
      buildCompareModel(
        gallery('run-a', [galleryShot('same', 'a.shots.ts', 0)]),
        gallery('run-b', [galleryShot('same', 'a.shots.ts', 1)]),
      ),
    )
    expect(html).not.toContain('Needs eyeballs first')
    expect(html).toContain('Paired context')
  })

  it('renders the exact all-not-comparable copy', () => {
    const html = renderCompare(
      buildCompareModel(
        gallery('run-a', [galleryShot('same', 'a.shots.ts', 0, false)]),
        gallery('run-b', [galleryShot('same', 'a.shots.ts', 1, false)]),
      ),
    )
    expect(html).toContain(
      'Every name-matched pair has an unreadable image on at least one side. Nothing here was visually compared.',
    )
  })

  it('names the empty run id in header facts when one side is empty', () => {
    const html = renderCompare(
      buildCompareModel(
        gallery('empty-a', []),
        gallery('run-b', [galleryShot('only-b', 'b.shots.ts', 0)]),
      ),
    )
    expect(html).toContain('<dt>Empty side</dt><dd>empty-a has no shots</dd>')
  })
})
