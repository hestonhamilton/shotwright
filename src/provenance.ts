// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser identity is observed at capture time; channel comes from project config.
// Never return a host path.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Browser } from '@playwright/test'
import type { BrowserExecutable, BrowserObservation, RunEnvironment } from './manifest.js'

const hashes = new Map<string, Promise<string>>()

export function runEnvironment(platform: NodeJS.Platform = process.platform): RunEnvironment {
  let distribution: RunEnvironment['distribution'] = null
  if (platform === 'linux') {
    try {
      const source = fs.existsSync('/etc/os-release') ? '/etc/os-release' : '/usr/lib/os-release'
      const release = fs.readFileSync(source, 'utf8')
      const field = (key: string): string | null => {
        const raw = release.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]
        if (!raw) return null
        const quoted =
          (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        const value = quoted ? raw.slice(1, -1) : raw
        return /^[a-z0-9][a-z0-9._-]*$/i.test(value) ? value : null
      }
      const id = field('ID'),
        versionId = field('VERSION_ID')
      if (id && versionId) distribution = { id, versionId }
    } catch {
      /* unavailable is expected on minimal systems */
    }
  }
  return { platform, distribution }
}

function browserCacheRoot(): string {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (configured === '0') {
    const require = createRequire(import.meta.resolve('@playwright/test'))
    return path.join(
      path.dirname(require.resolve('playwright-core/package.json')),
      '.local-browsers',
    )
  }
  if (configured) return path.resolve(process.env.INIT_CWD || process.cwd(), configured)
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ms-playwright')
}

interface ProcessBinding {
  parent: number
  start: string
  alive: boolean
}
function binding(pid: number): ProcessBinding | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return {
      parent: Number(fields[1]),
      start: fields[19] ?? '',
      alive: fields[0] !== 'Z' && fields[0] !== 'X',
    }
  } catch {
    return null
  }
}

function childAlive(pid: number, start?: string): boolean {
  const state = binding(pid)
  return (
    !!state &&
    state.alive &&
    state.parent === process.pid &&
    !!state.start &&
    (start === undefined || state.start === start)
  )
}

async function digestImage(link: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(link)) hash.update(chunk)
  return hash.digest('hex')
}

export async function executableForPid(pid: number): Promise<BrowserExecutable | null> {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid < 1) return null
  const first = binding(pid)
  if (!first || !childAlive(pid, first.start)) return null
  const link = `/proc/${pid}/exe`
  try {
    const target = fs.readlinkSync(link)
    const image = fs.statSync(link)
    if (!image.isFile() || !childAlive(pid, first.start)) return null
    const identity = `${image.dev}:${image.ino}`
    let pending = hashes.get(identity)
    if (!pending) {
      pending = digestImage(link)
      hashes.set(identity, pending)
    }
    let sha256: string
    try {
      sha256 = await pending
    } catch {
      hashes.delete(identity)
      return null
    }
    if (!childAlive(pid, first.start)) return null
    const afterImage = fs.statSync(link)
    if (afterImage.dev !== image.dev || afterImage.ino !== image.ino) return null
    let root: string | null = null
    try {
      root = fs.realpathSync(browserCacheRoot())
    } catch {
      /* cache may not exist for overrides */
    }
    const relative = root === null ? '' : path.relative(root, target)
    const managed =
      root !== null &&
      !!relative &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    const portable = managed ? relative.split(path.sep).join('/') : path.basename(target)
    if (!portable || portable.includes(' (deleted)')) return null
    return { kind: managed ? 'managed' : 'overridden', path: portable, sha256 }
  } catch {
    return null
  }
}

export async function observeBrowser(
  browser: Browser | null,
  channel: unknown,
): Promise<BrowserObservation> {
  const unavailable: BrowserObservation = {
    name: null,
    version: null,
    channel: null,
    executable: null,
  }
  try {
    if (!browser) return unavailable
    const name = browser.browserType().name()
    const version = browser.version()
    const observed: BrowserObservation = {
      name: ['chromium', 'firefox', 'webkit'].includes(name) ? name : null,
      version: /^\d+(?:\.\d+)*$/.test(version) ? version : null,
      channel: typeof channel === 'string' && /^[a-z0-9-]+$/.test(channel) ? channel : null,
      executable: null,
    }
    if (process.platform !== 'linux' || name !== 'chromium') return observed
    // Playwright's client connection marks connected browsers as remote. Treat an
    // unknown connection shape conservatively; this is pinned to the peer release.
    const connection = (browser as Browser & { _connection?: { isRemote?: () => boolean } })
      ._connection
    if (!connection || typeof connection.isRemote !== 'function' || connection.isRemote())
      return observed
    let session: Awaited<ReturnType<Browser['newBrowserCDPSession']>> | undefined
    try {
      session = await browser.newBrowserCDPSession()
      const response = (await session.send('SystemInfo.getProcessInfo')) as {
        processInfo?: Array<{ type?: string; id?: number }>
      }
      const pids = response.processInfo
        ?.filter((process) => process.type === 'browser')
        .map((process) => process.id)
      if (pids?.length === 1 && pids[0] !== undefined)
        observed.executable = await executableForPid(pids[0])
    } catch {
      /* connected browsers and unsupported CDP return unavailable */
    } finally {
      try {
        await session?.detach()
      } catch {
        /* detaching is best effort */
      }
    }
    return observed
  } catch {
    return unavailable
  }
}
