import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseCompareArgs, parseGalleryArgs, parseRunArgs } from '../../src/cli.js'
import {
  applyInitPlan,
  classifyInitOutcome,
  dryRunInitPlan,
  formatInitResult,
  initExitCode,
  mutatePackageJsonScripts,
  parseInitArgs,
  planInit,
  resolveSkillDestination,
  type InitAction,
  type InitResult,
  type InitPlan,
} from '../../src/init.js'
import { readTemplate, templateUrl } from '../../src/templates.js'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('parseInitArgs', () => {
  it('accepts the planned surface', () => {
    expect(parseInitArgs([])).toEqual({ dryRun: false })
    expect(parseInitArgs(['--dry-run'])).toEqual({ dryRun: true })
  })

  it('rejects unknown flags including --force', () => {
    expect(() => parseInitArgs(['--force'])).toThrow(/unknown argument: --force/)
    expect(() => parseInitArgs(['--nope'])).toThrow(/Usage: shotwright init/)
  })
})

describe('templates', () => {
  it('resolves init templates adjacent to dist from the module URL', () => {
    expect(templateUrl('init/shots.config.ts').href).toMatch(/\/templates\/init\/shots\.config\.ts$/)
    expect(templateUrl('github/shotwright.yml').href).toMatch(/\/templates\/github\/shotwright\.yml$/)
    expect(templateUrl('init/shots.config.ts').href).not.toContain('/dist/templates/')
  })

  it('keeps generated command strings parseable by the real parsers', () => {
    expect(parseShotwrightCommand('pnpm shots')).toEqual(parseRunArgs([]))
    expect(parseShotwrightCommand('pnpm shots --only home')).toMatchObject({ only: 'home' })
    expect(parseShotwrightCommand('pnpm shots --video --trace')).toMatchObject({
      video: true,
      trace: true,
      passthrough: [],
    })
    expect(parseShotwrightCommand('pnpm shots -- --workers=1')).toMatchObject({
      passthrough: ['--workers=1'],
    })
    expect(parseShotwrightCommand('pnpm shots --video -- --workers=1')).toMatchObject({
      video: true,
      passthrough: ['--workers=1'],
    })
    expect(parseGalleryCommand('pnpm shots:gallery')).toEqual(parseGalleryArgs([]))
    expect(parseGalleryCommand('pnpm shots:gallery --lan')).toMatchObject({ lan: true })
    expect(() => parseGalleryCommand('pnpm shots:gallery -- --lan')).toThrow(/unknown argument: --/)

    const skill = readTemplate('skills/shots-harness/SKILL.md')
    for (const command of fencedCommands(skill)) {
      if (command.startsWith('pnpm shots ')) parseShotwrightCommand(command)
      if (command.startsWith('pnpm shots:gallery')) parseGalleryCommand(command)
    }

  })
})

