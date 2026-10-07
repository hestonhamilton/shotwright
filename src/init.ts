// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'

export interface InitArgs {
  dryRun: boolean
}

export interface SkillDestination {
  displayPath: string
  symlinkNotice: string | null
}

export interface InitPlan {
  cwd: string
  vite: boolean
  actions: InitAction[]
  leftAlone: InitReportLine[]
  needsReview: InitReportLine[]
  upToDate: string[]
  conflicts: ScriptConflict[]
  notices: string[]
}

export interface InitAction {
  path: string
  label: string
  kind: 'create' | 'update'
  detail?: string
  notice?: string
  write: () => void
}

export interface InitReportLine {
  path: string
  detail: string
}

export interface ScriptConflict {
  name: string
  actual: string
}

export interface InitResult {
  plan: InitPlan
  dryRun: boolean
  written: InitAction[]
  failedAction: InitAction | null
  error: unknown
}

export type InitOutcome =
  | { kind: 'dry-run'; nextSteps: InitNextSteps }
  | { kind: 'partial-write-failure'; exitCode: 1 }
  | { kind: 'script-conflict'; scriptName: string; exitCode: 1 }
  | { kind: 'fresh-vite-scaffold'; nextSteps: 'vite'; exitCode: 0 }
  | { kind: 'fresh-placeholder-scaffold'; nextSteps: 'placeholder'; exitCode: 0 }
  | { kind: 'partial-update'; nextSteps: InitNextSteps; exitCode: 0 }
  | { kind: 'nothing-changed-review-pending'; reviewCount: number; exitCode: 0 }
  | { kind: 'nothing-changed'; exitCode: 0 }

type InitNextSteps = 'vite' | 'placeholder'

export interface DesiredScripts {
  shots: string
  'shots:gallery': string
  'shots:compare': string
  'shots:install': string
}

const INIT_USAGE = 'Usage: shotwright init [--dry-run]'
const desiredScripts: DesiredScripts = {
  shots: 'shotwright run',
  'shots:gallery': 'shotwright gallery',
  'shots:compare': 'shotwright compare',
  'shots:install': 'playwright install chromium',
}

const viteWebServerBlock = `  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI,
  },`

const placeholderWebServerBlock = `  // Point these at the command and URL that boot your app for review captures.
  // use: { baseURL: 'http://127.0.0.1:5173' },
  // webServer: {
  //   command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
  //   url: 'http://127.0.0.1:5173/',
  //   reuseExistingServer: !process.env.CI,
  // },`

export function parseInitArgs(argv: string[]): InitArgs {
  const args: InitArgs = { dryRun: false }
  for (const argument of argv) {
    if (argument === '--dry-run') {
      args.dryRun = true
    } else {
      throw new Error(`unknown argument: ${argument}\n${INIT_USAGE}`)
    }
  }
  return args
}

export function detectVite(pkg: unknown): boolean {
  if (!isObject(pkg)) return false
  return hasOwnPackage(pkg.dependencies, 'vite') || hasOwnPackage(pkg.devDependencies, 'vite')
}

export function mutatePackageJsonScripts(
  raw: string,
  desired: DesiredScripts = desiredScripts,
): { raw: string; changed: string[]; conflicts: ScriptConflict[]; note: string | null } {
  const pkg = JSON.parse(raw) as unknown
  if (!isObject(pkg)) throw new Error('package.json must contain a JSON object')

  const newline = raw.endsWith('\n') ? '\n' : ''
  const indent = detectJsonIndent(raw)
  const note = indent === null ? 'package.json had no indented property lines; using 2-space indent' : null
  const indentString = indent ?? '  '
  const scripts = isObject(pkg.scripts) ? pkg.scripts : {}
  const conflicts: ScriptConflict[] = []
  const changed: string[] = []

  for (const [name, command] of Object.entries(desired)) {
    const actual = scripts[name]
    if (actual === undefined) {
      scripts[name] = command
      changed.push(name)
    } else if (actual !== command) {
      conflicts.push({ name, actual: String(actual) })
    }
  }

  if (!isObject(pkg.scripts) && changed.length > 0) {
    pkg.scripts = scripts
  }

  if (changed.length === 0) return { raw, changed, conflicts, note }
  return { raw: JSON.stringify(pkg, null, indentString) + newline, changed, conflicts, note }
}

