import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  formatGalleryExposureNotice,
  formatGallerySelection,
  helpFor,
  isLanExposure,
  misplacedSeparatorWarnings,
  parseCompareArgs,
  parseGalleryArgs,
  parseRunArgs,
  probeOutputDir,
  resolvePlaywrightCli,
} from '../../src/cli.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('parseRunArgs', () => {
  it('defaults', () => {
    expect(parseRunArgs([])).toEqual({
      only: null,
      video: false,
      trace: false,
      config: 'shots.config.ts',
      passthrough: [],
      separatorWarnings: [],
    })
  })

  it('parses flags and passthrough', () => {
    expect(parseRunArgs(['--only', 'checkout,cart', '--video', '--config', 'x.ts', '--', '--workers=1'])).toEqual({
      only: 'checkout,cart',
      video: true,
      trace: false,
      config: 'x.ts',
      passthrough: ['--workers=1'],
      separatorWarnings: [],
    })
  })

  it('reclaims --only and its value after the passthrough separator', () => {
    expect(parseRunArgs(['--', '--only', 'home', '--workers=1'])).toMatchObject({
      only: 'home',
      passthrough: ['--workers=1'],
      separatorWarnings: [
        expect.stringContaining('--only came after `--`; shotwright applied it'),
      ],
    })
  })

  it('reclaims --video after the passthrough separator', () => {
    expect(parseRunArgs(['--', '--workers=1', '--video'])).toMatchObject({
      video: true,
      passthrough: ['--workers=1'],
      separatorWarnings: [
        expect.stringContaining('--video came after `--`; shotwright applied it'),
      ],
    })
  })

  it('leaves Playwright trace modes in passthrough without warning', () => {
    expect(parseRunArgs(['--', '--trace', 'retain-on-failure', '--workers=1'])).toMatchObject({
      trace: false,
      passthrough: ['--trace', 'retain-on-failure', '--workers=1'],
      separatorWarnings: [],
    })
  })

  it('reclaims bare --trace after the passthrough separator', () => {
    expect(parseRunArgs(['--', '--trace', '--workers=1'])).toMatchObject({
      trace: true,
      passthrough: ['--workers=1'],
      separatorWarnings: [
        expect.stringContaining('--trace came after `--`; shotwright applied it'),
      ],
    })
    expect(parseRunArgs(['--', '--trace'])).toMatchObject({
      trace: true,
      passthrough: [],
      separatorWarnings: [
        expect.stringContaining('--trace came after `--`; shotwright applied it'),
      ],
    })
  })

  it('leaves --only-changed and ordinary Playwright passthrough untouched', () => {
    expect(parseRunArgs(['--', '--only-changed', '--workers=1'])).toMatchObject({
      only: null,
      video: false,
      trace: false,
      passthrough: ['--only-changed', '--workers=1'],
      separatorWarnings: [],
    })
  })

  it('rejects unknown flags and missing values', () => {
    expect(() => parseRunArgs(['--nope'])).toThrow(/unknown argument/)
    expect(() => parseRunArgs(['--only'])).toThrow(/--only requires/)
  })
})

describe('misplacedSeparatorWarnings', () => {
  it('warns for shotwright flags that landed in Playwright passthrough', () => {
    expect(misplacedSeparatorWarnings(['--video', '--trace', '--workers=1', '--only'])).toEqual([
      'shotwright: warning: --video came after `--`; shotwright applied it and removed it from Playwright passthrough.\n' +
        '            Prefer shotwright flags first:  pnpm shots --video -- --workers=1',
      'shotwright: warning: --trace came after `--`; shotwright applied it and removed it from Playwright passthrough.\n' +
        '            Prefer shotwright flags first:  pnpm shots --video -- --workers=1',
      'shotwright: warning: --only came after `--`; shotwright applied it and removed it from Playwright passthrough.\n' +
        '            Prefer shotwright flags first:  pnpm shots --video -- --workers=1',
    ])
  })

  it('ignores normal Playwright passthrough flags', () => {
    expect(misplacedSeparatorWarnings(['--workers=1', '--project=chromium'])).toEqual([])
  })
})

describe('resolvePlaywrightCli', () => {
  it('resolves the peer cli entry from a consumer cwd', () => {
    const cli = resolvePlaywrightCli(repoRoot)
    expect(cli).toMatch(/@playwright[/\\]test[/\\]cli\.js$/)
  })

  it('errors actionably when the peer is missing', () => {
    expect(() => resolvePlaywrightCli(os.tmpdir())).toThrow(/install the peer dependency/)
  })
})

