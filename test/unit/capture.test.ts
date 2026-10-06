import { afterEach, describe, expect, it, vi } from 'vitest'

import { shot, validateShotName, validateSpecPath } from '../../src/capture.js'
import type { Page } from '@playwright/test'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('shot', () => {
  it('throws an actionable error without SHOTWRIGHT_RUN_DIR', async () => {
    vi.stubEnv('SHOTWRIGHT_RUN_DIR', '')
    delete process.env.SHOTWRIGHT_RUN_DIR
    await expect(shot({} as Page, 'anything')).rejects.toThrow(/shotwright run/)
  })
})

describe('validateShotName', () => {
  it.each(['home', 'home-page', 'step 1', 'a.b', '..x', 'x..', '.hidden', 'ünïcode'])(
    'accepts %j',
    (name) => {
      expect(() => validateShotName(name)).not.toThrow()
    },
  )

  it.each([
    ['', /is empty/],
    ['.', /relative path segment/],
    ['..', /relative path segment/],
    ['a/b', /slash/],
    ['../escape', /slash/],
    ['a\\b', /backslash/],
    ['..\\escape', /backslash/],
    ['a\0b', /NUL/],
  ])('rejects %j', (name, reason) => {
    expect(() => validateShotName(name)).toThrow(reason)
    expect(() => validateShotName(name)).toThrow(`invalid shot name ${JSON.stringify(name)}`)
  })

  it('rejects an unsafe name from shot() before touching the page', async () => {
    vi.stubEnv('SHOTWRIGHT_RUN_DIR', '/nonexistent-run-dir')
    await expect(shot({} as Page, '../escape')).rejects.toThrow(/invalid shot name "\.\.\/escape"/)
  })
})

describe('validateSpecPath', () => {
  it.each(['home.shots.ts', 'flows/login.shots.ts', 'a/b/c.shots.ts', '..x/y.shots.ts'])(
    'accepts %j',
    (spec) => {
      expect(() => validateSpecPath(spec)).not.toThrow()
    },
  )

  it.each([
    ['', /is empty/],
    ['../outside.shots.ts', /path segment/],
    ['a/../../b.shots.ts', /path segment/],
    ['./a.shots.ts', /path segment/],
    ['a//b.shots.ts', /path segment/],
    ['/abs/a.shots.ts', /absolute/],
    ['a\\b.shots.ts', /backslash/],
    ['a\0.shots.ts', /NUL/],
  ])('rejects %j', (spec, reason) => {
    expect(() => validateSpecPath(spec)).toThrow(reason)
    expect(() => validateSpecPath(spec)).toThrow(`invalid spec path ${JSON.stringify(spec)}`)
  })
})
