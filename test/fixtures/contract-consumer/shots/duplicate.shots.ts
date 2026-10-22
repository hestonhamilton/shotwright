import { test } from '@playwright/test'
import { shot } from '../../../../dist/capture.js'
test('duplicate one', async ({page}) => {await page.goto('data:text/html,one');await shot(page,'collision')})
test('duplicate two', async ({page}) => {await page.goto('data:text/html,two');await shot(page,'collision')})
