import { shot, walkthrough } from 'shotwright/capture'

walkthrough('passing nested npm capture', async ({ page }) => {
  await page.setContent('<main>nested npm proof</main>')
  await shot(page, 'pass')
})

walkthrough('intentional failure after capture', async ({ page }) => {
  await page.setContent('<main>failed run evidence</main>')
  await shot(page, 'failure')
  throw new Error('intentional proof failure')
})
