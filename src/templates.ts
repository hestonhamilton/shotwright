// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'

export function templateUrl(rel: string): URL {
  return new URL('../templates/' + rel, import.meta.url)
}

export function readTemplate(rel: string): string {
  return fs.readFileSync(templateUrl(rel), 'utf8')
}