describe('InitOutcome output coherence', () => {
  const cases: {
    name: string
    result: () => InitResult
    outcome: ReturnType<typeof classifyInitOutcome>['kind']
    headline: string
    exitCode: number
    sections: string[]
    absent: string[]
    includes?: string[]
    commands: string[]
  }[] = [
    {
      name: 'fresh vite scaffold',
      result: () => applyInitPlan(planInit(fixture({ packageJson: { devDependencies: { vite: '~8.1.5' } } }), readTemplate)),
      outcome: 'fresh-vite-scaffold',
      headline:
        'shotwright init: detected vite — wrote an executable webServer default for http://127.0.0.1:5173',
      exitCode: 0,
      sections: ['Created', 'Updated', 'Next steps'],
      absent: ['Edit shots.config.ts', 'Needs your review'],
      includes: ['.gitignore (+3 entries)'],
      commands: ['pnpm shots:install', 'pnpm shots', 'pnpm shots:gallery'],
    },
    {
      name: 'fresh non-vite placeholder scaffold',
      result: () => applyInitPlan(planInit(fixture({ packageJson: {} }), readTemplate)),
      outcome: 'fresh-placeholder-scaffold',
      headline: 'shotwright init: wrote scaffold with a commented webServer placeholder',
      exitCode: 0,
      sections: ['Created', 'Updated', 'Next steps'],
      absent: ['detected vite', 'Needs your review', '.gitignore (+4 entries)'],
      includes: ['.gitignore (+3 entries)'],
      commands: ['pnpm shots:install', 'pnpm shots', 'pnpm shots:gallery'],
    },
    {
      name: 'partial update',
      result: () => applyInitPlan(planInit(partialUpdateFixture({ vite: false }), readTemplate)),
      outcome: 'partial-update',
      headline: 'shotwright init: updated scaffold',
      exitCode: 0,
      sections: ['Updated', 'Up to date', 'Next steps'],
      absent: ['Created', 'Needs your review', 'cannot claim'],
      commands: ['pnpm shots:install', 'pnpm shots', 'pnpm shots:gallery'],
    },
    {
      name: 'nothing changed',
      result: () => {
        const cwd = fixture({ packageJson: {} })
        applyInitPlan(planInit(cwd, readTemplate))
        return applyInitPlan(planInit(cwd, readTemplate))
      },
      outcome: 'nothing-changed',
      headline: 'shotwright init: already set up — nothing to change',
      exitCode: 0,
      sections: ['Up to date'],
      absent: ['Next steps', 'Needs your review', 'updated scaffold'],
      commands: [],
    },
    {
      name: 'nothing changed but review pending',
      result: () => {
        const cwd = fixture({ packageJson: {} })
        applyInitPlan(planInit(cwd, readTemplate))
        const skill = path.join(cwd, '.claude', 'skills', 'shots-harness', 'SKILL.md')
        fs.writeFileSync(skill, 'project skill')
        fs.writeFileSync(skill + '.new', readTemplate('skills/shots-harness/SKILL.md'))
        return applyInitPlan(planInit(cwd, readTemplate))
      },
      outcome: 'nothing-changed-review-pending',
      headline: 'shotwright init: no changes — 1 file needs your review',
      exitCode: 0,
      sections: ['Needs your review', 'Up to date'],
      absent: ['Next steps', 'already set up — nothing to change'],
      commands: [],
    },
    {
      name: 'script conflict',
      result: () =>
        applyInitPlan(planInit(fixture({ packageJson: { scripts: { shots: 'playwright test' } } }), readTemplate)),
      outcome: 'script-conflict',
      headline: 'shotwright init: cannot claim the `shots` script',
      exitCode: 1,
      sections: ['Created'],
      absent: ['Next steps', 'Not attempted', 'already set up'],
      commands: ['pnpm exec shotwright run'],
    },
    {
      name: 'partial write failure',
      result: () => {
        const cwd = fixture({ packageJson: {} })
        const plan = planInit(cwd, readTemplate)
        plan.actions[1] = {
          ...plan.actions[1]!,
          write: () => {
            throw new Error("EACCES: permission denied, open 'shots/example.shots.ts'")
          },
        }
        return applyInitPlan(plan)
      },
      outcome: 'partial-write-failure',
      headline: 'shotwright init: failed partway through — the scaffold is incomplete',
      exitCode: 1,
      sections: ['Error', 'Written before the failure', 'Not written'],
      absent: ['Next steps', 'Not attempted', 'already set up'],
      commands: ['pnpm exec shotwright init'],
    },
    {
      name: 'dry run',
      result: () => dryRunInitPlan(planInit(fixture({ packageJson: {} }), readTemplate)),
      outcome: 'dry-run',
      headline: 'shotwright init: dry run',
      exitCode: 0,
      sections: ['Would create', 'Would update', 'Next steps'],
      absent: ['Created', 'Updated', 'Needs your review'],
      commands: ['pnpm shots:install', 'pnpm shots', 'pnpm shots:gallery'],
    },
  ]

  it.each(cases)(
    '$name',
    ({ result: makeResult, outcome, headline, exitCode, sections, absent, includes = [], commands }) => {
      const result = makeResult()
      const output = formatInitResult(result)
      expect(classifyInitOutcome(result).kind).toBe(outcome)
      expect(initExitCode(result)).toBe(exitCode)
      expect(output.split('\n')[0]).toBe(headline)
      for (const section of sections) expect(sectionTitles(output)).toContain(section)
      for (const text of includes) expect(output).toContain(text)
      for (const text of absent) expect(output).not.toContain(text)

      const outputCommands = pnpmCommands(output)
      expect(outputCommands).toEqual(expect.arrayContaining(commands))
      for (const command of outputCommands) assertGeneratedCommandParses(command)
    },
  )
})

