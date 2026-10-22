#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// shotwright CLI. E1 ships `run`; gallery/compare/trace/init land in E3+/E6.
//
// `run` resolves the *consumer's* @playwright/test (the peer — never npx, which
// could silently fetch a mismatched version), sets the env contract, and spawns
// `node <playwright cli> test -c <config>`. Run-dir creation happens inside the
// config factory at eval time; the reporter prints the run summary.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { formatGalleryDiagnostics, generateGallery } from './gallery/generate.js'
import { compareStates } from './gallery/compare-model.js'
import { generateCompareGallery } from './gallery/generate-compare.js'
import type { CompareGenerationResult } from './gallery/model.js'
import {
  resolveCompareRuns,
  resolveGalleryRun,
  type ResolvedGalleryRun,
} from './gallery/resolve.js'
import {
  galleryUrls,
  isLoopbackBind,
  startGalleryServer,
  waitForGalleryShutdown,
} from './gallery/server.js'
import {
  applyInitPlan,
  dryRunInitPlan,
  formatInitResult,
  initExitCode,
  parseInitArgs,
  planInit,
} from './init.js'
import { readTemplate } from './templates.js'
import { shotwrightVersion } from './version.js'
import { formatPublication, listRuns } from './runs.js'

export interface RunArgs {
  only: string | null
  video: boolean
  trace: boolean
  config: string
  passthrough: string[]
  separatorWarnings: string[]
  runDirFile: string | null
}

export interface GalleryArgs {
  runId: string | null
  config: string
  host: string
  port: number
  lan: boolean
  last: boolean
  includeTraces: boolean
}

export interface CompareArgs {
  a: string
  b: string
  config: string
  last: boolean
  failOnChange: boolean
  output: string | null
}

const RUN_USAGE = `Usage: shotwright run [--only a,b] [--video] [--trace] [--run-dir-file <path>] [--config <path>] [-- <playwright test args>]. The run-dir-file must be unique per invocation.`
const GALLERY_USAGE = `Usage: shotwright gallery [run-id|--last] [--config <path>] [--host <host>] [--port <port>] [--lan] [--include-traces]. Traces are withheld on a non-loopback bind unless --include-traces is given.`
const COMPARE_USAGE = `Usage: shotwright compare <run-a|latest|--last|path> <run-b|latest|--last|path> [--config <path>] [--output <file.html>] [--fail-on-change]. Exits 0 after writing the page unless --fail-on-change is given and a pair is not identical or similar.`
const RUNS_USAGE = `Usage: shotwright runs [--config <path>] [--json]`
const INIT_USAGE = `Usage: shotwright init [--dry-run] [--package-manager npm|pnpm|yarn]`
const GLOBAL_USAGE = `Usage: shotwright --help | --version`
const USAGE = `${RUN_USAGE}\n${RUNS_USAGE}\n${GALLERY_USAGE}\n${COMPARE_USAGE}\n${INIT_USAGE}\n${GLOBAL_USAGE}`

const COMMAND_USAGE: Readonly<Record<string, string>> = {
  run: RUN_USAGE,
  runs: RUNS_USAGE,
  gallery: GALLERY_USAGE,
  compare: COMPARE_USAGE,
  init: INIT_USAGE,
}
const HELP_FLAGS = new Set(['--help', '-h'])
const VERSION_FLAGS = new Set(['--version', '-v'])

/**
 * Whether argv asks for the version: `--version` or `-v` as the FIRST argument
 * only, so `run -- --version` still reaches Playwright untouched (ADR 0006).
 * For bug reports and for checking which version pnpm actually resolved, which
 * pnpm 11's minimumReleaseAge can make differ from the newest (shotwright-746.18.19).
 */
export function isVersionRequest(argv: readonly string[]): boolean {
  return argv[0] !== undefined && VERSION_FLAGS.has(argv[0])
}

/**
 * The usage text a help request asks for, or null when argv is not one.
 *
 * Recognised: no arguments; `--help`/`-h`/`help` as the command; `help <cmd>`;
 * and `<cmd> --help`/`<cmd> -h` as the first argument after a known command.
 * Only the FIRST argument after `run` is inspected, so `run -- --help` still
 * reaches Playwright untouched (ADR 0006). Before this existed every spelling
 * of the help flag was an unknown command exiting 1, and the release runbook
 * uses `shotwright --help` as the post-publish smoke test (shotwright-746.18.12).
 */
