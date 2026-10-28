import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

import { chromium, type Browser, type Locator, type Page } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateGallery } from '../../src/gallery/generate.js'
import type { Manifest, ShotEntry } from '../../src/manifest.js'
import { makeManifest, makeShot } from '../fixtures/manifest.js'

let browser: Browser
let root: string
let galleryUrl: string
let largeGalleryUrl: string

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
      placeholderVisibility: ownerWindow.getComputedStyle(element.querySelector('.placeholder')!)
        .visibility,
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
    focused = await page.waitForFunction(
      (target) => target.ownerDocument.activeElement === target,
      element,
    )
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
          : `<${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}${node.className ? '.' + String(node.className).trim().replace(/\s+/g, '.') : ''}${node
              .getAttributeNames()
              .filter((name: string) => name.startsWith('data-'))
              .map((name: string) => `[${name}="${node.getAttribute(name)}"]`)
              .join('')}>`
      const dialog = ownerDocument.querySelector('#inspection-dialog') as { open?: boolean } | null
      return {
        activeElement: describe(active),
        target: describe(target),
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
    const name =
      index === 0 ? '<script>inert</script>' : index === 2 ? 'tall-aspect' : `shot-${index + 1}`
    const file = `shots/browser.shots.ts/shot-${index + 1}.png`
    fs.writeFileSync(
      path.join(runDir, file),
      uniquePng(
        index,
        index === 2 ? 24 : index === 1 ? 200 : 32,
        index === 2 ? 96 : index === 1 ? 150 : 24,
      ),
    )
    shots.push(
      makeShot({
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
        ...(index === 0 && { note: 'Unique note-only phrase\n' + 'longword'.repeat(1000) }),
      }),
    )
  }
  const manifest: Manifest = makeManifest({
    runId: 'run',
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:01:00.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    shots,
  })
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest))
  galleryUrl = `${pathToFileURL(generateGallery(runDir).galleryPath).href}#debug`
  browser = await chromium.launch({ headless: true })
  const largeDir = path.join(root, 'large')
  fs.mkdirSync(path.join(largeDir, 'shots'), { recursive: true })
  const capture = async (name: string, scale: number): Promise<ShotEntry> => {
    const wideTall = name === 'wide-tall'
    const context = await browser.newContext({
      viewport: { width: wideTall ? 2560 : 1280, height: 800 },
      deviceScaleFactor: scale,
    })
    const page = await context.newPage()
    await page.setContent(
      `<style>body{margin:0}main{height:${wideTall ? 16566 : name === 'tall' ? 8000 : 1200}px;background:linear-gradient(#284b88,#e8ad48)}</style><main></main>`,
    )
    await page.screenshot({ path: path.join(largeDir, 'shots', `${name}.png`), fullPage: true })
    await context.close()
    return makeShot({
      name:
        name === 'scale-two'
          ? 'A long screenshot title that wraps across several lines on a narrow screen and still keeps all viewer controls readable'
          : name,
      spec: 'large.shots.ts',
      file: `shots/${name}.png`,
      viewport: { width: wideTall ? 2560 : 1280, height: 800 },
      deviceScaleFactor: scale,
    })
  }
  const largeShots = [
    await capture('tall', 1),
    await capture('scale-two', 2),
    await capture('wide-tall', 1),
  ]
  fs.writeFileSync(
    path.join(largeDir, 'manifest.json'),
    JSON.stringify(makeManifest({ runId: 'large', shots: largeShots })),
  )
  largeGalleryUrl = pathToFileURL(generateGallery(largeDir).galleryPath).href
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
  it('shows a generated video and trace section with native controls and download links', async () => {
    const runDir = path.join(root, 'artifacts')
    fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true })
    fs.mkdirSync(path.join(runDir, 'video'), { recursive: true })
    fs.mkdirSync(path.join(runDir, 'trace'), { recursive: true })
    fs.writeFileSync(path.join(runDir, 'shots', 'one.png'), uniquePng(42))
    fs.writeFileSync(path.join(runDir, 'video', 'one.webm'), 'video fixture')
    fs.writeFileSync(path.join(runDir, 'trace', 'one.zip'), 'trace fixture')
    fs.writeFileSync(
      path.join(runDir, 'manifest.json'),
      JSON.stringify(
        makeManifest({
          runId: 'artifacts',
          shots: [
            makeShot({
              name: 'one',
              spec: 'artifacts.shots.ts',
              file: 'shots/one.png',
              video: 'video/one.webm',
              trace: 'trace/one.zip',
            }),
          ],
        }),
      ),
    )
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await page.goto(pathToFileURL(generateGallery(runDir).galleryPath).href)
      const section = page.locator('aside.artifacts')
      expect(await section.getAttribute('aria-label')).toBe(
        'Videos and traces for artifacts.shots.ts',
      )
      expect(await section.locator('h3').textContent()).toBe('Videos and traces')
      expect(await section.getByText('Referenced by 1 shot in this spec').isVisible()).toBe(true)
      const video = section.locator('video')
      expect(await video.isVisible()).toBe(true)
      expect(await video.getAttribute('controls')).not.toBeNull()
      expect(await video.getAttribute('aria-label')).toBe('Recorded video for linked screenshots')
      expect(await section.getByRole('link', { name: 'Download video' }).isVisible()).toBe(true)
      expect(await section.getByRole('link', { name: 'Download trace' }).isVisible()).toBe(true)
    } finally {
      await page.close()
    }
  })

  it('keeps run facts reachable while showing screenshot media in the first mobile viewport', async () => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 640 },
      { width: 1280, height: 800 },
    ]) {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      await page.goto(galleryUrl)
      const facts = page.locator('.run-facts-disclosure')
      const summary = facts.locator('summary')
      expect(await page.locator('.status .badge').count()).toBe(4)
      expect(await page.locator('#search').isEnabled()).toBe(true)
      expect(await page.locator('#search').getAttribute('placeholder')).toContain(
        'press / to focus',
      )
      expect(await page.locator('.keyboard').isVisible()).toBe(viewport.width > 760)
      expect(await page.locator('[data-filter]').first().isEnabled()).toBe(true)
      if (viewport.width <= 760) {
        expect(await facts.evaluate((element) => element.hasAttribute('open'))).toBe(false)
        const media = await page.locator('.card').first().locator('.media').boundingBox()
        expect(media).not.toBeNull()
        expect(
          Math.min(media!.y + media!.height, viewport.height) - Math.max(media!.y, 0),
        ).toBeGreaterThanOrEqual(120)
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        await expectFocus(page, summary)
        await page.keyboard.press('Enter')
        expect(await facts.evaluate((element) => element.hasAttribute('open'))).toBe(true)
        expect(await facts.locator('dt:visible').count()).toBe(10)
        await page.keyboard.press('Space')
        expect(await facts.evaluate((element) => element.hasAttribute('open'))).toBe(false)
        if (viewport.width === 390) {
          await page.setViewportSize({ width: 700, height: 844 })
          expect(await facts.evaluate((element) => element.hasAttribute('open'))).toBe(false)
          await page.setViewportSize({ width: 1280, height: 800 })
          await page.waitForFunction(
            (element) => element.hasAttribute('open'),
            await facts.elementHandle(),
          )
          await page.setViewportSize(viewport)
          await page.waitForFunction(
            (element) => !element.hasAttribute('open'),
            await facts.elementHandle(),
          )
        }
      } else {
        expect(await facts.evaluate((element) => element.hasAttribute('open'))).toBe(true)
        expect(
          await summary.evaluate(
            (element) => element.ownerDocument.defaultView!.getComputedStyle(element).display,
          ),
        ).toBe('none')
        expect(await facts.locator('dt:visible').count()).toBe(10)
        expect(await facts.evaluate((element) => element.closest('.topbar') !== null)).toBe(true)
        expect(
          await facts
            .locator('.runfacts')
            .evaluate(
              (element) =>
                element.ownerDocument
                  .defaultView!.getComputedStyle(element)
                  .gridTemplateColumns.split(' ').length,
            ),
        ).toBe(4)
      }
      await context.close()
    }

    for (const viewport of [
      { width: 320, height: 640 },
      { width: 1280, height: 800 },
    ]) {
      const context = await browser.newContext({ viewport, javaScriptEnabled: false })
      const page = await context.newPage()
      await page.goto(galleryUrl)
      const facts = page.locator('.run-facts-disclosure')
      expect(await facts.evaluate((element) => element.hasAttribute('open'))).toBe(false)
      expect(await page.locator('#search').isDisabled()).toBe(true)
      expect(await page.locator('#search').getAttribute('placeholder')).toBe(
        'Shot, spec, or test title',
      )
      expect(await page.locator('.keyboard').isHidden()).toBe(true)
      expect(await page.locator('body').innerText()).not.toContain('Original queued')
      expect(await page.locator('.placeholder-copy').first().textContent()).toContain(
        'Original available to download',
      )
      expect(await page.locator('[data-filter]:enabled').count()).toBe(0)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await expectFocus(page, facts.locator('summary'))
      await page.keyboard.press(viewport.width === 320 ? 'Enter' : 'Space')
      expect(await facts.locator('dt:visible').count()).toBe(10)
      await context.close()
    }
  })

  it('keeps a long mobile result count clear of the search label and input', async () => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } })
    const page = await context.newPage()
    try {
      await page.goto(galleryUrl)
      await page.locator('#result-count').evaluate((element) => {
        element.textContent = '1234 of 1234 shots shown'
      })
      const count = await page.locator('#result-count').boundingBox()
      const label = await page.locator('.controls label .eyebrow').boundingBox()
      const input = await page.locator('#search').boundingBox()
      expect(count).not.toBeNull()
      expect(label).not.toBeNull()
      expect(input).not.toBeNull()
      const overlaps = (left: NonNullable<typeof count>, right: NonNullable<typeof count>) =>
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y
      expect(overlaps(count!, label!)).toBe(false)
      expect(overlaps(count!, input!)).toBe(false)
    } finally {
      await context.close()
    }
  })

  it('centers a small image and offers zoom only after the viewport makes it necessary', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 844 } })
    const page = await context.newPage()
    await page.goto(galleryUrl)
    await page
      .locator('.card')
      .filter({ has: page.locator('h3', { hasText: /^shot-2$/ }) })
      .locator('.media')
      .click()
    const dialog = page.locator('#inspection-dialog[data-viewer-state="ready"]')
    await dialog.waitFor()
    const image = page.locator('.inspection-image')
    const surface = page.locator('.inspection-surface')
    const imageBox = await image.boundingBox()
    const surfaceBox = await surface.boundingBox()
    expect(imageBox!.x + imageBox!.width / 2).toBeCloseTo(surfaceBox!.x + surfaceBox!.width / 2, 0)
    expect(imageBox!.y + imageBox!.height / 2).toBeCloseTo(
      surfaceBox!.y + surfaceBox!.height / 2,
      0,
    )
    expect(await page.locator('[data-viewer-toggle]').isHidden()).toBe(true)
    expect(await page.locator('.viewer-help').isHidden()).toBe(true)
    expect(
      await image.evaluate(
        (element) => element.ownerDocument.defaultView!.getComputedStyle(element).cursor,
      ),
    ).toBe('default')
    await image.click()
    expect(await image.evaluate((element) => element.classList.contains('actual'))).toBe(false)
    await page.setViewportSize({ width: 180, height: 250 })
    await page.locator('[data-viewer-toggle]:visible').waitFor()
    expect(await page.locator('[data-viewer-toggle]').isVisible()).toBe(true)
    expect(await page.locator('.viewer-help').isVisible()).toBe(true)
    expect(
      await image.evaluate(
        (element) => element.ownerDocument.defaultView!.getComputedStyle(element).cursor,
      ),
    ).toBe('zoom-in')
    await page.locator('[data-viewer-toggle]').click()
    await dialog.waitFor()
    expect(await image.evaluate((element) => element.classList.contains('actual'))).toBe(true)
    await context.close()
  })

  it('searches notes and scrolls a bounded note by keyboard at narrow width', async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
    })
    const page = await context.newPage()
    await page.goto(galleryUrl)
    await page.locator('#search').fill('unique note-only phrase')
    expect(await page.locator('.card:not(.hidden)').count()).toBe(1)
    const note = page.getByRole('group', { name: 'Note for <script>inert</script>' })
    expect(await note.isVisible()).toBe(true)
    const before = await note.evaluate((element) => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      width: element.getBoundingClientRect().width,
    }))
    expect(before.height).toBeLessThan(before.scrollHeight)
    expect(before.height).toBeLessThanOrEqual(128)
    expect(before.width).toBeLessThanOrEqual(390)
    expect(await note.evaluate((element) => element.classList.contains('more-below'))).toBe(true)
    expect(await note.evaluate((element) => element.classList.contains('more-above'))).toBe(false)
    await page.locator('#search').focus()
    for (let index = 0; index < 12; index++) {
      if (await note.evaluate((element) => element.ownerDocument.activeElement === element)) break
      await page.keyboard.press('Tab')
    }
    await expectFocus(page, note)
    await page.keyboard.press('PageDown')
    await page.waitForFunction(
      (target) => target.scrollTop > 0 && target.classList.contains('more-above'),
      await note.elementHandle(),
    )
    expect(await note.evaluate((element) => element.classList.contains('more-above'))).toBe(true)
    await note.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.waitForFunction(
      (target) => !target.classList.contains('more-below'),
      await note.elementHandle(),
    )
    expect(await note.evaluate((element) => element.classList.contains('more-above'))).toBe(true)
    await note.evaluate((element) => {
      element.textContent = 'Short note.'
    })
    await page.waitForFunction(
      (target) => !target.classList.contains('more-above'),
      await note.elementHandle(),
    )
    expect(await note.evaluate((element) => element.classList.contains('more-below'))).toBe(false)
    expect(
      await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'),
    ).toBe(true)
    await context.close()
  })

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
    expect(
      await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'),
    ).toBe(true)
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
    expect(await page.locator('#debug-overlay').textContent()).toMatch(
      /Live overview images: [0-3] \/ 3/,
    )

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

  it('does not pull focus back to the inspect trigger once focus has moved on', async () => {
    // shotwright-746.17. A dialog's close event is queued, not synchronous, and
    // input can be handled before it. The 60-shot test above pressed Escape and
    // then '/', and about one loaded run in ten the queued close handler ran
    // AFTER '/' had focused the search box and moved focus back to the trigger.
    // Closing and refocusing in one task reproduces that ordering every time.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto(galleryUrl)
    const inspect = page.locator('.card').first().locator('[data-inspect]')
    await inspect.click()
    expect(await page.locator('#inspection-dialog[open]').count()).toBe(1)
    const afterClose = await page.evaluate<string>(`(async () => {
      const closed = new Promise((resolve) => {
        document.querySelector('#inspection-dialog').addEventListener('close', resolve, { once: true })
      })
      document.querySelector('#inspection-dialog').close()
      document.querySelector('#search').focus()
      await closed
      await new Promise((resolve) => setTimeout(resolve, 0))
      return document.activeElement.id
    })()`)
    expect(afterClose).toBe('search')

    // The restore itself still has to work when nothing else took focus.
    await inspect.click()
    await page.keyboard.press('Escape')
    await expectFocus(page, inspect)
    await context.close()
  })

  it('keeps a viewer reopened in the same task after its queued close event', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto(galleryUrl)
    await page.locator('.card').first().locator('[data-inspect]').click()
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    await page.evaluate(`(() => {
      document.querySelector('#inspection-dialog').close()
      document.querySelectorAll('[data-inspect]')[1].click()
    })()`)
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    expect(await page.locator('#inspection-dialog[open] .inspection-image').count()).toBe(1)
    expect(await page.locator('#inspection-title').textContent()).toBe('shot-2 — Screenshot')
    await context.close()
  })

  it('fits tall screenshots and toggles true device pixels with click anchoring', async () => {
    for (const deviceScaleFactor of [1, 2]) {
      for (const width of [1440, 390, 320]) {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor,
        })
        const page = await context.newPage()
        await page.goto(largeGalleryUrl)
        const opener = page.locator('.card').first().locator('.media')
        await opener.click()
        const dialog = page.locator('#inspection-dialog')
        await dialog.waitFor({ state: 'visible' })
        await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
        const geometry = () =>
          page.locator('.inspection-image').evaluate((image) => {
            const surface = image.parentElement!
            return {
              width: image.getBoundingClientRect().width,
              height: image.getBoundingClientRect().height,
              surfaceWidth: surface.clientWidth,
              surfaceHeight: surface.clientHeight,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              scrollTop: surface.scrollTop,
              maxScrollTop: surface.scrollHeight - surface.clientHeight,
            }
          })
        const fit = await geometry()
        expect(fit.width).toBeLessThanOrEqual(fit.surfaceWidth + 1)
        expect(fit.height).toBeLessThanOrEqual(fit.surfaceHeight + 1)
        expect(fit.width).toBeLessThanOrEqual(fit.naturalWidth / deviceScaleFactor + 1)
        const image = page.locator('.inspection-image')
        const rect = await image.boundingBox()
        if (!rect) throw new Error('viewer image absent')
        const clickX = rect.x + rect.width / 2
        const clickY = rect.y + rect.height / 2
        await image.evaluate((element) =>
          element.addEventListener(
            'pointerup',
            (event: { clientX: number; clientY: number }) => {
              const rect = element.getBoundingClientRect()
              ;(
                globalThis as unknown as {
                  viewerClick?: { x: number; y: number; clientX: number; clientY: number }
                }
              ).viewerClick = {
                x: (event.clientX - rect.left) / rect.width,
                y: (event.clientY - rect.top) / rect.height,
                clientX: event.clientX,
                clientY: event.clientY,
              }
            },
            { once: true, capture: true },
          ),
        )
        await page.mouse.click(clickX, clickY)
        await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
        const actual = await geometry()
        expect(actual.width).toBeCloseTo(actual.naturalWidth / deviceScaleFactor, 0)
        expect(actual.height).toBeCloseTo(actual.naturalHeight / deviceScaleFactor, 0)
        expect(await page.locator('[data-viewer-toggle]').textContent()).toBe('Fit to window')
        const anchor = await image.evaluate((element) => {
          const point = (
            globalThis as unknown as {
              viewerClick: { x: number; y: number; clientX: number; clientY: number }
            }
          ).viewerClick
          const box = element.getBoundingClientRect()
          return {
            x: box.x + box.width * point.x - point.clientX,
            y: box.y + box.height * point.y - point.clientY,
          }
        })
        if (actual.width > actual.surfaceWidth) expect(Math.abs(anchor.x)).toBeLessThanOrEqual(1)
        else expect(await image.evaluate((element) => element.parentElement!.scrollLeft)).toBe(0)
        expect(
          Math.abs(anchor.y),
          JSON.stringify({ anchor, fit, actual, clickY }),
        ).toBeLessThanOrEqual(1)
        await page.locator('[data-viewer-toggle]').click()
        await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
        expect((await geometry()).height).toBeLessThanOrEqual(fit.surfaceHeight + 1)
        if (width === 1440 && deviceScaleFactor === 1) {
          await page.evaluate(`(() => {
            const image = document.querySelector('.inspection-image');
            const rect = image.getBoundingClientRect();
            image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top }));
          })()`)
          await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
          expect((await geometry()).scrollTop).toBeLessThanOrEqual(1)
        }
        await page.keyboard.press('Escape')
        await expectFocus(page, opener)
        await context.close()
      }
    }
  }, 120_000)

  it('keeps the exact pointer position anchored when a wide, tall image zooms', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.goto(largeGalleryUrl)
    await page.locator('.card').filter({ hasText: 'wide-tall' }).locator('.media').click()
    const ready = page.locator('#inspection-dialog[data-viewer-state="ready"]')
    await ready.waitFor()
    const image = page.locator('.inspection-image')
    for (const [x, y] of [
      [0.5, 0.5],
      [0.6, 0.65],
    ] as const) {
      const fit = await image.boundingBox()
      if (!fit) throw new Error('viewer image absent')
      expect(fit.width / 2560).toBeLessThan(0.1)
      const point = { clientX: fit.x + fit.width * x, clientY: fit.y + fit.height * y }
      await page.mouse.click(point.clientX, point.clientY)
      await ready.waitFor()
      const actual = await image.evaluate(
        (element, { x, y, point }) => {
          const rect = element.getBoundingClientRect()
          const surface = element.parentElement!
          return {
            width: rect.width,
            scrollWidth: surface.scrollWidth,
            clientWidth: surface.clientWidth,
            deltaX: rect.left + rect.width * x - point.clientX,
            deltaY: rect.top + rect.height * y - point.clientY,
          }
        },
        { x, y, point },
      )
      expect(actual.width).toBe(2560)
      expect(actual.scrollWidth).toBeGreaterThan(actual.clientWidth)
      expect(Math.abs(actual.deltaX), JSON.stringify({ x, y, actual })).toBeLessThanOrEqual(1)
      expect(Math.abs(actual.deltaY), JSON.stringify({ x, y, actual })).toBeLessThanOrEqual(1)
      await page.locator('[data-viewer-toggle]').click()
      await ready.waitFor()
    }
    await context.close()
  })

  it('opens a device-scale-two capture and refits on resize', async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 844 },
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    await page.goto(largeGalleryUrl)
    const opener = page.locator('.card').nth(1).locator('[data-inspect]')
    await opener.click()
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    const image = page.locator('.inspection-image')
    const before = await image.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      natural: element.naturalWidth,
    }))
    expect(before.width).toBeLessThanOrEqual(before.natural / 2)
    await page.locator('[data-viewer-toggle]').click()
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    expect(await image.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(
      before.natural / 2,
      0,
    )
    await page.locator('[data-viewer-toggle]').click()
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(
      (element) => {
        const surface = element.parentElement!
        const dpr = element.ownerDocument.defaultView!.devicePixelRatio
        const width = element.naturalWidth / dpr
        const height = element.naturalHeight / dpr
        const fit = Math.min(surface.clientWidth / width, surface.clientHeight / height, 1)
        const rect = element.getBoundingClientRect()
        return (
          Math.abs(rect.width - width * fit) < 0.5 &&
          Math.abs(rect.height - height * fit) < 0.5 &&
          element.ownerDocument
            .querySelector('#inspection-dialog')
            ?.getAttribute('data-viewer-state') === 'ready'
        )
      },
      await image.elementHandle(),
    )
    const header = await page.locator('.dialog-head').boundingBox()
    const surface = await page.locator('.inspection-surface').boundingBox()
    expect(header!.y + header!.height).toBeLessThanOrEqual(surface!.y)
    const resized = await image.evaluate((element) => {
      const surface = element.parentElement!
      const dpr = element.ownerDocument.defaultView!.devicePixelRatio
      const actualWidth = element.naturalWidth / dpr
      const actualHeight = element.naturalHeight / dpr
      const fit = Math.min(
        surface.clientWidth / actualWidth,
        surface.clientHeight / actualHeight,
        1,
      )
      const rect = element.getBoundingClientRect()
      return {
        width: rect.width,
        height: rect.height,
        fitWidth: actualWidth * fit,
        fitHeight: actualHeight * fit,
      }
    })
    expect(resized.fitWidth).toBeLessThan(before.width)
    expect(resized.width).toBeCloseTo(resized.fitWidth, 0)
    expect(resized.height).toBeCloseTo(resized.fitHeight, 0)
    await page.locator('[data-viewer-toggle]').click()
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 391,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await page.waitForFunction('window.devicePixelRatio === 1')
    await page.waitForFunction(
      (element) =>
        element.getBoundingClientRect().width === element.naturalWidth &&
        element.ownerDocument
          .querySelector('#inspection-dialog')
          ?.getAttribute('data-viewer-state') === 'ready',
      await image.elementHandle(),
    )
    expect(await image.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(
      before.natural,
      0,
    )
    await page.locator('[data-viewer-toggle]').click()
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    expect(await image.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(
      before.width,
    )
    await page.keyboard.press('Escape')
    await expectFocus(page, opener)
    await context.close()
  }, 30_000)

  it('keeps preview and text actions accessible and filters recoverable', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto(galleryUrl)
    const first = page.locator('.card').first()
    const preview = first.locator('.media')
    await preview.focus()
    await page.keyboard.press('Enter')
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    await page.keyboard.press('Escape')
    await expectFocus(page, preview)
    await preview.focus()
    await page.keyboard.press('Space')
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    await page.keyboard.press('Escape')
    await expectFocus(page, preview)
    expect(await page.locator('#result-count').textContent()).toBe('60 of 60 shots shown')
    await page.locator('#search').fill('no such shot')
    expect(await page.locator('#result-count').textContent()).toBe('0 of 60 shots shown')
    expect(await page.locator('#no-match').isVisible()).toBe(true)
    await page.locator('[data-clear-search]').click()
    expect(await page.locator('#no-match').isVisible()).toBe(false)
    await page.locator('[data-filter="cropped"]').click()
    expect(await page.locator('#result-count').textContent()).toBe('9 of 60 shots shown')
    await page.locator('#search').fill('shot-30')
    expect(await page.locator('#no-match').isVisible()).toBe(true)
    await page.locator('[data-clear-filter]').click()
    expect(await page.locator('#result-count').textContent()).toBe('1 of 60 shots shown')
    expect(await page.locator('[data-filter="cropped"]').textContent()).toBe('Not full page · 9')
    await page.locator('[data-filter="cropped"]').click()
    await page.locator('[data-clear-search]').click()
    expect(await page.locator('#result-count').textContent()).toBe('9 of 60 shots shown')
    expect(await page.locator('[data-filter="cropped"]').getAttribute('aria-pressed')).toBe('true')
    await context.close()
  })

  it('hides a tall image placeholder while loaded and restores it after bounded eviction', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto(galleryUrl)
    const tallCard = page
      .locator('.card')
      .filter({ has: page.locator('h3', { hasText: 'tall-aspect' }) })
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
    await tallCard.locator('.media').click()
    await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
    await page.keyboard.press('Escape')
    await expectFocus(page, tallCard.locator('.media'))
    await context.close()
  })

  it('retains originals without JavaScript and loads on demand without IntersectionObserver', async () => {
    const noScript = await browser.newContext({ javaScriptEnabled: false })
    const noScriptPage = await noScript.newPage()
    await noScriptPage.goto(galleryUrl)
    expect(await noScriptPage.locator('a[data-original]').count()).toBe(60)
    expect(await noScriptPage.locator('noscript').isVisible()).toBe(true)
    expect(await noScriptPage.locator('[data-viewer-open]:not([disabled])').count()).toBe(0)
    expect(await noScriptPage.locator('.load-action').count()).toBe(60)
    expect(await noScriptPage.locator('.load-action:not([disabled])').count()).toBe(0)
    expect(await noScriptPage.locator('.overview-image').count()).toBe(0)
    const noScriptTallCard = noScriptPage.locator('.card').filter({
      has: noScriptPage.locator('h3', { hasText: 'tall-aspect' }),
    })
    expect(await mediaTextState(noScriptTallCard.locator('.media'))).toEqual({
      placeholderVisibility: 'visible',
      visibleText: ['Original available to download · 24×96 intrinsic pixels'],
      visibleTextIntersectingImage: 0,
    })
    expect(await noScriptTallCard.locator('a[data-original]').getAttribute('download')).toBe(
      'shot-3.png',
    )
    await noScript.close()

    const fallback = await browser.newContext()
    await fallback.addInitScript('delete window.IntersectionObserver')
    const fallbackPage = await fallback.newPage()
    await fallbackPage.goto(galleryUrl)
    expect(await fallbackPage.locator('.overview-image').count()).toBe(1)
    expect(await fallbackPage.locator('.load-action:visible').count()).toBe(60)
    expect(await fallbackPage.locator('.load-action:not([disabled])').count()).toBe(60)
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

it('keeps an artifact-only spec visible and its escaped preview and full-file link usable in the browser', async () => {
  const runDir = path.join(root, 'artifact-only')
  fs.mkdirSync(path.join(runDir, 'data'), { recursive: true })
  fs.writeFileSync(path.join(runDir, 'data/page.html'), '<h1>review source</h1>')
  fs.writeFileSync(
    path.join(runDir, 'manifest.json'),
    JSON.stringify(
      makeManifest({
        runId: 'artifact-only',
        artifacts: [
          {
            name: 'page.html',
            spec: 'only-data.shots.ts',
            file: 'data/page.html',
            contentType: 'text/html',
            bytes: 22,
            testId: 'data-test',
          },
        ],
      }),
    ),
  )
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(pathToFileURL(generateGallery(runDir).galleryPath).href)
    expect(await page.getByRole('heading', { name: 'only-data.shots.ts' }).isVisible()).toBe(true)
    expect(await page.locator('.data-preview').textContent()).toBe('<h1>review source</h1>')
    expect(await page.getByRole('link', { name: 'Download full file' }).getAttribute('href')).toBe(
      'data/page.html',
    )
    expect(errors).toEqual([])
  } finally {
    await page.close()
  }
})

it('shows nested test context on desktop and mobile and filters by describe title', async () => {
  const runDir = path.join(root, 'w4-cards')
  const captures = [
    makeShot({
      name: 'review-order',
      spec: 'checkout.shots.ts',
      file: 'shots/checkout.shots.ts/review-order.png',
      testId: 'checkout',
    }),
    makeShot({
      name: 'account-menu',
      spec: 'account.shots.ts',
      file: 'shots/account.shots.ts/account-menu.png',
      testId: 'account',
    }),
  ]
  for (const [index, entry] of captures.entries()) {
    const file = path.join(runDir, entry.file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, uniquePng(30 + index, 960, 620))
  }
  fs.writeFileSync(
    path.join(runDir, 'manifest.json'),
    JSON.stringify(
      makeManifest({
        runId: 'w4-cards',
        shots: captures,
        tests: [
          {
            id: 'checkout',
            title: 'shows the complete shipping estimate after applying a promotion',
            titlePath: [
              'Checkout',
              'Review and confirm an order with several delivery options',
              'shows the complete shipping estimate after applying a promotion',
            ],
            spec: 'checkout.shots.ts',
            project: 'chromium',
            status: 'passed',
            retry: 0,
            durationMs: 1,
          },
          {
            id: 'account',
            title: 'opens the account menu',
            titlePath: ['Account settings', 'opens the account menu'],
            spec: 'account.shots.ts',
            project: 'chromium',
            status: 'passed',
            retry: 0,
            durationMs: 1,
          },
        ],
      }),
    ),
  )
  const url = pathToFileURL(generateGallery(runDir).galleryPath).href
  const output = path.join('local')
  fs.mkdirSync(output, { recursive: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(url)
    const title =
      'Checkout › Review and confirm an order with several delivery options › shows the complete shipping estimate after applying a promotion'
    expect(await page.locator('.test-title').first().textContent()).toBe(title)
    await page.screenshot({ path: path.join(output, 'w4-cards-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.locator('.test-title').first().isVisible()).toBe(true)
    await page.screenshot({ path: path.join(output, 'w4-cards-mobile.png'), fullPage: true })
    await page.locator('#search').fill('Review and confirm an order')
    expect(await page.locator('.card:not(.hidden)').count()).toBe(1)
    expect(await page.locator('.card:not(.hidden) .test-title').textContent()).toBe(title)
    await page.screenshot({ path: path.join(output, 'w4-search.png'), fullPage: true })
  } finally {
    await page.close()
  }
})