describe('planInit', () => {
  it('renders an executable vite webServer with strictPort and no separator', () => {
    const cwd = fixture({ packageJson: { devDependencies: { vite: '~8.1.5' } } })
    const plan = planInit(cwd, readTemplate)
    applyInitPlan(plan)

    const config = fs.readFileSync(path.join(cwd, 'shots.config.ts'), 'utf8')
    expect(config).toContain("command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort'")
    expect(config).not.toContain('pnpm dev -- --host')
    expect(config).toContain('webServer: {')
  })

  it('renders a commented placeholder for non-vite projects', () => {
    const cwd = fixture({ packageJson: {} })
    const plan = planInit(cwd, readTemplate)
    applyInitPlan(plan)

    const config = fs.readFileSync(path.join(cwd, 'shots.config.ts'), 'utf8')
    expect(config).toContain('// Point these at the command and URL')
    expect(config).toContain("// webServer: {")
    expect(config).not.toContain('\n  webServer: {\n')
  })

  it('leaves differing config/spec files alone with exit 0', () => {
    const cwd = fixture({ packageJson: {} })
    fs.writeFileSync(path.join(cwd, 'shots.config.ts'), 'custom config')
    fs.mkdirSync(path.join(cwd, 'shots'))
    fs.writeFileSync(path.join(cwd, 'shots', 'example.shots.ts'), 'custom spec')

    const result = applyInitPlan(planInit(cwd, readTemplate))
    const output = formatInitResult(result)
    expect(initExitCode(result)).toBe(0)
    expect(output).toContain('Left alone (yours)')
    expect(output).toContain('shots.config.ts')
    expect(fs.readFileSync(path.join(cwd, 'shots.config.ts'), 'utf8')).toBe('custom config')
  })

  it('creates the GitHub workflow template as a managed file', () => {
    const cwd = fixture({ packageJson: {} })
    const result = applyInitPlan(planInit(cwd, readTemplate))
    const workflow = path.join(cwd, '.github', 'workflows', 'shotwright.yml')

    expect(result.written.map((action) => action.path)).toContain('.github/workflows/shotwright.yml')
    expect(fs.readFileSync(workflow, 'utf8')).toBe(readTemplate('github/shotwright.yml'))
  })

  it('reports the GitHub workflow up to date on rerun when unchanged', () => {
    const cwd = fixture({ packageJson: {} })
    applyInitPlan(planInit(cwd, readTemplate))

    const result = applyInitPlan(planInit(cwd, readTemplate))

    expect(result.written.map((action) => action.path)).not.toContain('.github/workflows/shotwright.yml')
    expect(result.plan.upToDate).toContain('.github/workflows/shotwright.yml')
  })

  it('leaves a consumer-edited GitHub workflow alone with exit 0', () => {
    const cwd = fixture({ packageJson: {} })
    const workflow = path.join(cwd, '.github', 'workflows', 'shotwright.yml')
    fs.mkdirSync(path.dirname(workflow), { recursive: true })
    fs.writeFileSync(workflow, 'name: Custom shots\n')

    const result = applyInitPlan(planInit(cwd, readTemplate))
    const output = formatInitResult(result)

    expect(initExitCode(result)).toBe(0)
    expect(output).toContain('Left alone (yours)')
    expect(output).toContain('.github/workflows/shotwright.yml')
    expect(fs.readFileSync(workflow, 'utf8')).toBe('name: Custom shots\n')
  })

  it('lists the GitHub workflow in dry-run output without writing it', () => {
    const cwd = fixture({ packageJson: {} })
    const result = dryRunInitPlan(planInit(cwd, readTemplate))
    const output = formatInitResult(result)

    expect(output).toContain('Would create')
    expect(output).toContain('.github/workflows/shotwright.yml')
    expect(fs.existsSync(path.join(cwd, '.github', 'workflows', 'shotwright.yml'))).toBe(false)
  })

  it('reports a taken shots script as exit 1 without changing package.json', () => {
    const cwd = fixture({ packageJson: { scripts: { shots: 'playwright test' } } })
    const before = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    const result = applyInitPlan(planInit(cwd, readTemplate))
    const output = formatInitResult(result)

    expect(initExitCode(result)).toBe(1)
    expect(output).toContain('cannot claim the `shots` script')
    expect(output).toContain('"shots": "playwright test"')
    expect(output).not.toContain('Next steps')
    expect(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).toBe(before)
  })

  it('does not report minified package indentation when scripts are conflicted', () => {
    const cwd = tempDir()
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"m","scripts":{"shots":"playwright test"}}')
    const before = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    const result = applyInitPlan(planInit(cwd, readTemplate))
    const output = formatInitResult(result)

    expect(initExitCode(result)).toBe(1)
    expect(output).toContain('cannot claim the `shots` script')
    expect(output).not.toContain('package.json had no indented property lines')
    expect(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).toBe(before)
  })

  it('reports minified package indentation when package.json is written', () => {
    const cwd = tempDir()
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"m"}')
    const result = applyInitPlan(planInit(cwd, readTemplate))
    const output = formatInitResult(result)

    expect(result.written.map((action) => action.path)).toContain('package.json')
    expect(output).toContain('package.json had no indented property lines; using 2-space indent')
  })

  it('does not report minified package indentation when an earlier write fails', () => {
    const cwd = tempDir()
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"m"}')
    const plan = planInit(cwd, readTemplate)
    plan.actions[0] = {
      ...plan.actions[0]!,
      write: () => {
        throw new Error('injected write failure')
      },
    }
    const result = applyInitPlan(plan)
    const output = formatInitResult(result)

    expect(result.written.map((action) => action.path)).not.toContain('package.json')
    expect(output).not.toContain('package.json had no indented property lines')
  })

  it('appends only missing gitignore lines and preserves newline boundaries', () => {
    const cwd = fixture({ packageJson: {} })
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/')
    applyInitPlan(planInit(cwd, readTemplate))
    expect(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe(
      'node_modules/\n# shotwright review artifacts — regenerated, never committed\nshots-output/\nplaywright-report/\ntest-results/\n',
    )

    const rerun = applyInitPlan(planInit(cwd, readTemplate))
    expect(rerun.written.map((action) => action.path)).not.toContain('.gitignore')
  })

  it('never overwrites a differing skill and writes .new once', () => {
    const cwd = fixture({ packageJson: {} })
    const skill = path.join(cwd, '.claude', 'skills', 'shots-harness', 'SKILL.md')
    fs.mkdirSync(path.dirname(skill), { recursive: true })
    fs.writeFileSync(skill, 'project skill')

    const result = applyInitPlan(planInit(cwd, readTemplate))
    expect(fs.readFileSync(skill, 'utf8')).toBe('project skill')
    expect(fs.readFileSync(skill + '.new', 'utf8')).toBe(readTemplate('skills/shots-harness/SKILL.md'))
    expect(formatInitResult(result)).toContain('Needs your review')

    const rerun = applyInitPlan(planInit(cwd, readTemplate))
    expect(rerun.written.map((action) => action.path)).not.toContain(
      '.claude/skills/shots-harness/SKILL.md.new',
    )
    expect(formatInitResult(rerun)).toContain('SKILL.md.new')
  })

  it('reports both skill paths when SKILL.md.new differs too', () => {
    const cwd = fixture({ packageJson: {} })
    const skill = path.join(cwd, '.claude', 'skills', 'shots-harness', 'SKILL.md')
    fs.mkdirSync(path.dirname(skill), { recursive: true })
    fs.writeFileSync(skill, 'project skill')
    fs.writeFileSync(skill + '.new', 'other new')

    const result = applyInitPlan(planInit(cwd, readTemplate))
    expect(result.written.map((action) => action.path)).not.toContain(
      '.claude/skills/shots-harness/SKILL.md.new',
    )
    expect(formatInitResult(result)).toContain('both differ from the packaged guidance')
  })

  it('reports symlinked skill destinations before writing through them', () => {
    const cwd = fixture({ packageJson: {} })
    fs.mkdirSync(path.join(cwd, '.agents', 'skills'), { recursive: true })
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true })
    fs.symlinkSync('../.agents/skills', path.join(cwd, '.claude', 'skills'))

    const destination = resolveSkillDestination(cwd)
    expect(destination.symlinkNotice).toContain('Note: .claude/skills is a symlink to .agents/skills')
    const result = applyInitPlan(planInit(cwd, readTemplate))
    const output = formatInitResult(result)
    expect(output.indexOf('Note: .claude/skills')).toBeLessThan(output.indexOf('Created'))
    expect(fs.existsSync(path.join(cwd, '.agents', 'skills', 'shots-harness', 'SKILL.md'))).toBe(true)
  })

})

