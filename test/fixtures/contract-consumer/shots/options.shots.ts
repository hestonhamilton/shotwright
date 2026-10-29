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

test('spec-created context scale follows the captured page and locator', async ({ page, browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 240 },
    deviceScaleFactor: 1,
  })
  try {
    const other = await context.newPage()
    await other.setContent(`
      <style>body { margin: 0 } #target { width: 120px; height: 60px; background: blue }</style>
      <div id="target"></div><div style="height: 600px"></div>
    `)
    expect(await other.evaluate('window.devicePixelRatio')).toBe(1)
    expect(await page.evaluate('window.devicePixelRatio')).toBe(2)
    const runDir = process.env.SHOTWRIGHT_RUN_DIR!
    const viewportBytes = await other.screenshot({ type: 'png', fullPage: false })
    await shot(other, 'context-viewport', { fullPage: false })
    expect(fs.readFileSync(path.join(runDir, 'shots/options/context-viewport.png'))).toEqual(
      viewportBytes,
    )
    const fullPageBytes = await other.screenshot({ type: 'png', fullPage: true })
    await shot(other, 'context-full-page')
    expect(fs.readFileSync(path.join(runDir, 'shots/options/context-full-page.png'))).toEqual(
      fullPageBytes,
    )
    const target = other.locator('#target')
    const locatorBytes = await target.screenshot({ type: 'png' })
    await shot(page, 'context-locator', { locator: target })
    expect(fs.readFileSync(path.join(runDir, 'shots/options/context-locator.png'))).toEqual(
      locatorBytes,
    )
    await shot(page, 'project-viewport', { fullPage: false })
  } finally {
    await context.close()
  }
})
