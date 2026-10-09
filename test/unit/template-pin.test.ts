import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

// shotwright-746.18.39. The template `shotwright init` installs pins the
// reusable workflow to the release tag, and nothing used to tie that tag to
// package.json: the first Version PR after 0.1.0 bumped the version and left
// the pin behind.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const script = path.join(repoRoot, 'scripts/sync-template-pin.mjs')
const temporary: string[] = []

function run(args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: result.status, output: result.stdout + result.stderr }
}

function tree(version: string, template: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-template-pin-'))
  temporary.push(root)
  fs.mkdirSync(path.join(root, 'templates/github'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }))
  fs.writeFileSync(path.join(root, 'templates/github/shotwright.yml'), template)
  return root
}

const pinned = (tag: string) =>
  `jobs:\n  shots:\n    # a comment naming @main must survive\n    uses: owner/shotwright/.github/workflows/shotwright.yml@${tag}\n    with:\n      mode: consumer\n`

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('template workflow pin', () => {
  it('matches the package version in this repository', () => {
    const result = run(['--check'])
    expect(result.output).toContain('template pin is v')
    expect(result.status).toBe(0)
  })

  it('fails the check, without writing, when the pin is behind the version', () => {
    const root = tree('0.1.1', pinned('v0.1.0'))
    const result = run(['--check', '--root', root])
    expect(result.status).toBe(1)
    expect(result.output).toContain('pins v0.1.0 but package.json is 0.1.1')
    expect(fs.readFileSync(path.join(root, 'templates/github/shotwright.yml'), 'utf8')).toBe(pinned('v0.1.0'))
  })

  it('rewrites only the pin, including for a prerelease version', () => {
    const root = tree('0.2.0-rc.1', pinned('v0.1.1'))
    expect(run(['--root', root]).status).toBe(0)
    expect(fs.readFileSync(path.join(root, 'templates/github/shotwright.yml'), 'utf8')).toBe(pinned('v0.2.0-rc.1'))
    expect(run(['--check', '--root', root]).status).toBe(0)
  })

  it('refuses a template with no pinned line or with two', () => {
    expect(run(['--root', tree('0.1.1', 'jobs: {}\n')]).status).toBe(2)
    expect(run(['--root', tree('0.1.1', pinned('v0.1.0') + pinned('v0.1.0'))]).status).toBe(2)
  })
})
