import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import { expect, it } from 'vitest'
import { generateCompareGallery } from '../../src/gallery/generate-compare.js'
import { makeManifest, makeShot } from '../fixtures/manifest.js'

it('opens A, B, and Diff without CSP violations or network requests and leaves no-JS previews usable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-compare-browser-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const runs = (['a', 'b'] as const).map((side) => {
      const dir = path.join(root, side)
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
      const image = new PNG({ width: 40, height: 60 })
      image.data.fill(side === 'a' ? 10 : 80)
      fs.writeFileSync(path.join(dir, 'shots', 'one.png'), PNG.sync.write(image))
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify(
          makeManifest({
            runId: side,
            shots: [
              makeShot({ spec: '<sample>.shots.ts', name: 'one & done', file: 'shots/one.png' }),
            ],
          }),
        ),
      )
      return dir
    })
    const file = generateCompareGallery(runs[0]!, runs[1]!).outputFile
    const html = fs.readFileSync(file, 'utf8')
    expect(html).toContain('&lt;sample&gt;.shots.ts')
    expect(html).toContain('one &amp; done')
    const url = pathToFileURL(file).href
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ colorScheme })
      const page = await context.newPage()
      const errors: string[] = []
      const network: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (/^https?:/.test(request.url())) network.push(request.url())
      })
      await page.goto(url)
      expect(await page.locator('[data-viewer-pair-a]').count()).toBe(1)
      const pairOpener = page.locator('[data-viewer-pair-a]')
      await pairOpener.click()
      await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
      expect(await page.locator('.pair-surface img[src]').count()).toBe(2)
      expect(await page.locator('#inspection-dialog').count()).toBe(1)
      expect(await page.locator('[data-pair-mode="side"]').getAttribute('aria-pressed')).toBe(
        'true',
      )
      expect(await page.locator('.pair-controls').isVisible()).toBe(true)
      await page.locator('[data-pair-mode="swipe"]').click()
      expect(await page.locator('.pair-surface img[src]').count()).toBe(4)
      await page.locator('[data-pair-range]').fill('35')
      expect(await page.locator('[data-pair-percent]').textContent()).toBe('35%')
      expect(
        await page
          .locator('.pair-layer-b')
          .evaluate(
            (element) => element.ownerDocument.defaultView!.getComputedStyle(element).clipPath,
          ),
      ).toBe('inset(0px 65% 0px 0px)')
      await page.locator('[data-pair-mode="onion"]').click()
      expect(await page.locator('[data-pair-range]').inputValue()).toBe('50')
      await page.locator('[data-pair-range]').fill('70')
      expect(
        await page
          .locator('.pair-layer-b')
          .evaluate(
            (element) => element.ownerDocument.defaultView!.getComputedStyle(element).opacity,
          ),
      ).toBe('0.7')
      await page.locator('[data-pair-mode="swipe"]').click()
      expect(await page.locator('[data-pair-range]').inputValue()).toBe('35')
      await page.locator('[data-pair-mode="onion"]').click()
      expect(await page.locator('[data-pair-range]').inputValue()).toBe('70')
      await page.keyboard.press('Escape')
      await page.locator('.pair-surface img[src]').first().waitFor({ state: 'detached' })
      expect(
        await pairOpener.evaluate((element) => element === element.ownerDocument.activeElement),
      ).toBe(true)
      expect(await page.locator('.pair-surface img[src]').count()).toBe(0)
      expect(await page.locator('[data-viewer-open]').count()).toBe(3)
      expect(await page.locator('a[download]').count()).toBe(2)
      for (const side of ['a', 'b', 'diff']) {
        const opener = page.locator(`[data-viewer-open="pair-0-${side}"]`)
        await opener.click()
        await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
        expect(await page.locator('.pair-surface img[src]').count()).toBe(0)
        expect(await page.locator('[data-viewer-prev]').isHidden()).toBe(true)
        expect(await page.locator('[data-viewer-next]').isHidden()).toBe(true)
        expect(await page.locator('[data-viewer-position]').isHidden()).toBe(true)
        expect(await page.locator('.viewer-navigation-help').textContent()).toBe('')
        expect(await page.locator('.viewer-help').innerText()).not.toContain(
          'While fitted, Left and Right move between shots',
        )
        expect(await page.locator('.inspection-image').getAttribute('src')).toBe(
          await page.locator(`#pair-0-${side}`).getAttribute('src'),
        )
        expect(await page.locator('[data-viewer-toggle]').isHidden()).toBe(true)
        expect(await page.locator('.viewer-help').isHidden()).toBe(true)
        const styles = await page.locator('.inspection-image').evaluate((image) => {
          const view = image.ownerDocument.defaultView!
          return {
            cursor: view.getComputedStyle(image).cursor,
            outline: view.getComputedStyle(image).outlineWidth,
            imageBackground: view.getComputedStyle(image).backgroundColor,
            surfaceBackground: view.getComputedStyle(image.parentElement!).backgroundColor,
            actionWeight: view.getComputedStyle(
              image.ownerDocument.querySelector('.viewer-dialog .action')!,
            ).fontWeight,
          }
        })
        expect(styles.cursor).toBe('default')
        expect(styles.outline).toBe('1px')
        expect(styles.surfaceBackground).not.toBe(styles.imageBackground)
        expect(styles.actionWeight).toBe('650')
        await page.locator('.inspection-image').click()
        expect(await page.locator('.inspection-image.actual').count()).toBe(0)
        await page.keyboard.press('Escape')
        expect(
          await opener.evaluate((element) => element === element.ownerDocument.activeElement),
        ).toBe(true)
      }
      await pairOpener.click()
      await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
      await page.setViewportSize({ width: 900, height: 700 })
      await page
        .locator('#inspection-dialog')
        .evaluate((dialog) => (dialog as unknown as { close(): void }).close())
      await page
        .locator('[data-viewer-open="pair-0-a"]')
        .evaluate((button) => (button as unknown as { click(): void }).click())
      await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
      expect(await page.locator('.pair-controls').isHidden()).toBe(true)
      expect(await page.locator('.inspection-image').count()).toBe(1)
      await page.keyboard.press('Escape')
      await pairOpener.click()
      await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
      expect(await page.locator('[data-pair-mode="side"]').getAttribute('aria-pressed')).toBe(
        'true',
      )
      await page.locator('[data-pair-mode="swipe"]').click()
      expect(await page.locator('[data-pair-range]').inputValue()).toBe('50')
      await page.locator('[data-pair-mode="onion"]').click()
      expect(await page.locator('[data-pair-range]').inputValue()).toBe('50')
      await page.keyboard.press('Escape')
      expect(errors).toEqual([])
      expect(network).toEqual([])
      await context.close()
    }
    const noScript = await browser.newContext({ javaScriptEnabled: false })
    const page = await noScript.newPage()
    await page.goto(url)
    expect(await page.locator('[data-viewer-open]:not([disabled])').count()).toBe(0)
    expect(await page.locator('[data-viewer-pair-a]:not([disabled])').count()).toBe(0)
    expect(await page.locator('[data-viewer-prev]').isHidden()).toBe(true)
    expect(await page.locator('[data-viewer-next]').isHidden()).toBe(true)
    expect(await page.locator('[data-viewer-position]').isHidden()).toBe(true)
    expect(await page.locator('.images img').count()).toBe(3)
    expect(await page.locator('a[download]').count()).toBe(2)
    await noScript.close()
    const broken = await browser.newPage()
    await broken.goto(url)
    await broken.locator('#pair-0-b').evaluate((image) => {
      image.setAttribute('src', 'data:image/png;base64,broken')
    })
    await broken.locator('[data-viewer-pair-a]').click()
    await broken.locator('#inspection-dialog[data-viewer-state="unavailable"]').waitFor()
    expect(await broken.locator('.pair-error').isVisible()).toBe(true)
    expect(await broken.locator('[data-pair-mode="side"]').isDisabled()).toBe(true)
    expect(await broken.locator('[data-viewer-toggle]').isHidden()).toBe(true)
    await broken.close()
  } finally {
    await browser.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('keeps pair geometry, panning, and overlay controls usable at desktop and narrow widths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-pair-geometry-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const runs = (['a', 'b'] as const).map((side) => {
      const dir = path.join(root, side)
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
      const image = new PNG({
        width: side === 'a' ? 2400 : 1200,
        height: side === 'a' ? 3000 : 1600,
      })
      for (let index = 0; index < image.data.length; index += 4) {
        image.data[index] = side === 'a' ? 240 : 20
        image.data[index + 1] = side === 'a' ? 20 : 90
        image.data[index + 2] = side === 'a' ? 20 : 240
        image.data[index + 3] = 255
      }
      fs.writeFileSync(path.join(dir, 'shots', 'one.png'), PNG.sync.write(image))
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify(
          makeManifest({ runId: side, shots: [makeShot({ name: 'one', file: 'shots/one.png' })] }),
        ),
      )
      return dir
    })
    const url = pathToFileURL(generateCompareGallery(runs[0]!, runs[1]!).outputFile).href
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
      const page = await context.newPage()
      await page.goto(url)
      const opener = page.locator('[data-viewer-pair-a]')
      await opener.click()
      await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
      const measure = () =>
        page.locator('.pair-surface').evaluate((surface) => {
          const panes = [...surface.querySelectorAll('[data-pair-pane]')]
          return panes.map((pane) => ({
            pane: pane.getBoundingClientRect().toJSON(),
            image: pane.querySelector('img')!.getBoundingClientRect().toJSON(),
            x: pane.scrollLeft,
            y: pane.scrollTop,
            maxX: pane.scrollWidth - pane.clientWidth,
            maxY: pane.scrollHeight - pane.clientHeight,
          }))
        })
      let dimensions = await measure()
      expect(
        Math.abs(dimensions[0]!.image.width / 1200 - dimensions[1]!.image.width / 600),
      ).toBeLessThan(0.01)
      if (viewport.width === 390)
        expect(dimensions[0]!.pane.bottom).toBeLessThan(dimensions[1]!.pane.top)
      await page.locator('[data-viewer-toggle]').click()
      dimensions = await measure()
      expect(dimensions[0]!.image.width).toBeCloseTo(1200, 0)
      expect(dimensions[1]!.image.width).toBeCloseTo(600, 0)
      await page.locator('[data-pair-pane="a"]').evaluate((pane) => {
        pane.scrollLeft = 900
        pane.scrollTop = 900
      })
      await expect.poll(async () => (await measure())[1]!.y).toBeGreaterThan(0)
      dimensions = await measure()
      expect(dimensions[1]!.y).toBeCloseTo(Math.min(dimensions[0]!.y, dimensions[1]!.maxY), 0)
      await page.locator('[data-pair-pane="b"]').evaluate((pane) => {
        pane.scrollTop = 40
      })
      await expect.poll(async () => (await measure())[0]!.y).toBeCloseTo(40, 0)
      await page.locator('.pair-surface').evaluate((surface) => {
        const a = surface.querySelector('[data-pair-pane="a"]')!
        const b = surface.querySelector('[data-pair-pane="b"]')!
        a.scrollTop = 300
        b.scrollTop = 120
      })
      await expect.poll(async () => (await measure())[0]!.y).toBeCloseTo(120, 0)
      dimensions = await measure()
      expect(Math.abs(dimensions[0]!.y - dimensions[1]!.y)).toBeLessThanOrEqual(1)
      await page.locator('[data-pair-mode="swipe"]').click()
      await page.locator('[data-pair-range]').fill('35')
      const overlay = page.locator('.pair-overlay .pair-stage')
      expect(
        await overlay
          .locator('.pair-layer-b')
          .evaluate((layer) => layer.ownerDocument.defaultView!.getComputedStyle(layer).clipPath),
      ).toContain('65%')
      expect(await overlay.evaluate((stage) => stage.getBoundingClientRect().width)).toBeCloseTo(
        1200,
        0,
      )
      expect(await page.locator('.pair-details').textContent()).toContain('aligned at top left')
      if (viewport.width === 1280) {
        const pixels = PNG.sync.read(await overlay.screenshot())
        const colorAt = (fraction: number) => {
          const offset =
            (Math.floor(pixels.height * 0.1) * pixels.width + Math.floor(pixels.width * fraction)) *
            4
          return [...pixels.data.subarray(offset, offset + 3)]
        }
        expect(colorAt(0.1)).toEqual([20, 90, 240])
        expect(colorAt(0.6)).toEqual([240, 20, 20])
      }
      await page.locator('[data-pair-range]').focus()
      await page.keyboard.press('Home')
      expect(await page.locator('[data-pair-range]').inputValue()).toBe('0')
      await page.keyboard.press('End')
      expect(await page.locator('[data-pair-range]').inputValue()).toBe('100')
      await page.locator('[data-pair-mode="onion"]').click()
      await page.locator('[data-pair-range]').fill('35')
      expect(
        await overlay
          .locator('.pair-layer-b')
          .evaluate((layer) => layer.ownerDocument.defaultView!.getComputedStyle(layer).opacity),
      ).toBe('0.35')
      await page.keyboard.press('Escape')
      await opener.click()
      await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
      expect(await page.locator('[data-pair-mode="side"]').getAttribute('aria-pressed')).toBe(
        'true',
      )
      await context.close()
    }
  } finally {
    await browser.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('fits 1000x700 and 1000x8000 pairs within both panes at mobile and desktop sizes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-pair-fit-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const runs = (['a', 'b'] as const).map((side) => {
      const dir = path.join(root, side)
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
      const shots = [700, 8000].map((height) => {
        const name = `height-${height}`
        const image = new PNG({ width: 1000, height })
        for (let pixel = 0; pixel < image.data.length; pixel += 4) {
          image.data[pixel] = side === 'a' ? 220 : 30
          image.data[pixel + 1] = 80
          image.data[pixel + 2] = side === 'a' ? 40 : 210
          image.data[pixel + 3] = 255
        }
        fs.writeFileSync(path.join(dir, 'shots', `${name}.png`), PNG.sync.write(image))
        return makeShot({ name, file: `shots/${name}.png` })
      })
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify(makeManifest({ runId: side, shots })),
      )
      return dir
    })
    const url = pathToFileURL(generateCompareGallery(runs[0]!, runs[1]!).outputFile).href
    for (const viewport of [
      { width: 390, height: 844, colorScheme: 'dark' as const },
      { width: 1280, height: 800, colorScheme: 'light' as const },
    ]) {
      const context = await browser.newContext({ viewport, colorScheme: viewport.colorScheme })
      const page = await context.newPage()
      await page.goto(url)
      for (const [index, height] of [700, 8000].entries()) {
        await page.locator('[data-viewer-pair-a]').nth(index).click()
        await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
        const overflow = await page.locator('[data-pair-pane]').evaluateAll((panes) =>
          panes.map((pane) => ({
            vertical: pane.scrollHeight - pane.clientHeight,
            horizontal: pane.scrollWidth - pane.clientWidth,
          })),
        )
        for (const pane of overflow) {
          expect(pane.vertical).toBeLessThanOrEqual(0)
          expect(pane.horizontal).toBeLessThanOrEqual(0)
        }
        if (process.env.SHOTWRIGHT_REPAIR_SCREENSHOTS) {
          const out = path.join(process.cwd(), 'local')
          fs.mkdirSync(out, { recursive: true })
          await page.locator('#inspection-dialog').screenshot({
            path: path.join(out, `pair-side-${viewport.width}x${viewport.height}-${height}.png`),
          })
        }
        await page.keyboard.press('Escape')
      }
      await context.close()
    }
  } finally {
    await browser.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('filters final compare pairs and keeps native jump links usable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-compare-navigation-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const runs = (['a', 'b'] as const).map((side) => {
      const dir = path.join(root, side)
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'data'))
      const names = side === 'a' ? ['same', 'tint', 'removed'] : ['same', 'tint', 'added']
      const shots = names.map((name) => {
        const image = new PNG({ width: 2, height: 2 })
        image.data.fill(name === 'tint' && side === 'b' ? 1 : 0)
        fs.writeFileSync(path.join(dir, 'shots', `${name}.png`), PNG.sync.write(image))
        return makeShot({
          spec: '<sample>.shots.ts',
          name: `${name} & more`,
          file: `shots/${name}.png`,
        })
      })
      for (const name of ['kept', 'ignored'])
        fs.writeFileSync(path.join(dir, 'data', `${name}.txt`), `${side}-${name}`)
      const artifacts = ['kept', 'ignored'].map((name) => ({
        spec: 'notes.shots.ts',
        name,
        file: `data/${name}.txt`,
        contentType: 'text/plain',
        bytes: 9,
        testId: 'test-note',
      }))
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify(makeManifest({ runId: side, shots, artifacts })),
      )
      return dir
    })
    const outputFile = generateCompareGallery(runs[0]!, runs[1]!, {
      strict: true,
      failOnChange: true,
      ignore: ['notes.shots.ts/ignored'],
    }).outputFile
    const lenientFile = path.join(root, 'lenient.html')
    generateCompareGallery(runs[0]!, runs[1]!, {
      ignore: ['notes.shots.ts/ignored'],
      outputFile: lenientFile,
    })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const errors: string[] = []
    const network: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) network.push(request.url())
    })
    await page.goto(pathToFileURL(outputFile).href)
    const cards = page.locator('article.pair')
    const visible = page.locator('article.pair:visible')
    const jumps = page.locator('[data-compare-jump]:visible')
    expect(await cards.count()).toBe(6)
    expect(await visible.count()).toBe(6)
    expect(await page.locator('[data-compare-filter="all"]').getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(await page.locator('[data-compare-filter]:disabled').count()).toBe(0)
    expect(await page.locator('[data-compare-filter="gated"]').textContent()).toBe('Gated 4')
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(
      '&lt;sample&gt;.shots.ts / tint &amp; more · Similar',
    )
    await page.locator('.compare-jumps summary').click()
    await page.locator('[data-compare-filter="changed"]').click()
    expect(await visible.count()).toBe(2)
    expect(await jumps.count()).toBe(2)
    expect(await page.locator('#compare-result-count').textContent()).toBe('2 of 6 pairs shown')
    expect(await page.locator('#compare-result-count').getAttribute('role')).toBe('status')
    expect(await page.locator('.counts').count()).toBe(0)
    await page.locator('[data-compare-filter="gated"]').click()
    expect(await visible.count()).toBe(4)
    expect(await jumps.count()).toBe(4)
    expect(await page.locator('article.pair.state-similar:visible').count()).toBe(1)
    expect(await page.locator('article.pair.ignored:visible').count()).toBe(0)
    for (const href of await jumps
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
      expect(await page.locator(href!).isVisible()).toBe(true)
    }
    const first = jumps.locator('a').first()
    const href = await first.getAttribute('href')
    await first.click()
    expect(new URL(page.url()).hash).toBe(href)
    expect(
      await page.locator(href!).evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.top < element.ownerDocument.defaultView!.innerHeight && bounds.bottom > 0
      }),
    ).toBe(true)
    await page.locator('[data-compare-filter="similar"]').click()
    expect(new URL(page.url()).hash).toBe('')
    const hiddenPair = await page.locator('article.pair.state-added').getAttribute('id')
    expect(await page.locator(`#${hiddenPair}`).isVisible()).toBe(false)
    await page.evaluate((id) => {
      ;(globalThis as unknown as { location: { hash: string } }).location.hash = id
    }, hiddenPair!)
    await page.locator(`#${hiddenPair}`).waitFor({ state: 'visible' })
    expect(await page.locator('[data-compare-filter="all"]').getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(new URL(page.url()).hash).toBe(`#${hiddenPair}`)
    expect(
      await page.locator(`#${hiddenPair}`).evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.top < element.ownerDocument.defaultView!.innerHeight && bounds.bottom > 0
      }),
    ).toBe(true)
    await page.locator('[data-compare-filter="all"]').click()
    expect(await visible.count()).toBe(6)
    expect(await jumps.count()).toBe(6)
    expect(
      await page
        .locator('html')
        .evaluate(
          (element) => element.scrollWidth <= element.ownerDocument.defaultView!.innerWidth,
        ),
    ).toBe(true)
    expect(errors).toEqual([])
    expect(network).toEqual([])
    await context.close()
    const noScript = await browser.newContext({ javaScriptEnabled: false })
    const plain = await noScript.newPage()
    await plain.goto(pathToFileURL(outputFile).href)
    expect(await plain.locator('article.pair:visible').count()).toBe(6)
    expect(await plain.locator('[data-compare-filter]:disabled').count()).toBe(
      await plain.locator('[data-compare-filter]').count(),
    )
    expect(await plain.locator('[data-compare-filter="gated"]').textContent()).toBe('Gated 4')
    await plain.locator('.compare-jumps summary').click()
    expect(await plain.locator('[data-compare-jump]:visible').count()).toBe(6)
    await noScript.close()
    const lenient = await browser.newPage()
    await lenient.goto(pathToFileURL(lenientFile).href)
    expect(await lenient.locator('[data-compare-filter="gated"]').textContent()).toBe(
      'Would gate 3',
    )
    await lenient.locator('[data-compare-filter="gated"]').click()
    expect(await lenient.locator('article.pair.state-similar:visible').count()).toBe(0)
    expect(await lenient.locator('article.pair:visible').count()).toBe(3)
    await lenient.close()
  } finally {
    await browser.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