export function helpFor(argv: readonly string[]): string | null {
  const [cmd, next] = argv
  if (cmd === undefined || HELP_FLAGS.has(cmd)) return USAGE
  if (cmd === 'help') return (next !== undefined ? COMMAND_USAGE[next] : undefined) ?? USAGE
  const commandUsage = COMMAND_USAGE[cmd]
  if (commandUsage !== undefined && next !== undefined && HELP_FLAGS.has(next)) return commandUsage
  return null
}

export function parseRunArgs(argv: string[]): RunArgs {
  const args: RunArgs = {
    only: null,
    video: false,
    trace: false,
    config: 'shots.config.ts',
    passthrough: [],
    separatorWarnings: [],
    runDirFile: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') {
      parseRunPassthrough(argv.slice(i + 1), args)
      break
    } else if (a === '--only') {
      const v = argv[++i]
      if (!v) throw new Error('--only requires a value (comma-separated substrings)')
      args.only = v
    } else if (a === '--video') {
      args.video = true
    } else if (a === '--trace') {
      args.trace = true
    } else if (a === '--config') {
      const v = argv[++i]
      if (!v) throw new Error('--config requires a path')
      args.config = v
    } else if (a === '--run-dir-file') {
      args.runDirFile = requireValue(argv, ++i, a)
    } else {
      throw new Error(`unknown argument: ${a}\n${RUN_USAGE}`)
    }
  }
  return args
}

// Derived from `pnpm exec playwright test --help` on 2026-07-30:
// `--trace <mode>` choices are "on", "off", "on-first-retry",
// "on-all-retries", "retain-on-failure", "retain-on-first-failure", and
// "retain-on-failure-and-retries".
const PLAYWRIGHT_TRACE_MODES = new Set([
  'on',
  'off',
  'on-first-retry',
  'on-all-retries',
  'retain-on-failure',
  'retain-on-first-failure',
  'retain-on-failure-and-retries',
])

function parseRunPassthrough(argv: string[], args: RunArgs): void {
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!
    if (argument === '--only') {
      const value = argv[++i]
      if (!value) throw new Error('--only requires a value (comma-separated substrings)')
      args.only = value
      args.separatorWarnings.push(separatorWarning('--only'))
    } else if (argument === '--video') {
      args.video = true
      args.separatorWarnings.push(separatorWarning('--video'))
    } else if (argument === '--trace' && !PLAYWRIGHT_TRACE_MODES.has(argv[i + 1] ?? '')) {
      args.trace = true
      args.separatorWarnings.push(separatorWarning('--trace'))
    } else {
      args.passthrough.push(argument)
    }
  }
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function validateHost(host: string): void {
  if (
    host.length > 253 ||
    /[\s/\\\0]/.test(host) ||
    (net.isIP(host) === 0 &&
      !host
        .split('.')
        .every(
          (label) =>
            label.length > 0 &&
            label.length <= 63 &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
        ))
  ) {
    throw new Error(`--host must be an IP address or hostname: ${host}`)
  }
}

