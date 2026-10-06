import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

import { chromium, type Browser, type Locator, type Page } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateGallery } from '../../src/gallery/generate.js'
import { MANIFEST_VERSION, type Manifest, type ShotEntry } from '../../src/manifest.js'

let browser: Browser
let root: string
let galleryUrl: string

function crc32(contents: Buffer): number {
  let crc = 0xffffffff
  for (const byte of contents) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const result = Buffer.alloc(12 + data.byteLength)
  result.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.byteLength)
  return result
}

function uniquePng(marker: number, width = 32, height = 24): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const rows: number[] = []
  for (let y = 0; y < height; y++) {
    rows.push(0)
    for (let x = 0; x < width; x++) {
      rows.push(marker, (x * 7 + marker) % 256, (y * 11 + marker) % 256, 255)
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function mediaTextState(media: Locator): Promise<{
  placeholderVisibility: string
  visibleText: string[]
  visibleTextIntersectingImage: number
}> {
  return media.evaluate((element) => {
    const ownerDocument = element.ownerDocument
    const ownerWindow = ownerDocument.defaultView!
    const image = element.querySelector('.overview-image')
    const imageRect = image?.getBoundingClientRect()
    const visibleText: string[] = []
    let visibleTextIntersectingImage = 0
    const walker = ownerDocument.createTreeWalker(element, 4)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = node.textContent?.trim()
      if (!text || !node.parentElement) continue
      const style = ownerWindow.getComputedStyle(node.parentElement)
      const range = ownerDocument.createRange()
      range.selectNodeContents(node)
      const rects = range.getClientRects()
      let renderedRectCount = 0
      let intersectsImage = false
      for (let index = 0; index < rects.length; index++) {
        const rect = rects[index]!
        if (rect.width === 0 || rect.height === 0) continue
        renderedRectCount++
        if (
          imageRect &&
          rect.left < imageRect.right &&
          rect.right > imageRect.left &&
          rect.top < imageRect.bottom &&
          rect.bottom > imageRect.top
        ) {
          intersectsImage = true
        }
      }
      const isVisible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        renderedRectCount > 0
      if (!isVisible) continue
      visibleText.push(text)
      if (intersectsImage) visibleTextIntersectingImage++
    }
    return {
      placeholderVisibility: ownerWindow.getComputedStyle(element.querySelector('.placeholder')!).visibility,
      visibleText,
      visibleTextIntersectingImage,
    }
  })
}

async function expectFocus(page: Page, locator: Locator): Promise<void> {
  const element = await locator.elementHandle()
  if (element === null) throw new Error('focus target was not found')
  let focused
  try {
    focused = await page.waitForFunction((target) => target.ownerDocument.activeElement === target, element)
  } catch (error) {
    // shotwright-746.17: this wait has timed out on CI roughly one run in ten
    // with nothing in the failure saying WHERE focus went. Report it, so the
    // next sighting is evidence rather than another retry.
    // Everything is reached through the target's ownerDocument: this file is
    // compiled without the DOM lib, like the helpers above.
    const where = await page.evaluate((target) => {
      const ownerDocument = target.ownerDocument
      const active = ownerDocument.activeElement
      const describe = (node: typeof active) =>
        node === null
          ? 'null'
          : `<${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}${node.className ? '.' + String(node.className).trim().replace(/\s+/g, '.') : ''}>`
      const dialog = ownerDocument.querySelector('#inspection-dialog') as { open?: boolean } | null
      return {
        activeElement: describe(active),
        targetConnected: target.isConnected,
        targetVisible: target.getClientRects().length > 0,
        dialogOpen: dialog?.open ?? null,
        hasFocus: ownerDocument.hasFocus(),
      }
    }, element)
    throw new Error(`focus never reached the target: ${JSON.stringify(where)}`, { cause: error })
  }
  expect(await focused.jsonValue()).toBe(true)
  await focused.dispose()
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-gallery-browser-'))
  const runDir = path.join(root, 'run')
  fs.mkdirSync(path.join(runDir, 'shots/browser.shots.ts'), { recursive: true })
  const shots: ShotEntry[] = []
  for (let index = 0; index < 60; index++) {
    const name = index === 0 ? '<script>inert</script>' : index === 2 ? 'tall-aspect' : `shot-${index + 1}`
    const file = `shots/browser.shots.ts/shot-${index + 1}.png`
    fs.writeFileSync(path.join(runDir, file), uniquePng(index, index === 2 ? 24 : 32, index === 2 ? 96 : 24))
    shots.push({
      name,
      spec: 'browser.shots.ts',
      file,
      viewport: index % 2 === 0 ? { width: 390, height: 844 } : { width: 1440, height: 960 },
      deviceScaleFactor: 2,
      fullPage: index % 7 !== 0,
      capturedAt: `2026-07-29T00:00:${String(index).padStart(2, '0')}.000Z`,
      durationMs: index,
      video: null,
      trace: null,
    })
  }
  const manifest: Manifest = {
    manifestVersion: MANIFEST_VERSION,
    runId: 'run',
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:01:00.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    shots,
  }
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest))
  galleryUrl = `${pathToFileURL(generateGallery(runDir).galleryPath).href}#debug`
  browser = await chromium.launch({ headless: true })
  // 120s, not 30s: this is a wall-clock budget, not an assertion. Building 60
  // PNGs and launching Chromium takes ~1s on a dev machine and far longer in a
  // 4-CPU CI container, where Playwright round-trips measured ~25x slower
  // (shotwright-746.14). Nothing here is timing-sensitive by design.
}, 120_000)

