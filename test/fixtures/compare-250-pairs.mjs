// SPDX-License-Identifier: AGPL-3.0-or-later
// Run after pnpm run build: node test/fixtures/compare-250-pairs.mjs <output-directory>
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { PNG } from 'pngjs'
import { generateCompareGallery } from '../../dist/gallery/generate-compare.js'

const root = process.argv[2] ?? path.join('local', 'compare-measurement')
fs.mkdirSync(root, { recursive: true })
const dimensions = [{ width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 1440, height: 960 }]
const image = (width, height, marker, subtle = false) => {
  const png = new PNG({ width, height })
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = marker
    png.data[index + 1] = 65
    png.data[index + 2] = 145
    png.data[index + 3] = 255
  }
  if (subtle) png.data[0] = 1
  return PNG.sync.write(png)
}
const imageCache = new Map()
const cachedImage = (width, height, marker, subtle) => {
  const key = `${width}:${height}:${marker}:${subtle}`
  if (!imageCache.has(key)) imageCache.set(key, image(width, height, marker, subtle))
  return imageCache.get(key)
}
const rows = (side) => {
  const dir = path.join(root, side)
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
  const shots = []
  for (let index = 0; index < 250; index++) {
    const group = index % 4
    const dim = dimensions[index % dimensions.length]
    const width = side === 'b' && group === 3 ? dim.width + 1 : dim.width
    const marker = side === 'b' && group === 2 ? 255 : 0
    const filename = `shot-${String(index).padStart(3, '0')}.png`
    const file = `shots/${filename}`
    fs.writeFileSync(path.join(dir, file), cachedImage(width, dim.height, marker, side === 'b' && group === 1))
    shots.push({ name: `shot-${index}`, spec: `spec-${Math.floor(index / 10)}.shots.ts`, file, viewport: dim, deviceScaleFactor: 1, fullPage: true, capturedAt: '2026-10-22T00:00:00.000Z', durationMs: 1, video: null, trace: null, testId: null, checked: false, retry: 0 })
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifestVersion: 2, runId: side, startedAt: '2026-10-22T00:00:00.000Z', finishedAt: '2026-10-22T00:01:00.000Z', shotwrightVersion: '0.2.0', playwrightVersion: '1.63.0', flags: { only: [], video: false, trace: false }, status: 'passed', publication: { gallery: { ok: true }, evidence: { ok: true } }, tests: [], shots, artifacts: [], failures: [] }))
  return dir
}
const a = rows('a'), b = rows('b')
const startMemory = process.memoryUsage()
const started = performance.now()
const result = generateCompareGallery(a, b)
const elapsedMs = Math.round(performance.now() - started)
const endMemory = process.memoryUsage()
// The compare is synchronous, so an event-loop timer cannot sample its peak.
const peakRss = process.resourceUsage().maxRSS * 1024
if (result.model.pairs.length !== 250 || result.counts.identical !== 63 || result.counts.similar !== 63 || result.counts.changed !== 62 || result.counts['size-changed'] !== 62) throw new Error('250-pair fixture state counts changed')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const html = fs.readFileSync(result.outputFile)
const json = JSON.parse(fs.readFileSync(result.outputFile.replace(/\.html$/, '.compare.json'), 'utf8'))
json.runs.a.pathDigest = 'PATH'
json.runs.b.pathDigest = 'PATH'
const htmlHash = sha256(html)
const jsonHash = sha256(JSON.stringify(json, null, 2) + '\n')
if (htmlHash !== '24dedcc69b7e252c01b829c51fd8b17a4f97916b5c951935cc37be08b1930f64' || jsonHash !== '2f6a28bdcb6c935d9df034f3c5d1052acb35638b46a72a2af4f8c3d4c85a68a1') throw new Error('compare output bytes changed from the original implementation')
// 256,610,304 measured bytes × 1.5, rounded up to the next 50 MB.
const rssCeilingBytes = 400_000_000
if (peakRss > rssCeilingBytes) throw new Error(`peak RSS ${peakRss} exceeds ${rssCeilingBytes}`)
const measurement = { pairs: 250, dimensions, elapsedMs, startRssBytes: startMemory.rss, startHeapUsedBytes: startMemory.heapUsed, endHeapUsedBytes: endMemory.heapUsed, peakRssBytes: peakRss, rssCeilingBytes, htmlBytes: html.length, htmlHash, normalizedJsonHash: jsonHash, counts: result.counts }
console.log(JSON.stringify(measurement))
