import { expect, test } from '@playwright/test'
import { shot, artifact } from '../../../../dist/capture.js'
test('same name a', async ({page}) => {
  await page.goto('data:text/html,<h1>A</h1>')
  await shot(page,'shared',{check:()=>expect(page.locator('h1')).toHaveText('A')})
  await artifact('body.txt',{body:'hello',contentType:'text/plain'})
})
