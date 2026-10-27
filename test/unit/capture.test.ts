import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { artifact, shot, validateShotName, validateSpecPath } from '../../src/capture.js'
import { readSidecars } from '../../src/manifest.js'
import type { Page } from '@playwright/test'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('artifact path copy', () => {
  function fixture() {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-artifact-'))
    fs.mkdirSync(path.join(runDir, '.sidecar'))
    vi.stubEnv('SHOTWRIGHT_RUN_DIR', runDir)
    const info = {
      titlePath: ['flow.shots.ts', 'walkthrough'],
      project: { testDir: runDir, use: {} },
      testId: 'test-1',
      retry: 0,
    } as ReturnType<typeof test.info>
    vi.spyOn(test, 'info').mockReturnValue(info)
    const source = path.join(runDir, 'source.bin')
    const dest = path.join(runDir, 'data/flow/report.bin')
    return { runDir, info, source, dest }
  }

  it('copies multiple chunks without reading the whole source and records exact bytes', async () => {
    const { runDir, source, dest } = fixture()
    try {
      const content = Buffer.alloc(256 * 1024 + 13, 0x61)
      fs.writeFileSync(source, content)
      const read = vi.spyOn(fs, 'readFileSync')
      const write = vi.spyOn(fs, 'writeSync')
      await expect(
        artifact('report.bin', { path: source, contentType: 'application/octet-stream' }),
      ).resolves.toBeUndefined()
      expect(read.mock.calls.some(([file]) => file === source)).toBe(false)
      expect(write.mock.calls.length).toBeGreaterThan(1)
      expect(fs.readFileSync(dest)).toEqual(content)
      expect(readSidecars(runDir)).toMatchObject([{ kind: 'artifact', bytes: content.length }])
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('copies an empty source and preserves body bytes and byte counts', async () => {
    const { runDir, source, dest } = fixture()
    try {
      fs.writeFileSync(source, '')
      await artifact('report.bin', { path: source, contentType: 'application/octet-stream' })
      await artifact('body.bin', {
        body: Buffer.from([0, 255, 1]),
        contentType: 'application/octet-stream',
      })
      expect(fs.readFileSync(dest)).toHaveLength(0)
      expect(fs.readFileSync(path.join(runDir, 'data/flow/body.bin'))).toEqual(
        Buffer.from([0, 255, 1]),
      )
      expect(
        readSidecars(runDir)
          .filter((sidecar) => sidecar.kind === 'artifact')
          .map((sidecar) => [sidecar.name, sidecar.bytes])
          .sort(),
      ).toEqual([
        ['body.bin', 3],
        ['report.bin', 0],
      ])
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('preserves a prior retry artifact when the source cannot be opened', async () => {
    const { runDir, info, source, dest } = fixture()
    try {
      await expect(
        artifact('report.bin', { path: source, contentType: 'text/plain' }),
      ).rejects.toMatchObject({ code: 'ENOENT' })
      expect(fs.existsSync(dest)).toBe(false)
      expect(readSidecars(runDir)).toEqual([])
      await artifact('report.bin', { body: 'old', contentType: 'text/plain' })
      info.retry = 1
      await expect(
        artifact('report.bin', { path: source, contentType: 'text/plain' }),
      ).rejects.toMatchObject({ code: 'ENOENT' })
      expect(fs.readFileSync(dest, 'utf8')).toBe('old')
      expect(readSidecars(runDir)).toMatchObject([{ bytes: 3, retry: 0 }])
      fs.mkdirSync(source)
      await expect(
        artifact('report.bin', { path: source, contentType: 'text/plain' }),
      ).rejects.toThrow('not a regular file')
      expect(fs.readFileSync(dest, 'utf8')).toBe('old')
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('handles short writes and closes the claimed descriptor once', async () => {
    const { runDir, source, dest } = fixture()
    try {
      fs.writeFileSync(source, Buffer.alloc(130 * 1024, 0x62))
      const original = fs.writeSync.bind(fs)
      const write = vi.spyOn(fs, 'writeSync').mockImplementation((...args) => {
        const [fd, buffer, offset, length] = args as unknown as [number, Buffer, number, number]
        return original(fd, buffer, offset, Math.min(length, 7))
      })
      const close = vi.spyOn(fs, 'closeSync')
      await artifact('report.bin', { path: source, contentType: 'text/plain' })
      const destinationFd = write.mock.calls[0]![0]
      expect(close.mock.calls.filter(([fd]) => fd === destinationFd)).toHaveLength(1)
      expect(write.mock.calls.length).toBeGreaterThan(2)
      expect(fs.readFileSync(dest)).toEqual(fs.readFileSync(source))
      expect(readSidecars(runDir)).toMatchObject([{ bytes: 130 * 1024 }])
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })

  it.each(['zero', 'throw', 'replace'] as const)(
    'cleans a failed %s write only when it still owns the inode',
    async (failure) => {
      const { runDir, source, dest } = fixture()
      try {
        fs.writeFileSync(source, Buffer.alloc(130 * 1024, 0x63))
        const original = fs.writeSync.bind(fs)
        let calls = 0
        vi.spyOn(fs, 'writeSync').mockImplementation((...args) => {
          const [fd, buffer, offset, length] = args as unknown as [number, Buffer, number, number]
          calls++
          if (calls === 2) {
            if (failure === 'replace') {
              fs.unlinkSync(dest)
              fs.writeFileSync(dest, 'replacement')
            }
            if (failure === 'zero') return 0
            throw new Error('injected write failure')
          }
          return original(fd, buffer, offset, length)
        })
        const close = vi.spyOn(fs, 'closeSync')
        await expect(
          artifact('report.bin', { path: source, contentType: 'text/plain' }),
        ).rejects.toThrow(failure === 'zero' ? 'no progress' : 'injected write failure')
        expect(calls).toBe(2)
        expect(close).toHaveBeenCalledTimes(1)
        expect(fs.existsSync(dest)).toBe(failure === 'replace')
        if (failure === 'replace') expect(fs.readFileSync(dest, 'utf8')).toBe('replacement')
        expect(readSidecars(runDir)).toEqual([])
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true })
      }
    },
  )

  it('removes a partial retry copy after a read failure without masking the error', async () => {
    const { runDir, info, source, dest } = fixture()
    try {
      await artifact('report.bin', { body: 'old', contentType: 'text/plain' })
      info.retry = 1
      fs.writeFileSync(source, Buffer.alloc(130 * 1024, 0x64))
      const create = fs.createReadStream.bind(fs)
      let reader: fs.ReadStream | undefined
      vi.spyOn(fs, 'createReadStream').mockImplementation((...args) => {
        reader = create(...args)
        return reader
      })
      const original = fs.writeSync.bind(fs)
      const write = vi.spyOn(fs, 'writeSync').mockImplementation((...args) => {
        const [fd, buffer, offset, length] = args as unknown as [number, Buffer, number, number]
        const written = original(fd, buffer, offset, length)
        reader!.destroy(new Error('injected read failure'))
        return written
      })
      const close = vi.spyOn(fs, 'closeSync')
      await expect(
        artifact('report.bin', { path: source, contentType: 'text/plain' }),
      ).rejects.toThrow('injected read failure')
      expect(write).toHaveBeenCalled()
      expect(fs.existsSync(dest)).toBe(false)
      expect(close).toHaveBeenCalledTimes(1)
      expect(readSidecars(runDir)).toMatchObject([{ retry: 0, bytes: 3 }])
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
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
