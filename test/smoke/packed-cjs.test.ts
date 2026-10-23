// Exercise the published tarball from a CommonJS consumer at the documented
// require(esm) floor. `pnpm run smoke` builds dist before this test runs.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map(Number)
const supportsRequireEsm =
  (nodeMajor === 20 && nodeMinor >= 19) || (nodeMajor === 22 && nodeMinor >= 12) || nodeMajor >= 23

it.skipIf(!supportsRequireEsm)(
  'loads the packed package from a CommonJS consumer via require(esm) (Node ^20.19.0 || >=22.12.0)',
  () => {
    const local = path.join(root, 'local')
    fs.mkdirSync(local, { recursive: true })
    const scratch = fs.mkdtempSync(path.join(local, 'packed-cjs-'))
    try {
      const packed = spawnSync('pnpm', ['pack', '--pack-destination', scratch], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NPM_CONFIG_CACHE: path.join(root, 'local/npm-cache'), CI: 'true' },
      })
      expect(packed.status, packed.stderr).toBe(0)
      const tarball = fs.readdirSync(scratch).find((name) => name.endsWith('.tgz'))
      expect(tarball).toBeDefined()

      const consumer = path.join(scratch, 'consumer')
      const modules = path.join(consumer, 'node_modules')
      const packageDir = path.join(modules, 'shotwright')
      fs.mkdirSync(packageDir, { recursive: true })
      fs.writeFileSync(
        path.join(consumer, 'package.json'),
        JSON.stringify({ name: 'packed-cjs-consumer', private: true }) + '\n',
      )
      const extracted = spawnSync(
        'tar',
        ['-xzf', path.join(scratch, tarball!), '--strip-components=1', '-C', packageDir],
        { encoding: 'utf8' },
      )
      expect(extracted.status, extracted.stderr).toBe(0)

      // Link the installed peer and runtime dependencies so the extracted
      // package resolves them without a consumer install or network access.
      for (const name of ['@playwright/test', 'pixelmatch', 'pngjs']) {
        const target = path.join(modules, name)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules', name)), target, 'dir')
      }

      const entry = path.join(consumer, 'index.cjs')
      fs.writeFileSync(
        entry,
        [
          "const main = require('shotwright')",
          "const capture = require('shotwright/capture')",
          'console.log(JSON.stringify({',
          '  defineShotsConfig: typeof main.defineShotsConfig,',
          '  walkthrough: typeof capture.walkthrough,',
          '  shot: typeof capture.shot,',
          '  artifact: typeof capture.artifact,',
          '  parseOnly: typeof capture.parseOnly,',
          '  shouldCapture: typeof capture.shouldCapture,',
          '  validateShotName: typeof capture.validateShotName,',
          '  validateSpecPath: typeof capture.validateSpecPath,',
          '  storageSpec: typeof capture.storageSpec,',
          '}))',
        ].join('\n') + '\n',
      )
      const run = spawnSync(process.execPath, [entry], { cwd: consumer, encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      expect(JSON.parse(run.stdout)).toEqual({
        defineShotsConfig: 'function',
        walkthrough: 'function',
        shot: 'function',
        artifact: 'function',
        parseOnly: 'function',
        shouldCapture: 'function',
        validateShotName: 'function',
        validateSpecPath: 'function',
        storageSpec: 'function',
      })
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  },
)
