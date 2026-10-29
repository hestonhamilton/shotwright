// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'

export interface InitArgs {
  dryRun: boolean
  packageManager?: PackageManager
}

export interface SkillDestination {
  displayPath: string
  symlinkNotice: string | null
}

export interface InitPlan {
  cwd: string
  root: string
  manager: PackageManager
  vite: boolean
  actions: InitAction[]
  leftAlone: InitReportLine[]
  needsReview: InitReportLine[]
  upToDate: string[]
  conflicts: ScriptConflict[]
  addedScripts: string[]
  matchedScripts: string[]
  skillDeferred: boolean
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
  | {
      kind: 'script-conflict'
      scriptName: string
      dryRun: boolean
      nextSteps: InitNextSteps
      exitCode: 1
    }
  | { kind: 'fresh-vite-scaffold'; nextSteps: 'vite'; exitCode: 0 }
  | { kind: 'fresh-placeholder-scaffold'; nextSteps: 'placeholder'; exitCode: 0 }
  | { kind: 'partial-update'; nextSteps: InitNextSteps; exitCode: 0 }
  | { kind: 'nothing-changed-review-pending'; reviewCount: number; exitCode: 0 }
  | { kind: 'nothing-changed'; exitCode: 0 }

type InitNextSteps = 'vite' | 'placeholder'
type PackageManager = 'npm' | 'pnpm' | 'yarn'

export interface DesiredScripts {
  shots: string
  'shots:gallery': string
  'shots:compare': string
  'shots:install': string
}

const INIT_USAGE = 'Usage: shotwright init [--dry-run] [--package-manager npm|pnpm|yarn]'
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
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!
    if (argument === '--dry-run') {
      args.dryRun = true
    } else if (argument === '--package-manager') {
      const value = argv[++i]
      if (value !== 'npm' && value !== 'pnpm' && value !== 'yarn')
        throw new Error(`invalid package manager: ${value ?? '(missing)'}\n${INIT_USAGE}`)
      args.packageManager = value
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
): {
  raw: string
  changed: string[]
  matched: string[]
  conflicts: ScriptConflict[]
  note: string | null
} {
  const pkg = JSON.parse(raw) as unknown
  if (!isObject(pkg)) throw new Error('package.json must contain a JSON object')

  const newline = raw.endsWith('\n') ? '\n' : ''
  const indent = detectJsonIndent(raw)
  const note =
    indent === null ? 'package.json had no indented property lines; using 2-space indent' : null
  const indentString = indent ?? '  '
  const scripts = isObject(pkg.scripts) ? pkg.scripts : {}
  const conflicts: ScriptConflict[] = []
  const changed: string[] = []
  const matched: string[] = []

  for (const [name, command] of Object.entries(desired)) {
    const actual = scripts[name]
    if (actual === undefined) {
      scripts[name] = command
      changed.push(name)
    } else if (actual !== command) {
      conflicts.push({ name, actual: String(actual) })
    } else {
      matched.push(name)
    }
  }

  if (!isObject(pkg.scripts) && changed.length > 0) {
    pkg.scripts = scripts
  }

  if (changed.length === 0) return { raw, changed, matched, conflicts, note }
  return {
    raw: JSON.stringify(pkg, null, indentString) + newline,
    changed,
    matched,
    conflicts,
    note,
  }
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

export function findGitRoot(cwd: string): string {
  let current = fs.realpathSync(cwd)
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error(
        'shotwright init: no containing Git root found; run init inside a Git repository',
      )
    }
    current = parent
  }
}