describe('mutatePackageJsonScripts', () => {
  // Every subcommand the skill and README tell an agent to run must have a
  // script, and every script must name a subcommand the CLI actually parses.
  // compare was shipped without one (shotwright-746.18.33); an agent reading
  // the installed skill had no way to reach it.
  it('writes one script per documented subcommand, each parseable by the CLI', () => {
    const pkg = JSON.parse(mutatePackageJsonScripts('{\n  "name": "app"\n}\n').raw) as {
      scripts: Record<string, string>
    }
    expect(Object.keys(pkg.scripts)).toEqual(['shots', 'shots:gallery', 'shots:compare', 'shots:install'])
    expect(pkg.scripts['shots']).toBe('shotwright run')
    expect(pkg.scripts['shots:gallery']).toBe('shotwright gallery')
    expect(pkg.scripts['shots:compare']).toBe('shotwright compare')
    expect(parseCompareArgs(['latest', '20260101-000000'])).toMatchObject({ a: 'latest', b: '20260101-000000' })
  })

  it('creates scripts as the last key when absent', () => {
    const result = mutatePackageJsonScripts('{\n  "name": "app"\n}\n').raw
    expect(Object.keys(JSON.parse(result))).toEqual(['name', 'scripts'])
  })

  it('preserves missing trailing newline', () => {
    expect(mutatePackageJsonScripts('{\n  "name": "app"\n}').raw.endsWith('\n')).toBe(false)
  })

  it('uses 2-space indentation for minified JSON and reports it', () => {
    const result = mutatePackageJsonScripts('{"name":"app"}')
    expect(result.raw).toContain('\n  "scripts": {')
    expect(result.note).toMatch(/2-space indent/)
  })

  it('matches tab and 4-space indentation', () => {
    expect(mutatePackageJsonScripts('{\n\t"name": "app"\n}\n').raw).toContain('\n\t"scripts": {')
    expect(mutatePackageJsonScripts('{\n    "name": "app"\n}\n').raw).toContain(
      '\n    "scripts": {',
    )
  })

  it('rejects malformed or missing package.json before writes are planned', () => {
    const malformed = tempDir()
    fs.writeFileSync(path.join(malformed, 'package.json'), '{"name":')
    expect(() => planInit(malformed, readTemplate)).toThrow(/could not parse package\.json/)
    expect(fs.readdirSync(malformed)).toEqual(['package.json'])

    const missing = tempDir()
    expect(() => planInit(missing, readTemplate)).toThrow(/package\.json not found/)
    expect(fs.readdirSync(missing)).toEqual([])
  })
})

