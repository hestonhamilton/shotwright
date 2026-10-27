import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { artifact, shot } from '../../../../dist/capture.js'
test('fails after capture', async ({page}) => {
  await page.goto('data:text/html,<h1>before failure</h1>')
  await shot(page,'before-failure')
  expect(1).toBe(2)
})
test('scratch source survives external reading before a failed run', async () => {
  const source = test.info().outputPath('report.txt')
  fs.writeFileSync(source, 'scratch report')
  expect(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))', source], { encoding: 'utf8' })).toBe('scratch report')
  await artifact('report.txt', { path: source, contentType: 'text/plain' })
  expect(1).toBe(2)
})