export function detectPackageManager(
  cwd: string,
  pkg: unknown,
  explicit?: PackageManager,
): PackageManager {
  if (explicit) return explicit
  const locks: Record<PackageManager, string> = {
    npm: 'package-lock.json',
    pnpm: 'pnpm-lock.yaml',
    yarn: 'yarn.lock',
  }
  const found = (Object.keys(locks) as PackageManager[]).filter((key) =>
    fs.existsSync(path.join(cwd, locks[key])),
  )
  const declaration =
    isObject(pkg) && typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : ''
  if (declaration && declaration !== 'npm' && declaration !== 'pnpm' && declaration !== 'yarn') {
    throw new Error(`shotwright init: unsupported packageManager ${declaration}`)
  }
  if (found.length > 1)
    throw new Error('shotwright init: ambiguous package-manager lockfiles; pass --package-manager')
  if (declaration && found.length === 1 && declaration !== found[0]) {
    throw new Error(
      'shotwright init: packageManager conflicts with lockfile; pass --package-manager',
    )
  }
  const agent = process.env.npm_config_user_agent?.split('/')[0]
  const inferred =
    (declaration as PackageManager) ||
    found[0] ||
    (agent === 'npm' || agent === 'pnpm' || agent === 'yarn' ? agent : null)
  if (!inferred)
    throw new Error('shotwright init: no package manager found; pass --package-manager')
  return inferred
}

