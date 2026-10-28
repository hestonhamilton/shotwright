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
      expect(await page.locator('[data-viewer-open]').count()).toBe(3)
      expect(await page.locator('a[download]').count()).toBe(2)
      for (const side of ['a', 'b', 'diff']) {
        const opener = page.locator(`[data-viewer-open="pair-0-${side}"]`)
        await opener.click()
        await page.locator('#inspection-dialog[data-viewer-state="ready"]').waitFor()
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
      expect(errors).toEqual([])
      expect(network).toEqual([])
      await context.close()
    }
    const noScript = await browser.newContext({ javaScriptEnabled: false })
    const page = await noScript.newPage()
    await page.goto(url)
    expect(await page.locator('[data-viewer-open]:not([disabled])').count()).toBe(0)
    expect(await page.locator('.images img').count()).toBe(3)
    expect(await page.locator('a[download]').count()).toBe(2)
    await noScript.close()
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
