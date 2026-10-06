// Tests for the tarball leak gate (shotwright-746.18.3, plan section 2).
//
// Two halves, and the split matters:
//
//   LAYER A is tested end to end. check-file-set.sh is run as a real process
//   against constructed directory trees, so these assertions cover the shipped
//   behaviour exactly.
//
//   LAYER B is tested at the REGEX level only. The rules are extracted from
//   gitleaks-tarball.toml and evaluated with JS RegExp. This proves the patterns
//   match what they must and — the part that carries the weight — miss the three
//   known-legitimate hits E9.R section 3.1 measured. It does NOT prove the
//   gitleaks harness runs them correctly, that --redact works, or that the
//   config parses. Those need the binary and are covered by the seeded-tarball
//   demonstration that E9.I still owes.
//
// The patterns are written in the intersection of Go RE2 and JS RegExp (\s, \d,
// \b, non-capturing groups; no POSIX classes, no lookaround) precisely so this
// second half is possible at all.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const checkFileSet = path.join(root, 'scripts/ci/check-file-set.sh')
const configPath = path.join(root, 'scripts/ci/gitleaks-tarball.toml')

interface ScriptResult {
  status: number
  stdout: string
  stderr: string
}

function runCheck(target: string, allowlist?: string): ScriptResult {
  const args = allowlist ? [target, allowlist] : [target]
  try {
    const stdout = execFileSync(checkFileSet, args, { encoding: 'utf8', stdio: 'pipe' })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

function makeTree(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-leak-gate-'))
  for (const rel of files) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, 'x\n')
  }
  return dir
}

// A correct tarball, in miniature: the two files npm ships unconditionally plus
// the two allowlisted trees.
const cleanTarball = ['README.md', 'package.json', 'dist/cli.js', 'templates/init/shots.config.ts']

