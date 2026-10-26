import { expect, it } from 'vitest'
import { compareProvenance } from '../../src/gallery/provenance.js'
import { buildCompareModel } from '../../src/gallery/compare-model.js'
import { renderCompareHeader } from '../../src/gallery/render-compare.js'
import { renderGallery } from '../../src/gallery/render.js'
import { makeManifest } from '../fixtures/manifest.js'
import type { Manifest } from '../../src/manifest.js'

const executable = { kind: 'managed' as const, path: 'chromium-1/chrome', sha256: 'a'.repeat(64) }
const known = makeManifest({
  environment: { platform: 'linux', distribution: { id: 'debian', versionId: '12' } },
  browsers: [
    { project: 'desktop', name: 'chromium', version: '1.2', channel: 'chrome', executable },
  ],
})
const model = (a: Manifest, b: Manifest) =>
  buildCompareModel(
    { manifest: a, specs: [], diagnostics: [], manifestByteLength: 0, sourceManifestVersion: 2 },
    { manifest: b, specs: [], diagnostics: [], manifestByteLength: 0, sourceManifestVersion: 2 },
  )

it('shows readable A4 differences without changing pair results', () => {
  const b = makeManifest({
    ...known,
    environment: { platform: 'linux', distribution: { id: 'ubuntu', versionId: '24.04' } },
    browsers: [{ ...known.browsers![0]!, version: '2.0' }],
  })
  expect(compareProvenance(known, b)).toEqual({
    status: 'known-fields-differ',
    differences: ['distribution: debian 12 → ubuntu 24.04', 'desktop browser version: 1.2 → 2.0'],
    unavailable: [],
  })
  expect(model(known, b).counts).toEqual(model(known, known).counts)
  expect(model(known, b).pairs).toEqual([])
  expect(renderCompareHeader(model(known, b))).toContain(
    'Render environments differ: distribution: debian 12 → ubuntu 24.04; desktop browser version: 1.2 → 2.0',
  )
})

it('ignores a configured channel that is present on one side only', () => {
  const b = makeManifest({ ...known, browsers: [{ ...known.browsers![0]!, channel: null }] })
  expect(compareProvenance(known, b)).toEqual({
    status: 'no-known-difference',
    differences: [],
    unavailable: [],
  })
})

it('ignores executable kind, path and digest when the A4 fields match', () => {
  const b = makeManifest({
    ...known,
    browsers: [
      {
        ...known.browsers![0]!,
        executable: { kind: 'overridden', path: 'elsewhere', sha256: 'b'.repeat(64) },
      },
    ],
  })
  expect(compareProvenance(known, b).status).toBe('no-known-difference')
  const unbound = makeManifest({
    ...known,
    browsers: [{ ...known.browsers![0]!, executable: null }],
  })
  expect(compareProvenance(known, unbound).status).toBe('no-known-difference')
})

it('does not ask for a distribution when the platforms are known to differ', () => {
  const mac = makeManifest({
    ...known,
    environment: { platform: 'darwin', distribution: null },
  })
  expect(compareProvenance(known, mac)).toEqual({
    status: 'known-fields-differ',
    differences: ['platform: linux → darwin'],
    unavailable: [],
  })
})

it('names unknown fields alongside a known difference', () => {
  const a = makeManifest({
    ...known,
    browsers: [...known.browsers!, { ...known.browsers![0]!, project: 'mobile' }],
  })
  const b = makeManifest({ ...known, browsers: [{ ...known.browsers![0]!, version: '2.0' }] })
  const result = compareProvenance(a, b)
  expect(result).toEqual({
    status: 'known-fields-differ',
    differences: ['desktop browser version: 1.2 → 2.0'],
    unavailable: ['B: browser for project mobile unknown'],
  })
  expect(renderCompareHeader(model(a, b))).toContain(
    'Render environments differ: desktop browser version: 1.2 → 2.0; also unknown: B: browser for project mobile unknown',
  )
})

it('treats equal Firefox and WebKit observations with null executables as known', () => {
  for (const name of ['firefox', 'webkit']) {
    const run = makeManifest({
      environment: { platform: 'darwin', distribution: null },
      browsers: [{ project: 'desktop', name, version: '1.0', channel: null, executable: null }],
    })
    expect(compareProvenance(run, run).status).toBe('no-known-difference')
  }
})

it('reports missing observations and projects without inventing a difference', () => {
  const old = makeManifest()
  expect(compareProvenance(old, known)).toEqual({
    status: 'unavailable',
    differences: [],
    unavailable: [
      'A: platform unknown',
      'A: distribution unknown',
      'A: browser for project desktop unknown',
    ],
  })
  expect(renderCompareHeader(model(old, known))).toContain(
    'Render environment provenance incomplete: A: platform unknown; A: distribution unknown; A: browser for project desktop unknown',
  )
  const withMobile = makeManifest({
    ...known,
    browsers: [...known.browsers!, { ...known.browsers![0]!, project: 'mobile' }],
  })
  expect(compareProvenance(known, withMobile)).toEqual({
    status: 'unavailable',
    differences: [],
    unavailable: ['A: browser for project mobile unknown'],
  })
})

it('names the second shared project when its browser differs', () => {
  const a = makeManifest({
    ...known,
    browsers: [...known.browsers!, { ...known.browsers![0]!, project: 'mobile' }],
  })
  const b = makeManifest({
    ...a,
    browsers: [a.browsers![0]!, { ...a.browsers![1]!, version: '2.0' }],
  })
  expect(compareProvenance(a, b).differences).toEqual(['mobile browser version: 1.2 → 2.0'])
})

it('escapes manifest-sourced project and browser names in the compare banner', () => {
  const a = makeManifest({
    ...known,
    browsers: [{ ...known.browsers![0]!, project: '<project>&', name: '<browser>' }],
  })
  const b = makeManifest({
    ...a,
    browsers: [{ ...a.browsers![0]!, name: 'browser&' }],
  })
  const html = renderCompareHeader(model(a, b))
  expect(html).toContain('&lt;project&gt;&amp; browser name: &lt;browser&gt; → browser&amp;')
  expect(html).not.toContain('<project>')
  expect(html).not.toContain('<browser>')
})

it('states the limited meaning of equal known fields', () => {
  expect(compareProvenance(known, known)).toEqual({
    status: 'no-known-difference',
    differences: [],
    unavailable: [],
  })
  const html = renderCompareHeader(model(known, known))
  expect(html).toContain('No known render environment difference (recorded fields only)')
  expect(html).not.toMatch(/equal rendering|identical rendering|same rendering/i)
})

it('escapes gallery metadata and labels the configured channel', () => {
  const manifest = makeManifest({
    ...known,
    browsers: [{ ...known.browsers![0]!, project: '<project>&' }],
  })
  const html = renderGallery({
    manifest,
    specs: [],
    diagnostics: [],
    manifestByteLength: 1,
    sourceManifestVersion: 2,
  })
  expect(html).toContain('&lt;project&gt;&amp;: chromium 1.2 · configured channel chrome')
  expect(html).not.toContain('<project>')
  expect(html).toContain('<dt>Environment</dt><dd>linux · debian 12</dd>')
  expect(html).toContain('executable managed chromium-1/chrome')
  expect(
    renderGallery({
      manifest: makeManifest(),
      specs: [],
      diagnostics: [],
      manifestByteLength: 1,
      sourceManifestVersion: 2,
    }),
  ).toContain('<dt>Browsers</dt><dd>unavailable</dd>')
})
