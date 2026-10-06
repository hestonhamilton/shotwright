import fs from 'node:fs'
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { isIP, type AddressInfo } from 'node:net'
import os, { type NetworkInterfaceInfo } from 'node:os'
import path from 'node:path'

import { validateManifest, validateRelativePath } from './model.js'

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

interface AllowedFile {
  file: string
  mime: string
  size: number
}

export interface GalleryServer {
  server: Server
  host: string
  port: number
  close(): Promise<void>
}

export interface LanAddress {
  interfaceName: string
  address: string
  physicalLooking: boolean
}

export interface PrintedUrl {
  label: 'Local' | 'LAN' | 'Candidate'
  url: string
}

export interface SignalSource {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

function readManifest(runDir: string): ReturnType<typeof validateManifest> {
  let bytes: Buffer
  try {
    bytes = fs.readFileSync(path.join(runDir, 'manifest.json'))
  } catch {
    throw new Error('shotwright gallery: manifest.json could not be read')
  }
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('shotwright gallery: manifest.json is not valid JSON')
  }
  return validateManifest(value, path.basename(runDir))
}

function encodedUrlPath(relativePath: string): string {
  return `/${validateRelativePath(relativePath).map(encodeURIComponent).join('/')}`
}

function isContained(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function canonicalReferencedFile(
  canonicalRun: string,
  relativePath: string,
): string | null {
  const segments = validateRelativePath(relativePath)
  let canonical: string
  try {
    canonical = fs.realpathSync(path.join(canonicalRun, ...segments))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw new Error(`shotwright gallery: referenced file is unreadable: ${relativePath}`, {
      cause: error,
    })
  }
  if (!isContained(canonicalRun, canonical)) {
    throw new Error(`shotwright gallery: referenced file escapes the run: ${relativePath}`)
  }
  if (!fs.statSync(canonical).isFile()) {
    throw new Error(`shotwright gallery: referenced path is not a file: ${relativePath}`)
  }
  return canonical
}

function addAllowed(
  allowlist: Map<string, AllowedFile>,
  urlPath: string,
  file: string,
  mime: string,
): void {
  const existing = allowlist.get(urlPath)
  if (existing) {
    if (existing.file !== file || existing.mime !== mime) {
      throw new Error(`shotwright gallery: conflicting encoded manifest path: ${urlPath}`)
    }
    return
  }
  allowlist.set(urlPath, { file, mime, size: fs.statSync(file).size })
}

export function buildGalleryAllowlist(
  runDir: string,
  galleryPath = path.join(runDir, 'gallery.html'),
): Map<string, AllowedFile> {
  const canonicalRun = fs.realpathSync(runDir)
  const canonicalGallery = fs.realpathSync(galleryPath)
  if (!isContained(canonicalRun, canonicalGallery)) {
    throw new Error('shotwright gallery: generated gallery escapes the run directory')
  }

  const allowlist = new Map<string, AllowedFile>()
  addAllowed(allowlist, '/', canonicalGallery, 'text/html; charset=utf-8')
  addAllowed(allowlist, '/gallery.html', canonicalGallery, 'text/html; charset=utf-8')

  const manifest = readManifest(canonicalRun)
  for (const shot of manifest.shots) {
    const references: Array<[string, string, string]> = [
      [shot.file, 'screenshot', 'image/png'],
    ]
    if (shot.video !== null) references.push([shot.video, 'video', 'video/webm'])
    if (shot.trace !== null) references.push([shot.trace, 'trace', 'application/zip'])

    for (const [relativePath, kind, mime] of references) {
      const extension = path.posix.extname(relativePath).toLowerCase()
      if (
        (kind === 'screenshot' && extension !== '.png') ||
        (kind === 'video' && extension !== '.webm') ||
        (kind === 'trace' && extension !== '.zip')
      ) {
        throw new Error(`shotwright gallery: unsupported ${kind} extension: ${relativePath}`)
      }
      const canonical = canonicalReferencedFile(canonicalRun, relativePath)
      if (canonical !== null) {
        addAllowed(allowlist, encodedUrlPath(relativePath), canonical, mime)
      }
    }
  }
  return allowlist
}

interface ByteRange {
  start: number
  end: number
}

export function parseByteRange(header: string, size: number): ByteRange | null {
  if (!header.startsWith('bytes=') || header.includes(',')) return null
  const value = header.slice('bytes='.length)
  const match = /^(\d*)-(\d*)$/.exec(value)
  if (!match || (match[1] === '' && match[2] === '')) return null

  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size === 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] === '' ? size - 1 : Number(match[2])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return null
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function sendText(
  response: ServerResponse,
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {},
  head = false,
): void {
  const body = Buffer.from(message)
  response.writeHead(status, {
    ...RESPONSE_HEADERS,
    ...extraHeaders,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(body.byteLength),
  })
  response.end(head ? undefined : body)
}

function requestPath(request: IncomingMessage): string | null {
  const target = request.url
  if (!target || !target.startsWith('/')) return null
  const query = target.indexOf('?')
  const pathname = query === -1 ? target : target.slice(0, query)
  try {
    decodeURIComponent(pathname)
  } catch {
    return null
  }
  return pathname
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * DNS-rebinding guard: a page the viewer visits can point its own hostname at
 * this server and read the captures (traces can carry cookies). Only loopback
 * names, the bound address, or — on a wildcard bind, where any address of this
 * machine reaches the server — any IP literal are accepted. No DNS name other
 * than `localhost` ever is. The port is not compared: a tunnel or forward may
 * legitimately present a different one, and rebinding is defeated by the name.
 */
export function isAllowedHostHeader(header: string | undefined, boundAddress: string): boolean {
  if (header === undefined) return false
  const match = /^(\[[^\]]*\]|[^:[\]]+)(?::\d{1,5})?$/.exec(header.toLowerCase())
  if (!match) return false
  const host = match[1]!
  if (LOOPBACK_HOSTS.has(host)) return true
  const bare = host.startsWith('[') ? host.slice(1, -1) : host
  const family = isIP(bare)
  if (family === 0 || (family === 6) !== host.startsWith('[')) return false
  if (boundAddress === '0.0.0.0' || boundAddress === '::') return true
  return bare === boundAddress.toLowerCase()
}

function handler(allowlist: Map<string, AllowedFile>, boundAddress: () => string) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const head = request.method === 'HEAD'
    if (!isAllowedHostHeader(request.headers.host, boundAddress())) {
      sendText(response, 400, 'Bad Request\n', {}, head)
      return
    }
    if (request.method !== 'GET' && !head) {
      sendText(response, 405, 'Method Not Allowed\n', { Allow: 'GET, HEAD' })
      return
    }

    const pathname = requestPath(request)
    const allowed = pathname === null ? undefined : allowlist.get(pathname)
    if (!allowed) {
      sendText(response, 404, 'Not Found\n', {}, head)
      return
    }

    const baseHeaders = {
      ...RESPONSE_HEADERS,
      'Content-Type': allowed.mime,
      'Accept-Ranges': 'bytes',
    }
    const rangeHeader = request.headers.range
    if (rangeHeader !== undefined) {
      const range = parseByteRange(rangeHeader, allowed.size)
      if (!range) {
        sendText(
          response,
          416,
          'Range Not Satisfiable\n',
          {
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${allowed.size}`,
          },
          head,
        )
        return
      }
      const length = range.end - range.start + 1
      response.writeHead(206, {
        ...baseHeaders,
        'Content-Length': String(length),
        'Content-Range': `bytes ${range.start}-${range.end}/${allowed.size}`,
      })
      if (head) {
        response.end()
      } else {
        fs.createReadStream(allowed.file, { start: range.start, end: range.end }).pipe(response)
      }
      return
    }

    response.writeHead(200, {
      ...baseHeaders,
      'Content-Length': String(allowed.size),
    })
    if (head) {
      response.end()
    } else {
      fs.createReadStream(allowed.file).pipe(response)
    }
  }
}

export async function startGalleryServer(
  runDir: string,
  host = '127.0.0.1',
  port = 0,
): Promise<GalleryServer> {
  const allowlist = buildGalleryAllowlist(runDir)
  const server: Server = http.createServer(
    handler(allowlist, () => (server.address() as AddressInfo).address),
  )
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return {
    server,
    host: address.address,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function ipv4Number(address: string): number | null {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null
  }
  return (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256 + octets[3]!) >>> 0
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4Number(address)
  if (value === null) return false
  const first = value >>> 24
  const second = (value >>> 16) & 0xff
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

function isSuppressedAddress(address: string): boolean {
  const value = ipv4Number(address)
  if (value === null) return true
  const first = value >>> 24
  const second = (value >>> 16) & 0xff
  return (
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  )
}

function physicalLooking(name: string): boolean {
  return /^(?:en|eth|wlan|wl|eno|ens|enp)/i.test(name)
}

export function filterLanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): LanAddress[] {
  const addresses: LanAddress[] = []
  const seen = new Set<string>()
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    if (/^(?:docker|br-|veth|virbr)/i.test(interfaceName)) continue
    for (const entry of entries ?? []) {
      if (
        entry.family !== 'IPv4' ||
        entry.internal ||
        !isPrivateIpv4(entry.address) ||
        isSuppressedAddress(entry.address) ||
        seen.has(entry.address)
      ) {
        continue
      }
      seen.add(entry.address)
      addresses.push({
        interfaceName,
        address: entry.address,
        physicalLooking: physicalLooking(interfaceName),
      })
    }
  }
  return addresses.sort(
    (a, b) =>
      Number(b.physicalLooking) - Number(a.physicalLooking) ||
      a.interfaceName.localeCompare(b.interfaceName) ||
      a.address.localeCompare(b.address),
  )
}

export function formatGalleryUrl(host: string, port: number): string {
  const formattedHost = host.includes(':') ? `[${host}]` : host
  return `http://${formattedHost}:${port}/`
}

export function galleryUrls(
  host: string,
  port: number,
  lan: boolean,
  interfaces = os.networkInterfaces(),
): PrintedUrl[] {
  const localHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host
  const wildcard = host === '0.0.0.0' || host === '::'
  const urls: PrintedUrl[] = [
    { label: lan && !wildcard ? 'LAN' : 'Local', url: formatGalleryUrl(localHost, port) },
  ]
  if (!lan) return urls
  if (!wildcard) return urls
  const addresses = filterLanAddresses(interfaces)
  for (const [index, entry] of addresses.entries()) {
    urls.push({
      label: index === 0 ? 'LAN' : 'Candidate',
      url: formatGalleryUrl(entry.address, port),
    })
  }
  return urls
}

export function waitForGalleryShutdown(
  galleryServer: GalleryServer,
  signals: SignalSource = process,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let closing = false
    const cleanup = (): void => {
      signals.removeListener('SIGINT', stop)
      signals.removeListener('SIGTERM', stop)
    }
    const stop = (): void => {
      if (closing) return
      closing = true
      galleryServer.close().then(
        () => {
          cleanup()
          resolve()
        },
        (error: unknown) => {
          cleanup()
          reject(error)
        },
      )
    }
    signals.once('SIGINT', stop)
    signals.once('SIGTERM', stop)
  })
}
