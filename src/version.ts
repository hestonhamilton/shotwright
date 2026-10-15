// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'

/**
 * shotwright's own version, read from its package.json at run time.
 *
 * Resolved relative to this module, so it is the same file from `src/` under
 * the tests and from `dist/` in an installed package — never hardcoded, which
 * would drift from what the Version PR wrote.
 */
export function shotwrightVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  return pkg.version
}