export function resolveSkillDestination(cwd: string): SkillDestination {
  const skillsDir = path.join(cwd, '.claude', 'skills')
  const skillPath = path.join(skillsDir, 'shots-harness', 'SKILL.md')
  try {
    const stat = fs.lstatSync(skillsDir)
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(skillsDir)
      return {
        displayPath: relativePath(cwd, path.join(target, 'shots-harness', 'SKILL.md')),
        symlinkNotice:
          `Note: .claude/skills is a symlink to ${relativePath(cwd, target)}\n` +
          `      the skill will be written to ${relativePath(cwd, path.join(target, 'shots-harness', 'SKILL.md'))}`,
      }
    }
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
  return { displayPath: relativePath(cwd, skillPath), symlinkNotice: null }
}

export function planInit(cwd: string, loadTemplate: (rel: string) => string): InitPlan {
  const packagePath = path.join(cwd, 'package.json')
  let packageRaw: string
  try {
    packageRaw = fs.readFileSync(packagePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) throw new Error('shotwright init: package.json not found', { cause: error })
    throw error
  }

  let packageMutation: ReturnType<typeof mutatePackageJsonScripts>
  let packageJson: unknown
  try {
    packageJson = JSON.parse(packageRaw) as unknown
    packageMutation = mutatePackageJsonScripts(packageRaw, desiredScripts)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`shotwright init: could not parse package.json: ${message}`, { cause: error })
  }

  const vite = detectVite(packageJson)
  const config = loadTemplate('init/shots.config.ts').replace(
    '  // {{webServerBlock}}',
    vite ? viteWebServerBlock : placeholderWebServerBlock,
  )
  const example = loadTemplate('init/shots/example.shots.ts')
  const ciWorkflow = loadTemplate('github/shotwright.yml')
  const gitignoreSnippet = loadTemplate('init/gitignore.snippet')
  const skill = loadTemplate('skills/shots-harness/SKILL.md')
  const plan: InitPlan = {
    cwd,
    vite,
    actions: [],
    leftAlone: [],
    needsReview: [],
    upToDate: [],
    conflicts: packageMutation.conflicts,
    notices: [],
  }
  planManagedFile(plan, 'shots.config.ts', config)
  planManagedFile(plan, 'shots/example.shots.ts', example)
  planManagedFile(plan, '.github/workflows/shotwright.yml', ciWorkflow)
  planPackageJson(plan, packageRaw, packageMutation)
  planGitignore(plan, gitignoreSnippet)
  planSkill(plan, skill)
  return plan
}

export function applyInitPlan(plan: InitPlan): InitResult {
  const written: InitAction[] = []
  for (const action of plan.actions) {
    try {
      action.write()
      written.push(action)
    } catch (error) {
      return { plan, dryRun: false, written, failedAction: action, error }
    }
  }
  return { plan, dryRun: false, written, failedAction: null, error: null }
}

export function dryRunInitPlan(plan: InitPlan): InitResult {
  return { plan, dryRun: true, written: [], failedAction: null, error: null }
}

export function classifyInitOutcome(result: InitResult): InitOutcome {
  const { plan } = result
  const nextSteps = plan.vite ? 'vite' : 'placeholder'
  if (result.dryRun) return { kind: 'dry-run', nextSteps }
  if (result.failedAction) return { kind: 'partial-write-failure', exitCode: 1 }
  if (plan.conflicts.length > 0) {
    return { kind: 'script-conflict', scriptName: plan.conflicts[0]!.name, exitCode: 1 }
  }
  if (result.written.length === 0) {
    if (plan.needsReview.length > 0) {
      return {
        kind: 'nothing-changed-review-pending',
        reviewCount: plan.needsReview.length,
        exitCode: 0,
      }
    }
    return { kind: 'nothing-changed', exitCode: 0 }
  }
  if (result.written.some((action) => action.path === 'shots.config.ts')) {
    return plan.vite
      ? { kind: 'fresh-vite-scaffold', nextSteps: 'vite', exitCode: 0 }
      : { kind: 'fresh-placeholder-scaffold', nextSteps: 'placeholder', exitCode: 0 }
  }
  return { kind: 'partial-update', nextSteps, exitCode: 0 }
}

