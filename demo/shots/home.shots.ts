import { shot, walkthrough } from 'shotwright/capture'

walkthrough('home states', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Project name').fill('Shotwright demo')
  await page.getByLabel('Review focus').fill('Modal and dark theme states')
  await shot(page, 'form-filled')

  await page.getByRole('button', { name: 'Review summary' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible' })
  await shot(page, 'modal-open', { locator: dialog })

  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Use dark theme' }).click()
  await shot(page, 'theme-dark')
})