afterAll(async () => {
  await browser?.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('gallery browser behavior', () => {
  it('keeps 60-shot overview decode bounded and supports keyboard-complete inspection at 390px', async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
    })
    const page = await context.newPage()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    const networkRequests: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) networkRequests.push(request.url())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(galleryUrl)

    expect(await page.locator('a[data-original]').count()).toBe(60)
    expect(await page.locator('.card').count()).toBe(60)
    expect(await page.evaluate<string>('getComputedStyle(document.body).backgroundColor')).toBe(
      'rgb(17, 21, 27)',
    )
    expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    expect(
      await page.evaluate<number>(`Array.from(document.querySelectorAll('button,input,a,summary'))
        .filter((element) => element.getClientRects().length > 0 && element.getBoundingClientRect().height < 44)
        .length`),
    ).toBe(0)
    expect(await page.locator('h1').count()).toBe(1)
    expect(await page.locator('h2').count()).toBeGreaterThan(0)
    expect(await page.locator('h3').count()).toBeGreaterThan(0)
    expect(await page.locator('main, [role="banner"], [role="contentinfo"]').count()).toBe(3)

    let maximumLive = 0
    for (let index = 0; index < 60; index++) {
      const card = page.locator('.card').nth(index)
      await card.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      try {
        await card.locator('.overview-image').waitFor({ timeout: 2_000 })
      } catch {
        throw new Error(`shot ${index + 1} did not acquire an overview image`)
      }
      const live = await page.locator('.overview-image').count()
      maximumLive = Math.max(maximumLive, live)
      expect(live).toBeLessThanOrEqual(3)
    }
    expect(maximumLive).toBe(3)
    expect(await page.locator('#debug-overlay').textContent()).toMatch(/Live overview images: [0-3] \/ 3/)

    const inspect = page.locator('.card').nth(59).locator('[data-inspect]')
    await inspect.click()
    expect(await page.locator('#inspection-dialog[open]').count()).toBe(1)
    expect(await page.locator('.inspection-image').count()).toBe(1)
    expect(await page.locator('.overview-image').count()).toBeLessThanOrEqual(3)
    await page.keyboard.press('Escape')
    expect(await page.locator('#inspection-dialog[open]').count()).toBe(0)
    await expectFocus(page, inspect)

    await page.keyboard.press('/')
    await expectFocus(page, page.locator('#search'))
    await page.locator('#search').fill('shot-30')
    expect(await page.locator('.card:not(.hidden)').count()).toBe(1)
    await page.keyboard.press('Escape')
    expect(await page.locator('.card:not(.hidden)').count()).toBe(60)
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
    expect(networkRequests).toEqual([])
    await context.close()
    // 120s for the same reason as the hook above: 60 scroll-and-wait iterations
    // cost ~1.1s locally and exceeded 30s on the CI runner. The bounds this test
    // actually asserts are the per-shot 2s waitFor and `live <= 3`, both of which
    // still fail fast if the eviction behaviour regresses.
  }, 120_000)

  it('hides a tall image placeholder while loaded and restores it after bounded eviction', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto(galleryUrl)
    const tallCard = page.locator('.card').filter({ has: page.locator('h3', { hasText: 'tall-aspect' }) })
    await tallCard.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await tallCard.locator('.overview-image').waitFor()

    expect(await mediaTextState(tallCard.locator('.media'))).toEqual({
      placeholderVisibility: 'hidden',
      visibleText: [],
      visibleTextIntersectingImage: 0,
    })

    const farCard = page.locator('.card').last()
    await farCard.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await farCard.locator('.overview-image').waitFor()
    await tallCard.locator('.overview-image').waitFor({ state: 'detached' })
    expect(await tallCard.locator('.overview-image').count()).toBe(0)
    expect(await mediaTextState(tallCard.locator('.media'))).toEqual({
      placeholderVisibility: 'visible',
      visibleText: ['Original queued · 24×96 intrinsic pixels'],
      visibleTextIntersectingImage: 0,
    })
    await context.close()
  })

  it('retains originals without JavaScript and loads on demand without IntersectionObserver', async () => {
    const noScript = await browser.newContext({ javaScriptEnabled: false })
    const noScriptPage = await noScript.newPage()
    await noScriptPage.goto(galleryUrl)
    expect(await noScriptPage.locator('a[data-original]').count()).toBe(60)
    expect(await noScriptPage.locator('noscript').isVisible()).toBe(true)
    expect(await noScriptPage.locator('.overview-image').count()).toBe(0)
    const noScriptTallCard = noScriptPage.locator('.card').filter({
      has: noScriptPage.locator('h3', { hasText: 'tall-aspect' }),
    })
    expect(await mediaTextState(noScriptTallCard.locator('.media'))).toEqual({
      placeholderVisibility: 'visible',
      visibleText: ['Original queued · 24×96 intrinsic pixels'],
      visibleTextIntersectingImage: 0,
    })
    expect(await noScriptTallCard.locator('a[data-original]').getAttribute('download')).toBe('shot-3.png')
    await noScript.close()

    const fallback = await browser.newContext()
    await fallback.addInitScript('delete window.IntersectionObserver')
    const fallbackPage = await fallback.newPage()
    await fallbackPage.goto(galleryUrl)
    expect(await fallbackPage.locator('.overview-image').count()).toBe(1)
    expect(await fallbackPage.locator('.load-action:visible').count()).toBe(60)
    await fallbackPage.locator('.card').nth(1).locator('.load-action').click()
    expect(await fallbackPage.locator('.overview-image').count()).toBe(2)
    const fallbackTallCard = fallbackPage.locator('.card').filter({
      has: fallbackPage.locator('h3', { hasText: 'tall-aspect' }),
    })
    await fallbackTallCard.locator('.load-action').click()
    expect(await mediaTextState(fallbackTallCard.locator('.media'))).toEqual({
      placeholderVisibility: 'hidden',
      visibleText: [],
      visibleTextIntersectingImage: 0,
    })
    await fallback.close()
  })

  it('keeps normal-aspect desktop media geometry unchanged when its image loads', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.addInitScript('delete window.IntersectionObserver')
    const page = await context.newPage()
    await page.goto(galleryUrl)
    const card = page.locator('.card').nth(1)
    const media = card.locator('.media')
    const placeholder = card.locator('.placeholder')
    const before = {
      media: await media.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
      placeholder: await placeholder.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
    }
    await card.locator('.load-action').click()
    await card.locator('.overview-image').waitFor()
    expect({
      media: await media.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
      placeholder: await placeholder.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
    }).toEqual(before)
    await context.close()
  })
})
