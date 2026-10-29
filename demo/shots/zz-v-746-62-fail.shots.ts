import { expect } from '@playwright/test'
import { shot, walkthrough } from 'shotwright/capture'

walkthrough('temporary upload policy failure', async ({ page }) => {
  await page.goto('/')
  await shot(page, 'v-746-62-before-failure')
  expect(true).toBe(false)
})
