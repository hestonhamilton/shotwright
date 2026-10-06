import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import type { NetworkInterfaceInfo } from 'node:os'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateGallery } from '../../src/gallery/generate.js'
import {
  buildGalleryAllowlist,
  filterLanAddresses,
  formatGalleryUrl,
  galleryUrls,
  isAllowedHostHeader,
  parseByteRange,
  startGalleryServer,
  waitForGalleryShutdown,
  type GalleryServer,
  type SignalSource,
} from '../../src/gallery/server.js'
import { MANIFEST_VERSION, type Manifest, type ShotEntry } from '../../src/manifest.js'
import { makePng } from '../fixtures/png.js'

const tmpDirs: string[] = []
const servers: GalleryServer[] = []

function png(): Buffer {
  return makePng(20, 10, 1)
}

const pngByteLength = png().byteLength

function tmpDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-gallery-server-'))
  tmpDirs.push(directory)
  return directory
}

function shot(overrides: Partial<ShotEntry> = {}): ShotEntry {
  return {
    name: 'home',
    spec: 'home.shots.ts',
    file: 'shots/home.png',
    viewport: { width: 20, height: 10 },
    deviceScaleFactor: 1,
    fullPage: false,
    capturedAt: '2026-07-29T00:00:00.000Z',
    durationMs: 12,
    video: 'video/shared.webm',
    trace: 'trace/shared.zip',
    ...overrides,
  }
}

function manifest(runId: string, shots: ShotEntry[] = [shot()]): Manifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:00:01.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: true, trace: true },
    shots,
  }
}

function writeRun(shots: ShotEntry[] = [shot()]): { runDir: string; image: Buffer } {
  const runDir = path.join(tmpDir(), 'run_abcd')
  fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true })
  fs.mkdirSync(path.join(runDir, 'video'))
  fs.mkdirSync(path.join(runDir, 'trace'))
  const image = png()
  fs.writeFileSync(path.join(runDir, 'shots/home.png'), image)
  fs.writeFileSync(path.join(runDir, 'video/shared.webm'), Buffer.from('webm-video-bytes'))
  fs.writeFileSync(path.join(runDir, 'trace/shared.zip'), Buffer.from('zip-trace-bytes'))
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest('run_abcd', shots)))
  generateGallery(runDir)
  return { runDir, image }
}

async function start(runDir: string): Promise<GalleryServer> {
  const server = await startGalleryServer(runDir)
  servers.push(server)
  return server
}

