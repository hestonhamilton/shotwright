import { shot, walkthrough } from 'shotwright/capture'

walkthrough('about layouts', async ({ page }) => {
  await page.goto('/about.html')
  await shot(page, 'about-desktop')

  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, 'mobile-layout')
})