describe('parseGalleryArgs', () => {
  it('defaults to latest on loopback with an OS-assigned port', () => {
    expect(parseGalleryArgs([])).toEqual({
      runId: null,
      config: 'shots.config.ts',
      host: '127.0.0.1',
      port: 0,
      lan: false,
    })
  })

  it('parses the positional id and every value flag in any order', () => {
    expect(
      parseGalleryArgs([
        '--port',
        '4173',
        '2026-07-29T00-00-00_abcd',
        '--host',
        '::1',
        '--config',
        'custom.ts',
      ]),
    ).toEqual({
      runId: '2026-07-29T00-00-00_abcd',
      config: 'custom.ts',
      host: '::1',
      port: 4173,
      lan: false,
    })
  })

  it('--lan selects the wildcard bind', () => {
    expect(parseGalleryArgs(['run_1234', '--lan'])).toMatchObject({
      runId: 'run_1234',
      host: '0.0.0.0',
      lan: true,
    })
  })

  it.each([
    ['--config', 'one', 'two'],
    ['--host', 'one.test', 'two.test'],
    ['--port', '1', '2'],
  ])('rejects duplicate %s', (flag, first, second) => {
    expect(() => parseGalleryArgs([flag, first, flag, second])).toThrow(/duplicate/)
  })

  it('rejects duplicate --lan and its conflict with --host', () => {
    expect(() => parseGalleryArgs(['--lan', '--lan'])).toThrow(/duplicate/)
    expect(() => parseGalleryArgs(['--host', '127.0.0.1', '--lan'])).toThrow(
      /mutually exclusive/,
    )
  })

  it.each([
    ['missing config', ['--config'], /requires a value/],
    ['missing host', ['--host'], /requires a value/],
    ['invalid host', ['--host', 'http://example.test'], /IP address or hostname/],
    ['unknown flag', ['--wat'], /unknown argument/],
    ['two ids', ['one', 'two'], /unexpected positional/],
  ])('rejects %s', (_label, argv, message) => {
    expect(() => parseGalleryArgs(argv)).toThrow(message)
  })

  it.each(['-1', '1.5', 'NaN', '65536', '1e2', ''])(
    'rejects invalid port %j before binding',
    (port) => {
      const argv = port === '' ? ['--port'] : ['--port', port]
      expect(() => parseGalleryArgs(argv)).toThrow(/integer from 0 to 65535|requires a value/)
    },
  )
})

describe('parseCompareArgs', () => {
  it('requires two selectors and defaults config', () => {
    expect(parseCompareArgs(['run-a', 'run-b'])).toEqual({
      a: 'run-a',
      b: 'run-b',
      config: 'shots.config.ts',
    })
    expect(parseCompareArgs(['latest', 'run-b'])).toMatchObject({ a: 'latest', b: 'run-b' })
  })

  it('parses the only supported flag in any position', () => {
    expect(parseCompareArgs(['run-a', '--config', 'custom.ts', 'run-b'])).toEqual({
      a: 'run-a',
      b: 'run-b',
      config: 'custom.ts',
    })
  })

  it.each([
    ['no selectors', []],
    ['one selector', ['run-a']],
    ['extra selector', ['run-a', 'run-b', 'run-c']],
    ['duplicate config', ['run-a', 'run-b', '--config', 'one.ts', '--config', 'two.ts']],
    ['missing config value', ['run-a', 'run-b', '--config']],
    ['unknown flag', ['run-a', 'run-b', '--wat']],
  ])('rejects %s', (_label, argv) => {
    expect(() => parseCompareArgs(argv)).toThrow()
  })

  it.each([
    ['--host', '127.0.0.1'],
    ['--port', '4173'],
    ['--lan'],
    ['--open'],
    ['--'],
    ['--output', 'compare.html'],
  ])('does not admit gallery, passthrough, or output flag %s', (...flag) => {
    expect(() => parseCompareArgs(['run-a', 'run-b', ...flag])).toThrow(/unknown argument/)
  })
})