describe('applyInitPlan', () => {
  it('records completed writes before an injected failure and never reports success', () => {
    const actions: InitAction[] = [
      { path: 'one', label: 'one', kind: 'create', write: () => undefined },
      {
        path: 'two',
        label: 'two',
        kind: 'create',
        write: () => {
          throw new Error("EACCES: permission denied, open 'two'")
        },
      },
      { path: 'three', label: 'three', kind: 'create', write: () => undefined },
    ]
    const plan: InitPlan = {
      cwd: tempDir(),
      vite: false,
      actions,
      leftAlone: [],
      needsReview: [],
      upToDate: [],
      conflicts: [],
      notices: [],
    }

    const result = applyInitPlan(plan)
    const output = formatInitResult(result)
    expect(result.written.map((action) => action.path)).toEqual(['one'])
    expect(output).toContain('failed partway through')
    expect(output).toContain('Written before the failure')
    expect(output).toContain('Not written')
    expect(output).not.toContain('Not attempted')
    expect(output).toContain('two')
    expect(output).toContain('three')
    expect(output).not.toContain('Next steps')
  })
})

function fixture(options: { packageJson: Record<string, unknown> }): string {
  const root = tempDir()
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'app', ...options.packageJson }, null, 2) + '\n',
  )
  return root
}

