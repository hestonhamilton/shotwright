import { shot, walkthrough } from 'shotwright/capture'

walkthrough('home page', async ({ page }) => {
  await page.goto('/')
  await shot(page, 'home')
})
