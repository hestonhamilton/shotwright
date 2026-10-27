import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { shot, validateShotName, validateSpecPath } from '../../src/capture.js'
import { readSidecars } from '../../src/manifest.js'
import type { Page } from '@playwright/test'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('shot', () => {
  it('throws an actionable error without SHOTWRIGHT_RUN_DIR', async () => {
    vi.stubEnv('SHOTWRIGHT_RUN_DIR', '')
    delete process.env.SHOTWRIGHT_RUN_DIR
    await expect(shot({} as Page, 'anything')).rejects.toThrow(/shotwright run/)
  })

  function fixture() {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-shot-'))
    fs.mkdirSync(path.join(runDir, '.sidecar'))
    vi.stubEnv('SHOTWRIGHT_RUN_DIR', runDir)
    const screenshot = vi.fn().mockResolvedValue(Buffer.from('png'))
    const page = {
      screenshot,
      viewportSize: () => ({ width: 800, height: 600 }),
      context: () => ({ browser: () => null }),
    } as unknown as Page
    vi.spyOn(test, 'info').mockReturnValue({
      titlePath: ['flow.shots.ts', 'walkthrough'],
      project: { testDir: runDir, use: { deviceScaleFactor: 2 } },
      testId: 'test-1',
      retry: 0,
    } as ReturnType<typeof test.info>)
    const png = (name: string) => path.join(runDir, 'shots', 'flow', `${name}.png`)
    return { runDir, page, screenshot, png }
  }

  it('runs a filtered check once without a screenshot, PNG, or sidecar', async () => {
    const { runDir, page, screenshot, png } = fixture()
    try {
      vi.stubEnv('SHOTWRIGHT_ONLY', 'selected')
      const check = vi.fn()
      await shot(page, 'omitted', { check })
      expect(check).toHaveBeenCalledOnce()
      expect(screenshot).not.toHaveBeenCalled()
      expect(fs.existsSync(png('omitted'))).toBe(false)
      expect(readSidecars(runDir)).toEqual([])
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('propagates a filtered check failure without writing a capture', async () => {
    const { runDir, page, screenshot, png } = fixture()
    try {
      vi.stubEnv('SHOTWRIGHT_ONLY', 'selected')
      await expect(
        shot(page, 'omitted', {
          check: () => {
            throw new Error('check failed')
          },
        }),
      ).rejects.toThrow('check failed')
      expect(screenshot).not.toHaveBeenCalled()
      expect(fs.existsSync(png('omitted'))).toBe(false)
      expect(readSidecars(runDir)).toEqual([])
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })

  it.each([
    [true, true],
    [false, false],
  ])(
    'writes a selected shot with checked=%s when check is present=%s',
    async (withCheck, checked) => {
      const { runDir, page, screenshot, png } = fixture()
      try {
        vi.stubEnv('SHOTWRIGHT_ONLY', 'selected')
        const check = vi.fn()
        await shot(page, 'selected', withCheck ? { check } : {})
        expect(check).toHaveBeenCalledTimes(withCheck ? 1 : 0)
        expect(screenshot).toHaveBeenCalledOnce()
        expect(fs.readFileSync(png('selected'))).toEqual(Buffer.from('png'))
        expect(readSidecars(runDir)).toMatchObject([{ kind: 'shot', checked }])
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true })
      }
    },
  )

  it('fails a later check that reads an earlier filtered shot PNG', async () => {
    const { runDir, page, screenshot, png } = fixture()
    try {
      vi.stubEnv('SHOTWRIGHT_ONLY', 'later')
      await shot(page, 'earlier')
      await expect(
        shot(page, 'later', {
          check: () => {
            fs.readFileSync(png('earlier'))
          },
        }),
      ).rejects.toThrow(/ENOENT/)
      expect(screenshot).not.toHaveBeenCalled()
      expect(fs.existsSync(png('earlier'))).toBe(false)
      expect(fs.existsSync(png('later'))).toBe(false)
      expect(readSidecars(runDir)).toEqual([])
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
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