describe('leak gate layer A — file-set allowlist', () => {
  it('passes a tarball whose every path is covered', () => {
    const dir = makeTree(cleanTarball)
    try {
      const result = runCheck(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('layer A ok')
      expect(result.stdout).toContain('4 file(s)')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails on a file outside every allowlisted path, naming it', () => {
    const dir = makeTree([...cleanTarball, 'src/index.ts'])
    try {
      const result = runCheck(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('LAYER A FAILED')
      expect(result.stderr).toContain('unexpected: src/index.ts')
      expect(result.stderr).toContain('scripts/ci/expected-files.txt')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // LICENSE was this test's example until the AGPL relicense (ADR 0018) made it a
  // legitimately allowlisted file. The assertion is unchanged in intent — a
  // top-level file npm ships UNCONDITIONALLY, and which the allowlist does not
  // cover, must still be caught. LICENCE is the British spelling; npm ships it
  // unconditionally too (measured 2026-09-03 with `npm pack --dry-run`), so a
  // contributor who spells it that way gets a second, unlisted license file in
  // the tarball. That is the case this now guards.
  it('fails on an unlisted top-level file npm ships unconditionally', () => {
    const dir = makeTree([...cleanTarball, 'LICENCE'])
    try {
      const result = runCheck(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('unexpected: LICENCE')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // The other half of the widening: prove the allowlist actually admits LICENSE
  // now, so this pair fails loudly if the entry is ever dropped from
  // scripts/ci/expected-files.txt.
  it('passes the LICENSE the AGPL relicense added', () => {
    const dir = makeTree([...cleanTarball, 'LICENSE'])
    try {
      const result = runCheck(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('layer A ok')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports every unmatched file, not just the first', () => {
    const dir = makeTree([...cleanTarball, 'src/a.ts', 'local/secret.txt'])
    try {
      const result = runCheck(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('unexpected: src/a.ts')
      expect(result.stderr).toContain('unexpected: local/secret.txt')
      expect(result.stderr).toContain('2 file(s)')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let a prefix rule match a sibling with the same leading characters', () => {
    // `dist/**` must not cover `dist-extra/`. The prefix comparison appends the
    // separator for exactly this reason.
    const dir = makeTree([...cleanTarball, 'dist-extra/leak.js'])
    try {
      const result = runCheck(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('unexpected: dist-extra/leak.js')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses an empty allowlist rather than passing everything', () => {
    const dir = makeTree(cleanTarball)
    const empty = path.join(dir, '..', `empty-allowlist-${path.basename(dir)}.txt`)
    fs.writeFileSync(empty, '# only comments\n\n')
    try {
      const result = runCheck(dir, empty)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('refusing to pass everything')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.rmSync(empty, { force: true })
    }
  })

  it('exits 2 rather than 0 when pointed at a directory that does not exist', () => {
    const result = runCheck(path.join(os.tmpdir(), 'shotwright-leak-gate-does-not-exist'))
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('not a directory')
  })
})

// --- Layer B: rule patterns -------------------------------------------------

interface Rule {
  id: string
  regex: RegExp
  allowlist: RegExp[]
}

function parseRules(): Map<string, Rule> {
  const toml = fs.readFileSync(configPath, 'utf8')
  const rules = new Map<string, Rule>()
  // Split on the rule table header; the trailing [[rules.allowlist]] of a rule
  // stays inside its own chunk, which is what lets the carve-out be tested.
  for (const chunk of toml.split(/^\[\[rules\]\]$/m).slice(1)) {
    const id = /^\s*id\s*=\s*"([^"]+)"/m.exec(chunk)?.[1]
    const pattern = /^\s*regex\s*=\s*'''([\s\S]*?)'''/m.exec(chunk)?.[1]
    if (!id || !pattern) continue
    const allowlist: RegExp[] = []
    // Split on the allowlist header rather than trying to find the bounds of the
    // `regexes = [ ... ]` array: a pattern may legitimately contain `]` (as
    // `[:/]` does), which makes bracket matching wrong. Everything after the
    // header is allowlist content, and the rule's own `regex` precedes it.
    const allowBlock = chunk.split(/^\s*\[rules\.allowlist\]$/m)[1]
    if (allowBlock) {
      for (const m of allowBlock.matchAll(/'''([\s\S]*?)'''/g)) {
        if (m[1]) allowlist.push(new RegExp(m[1]))
      }
    }
    rules.set(id, { id, regex: new RegExp(pattern), allowlist })
  }
  return rules
}

const rules = parseRules()

function fires(id: string, line: string): boolean {
  const rule = rules.get(id)
  if (!rule) throw new Error(`no such rule in gitleaks-tarball.toml: ${id}`)
  if (!rule.regex.test(line)) return false
  // gitleaks suppresses a finding when a rule allowlist matches; regexTarget =
  // "line" means the whole line is the subject.
  return !rule.allowlist.some((a) => a.test(line))
}

describe('leak gate layer B — rule patterns', () => {
  it('defines exactly the four rules the plan specifies', () => {
    expect([...rules.keys()].sort()).toEqual([
      'host-path-posix',
      'host-path-windows',
      'operator-username-in-path',
      'private-ipv4',
    ])
  })

  describe('host-path-posix', () => {
    it.each([
      ['const p = "/home/someone/projects/shotwright/dist"'],
      ['/Users/someone/Library/Caches'],
      ['spawn("/root/bin/thing")'],
    ])('fires on %s', (line) => {
      expect(fires('host-path-posix', line)).toBe(true)
    })

    it.each([
      ['import x from "./home/helper.js"'],
      ['a relative home/dir path'],
      ['the word /home with no trailing segment'],
    ])('does not fire on %s', (line) => {
      expect(fires('host-path-posix', line)).toBe(false)
    })
  })

  describe('host-path-windows', () => {
    it('fires on a Windows user-profile path', () => {
      expect(fires('host-path-windows', String.raw`C:\Users\someone\AppData`)).toBe(true)
    })

    it('does not fire on an unrelated drive path', () => {
      expect(fires('host-path-windows', String.raw`D:\build\out`)).toBe(false)
    })
  })

  describe('private-ipv4', () => {
    it.each([['10.8.0.2'], ['172.17.0.1'], ['192.168.0.42']])('fires on %s', (line) => {
      expect(fires('private-ipv4', line)).toBe(true)
    })

    // The single most important negative in this file. 127.0.0.1 is the gallery
    // server's correct bind and appears in three dist/ files; flagging it is the
    // fastest way to get the whole gate switched off.
    it.each([['127.0.0.1'], ['http://127.0.0.1:4173/'], ['0.0.0.0']])(
      'does not fire on loopback %s',
      (line) => {
        expect(fires('private-ipv4', line)).toBe(false)
      },
    )

    it.each([['172.15.0.1'], ['172.32.0.1'], ['9.10.0.1'], ['193.168.0.1']])(
      'does not fire on %s, just outside the private ranges',
      (line) => {
        expect(fires('private-ipv4', line)).toBe(false)
      },
    )
  })

  describe('operator-username-in-path', () => {
    it('fires on the username in filesystem-path position', () => {
      expect(fires('operator-username-in-path', '/home/hestonhamilton/projects')).toBe(true)
    })

    // Both of these are REQUIRED for a correct package and appear in a clean
    // tarball. E9.R section 3.1 measured a naive scan being wrong here.
    it('does not fire on package.json repository.url', () => {
      expect(
        fires('operator-username-in-path', '"url": "git+https://github.com/hestonhamilton/shotwright.git"'),
      ).toBe(false)
    })

    it('does not fire on the reusable-workflow uses: reference', () => {
      expect(
        fires(
          'operator-username-in-path',
          '    uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@main',
        ),
      ).toBe(false)
    })

    it('does not fire on an ssh remote URL', () => {
      expect(fires('operator-username-in-path', 'git@github.com:hestonhamilton/shotwright.git')).toBe(
        false,
      )
    })
  })
})
