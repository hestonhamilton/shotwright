#!/usr/bin/env node
// Keeps the consumer template's reusable-workflow pin equal to the package
// version (shotwright-746.18.39).
//
// templates/github/shotwright.yml carries `uses: …/shotwright.yml@v<version>`,
// and `shotwright init` writes that line into consuming projects. Changesets
// bumps package.json and knows nothing about the template, so the first Version
// PR after 0.1.0 would have shipped 0.1.1 still pointing consumers at v0.1.0.
//
//   node scripts/sync-template-pin.mjs            rewrite the pin
//   node scripts/sync-template-pin.mjs --check    exit 1 if it does not match
//   … --root <dir>                                operate on another tree (tests)
//
// The Version workflow runs the rewrite straight after `changeset version`;
// the unit suite runs the check, so a pin that drifts fails verify.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const check = args.includes('--check')
const rootFlag = args.indexOf('--root')
const root =
  rootFlag === -1
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    : path.resolve(args[rootFlag + 1] ?? '')

const templatePath = path.join(root, 'templates/github/shotwright.yml')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (typeof version !== 'string' || version === '') {
  console.error('sync-template-pin: package.json has no version')
  process.exit(2)
}

// Exactly one line may carry the pin. Zero or several means the template
// changed shape and this script no longer knows what it is editing.
const pin = /^(\s*uses:\s*\S+\/\.github\/workflows\/shotwright\.yml@)(\S+)\s*$/gm
const template = fs.readFileSync(templatePath, 'utf8')
const matches = [...template.matchAll(pin)]
if (matches.length !== 1) {
  console.error(`sync-template-pin: expected exactly one pinned uses: line, found ${matches.length}`)
  process.exit(2)
}

const wanted = `v${version}`
const current = matches[0][2]
if (current === wanted) {
  console.log(`sync-template-pin: template pin is ${wanted}`)
  process.exit(0)
}
if (check) {
  console.error(
    `sync-template-pin: template pins ${current} but package.json is ${version}; run node scripts/sync-template-pin.mjs`,
  )
  process.exit(1)
}
fs.writeFileSync(templatePath, template.replace(pin, `$1${wanted}`))
console.log(`sync-template-pin: template pin ${current} -> ${wanted}`)