export function parseGalleryArgs(argv: string[]): GalleryArgs {
  const args: GalleryArgs = {
    runId: null,
    config: 'shots.config.ts',
    host: '127.0.0.1',
    port: 0,
    lan: false,
    last: false,
    includeTraces: false,
  }
  const seen = new Set<string>()
  let explicitHost = false
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!
    if (argument === '--config' || argument === '--host' || argument === '--port') {
      if (seen.has(argument)) throw new Error(`duplicate argument: ${argument}`)
      seen.add(argument)
      const value = requireValue(argv, ++i, argument)
      if (argument === '--config') {
        args.config = value
      } else if (argument === '--host') {
        validateHost(value)
        args.host = value
        explicitHost = true
      } else {
        if (!/^\d+$/.test(value)) throw new Error('--port must be an integer from 0 to 65535')
        const port = Number(value)
        if (!Number.isSafeInteger(port) || port > 65535) {
          throw new Error('--port must be an integer from 0 to 65535')
        }
        args.port = port
      }
    } else if (argument === '--lan') {
      if (seen.has(argument)) throw new Error('duplicate argument: --lan')
      seen.add(argument)
      args.lan = true
    } else if (argument === '--include-traces') {
      if (args.includeTraces) throw new Error('duplicate argument: --include-traces')
      args.includeTraces = true
    } else if (argument === '--last') {
      if (args.last) throw new Error('duplicate argument: --last')
      args.last = true
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown argument: ${argument}\n${GALLERY_USAGE}`)
    } else if (args.runId !== null) {
      throw new Error(`unexpected positional argument: ${argument}\n${GALLERY_USAGE}`)
    } else {
      args.runId = argument
    }
  }
  if (args.lan && explicitHost) throw new Error('--lan and --host are mutually exclusive')
  if (args.lan) args.host = '0.0.0.0'
  if (args.last && args.runId !== null) throw new Error('--last and run-id are mutually exclusive')
  return args
}

export function parseCompareArgs(argv: string[]): CompareArgs {
  const selectors: string[] = []
  let config = 'shots.config.ts'
  let sawConfig = false
  let last = false
  let failOnChange = false
  let output: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!
    if (argument === '--config') {
      if (sawConfig) throw new Error('duplicate argument: --config')
      sawConfig = true
      config = requireValue(argv, ++i, argument)
    } else if (argument === '--output') {
      if (output !== null) throw new Error('duplicate argument: --output')
      output = requireValue(argv, ++i, argument)
    } else if (argument === '--fail-on-change') {
      if (failOnChange) throw new Error('duplicate argument: --fail-on-change')
      failOnChange = true
    } else if (argument === '--last') {
      if (last) throw new Error('duplicate argument: --last')
      last = true
      selectors.push('--last')
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown argument: ${argument}\n${COMPARE_USAGE}`)
    } else if (selectors.length === 2) {
      throw new Error(`unexpected positional argument: ${argument}\n${COMPARE_USAGE}`)
    } else {
      selectors.push(argument)
    }
  }

  if (selectors.length !== 2) {
    throw new Error(`compare requires exactly two run selectors\n${COMPARE_USAGE}`)
  }
  return {
    a: selectors[0]!,
    b: selectors[1]!,
    config,
    last,
    failOnChange,
    output,
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return (
    relative === '' ||
    !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
  )
}

/**
 * Validate an explicit `compare --output` page and return its absolute path,
 * with its created parent canonicalized so a symlinked parent cannot
 * smuggle the page into a run. The page must end in `.html`, contain no control
 * characters, have an existing or creatable directory, not lie inside either
 * compared run directory, and be a regular file (not a symlink) or absent. Its
 * `<stem>.compare.json` and `<stem>.diff-<n>.png` sidecars are written beside it.
 */
export function resolveCompareOutput(file: string, runDirs: readonly string[]): string {
  if (hasControlCharacter(file)) throw new Error('--output must not contain control characters')
  if (
    path.extname(file).toLowerCase() !== '.html' ||
    path.basename(file, path.extname(file)) === ''
  )
    throw new Error(`--output must name an .html file: ${file}`)
  const target = path.resolve(file)
  const missing: string[] = []
  let ancestor = path.dirname(target)
  let stat: fs.Stats
  for (;;) {
    try {
      stat = fs.statSync(ancestor)
      break
    } catch (error) {
      const parent = path.dirname(ancestor)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === ancestor)
        throw new Error(`--output directory cannot be created: ${path.dirname(target)}`, {
          cause: error,
        })
      missing.unshift(path.basename(ancestor))
      ancestor = parent
    }
  }
  if (!stat.isDirectory())
    throw new Error(`--output directory cannot be created: ${path.dirname(target)}`)
  const parent = path.join(fs.realpathSync(ancestor), ...missing)
  try {
    fs.mkdirSync(parent, { recursive: true })
  } catch (error) {
    throw new Error(`--output directory cannot be created: ${path.dirname(target)}`, {
      cause: error,
    })
  }
  // A directory swapped after validation can still redirect a later write.
  const canonical = path.join(fs.realpathSync(parent), path.basename(target))
  for (const runDir of runDirs) {
    if (isInside(runDir, canonical))
      throw new Error(`--output must not be inside a compared run directory: ${runDir}`)
  }
  const existing = fs.lstatSync(canonical, { throwIfNoEntry: false })
  if (existing && !existing.isFile())
    throw new Error(`--output must be a regular file or absent: ${file}`)
  return canonical
}

/**
 * Short digests that tell two same-basename run paths apart in a default
 * compare stem: the first ten hex characters of each absolute path's SHA-256,
 * lengthened only in the unlikely case the two prefixes collide.
 */
