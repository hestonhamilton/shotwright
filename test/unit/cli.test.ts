import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  formatCompareGate,
  formatGalleryExposureNotice,
  formatGallerySelection,
  formatIncludedTracesNotice,
  helpFor,
  isLanExposure,
  isVersionRequest,
  misplacedSeparatorWarnings,
  parseCompareArgs,
  parseGalleryArgs,
  parseRunArgs,
  probeOutputDir,
  resolveCompareOutput,
  resolvePlaywrightCli,
  runPathDigests,
} from '../../src/cli.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('parseRunArgs', () => {
  it('accepts an invocation run-dir destination', () => {
    expect(parseRunArgs(['--run-dir-file', 'run-dir.txt']).runDirFile).toBe('run-dir.txt')
    expect(() => parseRunArgs(['--run-dir-file'])).toThrow(/requires a value/)
  })
  it('defaults', () => {
    expect(parseRunArgs([])).toEqual({
      only: null,
      video: false,
      trace: false,
      config: 'shots.config.ts',
      passthrough: [],
      separatorWarnings: [],
      runDirFile: null,
    })
  })

  it('parses flags and passthrough', () => {
    expect(
      parseRunArgs(['--only', 'checkout,cart', '--video', '--config', 'x.ts', '--', '--workers=1']),
    ).toEqual({
      only: 'checkout,cart',
      video: true,
      trace: false,
      config: 'x.ts',
      passthrough: ['--workers=1'],
      separatorWarnings: [],
      runDirFile: null,
    })
  })

  it('reclaims --only and its value after the passthrough separator', () => {
    expect(parseRunArgs(['--', '--only', 'home', '--workers=1'])).toMatchObject({
      only: 'home',
      passthrough: ['--workers=1'],
      separatorWarnings: [expect.stringContaining('--only came after `--`; shotwright applied it')],
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
  it('accepts --last without a positional run id', () => {
    expect(parseGalleryArgs(['--last']).last).toBe(true)
    expect(() => parseGalleryArgs(['--last', 'run-a'])).toThrow(/mutually exclusive/)
  })
  it('defaults to latest on loopback with an OS-assigned port', () => {
    expect(parseGalleryArgs([])).toEqual({
      runId: null,
      config: 'shots.config.ts',
      host: '127.0.0.1',
      port: 0,
      lan: false,
      last: false,
      includeTraces: false,
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
      last: false,
      includeTraces: false,
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

  it('accepts --include-traces with --lan, defaulting to withheld traces', () => {
    expect(parseGalleryArgs(['--lan', '--include-traces'])).toMatchObject({
      host: '0.0.0.0',
      lan: true,
      includeTraces: true,
    })
    expect(parseGalleryArgs(['--lan']).includeTraces).toBe(false)
    expect(() => parseGalleryArgs(['--include-traces', '--include-traces'])).toThrow(/duplicate/)
  })

  it('rejects duplicate --lan and its conflict with --host', () => {
    expect(() => parseGalleryArgs(['--lan', '--lan'])).toThrow(/duplicate/)
    expect(() => parseGalleryArgs(['--host', '127.0.0.1', '--lan'])).toThrow(/mutually exclusive/)
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
  it('accepts --last', () => {
    expect(parseCompareArgs(['--last', 'run-b'])).toMatchObject({
      a: '--last',
      b: 'run-b',
      last: true,
    })
    expect(parseCompareArgs(['run-a', '--last'])).toMatchObject({
      a: 'run-a',
      b: '--last',
    })
  })
  it('requires two selectors and defaults config', () => {
    expect(parseCompareArgs(['run-a', 'run-b'])).toEqual({
      a: 'run-a',
      b: 'run-b',
      config: 'shots.config.ts',
      last: false,
      failOnChange: false,
      output: null,
    })
    expect(parseCompareArgs(['latest', 'run-b'])).toMatchObject({ a: 'latest', b: 'run-b' })
  })

  it('parses the only supported flag in any position', () => {
    expect(parseCompareArgs(['run-a', '--config', 'custom.ts', 'run-b'])).toEqual({
      a: 'run-a',
      b: 'run-b',
      config: 'custom.ts',
      last: false,
      failOnChange: false,
      output: null,
    })
  })

  it('parses --fail-on-change and --output in any position', () => {
    expect(
      parseCompareArgs(['--fail-on-change', 'run-a', '--output', 'out/review.html', 'run-b']),
    ).toEqual({
      a: 'run-a',
      b: 'run-b',
      config: 'shots.config.ts',
      last: false,
      failOnChange: true,
      output: 'out/review.html',
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
    ['duplicate --fail-on-change', ['a', 'b', '--fail-on-change', '--fail-on-change'], /duplicate/],
    ['duplicate --output', ['a', 'b', '--output', 'x.html', '--output', 'y.html'], /duplicate/],
    ['missing --output value', ['a', 'b', '--output'], /requires a value/],
    ['flag as --output value', ['a', 'b', '--output', '--fail-on-change'], /requires a value/],
  ])('rejects %s', (_label, argv, message) => {
    expect(() => parseCompareArgs(argv)).toThrow(message)
  })

  it.each([
    ['--host', '127.0.0.1'],
    ['--port', '4173'],
    ['--lan'],
    ['--open'],
    ['--'],
    ['--include-traces'],
  ])('does not admit gallery or passthrough flag %s', (...flag) => {
    expect(() => parseCompareArgs(['run-a', 'run-b', ...flag])).toThrow(/unknown argument/)
  })
})

describe('probeOutputDir', () => {
  it('keeps only the last MiB of each failed probe stream and reports truncation', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-probe-large-'))
    const script = path.join(scratch, 'large-probe.cjs')
    fs.writeFileSync(
      script,
      "process.stdout.write('a'.repeat(1_048_580)); process.stderr.write('b'.repeat(1_048_581)); process.exitCode = 1\n",
    )
    const originalError = console.error
    const originalStdout = process.stdout.write
    const originalStderr = process.stderr.write
    const messages: string[] = []
    let stdout = ''
    let stderr = ''
    console.error = (...parts: unknown[]) => messages.push(parts.join(' '))
    process.stdout.write = ((chunk: string) => {
      stdout += chunk
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string) => {
      stderr += chunk
      return true
    }) as typeof process.stderr.write
    try {
      await expect(
        probeOutputDir('large.ts', scratch, { playwrightCli: script, tempRoot: scratch }),
      ).rejects.toThrow(/config probe failed/)
      expect(stdout).toHaveLength(1_048_576)
      expect(stderr).toHaveLength(1_048_576)
      expect(stdout).toMatch(/^a+$/)
      expect(stderr).toMatch(/^b+$/)
      expect(messages).toContain('shotwright: probe stdout truncated to last 1 MiB')
      expect(messages).toContain('shotwright: probe stderr truncated to last 1 MiB')
    } finally {
      console.error = originalError
      process.stdout.write = originalStdout
      process.stderr.write = originalStderr
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('suppresses the E4 two-line probe listing on success and replays stdout and stderr on failure', async () => {
    const noise = fs.readFileSync(
      path.join(repoRoot, 'test/fixtures/cli-runs/probe-noise.txt'),
      'utf8',
    )
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-probe-noise-'))
    const originalLog = console.error
    const originalStdout = process.stdout.write
    const originalStderr = process.stderr.write
    const logged: string[] = []
    let stdout = ''
    let stderr = ''
    console.error = (...args: unknown[]) => {
      logged.push(args.join(' '))
    }
    process.stdout.write = ((chunk: string) => {
      stdout += chunk
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string) => {
      stderr += chunk
      return true
    }) as typeof process.stderr.write
    try {
      const invoke: NonNullable<Parameters<typeof probeOutputDir>[2]>['invoke'] = async (
        _cli,
        _args,
        options,
      ) => {
        fs.writeFileSync(options.env.SHOTWRIGHT_CONFIG_PROBE_FILE!, path.join(tempRoot, 'output'))
        return { code: 0, stdout: noise, stderr: '' }
      }
      await probeOutputDir('good.ts', tempRoot, { playwrightCli: 'fake', tempRoot, invoke })
      expect(stdout).toBe('')
      expect(stderr).toBe('')
      await expect(
        probeOutputDir('bad.ts', tempRoot, {
          playwrightCli: 'fake',
          tempRoot,
          invoke: async () => ({ code: 1, stdout: noise, stderr: 'config broke\n' }),
        }),
      ).rejects.toThrow(/config probe failed/)
      expect(stdout).toBe(noise)
      expect(stderr).toBe('config broke\n')
      expect(logged).toEqual(['shotwright: config probe output for bad.ts:'])
    } finally {
      console.error = originalLog
      process.stdout.write = originalStdout
      process.stderr.write = originalStderr
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
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
          expect(args).toEqual(['test', '--list', '--pass-with-no-tests', '-c', 'custom.ts'])
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
    expect(text).toContain('Usage: shotwright --help | --version')
  })

  it.each([
    [['run', '--help'], 'Usage: shotwright run '],
    [['gallery', '-h'], 'Usage: shotwright gallery '],
    [['help', 'compare'], 'Usage: shotwright compare '],
    [['help', 'init'], 'Usage: shotwright init '],
  ])("%j prints only that command's usage", (argv, prefix) => {
    const text = helpFor(argv)
    expect(text).not.toBeNull()
    expect(text!.startsWith(prefix)).toBe(true)
    expect(text!.split('\n')).toHaveLength(1)
  })

  it('documents the compare gate, compare output, and gallery trace override flags', () => {
    expect(helpFor(['help', 'compare'])).toContain('[--output <file.html>] [--fail-on-change]')
    expect(helpFor(['help', 'compare'])).toContain(
      'Exits 0 after writing the page unless --fail-on-change',
    )
    expect(helpFor(['gallery', '--help'])).toContain('[--lan] [--include-traces]')
    expect(helpFor(['gallery', '--help'])).toContain('withheld on a non-loopback bind')
  })

  it('does not treat a help flag after the Playwright separator as a help request', () => {
    expect(helpFor(['run', '--', '--help'])).toBeNull()
  })

  it.each([
    [['run']],
    [['gallery', 'latest']],
    [['init', '--dry-run']],
    [['nope']],
    [['nope', '--help']],
  ])('%j is not a help request', (argv) => {
    expect(helpFor(argv)).toBeNull()
  })

  it('falls back to the full usage for help on an unknown command', () => {
    expect(helpFor(['help', 'nope'])).toContain('Usage: shotwright gallery')
  })
})

describe('isVersionRequest', () => {
  // shotwright-746.18.19: a public CLI needs to say which version pnpm resolved.
  it.each([[['--version']], [['-v']]])('%j is a version request', (argv) => {
    expect(isVersionRequest(argv)).toBe(true)
  })

  it.each([[[]], [['run', '--version']], [['run', '--', '--version']], [['-V']], [['version']]])(
    '%j is not a version request',
    (argv) => {
      expect(isVersionRequest(argv)).toBe(false)
    },
  )
})

describe('compare output validation', () => {
  function scratch(): { root: string; runA: string; runB: string } {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-cli-output-')))
    const runA = path.join(root, 'runs', 'run-a')
    const runB = path.join(root, 'elsewhere', 'run-a')
    fs.mkdirSync(runA, { recursive: true })
    fs.mkdirSync(runB, { recursive: true })
    return { root, runA, runB }
  }

  it('returns the absolute page path for an existing or creatable directory', () => {
    const { root, runA, runB } = scratch()
    try {
      expect(resolveCompareOutput(path.join(root, 'review.html'), [runA, runB])).toBe(
        path.join(root, 'review.html'),
      )
      expect(resolveCompareOutput(path.join(root, 'new/nested/Review.HTML'), [runA, runB])).toBe(
        path.join(root, 'new/nested/Review.HTML'),
      )
      expect(fs.existsSync(path.join(root, 'new'))).toBe(false)
      fs.writeFileSync(path.join(root, 'existing.html'), 'old page')
      expect(resolveCompareOutput(path.join(root, 'existing.html'), [runA, runB])).toBe(
        path.join(root, 'existing.html'),
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['a non-.html name', 'review.htm', /\.html file/],
    ['a bare extension', '.html', /\.html file/],
    ['a newline', 'rev\niew.html', /control characters/],
    ['an escape character', 'rev\u001biew.html', /control characters/],
    ['a DEL character', 'rev\u007fiew.html', /control characters/],
  ])('rejects %s', (_label, name, message) => {
    const { root, runA, runB } = scratch()
    try {
      expect(() => resolveCompareOutput(path.join(root, name), [runA, runB])).toThrow(message)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a page inside either compared run, including through a symlinked parent', () => {
    const { root, runA, runB } = scratch()
    try {
      for (const target of [
        path.join(runA, 'compare.html'),
        path.join(runB, 'nested', 'compare.html'),
      ])
        expect(() => resolveCompareOutput(target, [runA, runB])).toThrow(
          /inside a compared run directory/,
        )
      fs.symlinkSync(runB, path.join(root, 'alias'))
      expect(() => resolveCompareOutput(path.join(root, 'alias/x.html'), [runA, runB])).toThrow(
        /inside a compared run directory/,
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a directory that cannot be created and a target that is not a regular file', () => {
    const { root, runA, runB } = scratch()
    try {
      fs.writeFileSync(path.join(root, 'file'), 'not a directory')
      expect(() => resolveCompareOutput(path.join(root, 'file/x.html'), [runA, runB])).toThrow(
        /cannot be created/,
      )
      expect(() =>
        resolveCompareOutput(path.join(root, 'file/deeper/x.html'), [runA, runB]),
      ).toThrow(/cannot be created/)
      fs.mkdirSync(path.join(root, 'dir.html'))
      expect(() => resolveCompareOutput(path.join(root, 'dir.html'), [runA, runB])).toThrow(
        /regular file or absent/,
      )
      fs.writeFileSync(path.join(root, 'real.html'), 'page')
      fs.symlinkSync(path.join(root, 'real.html'), path.join(root, 'link.html'))
      expect(() => resolveCompareOutput(path.join(root, 'link.html'), [runA, runB])).toThrow(
        /regular file or absent/,
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('same-basename compare stems', () => {
  it('gives two same-basename run paths distinct six-hex digests of their absolute paths', () => {
    const digests = runPathDigests(
      '/runs/one/2026-07-29T00-00-00_abcd',
      '/runs/two/2026-07-29T00-00-00_abcd',
    )
    expect(digests.a).toMatch(/^[0-9a-f]{6}$/)
    expect(digests.b).toMatch(/^[0-9a-f]{6}$/)
    expect(digests.a).not.toBe(digests.b)
    // Deterministic: the same path always yields the same digest.
    expect(runPathDigests('/runs/one/2026-07-29T00-00-00_abcd', '/x').a).toBe(digests.a)
  })
})

describe('compare gate line', () => {
  const counts = {
    identical: 3,
    similar: 1,
    changed: 1,
    'size-changed': 0,
    added: 1,
    removed: 0,
    unreadable: 0,
  }

  it('states the verdict and every count, and that the default only reports', () => {
    expect(formatCompareGate({ counts, gate: { nonParity: 2, failOnChange: false } })).toBe(
      'shotwright compare: 2 non-parity pairs; identical 3, similar 1, changed 1, size-changed 0, added 1, removed 0, unreadable 0; report only (exit 0)',
    )
  })

  it('states a failing and a passing opt-in gate', () => {
    expect(formatCompareGate({ counts, gate: { nonParity: 1, failOnChange: true } })).toMatch(
      /: 1 non-parity pair; .*; --fail-on-change: fail \(exit 1\)$/,
    )
    expect(
      formatCompareGate({
        counts: { ...counts, changed: 0, added: 0 },
        gate: { nonParity: 0, failOnChange: true },
      }),
    ).toMatch(/: parity \(every pair identical or similar\); .*; --fail-on-change: pass$/)
  })
})

describe('included traces notice', () => {
  it('names the non-loopback bind traces are served on', () => {
    expect(formatIncludedTracesNotice('0.0.0.0')).toBe(
      'shotwright gallery: --include-traces: serving Playwright traces (which can carry cookies and storage) on non-loopback bind 0.0.0.0',
    )
  })
})