export function planInit(
  cwd: string,
  loadTemplate: (rel: string) => string,
  explicitManager?: PackageManager,
): InitPlan {
  const packagePath = path.join(cwd, 'package.json')
  let packageRaw: string
  try {
    packageRaw = fs.readFileSync(packagePath, 'utf8')
  } catch (error) {
    if (isNotFound(error))
      throw new Error('shotwright init: package.json not found', { cause: error })
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

  const root = findGitRoot(cwd)
  const manager = detectPackageManager(cwd, packageJson, explicitManager)
  const vite = detectVite(packageJson)
  const config = loadTemplate('init/shots.config.ts').replace(
    '  // {{webServerBlock}}',
    (vite ? viteWebServerBlock : placeholderWebServerBlock).replace(
      'pnpm exec vite',
      `${managerExec(manager)} vite`,
    ),
  )
  const example = loadTemplate('init/shots/example.shots.ts')
  const workingDirectory =
    path.relative(root, fs.realpathSync(cwd)).split(path.sep).join('/') || '.'
  const ciWorkflow = loadTemplate('github/shotwright.yml')
    .replace(
      'working-directory: .',
      `working-directory: ${workingDirectory === '.' ? '.' : JSON.stringify(workingDirectory)}`,
    )
    .replace('package-manager: pnpm', `package-manager: ${manager}`)
  const gitignoreSnippet = loadTemplate('init/gitignore.snippet')
  const skill = renderSkill(loadTemplate('skills/shots-harness/SKILL.md'), manager)
  const plan: InitPlan = {
    cwd,
    root,
    manager,
    vite,
    actions: [],
    leftAlone: [],
    needsReview: [],
    upToDate: [],
    conflicts: packageMutation.conflicts,
    addedScripts: packageMutation.changed,
    matchedScripts: packageMutation.matched,
    skillDeferred: packageMutation.conflicts.some((conflict) => conflict.name === 'shots'),
    notices: [],
  }
  const declaredManager =
    isObject(packageJson) && typeof packageJson.packageManager === 'string'
      ? packageJson.packageManager.split('@')[0]
      : ''
  if (explicitManager && declaredManager && explicitManager !== declaredManager) {
    plan.notices.push(
      'Note: --package-manager ' +
        explicitManager +
        ' overrides package.json packageManager ' +
        declaredManager +
        '.',
    )
  }
  assertContained(root, cwd)
  planManagedFile(plan, 'shots.config.ts', config)
  planManagedFile(plan, 'shots/example.shots.ts', example)
  planManagedFile(plan, '.github/workflows/shotwright.yml', ciWorkflow, root)
  planPackageJson(plan, packageRaw, packageMutation)
  planGitignore(plan, gitignoreSnippet)
  if (!plan.skillDeferred) planSkill(plan, skill)
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
  if (result.failedAction) return { kind: 'partial-write-failure', exitCode: 1 }
  if (plan.conflicts.length > 0) {
    return {
      kind: 'script-conflict',
      scriptName: plan.conflicts[0]!.name,
      dryRun: result.dryRun,
      nextSteps,
      exitCode: 1,
    }
  }
  if (result.dryRun) return { kind: 'dry-run', nextSteps }
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

export function formatInitResult(
  result: InitResult,
  options: { omitNotices?: boolean } = {},
): string {
  const outcome = classifyInitOutcome(result)
  if (outcome.kind === 'partial-write-failure') return formatInitFailure(result, outcome)
  const lines: string[] = []
  const { plan } = result
  lines.push(formatHeadline(outcome))
  if (!options.omitNotices) appendNotices(lines, plan.notices)
  appendActionNotices(lines, result.dryRun ? plan.actions : result.written)
  appendConflicts(lines, plan.conflicts, plan.manager)
  if (plan.skillDeferred)
    lines.push(
      '',
      'Deferred',
      '  .claude/skills/shots-harness/SKILL.md (until the shots script conflict is resolved)',
    )

  if (result.dryRun) {
    appendActionSection(
      lines,
      'Would create',
      plan.actions.filter((action) => action.kind === 'create'),
    )
    appendActionSection(
      lines,
      'Would update',
      plan.actions.filter((action) => action.kind === 'update'),
    )
    appendReportSection(lines, 'Would leave alone (yours)', plan.leftAlone)
  } else {
    appendActionSection(
      lines,
      'Created',
      result.written.filter((action) => action.kind === 'create'),
    )
    appendActionSection(
      lines,
      'Updated',
      result.written.filter((action) => action.kind === 'update'),
    )
    appendReportSection(lines, 'Left alone (yours)', plan.leftAlone)
  }

  appendNeedsReview(lines, plan.needsReview, result.dryRun)
  appendUpToDate(lines, plan.upToDate)
  if (outcome.kind === 'script-conflict') {
    lines.push(
      '',
      result.dryRun
        ? `Setup would remain incomplete. Resolve the skipped script conflict and re-run \`${managerExec(plan.manager)} shotwright init\`; existing scaffold files and scripts would be skipped safely.`
        : `Setup remains incomplete. Resolve the skipped script conflict and re-run \`${managerExec(plan.manager)} shotwright init\`; existing scaffold files and scripts will be skipped safely.`,
    )
    if (result.dryRun && plan.actions.length === 0)
      lines.push('  No files or scripts would be written.')
    if (!result.dryRun)
      lines.push(
        result.written.length > 0
          ? '  The files and scripts listed under Created and Updated were written.'
          : '  No files or scripts were written.',
      )
  }
  appendNextSteps(lines, outcome, result)
  return trimTrailingBlank(lines).join('\n')
}

function planManagedFile(plan: InitPlan, rel: string, contents: string, base = plan.cwd): void {
  const absolute = path.join(base, rel)
  assertContained(plan.root, absolute)
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
  if (
    mutation.matched.length > 0 &&
    (mutation.changed.length > 0 || mutation.conflicts.length > 0)
  ) {
    plan.upToDate.push(`scripts: ${mutation.matched.join(', ')}`)
  }
  if (mutation.changed.length === 0) {
    if (mutation.conflicts.length === 0) plan.upToDate.push('package.json scripts')
    return
  }
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
  const destination = resolveSkillDestination(plan.root)
  assertContained(plan.root, path.join(plan.root, '.claude/skills/shots-harness/SKILL.md'))
  if (destination.symlinkNotice) plan.notices.push(destination.symlinkNotice)
  const rel = '.claude/skills/shots-harness/SKILL.md'
  const absolute = path.join(plan.root, rel)
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
    const newAbsolute = path.join(plan.root, newRel)
    const newExisting = readOptional(newAbsolute)
    if (newExisting === contents) {
      plan.needsReview.push({
        path: newRel,
        detail:
          'your SKILL.md differs and was not overwritten; compare and merge if you want the updated guidance',
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
        detail:
          'your SKILL.md differs and was not overwritten; compare and merge if you want the updated guidance',
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
      return `shotwright init: ${outcome.dryRun ? 'dry run — ' : ''}cannot claim the \`${outcome.scriptName}\` script`
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

function formatInitFailure(
  result: InitResult,
  outcome: Extract<InitOutcome, { kind: 'partial-write-failure' }>,
): string {
  const lines = [formatHeadline(outcome), '', 'Error', `  ${formatError(result.error)}`, '']
  appendActionNotices(lines, result.written)
  appendActionSection(lines, 'Written before the failure', result.written)
  const failedIndex = result.plan.actions.indexOf(result.failedAction!)
  appendActionSection(lines, 'Not written', result.plan.actions.slice(failedIndex))
  appendConflicts(lines, result.plan.conflicts, result.plan.manager)
  lines.push('')
  lines.push(
    `Fix the error and re-run \`${managerExec(result.plan.manager)} shotwright init\` — it will skip what already exists.`,
  )
  return trimTrailingBlank(lines).join('\n')
}

function appendActionSection(lines: string[], title: string, actions: InitAction[]): void {
  if (actions.length === 0) return
  lines.push('', title)
  for (const action of actions) {
    lines.push(`  ${action.label}`)
    if (action.path === 'package.json' && action.detail) lines.push(`    ${action.detail}`)
  }
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

function appendConflicts(
  lines: string[],
  conflicts: ScriptConflict[],
  manager: PackageManager,
): void {
  if (conflicts.length === 0) return
  for (const conflict of conflicts) {
    lines.push('')
    lines.push(`Skipped (existing command differs): ${conflict.name}`)
    lines.push('  package.json already defines:')
    lines.push(`      "${conflict.name}": "${conflict.actual}"`)
    lines.push('  shotwright did not change it.')
    lines.push('')
    lines.push(
      `  Rename your existing script, or run captures with \`${managerExec(manager)} shotwright run\`.`,
    )
  }
}

function appendNextSteps(lines: string[], outcome: InitOutcome, result: InitResult): void {
  const nextSteps = initOutcomeNextSteps(outcome)
  if (nextSteps === null) return
  const { plan } = result
  const available = new Set(plan.matchedScripts)
  if (result.dryRun || result.written.some((action) => action.path === 'package.json')) {
    for (const name of plan.addedScripts) available.add(name)
  }
  const steps: string[] = []
  if (nextSteps !== 'vite')
    steps.push('Edit shots.config.ts - uncomment and set webServer for your app')
  if (available.has('shots:install'))
    steps.push(`${managerRun(plan.manager, 'shots:install')}     # download the browser (one time)`)
  if (available.has('shots')) steps.push(managerRun(plan.manager, 'shots'))
  if (available.has('shots:gallery')) steps.push(managerRun(plan.manager, 'shots:gallery'))
  if (steps.length === 0) return
  lines.push('')
  lines.push('Next steps')
  for (const [index, step] of steps.entries()) lines.push(`  ${index + 1}. ${step}`)
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
    case 'script-conflict':
    case 'fresh-vite-scaffold':
    case 'fresh-placeholder-scaffold':
    case 'partial-update':
      return outcome.nextSteps
    case 'partial-write-failure':
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
    actions
      .map((action) => action.notice)
      .filter((notice): notice is string => notice !== undefined),
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

function managerExec(manager: PackageManager): string {
  return manager === 'npm' ? 'npm exec --' : manager === 'pnpm' ? 'pnpm exec' : 'yarn'
}

function managerRun(manager: PackageManager, script: string): string {
  return manager === 'npm' ? `npm run ${script}` : `${manager} ${script}`
}

function renderSkill(template: string, manager: PackageManager): string {
  if (manager === 'pnpm') return template
  if (manager === 'yarn')
    return template.replaceAll('pnpm exec ', 'yarn ').replaceAll('pnpm shots', 'yarn shots')
  return template
    .replaceAll('pnpm exec ', 'npm exec -- ')
    .replaceAll('pnpm shots --only', 'npm run shots -- --only')
    .replaceAll('pnpm shots --video', 'npm run shots -- --video')
    .replaceAll('pnpm shots:gallery --lan', 'npm run shots:gallery -- --lan')
    .replaceAll('pnpm shots:compare latest', 'npm run shots:compare -- latest')
    .replaceAll('pnpm shots:compare <', 'npm run shots:compare -- <')
    .replaceAll('pnpm shots', 'npm run shots')
}

function assertContained(root: string, target: string): void {
  let ancestor = target
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const resolved = fs.realpathSync(ancestor)
  const relative = path.relative(fs.realpathSync(root), resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('shotwright init: destination resolves outside the containing Git root')
  }
}
