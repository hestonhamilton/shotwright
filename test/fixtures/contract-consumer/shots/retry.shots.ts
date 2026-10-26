import { test } from '@playwright/test'
import { artifact, shot } from '../../../../dist/capture.js'
test('retry omit', async ({page},info) => {
  if (info.retry===0) {
    await page.goto('data:text/html,<h1>old</h1>')
    await shot(page,'retry-shot')
    await artifact('retry.txt',{body:'old',contentType:'text/plain'})
    throw new Error('retry once')
  }
})
test('retry recapture', async ({page},info) => {
  await page.goto(`data:text/html,<h1>${info.retry===0?'old':'new'}</h1>`)
  await shot(page,'retry-shot')
  await artifact('retry.txt',{body:info.retry===0?'old':'new',contentType:'text/plain'})
  if (info.retry===0) throw new Error('retry once')
})
test('retry failed capture', async ({page},info) => {
  await page.goto('data:text/html,<h1>retry</h1>')
  if (info.retry === 0) {
    await shot(page,'retry-failed-shot')
    throw new Error('retry once')
  }
  await page.close()
  await shot(page,'retry-failed-shot')
})
test('retry twice', async ({page},info) => {
  await page.goto(`data:text/html,<h1>attempt ${info.retry}</h1>`)
  await shot(page,'retry-twice-shot')
  if (info.retry < 2) throw new Error('retry again')
})