function request(
  server: GalleryServer,
  requestPath: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        path: requestPath,
        method: options.method,
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.server.listening) await server.close()
  }
  for (const directory of tmpDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('gallery allowlist and protocol', () => {
  it.each([
    ['/', 'text/html; charset=utf-8'],
    ['/gallery.html', 'text/html; charset=utf-8'],
    ['/shots/home.png', 'image/png'],
    ['/video/shared.webm', 'video/webm'],
    ['/trace/shared.zip', 'application/zip'],
  ])('serves allowlisted %s with exact MIME and safety headers', async (url, mime) => {
    const { runDir } = writeRun()
    const server = await start(runDir)
    const response = await request(server, url)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe(mime)
    expect(response.headers['content-length']).toBe(String(response.body.byteLength))
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['accept-ranges']).toBe('bytes')
  })

  it.each([
    '/manifest.json',
    '/.sidecar',
    '/shots/',
    '/missing',
    '/shots/%68ome.png',
    '/shots/%2e%2e/manifest.json',
    '/shots/%252e%252e/manifest.json',
    '/shots%2Fhome.png',
    '/shots/%ZZ.png',
  ])('returns an opaque 404 for non-allowlisted path %s', async (url) => {
    const { runDir } = writeRun()
    const server = await start(runDir)
    const response = await request(server, url)
    expect(response.status).toBe(404)
    expect(response.body.toString()).toBe('Not Found\n')
    expect(response.body.toString()).not.toContain(runDir)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('allows GET/HEAD only and HEAD mirrors successful headers without a body', async () => {
    const { runDir } = writeRun()
    const server = await start(runDir)
    const get = await request(server, '/shots/home.png')
    const head = await request(server, '/shots/home.png', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers).toMatchObject({
      'content-length': get.headers['content-length'],
      'content-type': 'image/png',
      'accept-ranges': 'bytes',
    })
    expect(head.body).toHaveLength(0)

    const post = await request(server, '/', { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')
    expect(post.headers['cache-control']).toBe('no-store')
  })

  it.each([
    ['zero', 'bytes=0-0', 206, 0, 0],
    ['full', `bytes=0-${pngByteLength - 1}`, 206, 0, pngByteLength - 1],
    ['partial', 'bytes=3-8', 206, 3, 8],
    ['suffix', 'bytes=-5', 206, pngByteLength - 5, pngByteLength - 1],
    ['open-ended', `bytes=${pngByteLength - 5}-`, 206, pngByteLength - 5, pngByteLength - 1],
  ])(
    'serves byte-exact %s ranges',
    async (_label, range, status, startByte, endByte) => {
      const { runDir, image } = writeRun()
      const server = await start(runDir)
      const response = await request(server, '/shots/home.png', {
        headers: { Range: range },
      })
      expect(response.status).toBe(status)
      expect(response.body).toEqual(image.subarray(startByte, endByte + 1))
      expect(response.headers['content-range']).toBe(
        `bytes ${startByte}-${endByte}/${image.byteLength}`,
      )
      expect(response.headers['content-length']).toBe(String(endByte - startByte + 1))
    },
  )

  it.each([`bytes=${pngByteLength}-`, 'bytes=8-3', 'bytes=-0', 'items=0-1', 'bytes=0-1,3-4'])(
    'returns 416 for invalid or multiple range %s',
    async (range) => {
      const { runDir, image } = writeRun()
      const server = await start(runDir)
      const response = await request(server, '/shots/home.png', {
        headers: { Range: range },
      })
      expect(response.status).toBe(416)
      expect(response.headers['content-range']).toBe(`bytes */${image.byteLength}`)
      expect(response.headers['cache-control']).toBe('no-store')
    },
  )

  it('HEAD mirrors range status and headers with no body', async () => {
    const { runDir } = writeRun()
    const server = await start(runDir)
    const response = await request(server, '/shots/home.png', {
      method: 'HEAD',
      headers: { Range: 'bytes=3-8' },
    })
    expect(response.status).toBe(206)
    expect(response.headers['content-range']).toBe(`bytes 3-8/${pngByteLength}`)
    expect(response.headers['content-length']).toBe('6')
    expect(response.body).toHaveLength(0)
  })
})

function rawRequest(server: GalleryServer, head: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.port, '127.0.0.1', () => {
      socket.end(`${head}\r\n\r\n`)
    })
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')))
    socket.on('error', reject)
  })
}

describe('Host header (DNS rebinding guard)', () => {
  it.each(['localhost', 'localhost:4173', 'LOCALHOST:4173', '127.0.0.1', '127.0.0.1:9', '[::1]', '[::1]:4173'])(
    'accepts loopback form %s on a loopback bind',
    (host) => {
      expect(isAllowedHostHeader(host, '127.0.0.1')).toBe(true)
      expect(isAllowedHostHeader(host, '::1')).toBe(true)
    },
  )

  it.each([
    undefined,
    '',
    'evil.example',
    'evil.example:4173',
    'localhost.evil.example',
    '127.0.0.1.nip.io',
    'localhost.',
    '::1',
    '[127.0.0.1]',
    'localhost:port',
    'localhost:4173:1',
    '[::1]x',
  ])('rejects %s on a loopback bind', (host) => {
    expect(isAllowedHostHeader(host, '127.0.0.1')).toBe(false)
  })

  it('accepts the explicit bound address but not another literal', () => {
    expect(isAllowedHostHeader('192.168.77.13:4173', '192.168.77.13')).toBe(true)
    expect(isAllowedHostHeader('192.168.77.13', '192.168.77.13')).toBe(true)
    expect(isAllowedHostHeader('10.0.0.3:4173', '192.168.77.13')).toBe(false)
    expect(isAllowedHostHeader('[fd00::5]:4173', 'fd00::5')).toBe(true)
  })

  it('accepts any IP literal on a wildcard bind but never a DNS name', () => {
    for (const bound of ['0.0.0.0', '::']) {
      expect(isAllowedHostHeader('192.168.77.13:4173', bound)).toBe(true)
      expect(isAllowedHostHeader('[fd00::5]:4173', bound)).toBe(true)
      expect(isAllowedHostHeader('localhost:4173', bound)).toBe(true)
      expect(isAllowedHostHeader('workstation.lan:4173', bound)).toBe(false)
      expect(isAllowedHostHeader('evil.example', bound)).toBe(false)
    }
  })

  it.each(['localhost', `127.0.0.1`, '[::1]'])('serves a request whose Host is %s', async (host) => {
    const { runDir } = writeRun()
    const server = await start(runDir)
    const response = await request(server, '/', { headers: { Host: `${host}:${server.port}` } })
    expect(response.status).toBe(200)
  })

  it('rejects a foreign hostname with an opaque 400', async () => {
    const { runDir } = writeRun()
    const server = await start(runDir)
    for (const path of ['/', '/trace/shared.zip']) {
      const response = await request(server, path, {
        headers: { Host: `rebound.example:${server.port}` },
      })
      expect(response.status).toBe(400)
      expect(response.body.toString()).toBe('Bad Request\n')
      expect(response.headers['cache-control']).toBe('no-store')
    }
  })

  it('rejects a request with no Host header', async () => {
    const { runDir } = writeRun()
    const server = await start(runDir)
    const raw = await rawRequest(server, 'GET / HTTP/1.0')
    expect(raw).toMatch(/^HTTP\/1\.1 400 /)
    // HTTP/1.0 reaches the handler (Node only enforces Host on 1.1), so this is
    // the guard's own response, not Node's.
    expect(raw).toMatch(/Cache-Control: no-store/i)
    expect(raw.endsWith('\r\n\r\nBad Request\n')).toBe(true)
  })
})

describe('allowlist containment', () => {
  it('skips a missing reference so a partial generated gallery remains servable', () => {
    const missing = shot({ video: 'video/missing.webm', trace: null })
    const { runDir } = writeRun([missing])
    expect(buildGalleryAllowlist(runDir).has('/video/missing.webm')).toBe(false)
    expect(buildGalleryAllowlist(runDir).has('/')).toBe(true)
  })

  it('rejects a symlink escape at startup', () => {
    const escaped = shot({ video: null, trace: null })
    const { runDir } = writeRun([escaped])
    const outside = path.join(path.dirname(runDir), 'outside.png')
    fs.writeFileSync(outside, png())
    fs.rmSync(path.join(runDir, 'shots/home.png'))
    fs.symlinkSync(outside, path.join(runDir, 'shots/home.png'))
    expect(() => buildGalleryAllowlist(runDir)).toThrow(/escapes the run/)
  })

  it.each([
    ['absolute', '/outside.png'],
    ['scheme', 'https://example.test/a.png'],
    ['NUL', 'shots/nul\0.png'],
    ['dot segment', 'shots/../outside.png'],
    ['backslash', 'shots\\outside.png'],
  ])('rejects %s manifest paths at startup', (_label, file) => {
    const { runDir } = writeRun()
    fs.writeFileSync(
      path.join(runDir, 'manifest.json'),
      JSON.stringify(manifest('run_abcd', [shot({ file, video: null, trace: null })])),
    )
    expect(() => buildGalleryAllowlist(runDir)).toThrow(/run-relative|dot segments/)
  })
})

describe('range parser', () => {
  it('clamps an end beyond the representation', () => {
    expect(parseByteRange('bytes=2-999', 10)).toEqual({ start: 2, end: 9 })
  })
})

function networkInfo(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  }
}