export function initExitCode(result: InitResult): number {
  return initOutcomeExitCode(classifyInitOutcome(result))
}

export function formatInitResult(result: InitResult, options: { omitNotices?: boolean } = {}): string {
  const outcome = classifyInitOutcome(result)
  if (outcome.kind === 'partial-write-failure') return formatInitFailure(result, outcome)
  const lines: string[] = []
  const { plan } = result
  lines.push(formatHeadline(outcome))
  if (!options.omitNotices) appendNotices(lines, plan.notices)
  appendActionNotices(lines, result.dryRun ? plan.actions : result.written)
  appendConflicts(lines, plan.conflicts)

  if (result.dryRun) {
    appendActionSection(lines, 'Would create', plan.actions.filter((action) => action.kind === 'create'))
    appendActionSection(lines, 'Would update', plan.actions.filter((action) => action.kind === 'update'))
    appendReportSection(lines, 'Would leave alone (yours)', plan.leftAlone)
  } else {
    appendActionSection(lines, 'Created', result.written.filter((action) => action.kind === 'create'))
    appendActionSection(lines, 'Updated', result.written.filter((action) => action.kind === 'update'))
    appendReportSection(lines, 'Left alone (yours)', plan.leftAlone)
  }

  appendNeedsReview(lines, plan.needsReview, result.dryRun)
  appendUpToDate(lines, plan.upToDate)
  appendNextSteps(lines, outcome)
  return trimTrailingBlank(lines).join('\n')
}

function planManagedFile(plan: InitPlan, rel: string, contents: string): void {
  const absolute = path.join(plan.cwd, rel)
  const existing = readOptional(absolute)
  if (existing === null) {
    plan.actions.push({
      path: rel,
      label: rel,
      kind: 'create',
      write: () => writeFileCreatingParents(absolute, contents),
    })
  } else if (existing === contents) {
    plan.upToDate.push(rel)
  } else {
    plan.leftAlone.push({ path: rel, detail: 'differs from the template, as expected' })
  }
}

function planPackageJson(
  plan: InitPlan,
  original: string,
  mutation: ReturnType<typeof mutatePackageJsonScripts>,
): void {
  if (mutation.changed.length === 0) {
    if (mutation.conflicts.length === 0) plan.upToDate.push('package.json scripts')
    return
  }
  if (mutation.conflicts.length > 0) return
  plan.actions.push({
    path: 'package.json',
    label: 'package.json (scripts)',
    kind: 'update',
    detail: `scripts: ${mutation.changed.join(', ')}`,
    notice: mutation.note ?? undefined,
    write: () => {
      if (fs.readFileSync(path.join(plan.cwd, 'package.json'), 'utf8') !== original) {
        throw new Error('package.json changed after planning; re-run init')
      }
      fs.writeFileSync(path.join(plan.cwd, 'package.json'), mutation.raw)
    },
  })
}

function planGitignore(plan: InitPlan, snippet: string): void {
  const rel = '.gitignore'
  const absolute = path.join(plan.cwd, rel)
  const existing = readOptional(absolute)
  const lines = snippet.split(/\r?\n/).filter((line) => line.length > 0)
  const existingLines = existing?.split(/\r?\n/) ?? []
  const missing = lines.filter((line) => !existingLines.includes(line))
  const missingEntryCount = missing.filter((line) => !line.trimStart().startsWith('#')).length
  if (missing.length === 0) {
    plan.upToDate.push('.gitignore')
    return
  }
  plan.actions.push({
    path: rel,
    label: `.gitignore (+${missingEntryCount} entries)`,
    kind: existing === null ? 'create' : 'update',
    detail: `+${missingEntryCount} entries`,
    write: () => {
      const current = readOptional(absolute)
      if (current === null) {
        writeFileCreatingParents(absolute, snippet.endsWith('\n') ? snippet : snippet + '\n')
        return
      }
      const prefix = current.length === 0 || current.endsWith('\n') ? current : current + '\n'
      fs.writeFileSync(absolute, prefix + missing.join('\n') + '\n')
    },
  })
}