function partialUpdateFixture(options: { vite: boolean }): string {
  const cwd = fixture({
    packageJson: options.vite ? { devDependencies: { vite: '~8.1.5' } } : {},
  })
  const plan = planInit(cwd, readTemplate)
  applyInitPlan(plan)
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  delete pkg.scripts
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  return cwd
}

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-init-test-'))
  tempRoots.push(root)
  return root
}

function parseShotwrightCommand(command: string): ReturnType<typeof parseRunArgs> {
  const tokens = command.split(/\s+/)
  expect(tokens.slice(0, 2)).toEqual(['pnpm', 'shots'])
  return parseRunArgs(tokens.slice(2))
}

function parseGalleryCommand(command: string): ReturnType<typeof parseGalleryArgs> {
  const tokens = command.split(/\s+/)
  expect(tokens[0]).toBe('pnpm')
  expect(tokens[1]).toBe('shots:gallery')
  return parseGalleryArgs(tokens.slice(2))
}

function parseExecShotwrightCommand(command: string): void {
  const tokens = command.split(/\s+/)
  expect(tokens.slice(0, 3)).toEqual(['pnpm', 'exec', 'shotwright'])
  const [commandName, ...argv] = tokens.slice(3)
  if (commandName === 'run') {
    parseRunArgs(argv)
  } else if (commandName === 'gallery') {
    expect(argv).not.toContain('--')
    parseGalleryArgs(argv)
  } else if (commandName === 'init') {
    parseInitArgs(argv)
  } else {
    throw new Error(`unexpected shotwright command in generated output: ${command}`)
  }
}

function assertGeneratedCommandParses(command: string): void {
  if (command === 'pnpm shots:install') return
  if (command.startsWith('pnpm shots:gallery')) {
    expect(command.split(/\s+/)).not.toContain('--')
    parseGalleryCommand(command)
  } else if (command.startsWith('pnpm shots')) {
    parseShotwrightCommand(command)
  } else if (command.startsWith('pnpm exec shotwright')) {
    parseExecShotwrightCommand(command)
  } else {
    throw new Error(`unexpected generated command: ${command}`)
  }
}

function pnpmCommands(output: string): string[] {
  const commands = new Set<string>()
  for (const match of output.matchAll(/`(pnpm [^`]+)`/g)) commands.add(match[1]!)
  for (const line of output.split('\n')) {
    const match = /^\s*\d+\.\s+(pnpm[^\n#]+)/.exec(line)
    if (match) commands.add(match[1]!.trim())
  }
  return [...commands]
}

function sectionTitles(output: string): string[] {
  const titles = new Set([
    'Created',
    'Updated',
    'Left alone (yours)',
    'Needs your review',
    'Up to date',
    'Would create',
    'Would update',
    'Would leave alone (yours)',
    'Would need your review',
    'Next steps',
    'Error',
    'Written before the failure',
    'Not written',
  ])
  return output.split('\n').filter((line) => titles.has(line))
}

function fencedCommands(markdown: string): string[] {
  const commands: string[] = []
  const pattern = /```bash\n([^`]+?)\n```/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown)) !== null) {
    commands.push(
      ...match[1]!
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
  }
  return commands
}