export function runPathDigests(aRunDir: string, bRunDir: string): { a: string; b: string } {
  const a = createHash('sha256').update(aRunDir).digest('hex')
  const b = createHash('sha256').update(bRunDir).digest('hex')
  let length = 10
  while (length < a.length && a.slice(0, length) === b.slice(0, length)) length += 2
  return { a: a.slice(0, length), b: b.slice(0, length) }
}

/** The terminal line stating the parity-gate verdict with every state's count. */
export function formatCompareGate(
  result: Pick<CompareGenerationResult, 'counts' | 'gate'>,
): string {
  const counts = compareStates.map((state) => `${state} ${result.counts[state]}`).join(', ')
  const { nonParity, failOnChange } = result.gate
  const verdict =
    nonParity === 0
      ? 'parity (every pair identical or similar)'
      : `${nonParity} non-parity pair${nonParity === 1 ? '' : 's'}`
  const gate = failOnChange
    ? `--fail-on-change: ${nonParity === 0 ? 'pass' : 'fail (exit 1)'}`
    : 'report only (exit 0)'
  return `shotwright compare: ${verdict}; ${counts}; ${gate}`
}

export function formatIncludedTracesNotice(host: string): string {
  return `shotwright gallery: --include-traces: serving Playwright traces (which can carry cookies and storage) on non-loopback bind ${host}`
}

export function misplacedSeparatorWarnings(passthrough: string[]): string[] {
  const misplaced = passthrough.filter(
    (argument) => argument === '--only' || argument === '--video' || argument === '--trace',
  )
  return misplaced.map(separatorWarning)
}

function separatorWarning(argument: '--only' | '--video' | '--trace'): string {
  return (
    `shotwright: warning: ${argument} came after \`--\`; shotwright applied it and removed it from Playwright passthrough.\n` +
    '            Prefer shotwright flags first:  pnpm shots --video -- --workers=1'
  )
}

/** Resolve the consumer's @playwright/test CLI entry from `cwd`. */
export function resolvePlaywrightCli(cwd: string): string {
  const req = createRequire(path.join(cwd, 'noop.js'))
  let pkgPath: string
  try {
    pkgPath = req.resolve('@playwright/test/package.json')
  } catch {
    throw new Error(
      'shotwright: @playwright/test not found — install the peer dependency ' +
        '(e.g. `pnpm add -D @playwright/test`)',
    )
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['playwright']
  if (!bin) throw new Error('shotwright: could not locate the playwright CLI in @playwright/test')
  return path.join(path.dirname(pkgPath), bin)
}

export interface ConfigProbeDependencies {
  playwrightCli?: string
  invoke?: (
    cli: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => Promise<number | ProbeResult>
  tempRoot?: string
}

const PROBE_CAPTURE_LIMIT = 1024 * 1024

interface ProbeResult {
  code: number
  stdout: string
  stderr: string
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
}

function invokeProbe(
  cli: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<ProbeResult> {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = Buffer.alloc(0)
  let stderr = Buffer.alloc(0)
  let stdoutTruncated = false
  let stderrTruncated = false
  child.stdout.on('data', (chunk: Buffer) => {
    const combined = Buffer.concat([stdout, chunk])
    stdoutTruncated ||= combined.length > PROBE_CAPTURE_LIMIT
    stdout = combined.subarray(-PROBE_CAPTURE_LIMIT)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const combined = Buffer.concat([stderr, chunk])
    stderrTruncated ||= combined.length > PROBE_CAPTURE_LIMIT
    stderr = combined.subarray(-PROBE_CAPTURE_LIMIT)
  })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) =>
      resolve({
        code: code ?? 1,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        stdoutTruncated,
        stderrTruncated,
      }),
    )
  })
}

