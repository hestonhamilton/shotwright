// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'

interface OwnPackage {
  version: string
  license?: string
  repository?: string | { url?: string }
}

function ownPackage(): OwnPackage {
  return JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as OwnPackage
}

/**
 * shotwright's own version, read from its package.json at run time.
 *
 * Resolved relative to this module, so it is the same file from `src/` under
 * the tests and from `dist/` in an installed package — never hardcoded, which
 * would drift from what the Version PR wrote.
 */
export function shotwrightVersion(): string {
  return ownPackage().version
}

export interface ShotwrightSource {
  version: string
  license: string
  /** Browsable https URL of the source repository, or null when package.json names none. */
  url: string | null
}

/** Turn a package.json `repository` URL (`git+https://….git`) into a browsable one. */
export function browsableRepositoryUrl(raw: string | undefined): string | null {
  if (!raw) return null
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '')
  return /^https?:\/\//.test(url) ? url : null
}

/** Version, licence and source URL for the gallery footer (AGPL-3.0 section 13), from package.json. */
export function shotwrightSource(): ShotwrightSource {
  const pkg = ownPackage()
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  return {
    version: pkg.version,
    license: pkg.license ?? 'UNLICENSED',
    url: browsableRepositoryUrl(repository),
  }
}
