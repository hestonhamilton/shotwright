#!/usr/bin/env node
// `changeset version` writes multi-paragraph changeset bodies into CHANGELOG.md
// with indented blank lines ("  "). The repo's trailing-whitespace pre-commit
// hook rejects them, so every Version PR failed pre-commit. The Version workflow
// runs this straight after `changeset version`. Only whitespace-only lines are
// touched, so intentional hard breaks after text are left alone.
//
//   node scripts/strip-changelog-whitespace.mjs [file]    default CHANGELOG.md
import fs from 'node:fs'

const file = process.argv[2] ?? 'CHANGELOG.md'
const text = fs.readFileSync(file, 'utf8')
const cleaned = text.replace(/^[ \t]+$/gm, '')
if (cleaned !== text) fs.writeFileSync(file, cleaned)