describe('probeOutputDir', () => {
  it('returns a canonical value written by the config and removes its temp directory', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-probe-test-'))
    let probeDirectory = ''
    try {
      const expected = path.join(tempRoot, 'custom-output')
      const result = await probeOutputDir('custom.ts', tempRoot, {
        playwrightCli: '/synthetic/playwright.js',
        tempRoot,
        invoke: async (cli, args, options) => {
          expect(cli).toBe('/synthetic/playwright.js')
          expect(args).toEqual([
            'test',
            '--list',
            '--pass-with-no-tests',
            '-c',
            'custom.ts',
          ])
          expect(options.env.SHOTWRIGHT_RUN).toBe('0')
          expect(options.env.SHOTWRIGHT_RUN_DIR).toBeUndefined()
          const probeFile = options.env.SHOTWRIGHT_CONFIG_PROBE_FILE!
          probeDirectory = path.dirname(probeFile)
          fs.writeFileSync(probeFile, expected)
          return 0
        },
      })
      expect(result).toBe(expected)
      expect(fs.existsSync(probeDirectory)).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('cleans up and reports config evaluation failure', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-probe-test-'))
    try {
      await expect(
        probeOutputDir('broken.ts', tempRoot, {
          playwrightCli: '/synthetic/playwright.js',
          tempRoot,
          invoke: async () => 1,
        }),
      ).rejects.toThrow(/config probe failed/)
      expect(fs.readdirSync(tempRoot)).toEqual([])
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('never assumes shots-output when the config omits defineShotsConfig', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-probe-test-'))
    try {
      await expect(
        probeOutputDir('plain.ts', tempRoot, {
          playwrightCli: '/synthetic/playwright.js',
          tempRoot,
          invoke: async () => 0,
        }),
      ).rejects.toThrow(/did not call defineShotsConfig/)
      expect(fs.readdirSync(tempRoot)).toEqual([])
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects a relative probe value', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-probe-test-'))
    try {
      await expect(
        probeOutputDir('bad.ts', tempRoot, {
          playwrightCli: '/synthetic/playwright.js',
          tempRoot,
          invoke: async (_cli, _args, options) => {
            fs.writeFileSync(options.env.SHOTWRIGHT_CONFIG_PROBE_FILE!, 'shots-output')
            return 0
          },
        }),
      ).rejects.toThrow(/non-canonical/)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})

describe('gallery selection labels', () => {
  it('labels latest as the last fully passed run', () => {
    expect(formatGallerySelection('run_abcd', true)).toBe(
      'shotwright gallery: selected run run_abcd via latest (last fully passed run)',
    )
  })

  it('cautions that an explicitly selected run may be partial', () => {
    expect(formatGallerySelection('run_abcd', false)).toBe(
      'shotwright gallery: selected run run_abcd explicitly (this run may be partial or failed)',
    )
  })
})

describe('gallery bind exposure', () => {
  it.each([
    [
      'explicit private IPv4',
      '192.168.77.13',
      true,
      'Anyone on this network can view these captures until you stop the server.',
    ],
    [
      'explicit public IPv4',
      '203.0.113.8',
      true,
      'Anyone on this network can view these captures until you stop the server.',
    ],
    ['IPv4 loopback', '127.0.0.1', false, 'Use --lan for phone access.'],
    ['IPv6 loopback', '::1', false, 'Use --lan for phone access.'],
  ])('%s address %s has the correct exposure treatment', (_label, address, exposed, notice) => {
    expect(isLanExposure(address)).toBe(exposed)
    expect(formatGalleryExposureNotice(address)).toBe(notice)
  })
})

describe('helpFor', () => {
  // shotwright-746.18.12: every conventional spelling of the help flag used to be
  // an unknown command exiting 1, and the release runbook's post-publish smoke
  // test is `shotwright --help`.
  it.each([[[]], [['--help']], [['-h']], [['help']]])('%j prints the full usage', (argv) => {
    const text = helpFor(argv)
    expect(text).toMatch(/^Usage: shotwright run /)
    expect(text).toContain('Usage: shotwright gallery')
    expect(text).toContain('Usage: shotwright compare')
    expect(text).toContain('Usage: shotwright init')
  })

  it.each([
    [['run', '--help'], 'Usage: shotwright run '],
    [['gallery', '-h'], 'Usage: shotwright gallery '],
    [['help', 'compare'], 'Usage: shotwright compare '],
    [['help', 'init'], 'Usage: shotwright init '],
  ])('%j prints only that command\'s usage', (argv, prefix) => {
    const text = helpFor(argv)
    expect(text).not.toBeNull()
    expect(text!.startsWith(prefix)).toBe(true)
    expect(text!.split('\n')).toHaveLength(1)
  })

  it('does not treat a help flag after the Playwright separator as a help request', () => {
    expect(helpFor(['run', '--', '--help'])).toBeNull()
  })

  it.each([[['run']], [['gallery', 'latest']], [['init', '--dry-run']], [['nope']], [['nope', '--help']]])(
    '%j is not a help request',
    (argv) => {
      expect(helpFor(argv)).toBeNull()
    },
  )

  it('falls back to the full usage for help on an unknown command', () => {
    expect(helpFor(['help', 'nope'])).toContain('Usage: shotwright gallery')
  })
})