function planSkill(plan: InitPlan, contents: string): void {
  const destination = resolveSkillDestination(plan.cwd)
  if (destination.symlinkNotice) plan.notices.push(destination.symlinkNotice)
  const rel = '.claude/skills/shots-harness/SKILL.md'
  const absolute = path.join(plan.cwd, rel)
  const existing = readOptional(absolute)
  if (existing === null) {
    plan.actions.push({
      path: rel,
      label: destination.displayPath,
      kind: 'create',
      write: () => writeFileCreatingParents(absolute, contents),
    })
  } else if (existing === contents) {
    plan.upToDate.push(rel)
  } else {
    const newRel = rel + '.new'
    const newAbsolute = path.join(plan.cwd, newRel)
    const newExisting = readOptional(newAbsolute)
    if (newExisting === contents) {
      plan.needsReview.push({
        path: newRel,
        detail: 'your SKILL.md differs and was not overwritten; compare and merge if you want the updated guidance',
      })
    } else if (newExisting === null) {
      plan.actions.push({
        path: newRel,
        label: newRel,
        kind: 'create',
        write: () => writeFileCreatingParents(newAbsolute, contents),
      })
      plan.needsReview.push({
        path: newRel,
        detail: 'your SKILL.md differs and was not overwritten; compare and merge if you want the updated guidance',
      })
    } else {
      plan.needsReview.push({
        path: `${rel} and ${newRel}`,
        detail: 'both differ from the packaged guidance; neither was overwritten',
      })
    }
  }
}

function formatHeadline(outcome: InitOutcome): string {
  switch (outcome.kind) {
    case 'dry-run':
      return 'shotwright init: dry run'
    case 'partial-write-failure':
      return 'shotwright init: failed partway through — the scaffold is incomplete'
    case 'script-conflict':
      return `shotwright init: cannot claim the \`${outcome.scriptName}\` script`
    case 'fresh-vite-scaffold':
      return 'shotwright init: detected vite — wrote an executable webServer default for http://127.0.0.1:5173'
    case 'fresh-placeholder-scaffold':
      return 'shotwright init: wrote scaffold with a commented webServer placeholder'
    case 'partial-update':
      return 'shotwright init: updated scaffold'
    case 'nothing-changed-review-pending':
      return `shotwright init: no changes — ${outcome.reviewCount} ${pluralize('file', outcome.reviewCount)} ${outcome.reviewCount === 1 ? 'needs' : 'need'} your review`
    case 'nothing-changed':
      return 'shotwright init: already set up — nothing to change'
    default:
      return assertNever(outcome)
  }
}

function formatInitFailure(result: InitResult, outcome: Extract<InitOutcome, { kind: 'partial-write-failure' }>): string {
  const lines = [
    formatHeadline(outcome),
    '',
    'Error',
    `  ${formatError(result.error)}`,
    '',
  ]
  appendActionNotices(lines, result.written)
  appendActionSection(lines, 'Written before the failure', result.written)
  const failedIndex = result.plan.actions.indexOf(result.failedAction!)
  appendActionSection(lines, 'Not written', result.plan.actions.slice(failedIndex))
  lines.push('')
  lines.push('Fix the error and re-run `pnpm exec shotwright init` — it will skip what already exists.')
  return trimTrailingBlank(lines).join('\n')
}

function appendActionSection(lines: string[], title: string, actions: InitAction[]): void {
  if (actions.length === 0) return
  lines.push('', title)
  for (const action of actions) lines.push(`  ${action.label}`)
}

