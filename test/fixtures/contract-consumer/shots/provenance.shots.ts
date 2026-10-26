import { test } from '@playwright/test'
import { shot } from '../../../../dist/capture.js'

test('provenance across projects', async ({ page }, info) => {
  await page.setContent('<h1>Observed browser</h1>')
  await shot(page, `project-${info.project.name}`)
})

test('provenance internals fail after capture', async ({ page }) => {
  const browser = page.context().browser()!
  const connection = (browser as unknown as { _connection: { isRemote: () => boolean } })._connection
  const original = connection.isRemote
  connection.isRemote = () => { throw new Error('internal failure') }
  try {
    await page.setContent('<h1>Capture survives</h1>')
    await shot(page, 'survives')
  } finally {
    connection.isRemote = original
  }
})
