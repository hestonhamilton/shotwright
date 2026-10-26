import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { artifact } from '../../../../dist/capture.js'
test('data validation', async () => {
  await expect(artifact('../escape',{body:'x',contentType:'text/plain'})).rejects.toThrow(/invalid artifact name/)
  await expect(artifact('bad.txt',{body:'x',contentType:'bad'})).rejects.toThrow(/contentType/)
  await artifact('once.txt',{body:'first',contentType:'text/plain'})
  await artifact('logs/network.json',{body:'{"ok":true}',contentType:'application/json'})
  await expect(artifact('once.txt',{body:'second',contentType:'text/plain'})).rejects.toThrow(/duplicate artifact/)
  const runDir = process.env.SHOTWRIGHT_RUN_DIR!
  const outside = fs.mkdtempSync(path.join(os.tmpdir(),'shotwright-artifact-'))
  try {
    fs.symlinkSync(outside,path.join(runDir,'data/data/redirect'))
    await expect(artifact('redirect/escape.txt',{body:'escape',contentType:'text/plain'})).rejects.toThrow(/artifact parent/)
    expect(fs.existsSync(path.join(outside,'escape.txt'))).toBe(false)
    fs.writeFileSync(path.join(runDir,'data/data/file-parent'),'file')
    await expect(artifact('file-parent/escape.txt',{body:'escape',contentType:'text/plain'})).rejects.toThrow(/artifact parent/)
  } finally { fs.rmSync(outside,{recursive:true,force:true}) }
})
