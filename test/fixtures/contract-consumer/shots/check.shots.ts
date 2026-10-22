import fs from 'node:fs'
import path from 'node:path'
import { test } from '@playwright/test'
import { artifact, shot } from '../../../../dist/capture.js'
test('no-op check and fullPage bytes', async ({page}) => {
  await page.goto('data:text/html,<div style="height:3000px">tall</div>')
  await shot(page,'tall',{check:()=>{}})
  const runDir=process.env.SHOTWRIGHT_RUN_DIR!
  await page.screenshot({path:path.join(runDir,'explicit.png'),fullPage:true})
  await artifact('utf8.txt',{body:'héllo',contentType:'text/plain'})
  const source=path.join(runDir,'source.txt');fs.writeFileSync(source,'from path')
  await artifact('path.txt',{path:source,contentType:'text/plain'})
})
test('filtered callback does not execute', async ({page}) => {
  await shot(page,'excluded',{check:()=>{throw new Error('filtered callback executed')}})
})
test('thrown callback writes no capture', async ({page}) => {
  await shot(page,'throws',{check:()=>{throw new Error('check failed')}})
})
