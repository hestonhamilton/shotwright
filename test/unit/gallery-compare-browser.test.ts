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
