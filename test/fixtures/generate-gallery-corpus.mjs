#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const corpusStartedAt = Date.parse('2020-01-02T03:04:05.000Z')

function fail(message) {
  throw new Error(`generate-gallery-corpus: ${message}`)
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function textChunk(index) {
  const type = Buffer.from('tEXt', 'ascii')
  const data = Buffer.from(`shotwright-corpus-index\0${String(index).padStart(2, '0')}`, 'latin1')
  const chunk = Buffer.allocUnsafe(12 + data.byteLength)
  chunk.writeUInt32BE(data.byteLength, 0)
  type.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.byteLength)
  return chunk
}

function withUniqueTextChunk(png, index) {
  if (!png.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
    fail(`source screenshot ${index % 5} is not a PNG`)
  }

  let offset = pngSignature.byteLength
  while (offset + 12 <= png.byteLength) {
    const dataLength = png.readUInt32BE(offset)
    const chunkEnd = offset + 12 + dataLength
    if (chunkEnd > png.byteLength) fail('source PNG contains a truncated chunk')
    const type = png.toString('ascii', offset + 4, offset + 8)
    if (type === 'IEND') {
      if (dataLength !== 0 || chunkEnd !== png.byteLength) {
        fail('source PNG has an invalid terminal IEND chunk')
      }
      return Buffer.concat([png.subarray(0, offset), textChunk(index), png.subarray(offset)])
    }
    offset = chunkEnd
  }
  fail('source PNG has no terminal IEND chunk')
}

function safeStem(value) {
  const stem = value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
  return stem || 'shot'
}

function main() {
  const [sourceRun, targetRun, ...extra] = process.argv.slice(2)
  if (!sourceRun || !targetRun || extra.length > 0) {
    fail('usage: node generate-gallery-corpus.mjs <source-five-shot-run> <target-run-dir>')
  }

  const sourceDir = path.resolve(sourceRun)
  const targetDir = path.resolve(targetRun)
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'))
  if (manifest.manifestVersion !== 1 || !Array.isArray(manifest.shots)) {
    fail('source manifest must be manifest v1')
  }
  if (manifest.shots.length !== 5) fail('source manifest must contain exactly five shots')
  if (fs.existsSync(targetDir)) fail('target run directory already exists')

  fs.mkdirSync(path.join(targetDir, 'png'), { recursive: true })
  const shots = Array.from({ length: 60 }, (_, index) => {
    const source = manifest.shots[index % manifest.shots.length]
    const sequence = String(index + 1).padStart(2, '0')
    const file = `png/${sequence}-${safeStem(source.name)}.png`
    const sourcePng = fs.readFileSync(path.join(sourceDir, source.file))
    fs.writeFileSync(path.join(targetDir, file), withUniqueTextChunk(sourcePng, index))
    return {
      ...source,
      name: `${source.name}-corpus-${sequence}`,
      file,
      capturedAt: new Date(corpusStartedAt + index * 1_000).toISOString(),
      video: null,
      trace: null,
    }
  })

  const synthetic = {
    manifestVersion: 1,
    runId: path.basename(targetDir),
    startedAt: new Date(corpusStartedAt).toISOString(),
    finishedAt: new Date(corpusStartedAt + shots.length * 1_000).toISOString(),
    shotwrightVersion: manifest.shotwrightVersion,
    playwrightVersion: manifest.playwrightVersion,
    flags: { only: [], video: false, trace: false },
    shots,
  }
  fs.writeFileSync(
    path.join(targetDir, 'manifest.json'),
    `${JSON.stringify(synthetic, null, 2)}\n`,
  )
}

main()