function appendReportSection(lines: string[], title: string, reports: InitReportLine[]): void {
  if (reports.length === 0) return
  lines.push('', title)
  for (const report of reports) lines.push(`  ${report.path.padEnd(26)} ${report.detail}`)
}

function appendNeedsReview(lines: string[], reports: InitReportLine[], dryRun: boolean): void {
  if (reports.length === 0) return
  lines.push('', dryRun ? 'Would need your review' : 'Needs your review')
  for (const report of reports) {
    lines.push(`  ${report.path}`)
    lines.push(`    ${report.detail}`)
  }
}

function appendUpToDate(lines: string[], entries: string[]): void {
  if (entries.length === 0) return
  lines.push('', 'Up to date')
  lines.push(`  ${entries.join(', ')}`)
}

function appendConflicts(lines: string[], conflicts: ScriptConflict[]): void {
  if (conflicts.length === 0) return
  for (const conflict of conflicts) {
    lines.push('')
    lines.push('  package.json already defines:')
    lines.push(`      "${conflict.name}": "${conflict.actual}"`)
    lines.push('  shotwright did not change it.')
    lines.push('')
    lines.push('  Rename your existing script, or run captures with `pnpm exec shotwright run`.')
  }
}

function appendNextSteps(lines: string[], outcome: InitOutcome): void {
  const nextSteps = initOutcomeNextSteps(outcome)
  if (nextSteps === null) return
  lines.push('')
  lines.push('Next steps')
  if (nextSteps === 'vite') {
    lines.push('  1. pnpm shots:install     # download the browser (one time)')
    lines.push('  2. pnpm shots')
    lines.push('  3. pnpm shots:gallery')
  } else {
    lines.push('  1. Edit shots.config.ts - uncomment and set webServer for your app')
    lines.push('  2. pnpm shots:install     # download the browser (one time)')
    lines.push('  3. pnpm shots')
    lines.push('  4. pnpm shots:gallery')
  }
}

function initOutcomeExitCode(outcome: InitOutcome): number {
  switch (outcome.kind) {
    case 'dry-run':
      return 0
    case 'partial-write-failure':
    case 'script-conflict':
      return outcome.exitCode
    case 'fresh-vite-scaffold':
    case 'fresh-placeholder-scaffold':
    case 'partial-update':
    case 'nothing-changed-review-pending':
    case 'nothing-changed':
      return outcome.exitCode
    default:
      return assertNever(outcome)
  }
}

function initOutcomeNextSteps(outcome: InitOutcome): InitNextSteps | null {
  switch (outcome.kind) {
    case 'dry-run':
    case 'fresh-vite-scaffold':
    case 'fresh-placeholder-scaffold':
    case 'partial-update':
      return outcome.nextSteps
    case 'partial-write-failure':
    case 'script-conflict':
    case 'nothing-changed-review-pending':
    case 'nothing-changed':
      return null
    default:
      return assertNever(outcome)
  }
}

function appendNotices(lines: string[], notices: string[]): void {
  for (const notice of notices) {
    lines.push('')
    for (const line of notice.split('\n')) lines.push(line)
  }
}

function appendActionNotices(lines: string[], actions: InitAction[]): void {
  appendNotices(
    lines,
    actions.map((action) => action.notice).filter((notice): notice is string => notice !== undefined),
  )
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`
}

function detectJsonIndent(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(\s+)"/.exec(line)
    if (match?.[1]) return match[1]
  }
  return null
}

function readOptional(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

function writeFileCreatingParents(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

function hasOwnPackage(value: unknown, key: string): boolean {
  return isObject(value) && Object.hasOwn(value, key)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}

function relativePath(cwd: string, file: string): string {
  const relative = path.relative(cwd, file)
  return relative.length > 0 && !relative.startsWith('..') ? relative : file
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function assertNever(value: never): never {
  throw new Error(`unhandled init outcome: ${JSON.stringify(value)}`)
}

function trimTrailingBlank(lines: string[]): string[] {
  while (lines.at(-1) === '') lines.pop()
  return lines
}
