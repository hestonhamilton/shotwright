#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// shotwright CLI. E1 ships `run`; gallery/compare/trace/init land in E3+/E6.
//
// `run` resolves the *consumer's* @playwright/test (the peer — never npx, which
// could silently fetch a mismatched version), sets the env contract, and spawns
// `node <playwright cli> test -c <config>`. Run-dir creation happens inside the
// config factory at eval time; the reporter prints the run summary.

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { formatGalleryDiagnostics, generateGallery } from './gallery/generate.js'
import { generateCompareGallery } from './gallery/generate-compare.js'
import {
  resolveCompareRuns,
  resolveGalleryRun,
  type ResolvedGalleryRun,
} from './gallery/resolve.js'
import { galleryUrls, startGalleryServer, waitForGalleryShutdown } from './gallery/server.js'
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
import { listRuns } from './runs.js'

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
}

export interface CompareArgs {
  a: string
  b: string
  config: string
  last: boolean
  output: string | null
}

const RUN_USAGE = `Usage: shotwright run [--only a,b] [--video] [--trace] [--run-dir-file <path>] [--config <path>] [-- <playwright test args>]`
const GALLERY_USAGE = `Usage: shotwright gallery [run-id|--last] [--config <path>] [--host <host>] [--port <port>] [--lan]`
const COMPARE_USAGE = `Usage: shotwright compare <run-a|latest|--last|path> <run-b|latest|--last|path> [--config <path>] [--output <file>]`
const RUNS_USAGE = `Usage: shotwright runs [--config <path>] [--json]`
const INIT_USAGE = `Usage: shotwright init [--dry-run]`
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
    output,
  }
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
  ) => Promise<number | { code: number; stdout: string; stderr: string }>
  tempRoot?: string
}

function invokeProbe(
  cli: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
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
      if (callerFile) {
        const target = path.resolve(callerFile)
        const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`)
        try {
          fs.writeFileSync(temp, runDir, { flag: 'wx' })
          fs.renameSync(temp, target)
        } finally {
          fs.rmSync(temp, { force: true })
        }
      }
      console.log(`run-dir: ${runDir}`)
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

  const server = await startGalleryServer(selected.runDir, args.host, args.port)
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

function digestRunPath(runDir: string): string {
  return crypto.createHash('sha256').update(runDir).digest('hex').slice(0, 10)
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
    console.log('id\tstarted\tstatus\tshots')
    for (const row of rows) {
      console.log(`${row.runId}\t${row.startedAt ?? '-'}\t${row.status}\t${row.shotCount ?? '-'}`)
    }
  }
  return 0
}

async function compare(argv: string[]): Promise<number> {
  const args = parseCompareArgs(argv)
  if (!fs.existsSync(args.config)) {
    console.error(
      `shotwright: config not found: ${args.config} — pass --config or create shots.config.ts`,
    )
    return 1
  }

  const outputDir = await probeOutputDir(args.config)
  const selected = resolveCompareRuns(outputDir, args.a, args.b)
  const generated = generateCompareGallery(selected.outputDir, selected.a.runDir, selected.b.runDir)
  let comparePath = generated.comparePath
  if (args.output !== null || selected.a.runId === selected.b.runId) {
    const destination =
      args.output === null
        ? path.join(
            selected.outputDir,
            'compare',
            `${selected.a.runId}-${digestRunPath(selected.a.runDir)}.vs.${selected.b.runId}-${digestRunPath(selected.b.runDir)}.html`,
          )
        : path.resolve(args.output)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    if (destination !== generated.comparePath) {
      const temp = path.join(
        path.dirname(destination),
        `.${path.basename(destination)}.${process.pid}.tmp`,
      )
      try {
        fs.copyFileSync(generated.comparePath, temp)
        fs.renameSync(temp, destination)
        fs.rmSync(generated.comparePath)
      } finally {
        fs.rmSync(temp, { force: true })
      }
    }
    comparePath = destination
  }

  console.log(formatCompareSelection('A', selected.a))
  console.log(formatCompareSelection('B', selected.b))
  console.log(`shotwright compare: wrote ${comparePath}`)
  if (generated.diagnostics.length > 0) {
    console.error(
      generated.diagnostics
        .map((diagnostic) => `shotwright compare: ${diagnostic.path}: ${diagnostic.message}`)
        .join('\n'),
    )
  }
  return 0
}

async function init(argv: string[]): Promise<number> {
  const args = parseInitArgs(argv)
  const plan = planInit(process.cwd(), readTemplate)
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
