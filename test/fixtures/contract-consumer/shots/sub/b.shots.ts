import { test } from '@playwright/test'
import { shot } from '../../../../../dist/capture.js'
test('same name b', async ({page}) => {
  await page.goto('data:text/html,<h1>B</h1>')
  await shot(page,'shared')
})