export async function probeOutputDir(
  config: string,
  cwd = process.cwd(),
  dependencies: ConfigProbeDependencies = {},
): Promise<string> {
  const probeDir = fs.mkdtempSync(
    path.join(dependencies.tempRoot ?? os.tmpdir(), 'shotwright-config-probe-'),
  )
  const probeFile = path.join(probeDir, 'output-dir')
  try {
    const cli = dependencies.playwrightCli ?? resolvePlaywrightCli(cwd)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SHOTWRIGHT_RUN: '0',
      SHOTWRIGHT_CONFIG_PROBE_FILE: probeFile,
    }
    delete env.SHOTWRIGHT_RUN_DIR
    const result = await (dependencies.invoke ?? invokeProbe)(
      cli,
      ['test', '--list', '--pass-with-no-tests', '-c', config],
      { cwd, env },
    )
    const probe = typeof result === 'number' ? { code: result, stdout: '', stderr: '' } : result
    if (probe.code !== 0) {
      console.error(`shotwright: config probe output for ${config}:`)
      if (probe.stdoutTruncated) console.error('shotwright: probe stdout truncated to last 1 MiB')
      if (probe.stderrTruncated) console.error('shotwright: probe stderr truncated to last 1 MiB')
      if (probe.stdout) process.stdout.write(probe.stdout)
      if (probe.stderr) process.stderr.write(probe.stderr)
      throw new Error(
        `shotwright gallery: config probe failed for ${config} — fix the config and try again`,
      )
    }
    let outputDir: string
    try {
      outputDir = fs.readFileSync(probeFile, 'utf8')
    } catch {
      throw new Error(
        'shotwright gallery: config did not call defineShotsConfig() — export defineShotsConfig(...) from the selected config',
      )
    }
    if (
      outputDir.length === 0 ||
      outputDir.includes('\0') ||
      !path.isAbsolute(outputDir) ||
      path.resolve(outputDir) !== outputDir
    ) {
      throw new Error('shotwright gallery: config probe returned a non-canonical output directory')
    }
    return outputDir
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true })
  }
}

export function formatGallerySelection(runId: string, selectedViaLatest: boolean): string {
  return selectedViaLatest
    ? `shotwright gallery: selected run ${runId} via latest (last fully passed run)`
    : `shotwright gallery: selected run ${runId} explicitly (this run may be partial or failed)`
}

export function isLanExposure(address: string): boolean {
  if (net.isIPv4(address)) return !address.startsWith('127.')
  if (net.isIPv6(address)) {
    return address !== '::1' && !/^::ffff:127\./i.test(address)
  }
  return true
}

export function formatGalleryExposureNotice(address: string): string {
  return isLanExposure(address)
    ? 'Anyone on this network can view these captures until you stop the server.'
    : 'Use --lan for phone access.'
}

async function run(argv: string[]): Promise<number> {
  const args = parseRunArgs(argv)
  for (const warning of args.separatorWarnings) {
    console.warn(warning)
  }
  const callerFile = args.runDirFile ?? process.env.SHOTWRIGHT_RUN_DIR_FILE
  if (callerFile) {
    const parent = path.dirname(path.resolve(callerFile))
    try {
      if (!fs.statSync(parent).isDirectory()) {
        console.error('shotwright: --run-dir-file parent must be a directory')
        return 2
      }
    } catch {
      console.error('shotwright: --run-dir-file parent directory does not exist or is unreadable')
      return 2
    }
    try {
      const stat = fs.lstatSync(callerFile)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        console.error('shotwright: --run-dir-file destination must be a regular file or absent')
        return 2
      }
      fs.unlinkSync(callerFile)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (!fs.existsSync(args.config)) {
    console.error(
      `shotwright: config not found: ${args.config} — pass --config or create shots.config.ts`,
    )
    return 1
  }
  const cli = resolvePlaywrightCli(process.cwd())
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-run-dir-'))
  const privateFile = path.join(privateDir, 'run-dir')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SHOTWRIGHT_RUN: '1',
    SHOTWRIGHT_VIDEO: args.video ? '1' : '0',
    SHOTWRIGHT_TRACE: args.trace ? '1' : '0',
    SHOTWRIGHT_RUN_DIR_FILE: privateFile,
  }
  delete env.SHOTWRIGHT_RUN_DIR
  delete env.SHOTWRIGHT_CONFIG_PROBE_FILE
  if (args.only !== null) env.SHOTWRIGHT_ONLY = args.only
  try {
    const child = spawn(process.execPath, [cli, 'test', '-c', args.config, ...args.passthrough], {
      stdio: 'inherit',
      env,
    })
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (status) => resolve(status ?? 1))
    })
    if (fs.existsSync(privateFile)) {
      const runDir = fs.readFileSync(privateFile, 'utf8')
      let copyFailed = false
      if (callerFile) {
        const target = path.resolve(callerFile)
        const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`)
        try {
          fs.writeFileSync(temp, runDir, { flag: 'wx' })
          fs.renameSync(temp, target)
        } catch (error) {
          copyFailed = true
          console.error(
            `shotwright: --run-dir-file copy failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        } finally {
          fs.rmSync(temp, { force: true })
        }
      }
      console.log(`run-dir: ${runDir}`)
      if (copyFailed) return code === 0 ? 1 : code
    }
    return code
  } finally {
    fs.rmSync(privateDir, { recursive: true, force: true })
  }
}

