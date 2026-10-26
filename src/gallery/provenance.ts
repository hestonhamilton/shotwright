// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Manifest } from '../manifest.js'

export interface CompareProvenance {
  status: 'known-fields-differ' | 'unavailable' | 'no-known-difference'
  differences: string[]
  unavailable: string[]
}

/** One reviewer-readable line for the compare header; compare.json carries the same strings. */
export function provenanceBanner(provenance: CompareProvenance): string {
  if (provenance.status === 'known-fields-differ') {
    const also = provenance.unavailable.length
      ? `; also unknown: ${provenance.unavailable.join('; ')}`
      : ''
    return `Render environments differ: ${provenance.differences.join('; ')}${also}`
  }
  if (provenance.status === 'unavailable')
    return `Render environment provenance incomplete: ${provenance.unavailable.join('; ')}`
  return 'No known render environment difference (recorded fields only)'
}

/**
 * Compare the A4 fields only: platform, Linux distribution ID/VERSION_ID, and
 * per-project actual browser name and version. Configured channel and the
 * executable are recorded but deliberately not compared (ADR 0023).
 */
export function compareProvenance(a: Manifest, b: Manifest): CompareProvenance {
  const differences: string[] = []
  const unavailable: string[] = []
  const field = (
    label: string,
    left: string | null | undefined,
    right: string | null | undefined,
  ) => {
    if (left == null) unavailable.push(`A: ${label} unknown`)
    if (right == null) unavailable.push(`B: ${label} unknown`)
    if (left != null && right != null && left !== right)
      differences.push(`${label}: ${left} → ${right}`)
  }

  const aPlatform = a.environment?.platform
  const bPlatform = b.environment?.platform
  field('platform', aPlatform, bPlatform)
  // Distribution applies only to Linux. When both platforms are known and
  // differ, the platform difference already says it all; a darwin run has no
  // distribution to be "unknown".
  const platformsDiffer = aPlatform != null && bPlatform != null && aPlatform !== bPlatform
  if ((aPlatform === 'linux' || bPlatform === 'linux') && !platformsDiffer) {
    const left = a.environment?.distribution
    const right = b.environment?.distribution
    if (!left) unavailable.push('A: distribution unknown')
    if (!right) unavailable.push('B: distribution unknown')
    if (left && right) {
      if (left.id !== right.id || left.versionId !== right.versionId)
        differences.push(
          `distribution: ${left.id} ${left.versionId} → ${right.id} ${right.versionId}`,
        )
    }
  }

  const aBrowsers = new Map((a.browsers ?? []).map((row) => [row.project, row]))
  const bBrowsers = new Map((b.browsers ?? []).map((row) => [row.project, row]))
  const projects = [...new Set([...aBrowsers.keys(), ...bBrowsers.keys()])].sort()
  if (!projects.length) {
    unavailable.push('A: browser observations unknown', 'B: browser observations unknown')
  }
  for (const project of projects) {
    const left = aBrowsers.get(project)
    const right = bBrowsers.get(project)
    if (!left) unavailable.push(`A: browser for project ${project} unknown`)
    if (!right) unavailable.push(`B: browser for project ${project} unknown`)
    if (left && right) {
      field(`${project} browser name`, left.name, right.name)
      field(`${project} browser version`, left.version, right.version)
    }
  }
  return {
    status: differences.length
      ? 'known-fields-differ'
      : unavailable.length
        ? 'unavailable'
        : 'no-known-difference',
    differences,
    unavailable,
  }
}
