import { expect, test } from '@playwright/test'
import { shot } from '../../../../dist/capture.js'
test('fails after capture', async ({page}) => {
  await page.goto('data:text/html,<h1>before failure</h1>')
  await shot(page,'before-failure')
  expect(1).toBe(2)
})
