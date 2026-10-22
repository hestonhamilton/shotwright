import { expect, test } from '@playwright/test'
import { artifact } from '../../../../dist/capture.js'
test('data validation', async () => {
  await expect(artifact('../escape',{body:'x',contentType:'text/plain'})).rejects.toThrow(/invalid shot name/)
  await expect(artifact('bad.txt',{body:'x',contentType:'bad'})).rejects.toThrow(/contentType/)
  await artifact('once.txt',{body:'first',contentType:'text/plain'})
  await expect(artifact('once.txt',{body:'second',contentType:'text/plain'})).rejects.toThrow(/duplicate artifact/)
})
