import { shot, walkthrough } from 'shotwright/capture'

walkthrough('inline page', async ({ page }) => {
  await page.setContent('<main><h1>subdir consumer</h1><p>shotwright-746.8.1 proof</p></main>')
  await shot(page, 'inline')
})
