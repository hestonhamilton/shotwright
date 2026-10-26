import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { shot } from '../../../../dist/capture.js'
test('duplicate one', async ({page}) => {
  await page.goto('data:text/html,<body style="background:red">first claimant</body>')
  await page.screenshot({path:path.join(process.env.SHOTWRIGHT_RUN_DIR!,'first-expected.png'),fullPage:true})
  await shot(page,'collision')
  fs.writeFileSync(path.join(process.env.SHOTWRIGHT_RUN_DIR!,'first-complete'),'ready')
})
test('duplicate two', async ({page}) => {
  await page.goto('data:text/html,<body style="background:blue">second claimant</body>')
  await page.screenshot({path:path.join(process.env.SHOTWRIGHT_RUN_DIR!,'second-expected.png'),fullPage:true})
  const marker = path.join(process.env.SHOTWRIGHT_RUN_DIR!,'first-complete')
  await expect.poll(() => fs.existsSync(marker)).toBe(true)
  await shot(page,'collision')
})
