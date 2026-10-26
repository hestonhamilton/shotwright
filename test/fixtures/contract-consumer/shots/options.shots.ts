import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { shot } from '../../../../dist/capture.js'

test('shot screenshot options preserve Playwright bytes', async ({ page }) => {
  await page.setContent(`
    <style>body { margin: 0 } #target { width: 180px; height: 80px; background: green }</style>
    <div id="target"><span id="secret">secret</span></div>
    <div style="height: 1400px">tall page</div>
  `)
  const runDir = process.env.SHOTWRIGHT_RUN_DIR!
  const target = page.locator('#target')
  const mask = page.locator('#secret')
  const options = {
    animations: 'disabled' as const,
    caret: 'initial' as const,
    mask: [mask],
    style: '#target { background: blue !important }',
  }

  const defaultBytes = await page.screenshot({ type: 'png', fullPage: true })
  const pageScreenshot = page.screenshot.bind(page)
  page.screenshot = async (received) => {
    expect(received).toEqual({ type: 'png', fullPage: true })
    return pageScreenshot(received)
  }
  await shot(page, 'default-options')
  page.screenshot = pageScreenshot
  expect(fs.readFileSync(path.join(runDir, 'shots/options/default-options.png'))).toEqual(defaultBytes)

  const fullPageBytes = await page.screenshot({ type: 'png', fullPage: true, ...options })
  expect(fullPageBytes).not.toEqual(
    await page.screenshot({ type: 'png', fullPage: true, ...options, mask: [] }),
  )
  page.screenshot = async (received) => {
    expect(received).toEqual({ type: 'png', fullPage: true, ...options })
    return pageScreenshot(received)
  }
  await shot(page, 'full-page-options', options)
  page.screenshot = pageScreenshot
  expect(fs.readFileSync(path.join(runDir, 'shots/options/full-page-options.png'))).toEqual(
    fullPageBytes,
  )

  const locatorBytes = await target.screenshot({ type: 'png', ...options })
  expect(locatorBytes).not.toEqual(await target.screenshot({ type: 'png', ...options, mask: [] }))
  const locatorScreenshot = target.screenshot.bind(target)
  target.screenshot = async (received) => {
    expect(received).toEqual({ type: 'png', ...options })
    return locatorScreenshot(received)
  }
  await shot(page, 'locator-options', { locator: target, ...options })
  target.screenshot = locatorScreenshot
  expect(fs.readFileSync(path.join(runDir, 'shots/options/locator-options.png'))).toEqual(
    locatorBytes,
  )
})
