import { test } from '@playwright/test'
import { shot } from '../../../../dist/capture.js'

export function registerHelperShot(): void {
  test.describe('helper group', () => {
    test('helper registered capture', async ({ page }) => {
      await page.goto('data:text/html,<h1>helper</h1>')
      await shot(page, 'helper-shot')
    })
  })
}
