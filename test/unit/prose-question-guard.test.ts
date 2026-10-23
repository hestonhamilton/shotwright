// The Stop hook must block owner questions in prose and allow status reports.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const hook = path.join(root, '.claude/hooks/prose-question-guard.sh')
const scaffold = fs.readFileSync(path.join(root, '.claude/scaffold.conf'), 'utf8')
const hasDependencies = ['jq', 'python3'].every(
  (binary) => spawnSync('sh', ['-c', `command -v ${binary}`], { stdio: 'ignore' }).status === 0,
)

type HookOutput = { decision?: string; reason?: string; systemMessage?: string }

function runHook(
  message: string,
  options: { enforcement?: string; guard?: string; active?: boolean; rawPayload?: string } = {},
): HookOutput {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'prose-question-guard-'))
  try {
    const claudeDir = path.join(project, '.claude')
    fs.mkdirSync(claudeDir)
    const conf = scaffold
      .replace(/^ENFORCEMENT=.*$/m, `ENFORCEMENT=${options.enforcement ?? 'strict'}`)
      .replace(/^PROSE_QUESTION_GUARD=.*$/m, `PROSE_QUESTION_GUARD=${options.guard ?? 'on'}`)
    fs.writeFileSync(path.join(claudeDir, 'scaffold.conf'), conf)
    const payload =
      options.rawPayload ??
      JSON.stringify({
        hook_event_name: 'Stop',
        stop_hook_active: options.active ?? false,
        last_assistant_message: message,
      })
    const result = spawnSync('bash', [hook], {
      input: payload,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', CLAUDE_PROJECT_DIR: project },
    })
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim() ? (JSON.parse(result.stdout) as HookOutput) : {}
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
  }
}

const blocked = [
  ['want me to', 'Done. Want me to start B?'],
  ['shall I', 'Committed as `15f931f`. Shall I proceed?'],
  ['which do you prefer', 'Which do you prefer, the audit or the tier pass?'],
  ['say the word', "HANDOFF.md rewritten. Say the word and I'll start on the next bead."],
  ['your call', 'Pushing to main is your call.'],
  ['pending your call', "The bead is verified but not closed - that's your call."],
  ['tell me which', 'Both galleries are built. Tell me which to open first.'],
  [
    'open questions list',
    'Verification green.\n\nOpen questions:\n- keep the flag?\n- rename the verb?',
  ],
  ['outstanding list', 'All merged.\n\n**Outstanding:**\n1. the gallery deletion'],
  ['either or', 'Merged #341.\n\nMerge #342 too, or hold it until the render finishes?'],
  ['let me know which', 'Two loose ends.\n\n- a\n- b\n\nLet me know which you want first.'],
  ['question in a bullet', '- item one\n- Close it now, or leave it open until #208 merges?'],
  [
    'waiting on from you list',
    '| shot | status | note |\n|---|---|---|\n' +
      '| login-form | changed | already recorded in the manifest |\n\n' +
      "What I'm waiting on from you:\n" +
      '- your review of these 100 compare verdicts\n' +
      '- which of the changed shots to accept\n' +
      '- whether to gate on the 128 remaining pairs or keep the compare advisory',
  ],
  ['awaiting your decision list', 'Merged.\n\n**Awaiting your decision:**\n- the gallery deletion'],
  [
    'waiting on you heading paragraph',
    'Two beads filed.\n\n**Waiting on you**\n\n- Grade the section, then I write it.\n\nMain is current.',
  ],
] as const

const allowed = [
  ['plain report', 'Merged #341 and reset to baseline. Nothing in flight.'],
  ['empty message', ''],
  [
    'rhetorical mid paragraph',
    'Why does the manifest matter? Because every checkout resolves the same runs dir. Fixed in #343.',
  ],
  [
    'quoted question',
    'The owner asked "which tier is missing?" in the review; the answer is explicit.',
  ],
  ['backticked question', 'The failing command was `is this ok?` and it now passes.'],
  ['fenced code', 'Done.\n\n```\n$ shotwright compare --help\nwhat now?\n```'],
  ['blockquote', '> want me to try again?\n\nNo. The retry already ran and passed.'],
  ['decided and reported', 'Decided: keep the flag. The compare gate stays opt-in.'],
  [
    'waiting on a render',
    'Run queued.\n\nWaiting on the render; `shotwright gallery --watch` is under Monitor.',
  ],
  [
    'waiting on your grade sentence',
    'Pages served.\n\nStill waiting on your review of the three pages; nothing is pushed.',
  ],
  [
    'per your call already decided',
    'Compare runs advisory this time, per your call - the gate stays off, so CI stays green.',
  ],
  [
    'a tool tells me',
    'The fix is live, so when you finish reviewing I can read the rate off a digest that will now tell me if the run was partial.',
  ],
] as const

describe.skipIf(!hasDependencies)('prose question Stop hook', () => {
  it.each(blocked)('blocks %s', (_name, message) => {
    expect(runHook(message).decision).toBe('block')
  })

  it.each(allowed)('allows %s', (_name, message) => {
    expect(runHook(message)).toEqual({})
  })

  it('names AskUserQuestion and the offending line in the reason', () => {
    const output = runHook('Done. Want me to start B?')
    expect(output.reason).toContain('AskUserQuestion')
    expect(output.reason).toContain('Want me to start B?')
  })

  it('lets a second stop through', () => {
    expect(runHook('Done. Want me to start B?', { active: true })).toEqual({})
  })

  it('warns without blocking in guard warn mode', () => {
    const output = runHook('Done. Want me to start B?', { guard: 'warn' })
    expect(output.decision).toBeUndefined()
    expect(output.systemMessage).toMatch(/^ADVISORY/)
  })

  it('downgrades to a warning in enforcement warn mode', () => {
    const output = runHook('Done. Want me to start B?', { enforcement: 'warn' })
    expect(output.decision).toBeUndefined()
    expect(output.systemMessage).toBeDefined()
  })

  it('allows silently when either dial is off', () => {
    expect(runHook('Done. Want me to start B?', { guard: 'off' })).toEqual({})
    expect(runHook('Done. Want me to start B?', { enforcement: 'off' })).toEqual({})
  })

  it('allows unreadable JSON', () => {
    expect(runHook('', { rawPayload: '{unreadable' })).toEqual({})
  })

  it('is wired into the Stop event', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'),
    ) as {
      hooks: { Stop: { hooks: { command: string }[] }[] }
    }
    expect(
      settings.hooks.Stop.flatMap((group) => group.hooks.map((entry) => entry.command)),
    ).toContain('$CLAUDE_PROJECT_DIR/.claude/hooks/prose-question-guard.sh')
  })
})
