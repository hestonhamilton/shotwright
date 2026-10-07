#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// shotwright CLI. E1 ships `run`; gallery/compare/trace/init land in E3+/E6.
//
// `run` resolves the *consumer's* @playwright/test (the peer — never npx, which
// could silently fetch a mismatched version), sets the env contract, and spawns
// `node <playwright cli> test -c <config>`. Run-dir creation happens inside the
// config factory at eval time; the reporter prints the run summary.

import { spawn } from 'node:child_process'
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
import {
  galleryUrls,
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

export interface RunArgs {
  only: string | null
  video: boolean
  trace: boolean
  config: string
  passthrough: string[]
  separatorWarnings: string[]
}

export interface GalleryArgs {
  runId: string | null
  config: string
  host: string
  port: number
  lan: boolean
}

export interface CompareArgs {
  a: string
  b: string
  config: string
}

const RUN_USAGE = `Usage: shotwright run [--only a,b] [--video] [--trace] [--config <path>] [-- <playwright test args>]`
const GALLERY_USAGE = `Usage: shotwright gallery [run-id] [--config <path>] [--host <host>] [--port <port>] [--lan]`
const COMPARE_USAGE = `Usage: shotwright compare <run-a|latest> <run-b|latest> [--config <path>]`
const INIT_USAGE = `Usage: shotwright init [--dry-run]`
const USAGE = `${RUN_USAGE}\n${GALLERY_USAGE}\n${COMPARE_USAGE}\n${INIT_USAGE}`

const COMMAND_USAGE: Readonly<Record<string, string>> = {
  run: RUN_USAGE,
  gallery: GALLERY_USAGE,
  compare: COMPARE_USAGE,
  init: INIT_USAGE,
}
const HELP_FLAGS = new Set(['--help', '-h'])

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
  return args
}

export function parseCompareArgs(argv: string[]): CompareArgs {
  const selectors: string[] = []
  let config = 'shots.config.ts'
  let sawConfig = false

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!
    if (argument === '--config') {
      if (sawConfig) throw new Error('duplicate argument: --config')
      sawConfig = true
      config = requireValue(argv, ++i, argument)
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
  return { a: selectors[0]!, b: selectors[1]!, config }
}

export function misplacedSeparatorWarnings(passthrough: string[]): string[] {
  const misplaced = passthrough.filter((argument) =>
    argument === '--only' || argument === '--video' || argument === '--trace',
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
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin?: string | Record<string, string> }
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
  ) => Promise<number>
  tempRoot?: string
}

function invokeProbe(
  cli: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number> {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit',
  })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
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
    const code = await (dependencies.invoke ?? invokeProbe)(
      cli,
      ['test', '--list', '--pass-with-no-tests', '-c', config],
      { cwd, env },
    )
    if (code !== 0) {
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
  if (!fs.existsSync(args.config)) {
    console.error(`shotwright: config not found: ${args.config} — pass --config or create shots.config.ts`)
    return 1
  }
  const cli = resolvePlaywrightCli(process.cwd())
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SHOTWRIGHT_RUN: '1',
    SHOTWRIGHT_VIDEO: args.video ? '1' : '0',
    SHOTWRIGHT_TRACE: args.trace ? '1' : '0',
  }
  if (args.only !== null) env.SHOTWRIGHT_ONLY = args.only
  const child = spawn(process.execPath, [cli, 'test', '-c', args.config, ...args.passthrough], {
    stdio: 'inherit',
    env,
  })
  return new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)))
}

async function gallery(argv: string[]): Promise<number> {
  const args = parseGalleryArgs(argv)
  if (!fs.existsSync(args.config)) {
    console.error(`shotwright: config not found: ${args.config} — pass --config or create shots.config.ts`)
    return 1
  }
  const outputDir = await probeOutputDir(args.config)
  const selected = resolveGalleryRun(outputDir, args.runId)
  const generated = generateGallery(selected.runDir)

  console.log(formatGallerySelection(selected.runId, selected.selectedViaLatest))
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
  return selected.selectedViaLatest
    ? `shotwright compare: selected ${side} ${selected.runId} via latest (last fully passed run)`
    : `shotwright compare: selected ${side} ${selected.runId} explicitly`
}

async function compare(argv: string[]): Promise<number> {
  const args = parseCompareArgs(argv)
  if (!fs.existsSync(args.config)) {
    console.error(`shotwright: config not found: ${args.config} — pass --config or create shots.config.ts`)
    return 1
  }

  const outputDir = await probeOutputDir(args.config)
  const selected = resolveCompareRuns(outputDir, args.a, args.b)
  const generated = generateCompareGallery(
    selected.outputDir,
    selected.a.runDir,
    selected.b.runDir,
  )

  console.log(formatCompareSelection('A', selected.a))
  console.log(formatCompareSelection('B', selected.b))
  console.log(`shotwright compare: wrote ${generated.comparePath}`)
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
  const help = helpFor(argv)
  if (help !== null) {
    console.log(help)
    process.exitCode = 0
    return
  }
  const [cmd, ...rest] = argv
  if (cmd === 'run') {
    process.exitCode = await run(rest)
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