async function gallery(argv: string[]): Promise<number> {
  const args = parseGalleryArgs(argv)
  if (!fs.existsSync(args.config)) {
    console.error(
      `shotwright: config not found: ${args.config} — pass --config or create shots.config.ts`,
    )
    return 1
  }
  const outputDir = await probeOutputDir(args.config)
  const selected = resolveGalleryRun(outputDir, args.last ? '--last' : args.runId)
  const generated = generateGallery(selected.runDir)

  console.log(
    selected.selectedViaLast
      ? formatLastSelection(selected.runId, outputDir)
      : formatGallerySelection(selected.runId, selected.selectedViaLatest),
  )
  if (generated.diagnostics.length > 0) {
    console.error(formatGalleryDiagnostics(generated.diagnostics))
  }

  const server = await startGalleryServer(selected.runDir, args.host, args.port, {
    includeTraces: args.includeTraces,
  })
  const shutdown = waitForGalleryShutdown(server)
  const lanExposure = isLanExposure(server.host)
  console.log(`shotwright gallery: serving ${selected.runId}`)
  for (const printed of galleryUrls(server.host, server.port, lanExposure)) {
    console.log(`${printed.label}: ${printed.url}`)
  }
  if (lanExposure) {
    console.warn(formatGalleryExposureNotice(server.host))
  } else {
    console.log(formatGalleryExposureNotice(server.host))
  }
  if (args.includeTraces && !isLoopbackBind(server.host)) {
    console.warn(formatIncludedTracesNotice(server.host))
  }
  await shutdown
  return generated.diagnostics.length > 0 ? 1 : 0
}

function formatCompareSelection(side: 'A' | 'B', selected: ResolvedGalleryRun): string {
  if (selected.selectedViaLast)
    return `shotwright compare ${side}: ${formatLastSelection(selected.runId, selected.outputDir)}`
  return selected.selectedViaLatest
    ? `shotwright compare: selected ${side} ${selected.runId} via latest (last fully passed run)`
    : `shotwright compare: selected ${side} ${selected.runId} explicitly`
}

function formatLastSelection(runId: string, outputDir: string): string {
  let latest = 'none'
  try {
    latest = resolveGalleryRun(outputDir, null).runId
  } catch {
    // An absent last-passed link is normal for a failed first run.
  }
  return `selected ${runId} (--last: newest run with a manifest; latest = last passed run is ${latest})`
}

async function runs(argv: string[]): Promise<number> {
  let config = 'shots.config.ts'
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!
    if (argument === '--config') config = requireValue(argv, ++i, argument)
    else if (argument === '--json') json = true
    else throw new Error(`unknown argument: ${argument}\n${RUNS_USAGE}`)
  }
  if (!fs.existsSync(config)) {
    console.error(
      `shotwright: config not found: ${config} — pass --config or create shots.config.ts`,
    )
    return 1
  }
  const rows = listRuns(await probeOutputDir(config))
  if (json) console.log(JSON.stringify(rows, null, 2))
  else {
    console.log('id\tstarted\tstatus\tpublication\tshots')
    for (const row of rows) {
      console.log(
        `${row.runId}\t${row.startedAt ?? '-'}\t${row.status}\t${formatPublication(row)}\t${row.shotCount ?? '-'}`,
      )
    }
  }
  return 0
}