describe('LAN interface filtering and URL formatting', () => {
  it('suppresses docker-shaped, link-local, CGNAT, public, and internal entries', () => {
    const fixture: NodeJS.Dict<NetworkInterfaceInfo[]> = {
      lo: [networkInfo('127.0.0.1', true)],
      eth0: [networkInfo('192.168.0.42')],
      tun0: [networkInfo('10.8.0.2')],
      wlan0: [networkInfo('169.254.1.2')],
      eth1: [networkInfo('100.64.1.2')],
      eth2: [networkInfo('203.0.113.8')],
    }
    for (let index = 0; index < 10; index++) {
      fixture[`br-${index}`] = [networkInfo(`172.18.${index}.1`)]
    }
    fixture.docker0 = [networkInfo('172.17.0.1')]
    fixture.veth123 = [networkInfo('10.0.0.3')]
    fixture.virbr0 = [networkInfo('192.168.122.1')]

    expect(filterLanAddresses(fixture)).toEqual([
      { interfaceName: 'eth0', address: '192.168.0.42', physicalLooking: true },
      { interfaceName: 'tun0', address: '10.8.0.2', physicalLooking: false },
    ])
    expect(galleryUrls('0.0.0.0', 43210, true, fixture)).toEqual([
      { label: 'Local', url: 'http://127.0.0.1:43210/' },
      { label: 'LAN', url: 'http://192.168.0.42:43210/' },
      { label: 'Candidate', url: 'http://10.8.0.2:43210/' },
    ])
  })

  it('formats IPv6 hosts with brackets and never prints wildcard hosts', () => {
    expect(formatGalleryUrl('::1', 4173)).toBe('http://[::1]:4173/')
    expect(galleryUrls('::', 4173, false)[0]?.url).toBe('http://[::1]:4173/')
    expect(galleryUrls('0.0.0.0', 4173, true, {})).not.toContainEqual(
      expect.objectContaining({ url: expect.stringContaining('0.0.0.0') }),
    )
  })

  it('labels explicit exposed binds as LAN without advertising unbound candidates', () => {
    expect(galleryUrls('192.168.77.13', 4173, true, {})).toEqual([
      { label: 'LAN', url: 'http://192.168.77.13:4173/' },
    ])
    expect(galleryUrls('203.0.113.8', 4173, true, {})).toEqual([
      { label: 'LAN', url: 'http://203.0.113.8:4173/' },
    ])
    expect(galleryUrls('127.0.0.1', 4173, false, {})).toEqual([
      { label: 'Local', url: 'http://127.0.0.1:4173/' },
    ])
    expect(galleryUrls('::1', 4173, false, {})).toEqual([
      { label: 'Local', url: 'http://[::1]:4173/' },
    ])
  })

  it('reports the actual OS-assigned port', async () => {
    const { runDir } = writeRun()
    const server = await start(runDir)
    expect(server.port).toBeGreaterThan(0)
    expect(server.port).toBe((server.server.address() as { port: number }).port)
  })
})

describe('signal cleanup', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)('closes gracefully on %s', async (signal) => {
    const emitter = new EventEmitter()
    const close = vi.fn(async () => undefined)
    const fakeServer = { close } as unknown as GalleryServer
    const waiting = waitForGalleryShutdown(fakeServer, emitter as SignalSource)
    emitter.emit(signal)
    await waiting
    expect(close).toHaveBeenCalledOnce()
    expect(emitter.listenerCount('SIGINT')).toBe(0)
    expect(emitter.listenerCount('SIGTERM')).toBe(0)
  })
})