export async function compare(
  argv: string[],
  outputDirProbe: (config: string) => Promise<string> = probeOutputDir,
): Promise<number> {
  const args = parseCompareArgs(argv)
  if (!fs.existsSync(args.config)) {
    console.error(
      `shotwright: config not found: ${args.config} — pass --config or create shots.config.ts`,
    )
    return 1
  }

  const outputDir = await outputDirProbe(args.config)
  const selected = resolveCompareRuns(outputDir, args.a, args.b)
  const runDirs = [selected.a.runDir, selected.b.runDir]
  // Same-basename runs (two downloaded copies, say) would share the default
  // stem; a digest of each absolute run path keeps their outputs apart.
  const digests =
    args.output === null && selected.a.runId === selected.b.runId
      ? runPathDigests(selected.a.runDir, selected.b.runDir)
      : null
  let outputFile: string
  if (args.output === null) {
    outputFile = path.join(
      selected.outputDir,
      'compare',
      digests === null
        ? `${selected.a.runId}.vs.${selected.b.runId}.html`
        : `${selected.a.runId}-${digests.a}.vs.${selected.b.runId}-${digests.b}.html`,
    )
  }
  try {
    outputFile = resolveCompareOutput(args.output ?? outputFile!, runDirs)
    if (args.output === null && fs.existsSync(outputFile)) {
      const sidecar = path.join(
        path.dirname(outputFile),
        `${path.basename(outputFile, path.extname(outputFile))}.compare.json`,
      )
      // ADR 0009: the default stem is generator-owned, so a page without a readable
      // sidecar is ours to overwrite. Only a sidecar that records a different pair
      // marks the page as another comparison's output.
      let runs: unknown = null
      try {
        runs = (JSON.parse(fs.readFileSync(sidecar, 'utf8')) as { runs?: unknown }).runs ?? null
      } catch {
        runs = null
      }
      const expected = {
        a: {
          runId: selected.a.runId,
          pathDigest: createHash('sha256').update(selected.a.runDir).digest('hex'),
        },
        b: {
          runId: selected.b.runId,
          pathDigest: createHash('sha256').update(selected.b.runDir).digest('hex'),
        },
      }
      if (runs !== null && JSON.stringify(runs) !== JSON.stringify(expected)) {
        throw new Error(
          `default page ${outputFile} is not owned by runs ${selected.a.runDir} and ${selected.b.runDir}; sidecar ${sidecar} records a different pair`,
        )
      }
    }
  } catch (error) {
    console.error(`shotwright compare: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  const generated = generateCompareGallery(selected.a.runDir, selected.b.runDir, {
    outputFile,
    failOnChange: args.failOnChange,
  })

  const digestNote = (side: 'a' | 'b'): string =>
    digests === null ? '' : ` (digest ${digests[side]} = ${selected[side].runDir})`
  console.log(formatCompareSelection('A', selected.a) + digestNote('a'))
  console.log(formatCompareSelection('B', selected.b) + digestNote('b'))
  console.log(`shotwright compare: wrote ${generated.comparePath}`)
  if (generated.diagnostics.length > 0) {
    console.error(
      generated.diagnostics
        .map((diagnostic) => `shotwright compare: ${diagnostic.path}: ${diagnostic.message}`)
        .join('\n'),
    )
  }
  const gate = formatCompareGate(generated)
  if (args.failOnChange && generated.gate.nonParity > 0) {
    console.error(gate)
    return 1
  }
  console.log(gate)
  return 0
}

async function init(argv: string[]): Promise<number> {
  const args = parseInitArgs(argv)
  const plan = planInit(process.cwd(), readTemplate, args.packageManager)
  if (!args.dryRun && plan.notices.length > 0) {
    console.log(plan.notices.join('\n'))
  }
  const result = args.dryRun ? dryRunInitPlan(plan) : applyInitPlan(plan)
  const output = formatInitResult(result, { omitNotices: !args.dryRun })
  if (output.length > 0) console.log(output)
  return initExitCode(result)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (isVersionRequest(argv)) {
    console.log(shotwrightVersion())
    process.exitCode = 0
    return
  }
  const help = helpFor(argv)
  if (help !== null) {
    console.log(help)
    process.exitCode = 0
    return
  }
  const [cmd, ...rest] = argv
  if (cmd === 'run') {
    process.exitCode = await run(rest)
  } else if (cmd === 'runs') {
    process.exitCode = await runs(rest)
  } else if (cmd === 'gallery') {
    process.exitCode = await gallery(rest)
  } else if (cmd === 'compare') {
    process.exitCode = await compare(rest)
  } else if (cmd === 'init') {
    process.exitCode = await init(rest)
  } else {
    console.error(`shotwright: unknown command "${cmd}"\n${USAGE}`)
    process.exitCode = 1
  }
}

const invokedDirectly = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
