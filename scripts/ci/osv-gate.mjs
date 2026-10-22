import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ONLINE_TIMEOUT_MS = 30_000
export const DOWNLOAD_TIMEOUT_MS = 120_000
export const IDENTITY_TIMEOUT_MS = 10_000
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
export const CANARY_ADVISORY = 'GHSA-35jh-r3h4-6jhm'

class GateError extends Error {
  constructor(kind, message, details = []) {
    super(message)
    this.name = 'GateError'
    this.kind = kind
    this.details = details
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function appendBounded(chunks, chunk, state, maxBytes) {
  state.bytes += chunk.length
  if (state.bytes <= maxBytes) chunks.push(chunk)
  return state.bytes <= maxBytes
}

export function runProcess(
  command,
  args,
  { cwd, env = process.env, timeoutMs, maxOutputBytes = MAX_OUTPUT_BYTES },
) {
  return new Promise((resolveResult) => {
    let child
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolveResult({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        spawnError: error,
        timedOut: false,
        overflow: false,
      })
      return
    }

    const stdout = []
    const stderr = []
    const stdoutState = { bytes: 0 }
    const stderrState = { bytes: 0 }
    let spawnError
    let timedOut = false
    let overflow = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      if (!appendBounded(stdout, chunk, stdoutState, maxOutputBytes)) {
        overflow = true
        child.kill('SIGKILL')
      }
    })
    child.stderr.on('data', (chunk) => {
      if (!appendBounded(stderr, chunk, stderrState, maxOutputBytes)) {
        overflow = true
        child.kill('SIGKILL')
      }
    })
    child.on('error', (error) => {
      spawnError = error
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        spawnError,
        timedOut,
        overflow,
      })
    })
  })
}

function parseQuotedValue(raw, label, lineNumber) {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(raw)) {
    throw new GateError(
      'indeterminate',
      `policy line ${lineNumber}: ${label} must be one double-quoted string`,
    )
  }
  try {
    const value = JSON.parse(raw)
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('empty')
    }
    return value
  } catch {
    throw new GateError(
      'indeterminate',
      `policy line ${lineNumber}: ${label} is not a valid nonempty string`,
    )
  }
}

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
}

export function parsePolicy(text, today = new Date().toISOString().slice(0, 10)) {
  const exceptions = []
  const seenIds = new Set()
  let current = null

  const finishCurrent = (lineNumber) => {
    if (current === null) return
    for (const field of ['id', 'reason', 'ignoreUntil']) {
      if (!(field in current)) {
        throw new GateError(
          'indeterminate',
          `policy record ending at line ${lineNumber} is missing ${field}`,
        )
      }
    }
    if (!validDate(current.ignoreUntil)) {
      throw new GateError(
        'indeterminate',
        `policy record ${current.id}: ignoreUntil must be a real YYYY-MM-DD date`,
      )
    }
    if (current.ignoreUntil <= today) {
      throw new GateError(
        'indeterminate',
        `policy record ${current.id}: exception expired on ${current.ignoreUntil}`,
      )
    }
    const normalizedId = current.id.toUpperCase()
    if (seenIds.has(normalizedId)) {
      throw new GateError('indeterminate', `policy contains duplicate ID ${current.id}`)
    }
    seenIds.add(normalizedId)
    exceptions.push(current)
    current = null
  }

  const lines = text.replaceAll('\r\n', '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const line = lines[index].trim()
    if (line === '' || line.startsWith('#')) continue

    if (line === '[[IgnoredVulns]]') {
      finishCurrent(lineNumber - 1)
      current = {}
      continue
    }
    if (line.startsWith('[[')) {
      throw new GateError(
        'indeterminate',
        `policy line ${lineNumber}: only [[IgnoredVulns]] records are permitted`,
      )
    }
    if (current === null) {
      throw new GateError(
        'indeterminate',
        `policy line ${lineNumber}: field appears outside [[IgnoredVulns]]`,
      )
    }

    const assignment = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.+)$/)
    if (!assignment) {
      throw new GateError('indeterminate', `policy line ${lineNumber}: invalid syntax`)
    }
    const [, field, rawValue] = assignment
    if (!['id', 'reason', 'ignoreUntil'].includes(field)) {
      throw new GateError('indeterminate', `policy line ${lineNumber}: unknown field ${field}`)
    }
    if (field in current) {
      throw new GateError('indeterminate', `policy line ${lineNumber}: duplicate field ${field}`)
    }
    current[field] =
      field === 'ignoreUntil' ? rawValue : parseQuotedValue(rawValue, field, lineNumber)
  }
  finishCurrent(lines.length)
  return exceptions
}

// The peer dependencies shotwright is allowed to declare (ADR 0002).
const ALLOWED_PEER_DEPENDENCIES = new Set(['@playwright/test'])

// The reviewed runtime dependencies (ADR 0019, amendment 2026-10-22). Until
// then the invariant was zero runtime dependencies; an empty allowlist restores
// exactly that.
export const RUNTIME_ALLOWLIST_PATH = 'scripts/ci/runtime-dependency-allowlist.txt'

export function parseRuntimeAllowlist(text) {
  const reviewed = new Map()
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '' || line.startsWith('#')) continue
    const entry = line.match(
      /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)$/,
    )
    if (!entry) {
      throw new GateError(
        'indeterminate',
        `runtime-dependency allowlist line ${index + 1}: expected name@exact-version`,
      )
    }
    if (reviewed.has(entry[1])) {
      throw new GateError(
        'indeterminate',
        `runtime-dependency allowlist line ${index + 1}: duplicate entry for ${entry[1]}`,
      )
    }
    reviewed.set(entry[1], entry[2])
  }
  return reviewed
}

function unquoteLockKey(raw) {
  return /^'.*'$/.test(raw) ? raw.slice(1, -1).replaceAll("''", "'") : raw
}

// Reads what the root importer's `dependencies` resolve to and the dependency
// edges of every snapshot, from a pnpm 9.0-schema lockfile. Only the shapes pnpm
// writes are accepted; anything else leaves an entry unresolved, and an
// unresolved entry fails the gate rather than passing it.
export function readPnpmRuntimeGraph(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const importersAt = lines.indexOf('importers:')
  const snapshotsAt = lines.indexOf('snapshots:')
  if (importersAt < 0 || snapshotsAt < 0) {
    throw new GateError('indeterminate', 'pnpm lockfile must contain importers and snapshots maps')
  }

  const direct = new Map()
  let inRoot = false
  let inDependencies = false
  let name = null
  for (let index = importersAt + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    if (!line.startsWith(' ')) break
    if (/^ {2}\S/.test(line)) {
      inRoot = line === '  .:'
      inDependencies = false
      name = null
    } else if (inRoot && /^ {4}\S/.test(line)) {
      inDependencies = line === '    dependencies:'
      name = null
    } else if (inRoot && inDependencies) {
      const key = line.match(/^ {6}(\S.*):$/)
      const version = line.match(/^ {8}version: (\S+)$/)
      if (key) {
        name = unquoteLockKey(key[1])
        if (direct.has(name)) {
          throw new GateError('indeterminate', `pnpm lockfile repeats importer dependency ${name}`)
        }
        direct.set(name, undefined)
      } else if (version && name !== null) {
        direct.set(name, version[1])
      }
    }
  }

  const snapshots = new Map()
  let snapshot = null
  let collecting = false
  for (let index = snapshotsAt + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    if (!line.startsWith(' ')) break
    const key = line.match(/^ {2}(\S.*?):(?: \{\})?$/)
    if (key) {
      snapshot = unquoteLockKey(key[1])
      snapshots.set(snapshot, [])
      collecting = false
    } else if (/^ {4}\S/.test(line)) {
      collecting = snapshot !== null && /^ {4}(?:dependencies|optionalDependencies):$/.test(line)
    } else if (collecting) {
      const edge = line.match(/^ {6}(\S.*?): (\S+)$/)
      if (edge) snapshots.get(snapshot).push([unquoteLockKey(edge[1]), edge[2]])
    }
  }
  return { direct, snapshots }
}

// Returns the verified runtime closure as sorted `name version` strings.
export function validateRuntimePackage(text, { allowlist = '', lockfile = null } = {}) {
  let packageJson
  try {
    packageJson = JSON.parse(text)
  } catch {
    throw new GateError('indeterminate', 'package.json is not valid JSON')
  }
  if (!isPlainObject(packageJson)) {
    throw new GateError('indeterminate', 'package.json must contain an object')
  }
  const reviewed = parseRuntimeAllowlist(allowlist)
  // Every key that makes a package install something alongside shotwright, not
  // only `dependencies`: an optional or bundled dependency reaches the consumer
  // just the same, and until 2026-10-07 the invariant quietly checked one key
  // of the four (audit C-04). bundledDependencies is the documented spelling;
  // bundleDependencies is the alias npm also honours. Peer dependencies are
  // the consumer's own install, and ADR 0002 names the one shotwright may
  // declare; any other peer is a policy failure like a runtime dependency.
  // Only `dependencies` may use the reviewed allowlist; the other keys stay at
  // zero.
  const runtimeKeys = [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ]
  const found = new Set()
  const details = []
  const declared = []
  for (const key of runtimeKeys) {
    const value = packageJson[key]
    if (value === undefined) continue
    if (Array.isArray(value) && key.startsWith('bundle')) {
      for (const name of value) found.add(`${name} (${key})`)
      continue
    }
    if (!isPlainObject(value)) {
      throw new GateError('indeterminate', `package.json ${key} must be an object`)
    }
    for (const name of Object.keys(value)) {
      if (key === 'peerDependencies' && ALLOWED_PEER_DEPENDENCIES.has(name)) continue
      if (key === 'dependencies') declared.push(name)
      else found.add(`${name} (${key})`)
    }
  }

  const queue = []
  for (const name of declared) {
    if (reviewed.has(name)) {
      queue.push({ name, parent: null })
    } else {
      found.add(`${name} (dependencies)`)
      details.push(`${name}: not in the reviewed allowlist ${RUNTIME_ALLOWLIST_PATH}`)
    }
  }

  // Walk the resolved closure, so a reviewed package cannot bring in an
  // unreviewed one: every package it resolves to must be allowlisted too.
  const verified = []
  const closureNames = new Set()
  if (queue.length > 0) {
    if (lockfile === null) {
      throw new GateError(
        'indeterminate',
        'pnpm lockfile is required to check runtime dependencies',
      )
    }
    const graph = readPnpmRuntimeGraph(lockfile)
    for (const item of queue) item.version = graph.direct.get(item.name)
    const seen = new Set()
    while (queue.length > 0) {
      const { name, version, parent } = queue.shift()
      const where = parent === null ? 'dependencies' : `via ${parent}`
      closureNames.add(name)
      if (version === undefined) {
        found.add(`${name} (${where})`)
        details.push(`${name}: package.json declares it but pnpm-lock.yaml does not resolve it`)
        continue
      }
      const identity = `${name}@${version}`
      if (seen.has(identity)) continue
      seen.add(identity)
      const resolved = version.replace(/\(.*$/, '')
      const expected = reviewed.get(name)
      if (expected === undefined) {
        found.add(`${name} (${where})`)
        details.push(`${name}@${resolved}: not in the reviewed allowlist ${RUNTIME_ALLOWLIST_PATH}`)
      } else if (expected !== resolved) {
        found.add(`${name} (${where})`)
        details.push(
          `${name}: pnpm-lock.yaml resolves ${resolved}; the allowlist reviewed ${expected}`,
        )
      } else {
        verified.push(`${name} ${resolved}`)
      }
      const edges = graph.snapshots.get(identity)
      if (edges === undefined) {
        throw new GateError('indeterminate', `pnpm lockfile has no snapshot for ${identity}`)
      }
      for (const [child, childVersion] of edges) {
        queue.push({ name: child, version: childVersion, parent: `${name}@${resolved}` })
      }
    }
  }

  if (found.size > 0) {
    throw new GateError(
      'policy',
      `shotwright has runtime dependencies: ${[...found].sort().join(', ')}`,
      details,
    )
  }
  const stale = [...reviewed]
    .filter(([name]) => !closureNames.has(name))
    .map(([name, version]) => `${name}@${version}`)
  if (stale.length > 0) {
    throw new GateError(
      'policy',
      `${RUNTIME_ALLOWLIST_PATH} names packages that are not runtime dependencies: ${stale.join(', ')}`,
      ['remove stale entries so the reviewed allowlist stays exact'],
    )
  }
  return [...new Set(verified)].sort()
}

export function readPnpmLockPackageCount(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const versions = lines.filter((line) => line.startsWith('lockfileVersion:'))
  if (versions.length !== 1 || versions[0] !== "lockfileVersion: '9.0'") {
    throw new GateError(
      'indeterminate',
      "pnpm lockfile must declare exactly lockfileVersion: '9.0'",
    )
  }

  const packagesStarts = lines
    .map((line, index) => (line === 'packages:' ? index : -1))
    .filter((index) => index >= 0)
  const snapshotsStarts = lines
    .map((line, index) => (line === 'snapshots:' ? index : -1))
    .filter((index) => index >= 0)
  if (packagesStarts.length !== 1 || snapshotsStarts.length !== 1) {
    throw new GateError(
      'indeterminate',
      'pnpm lockfile must contain exactly one packages and one snapshots map',
    )
  }
  const start = packagesStarts[0]
  const end = snapshotsStarts[0]
  if (end <= start) {
    throw new GateError('indeterminate', 'pnpm lockfile snapshots map precedes packages')
  }

  const keys = new Set()
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!line.startsWith(' ')) {
      throw new GateError(
        'indeterminate',
        `pnpm lockfile has an unexpected top-level line inside packages at ${index + 1}`,
      )
    }
    if (line.startsWith('    ')) continue
    const entry = line.match(/^ {2}(\S.*?):(?: \{\})?$/)
    if (!entry) {
      throw new GateError(
        'indeterminate',
        `pnpm lockfile has an invalid package key at line ${index + 1}`,
      )
    }
    if (keys.has(entry[1])) {
      throw new GateError('indeterminate', `pnpm lockfile repeats package key ${entry[1]}`)
    }
    keys.add(entry[1])
  }
  if (keys.size === 0) {
    throw new GateError('indeterminate', 'pnpm lockfile packages map is empty')
  }
  return keys.size
}

function inspectResultJson(text, expectedPath, expectedPackages) {
  let document
  try {
    document = JSON.parse(text)
  } catch {
    throw new GateError('indeterminate', 'scanner stdout is not valid JSON')
  }
  if (!isPlainObject(document) || !Array.isArray(document.results)) {
    throw new GateError('indeterminate', 'scanner JSON has no results array')
  }
  if (document.results.length !== 1) {
    throw new GateError(
      'indeterminate',
      `scanner JSON contains ${document.results.length} results; expected exactly 1`,
    )
  }
  const result = document.results[0]
  if (!isPlainObject(result) || !isPlainObject(result.source)) {
    throw new GateError('indeterminate', 'scanner result has no source object')
  }
  if (result.source.type !== 'lockfile' || typeof result.source.path !== 'string') {
    throw new GateError('indeterminate', 'scanner result source is not a lockfile path')
  }
  if (resolve(result.source.path) !== resolve(expectedPath)) {
    throw new GateError('indeterminate', 'scanner result names the wrong lockfile source')
  }
  if (!Array.isArray(result.packages)) {
    throw new GateError('indeterminate', 'scanner result has no packages array')
  }
  if (result.packages.length !== expectedPackages) {
    throw new GateError(
      'indeterminate',
      `scanner extracted ${result.packages.length} packages; lockfile contains ${expectedPackages}`,
    )
  }

  const findings = []
  const seenPackages = new Set()
  for (const entry of result.packages) {
    if (!isPlainObject(entry) || !isPlainObject(entry.package)) {
      throw new GateError('indeterminate', 'scanner result contains a malformed package')
    }
    const { name, version, ecosystem } = entry.package
    if (
      typeof name !== 'string' ||
      name === '' ||
      typeof version !== 'string' ||
      version === '' ||
      ecosystem !== 'npm'
    ) {
      throw new GateError('indeterminate', 'scanner result contains an invalid npm package')
    }
    const identity = `${name}@${version}`
    if (seenPackages.has(identity)) {
      throw new GateError('indeterminate', `scanner result repeats package ${identity}`)
    }
    seenPackages.add(identity)
    const vulnerabilities = entry.vulnerabilities ?? []
    if (!Array.isArray(vulnerabilities)) {
      throw new GateError(
        'indeterminate',
        `scanner result has invalid vulnerabilities for ${name}@${version}`,
      )
    }
    for (const vulnerability of vulnerabilities) {
      if (!isPlainObject(vulnerability) || typeof vulnerability.id !== 'string') {
        throw new GateError('indeterminate', 'scanner result contains a malformed vulnerability')
      }
      const aliases = vulnerability.aliases ?? []
      if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== 'string')) {
        throw new GateError(
          'indeterminate',
          `scanner result contains invalid aliases for ${vulnerability.id}`,
        )
      }
      findings.push({
        package: `${name}@${version}`,
        ids: [...new Set([vulnerability.id, ...aliases])],
      })
    }
  }
  return { packageCount: result.packages.length, findings }
}

function processProblem(result) {
  if (result.timedOut) return 'scanner exceeded its external deadline'
  if (result.overflow) return 'scanner output exceeded the 16 MiB safety bound'
  if (result.spawnError) {
    return `scanner could not start (${result.spawnError.code ?? result.spawnError.name})`
  }
  if (result.signal) return `scanner was terminated by ${result.signal}`
  return null
}

function compactStderr(stderr, root, replacements = []) {
  let clean = stderr.trim()
  for (const value of [root, ...replacements]) {
    if (value) clean = clean.replaceAll(value, value === root ? '.' : '<temporary>')
  }
  return clean.split('\n').filter(Boolean).slice(-3)
}

export function classifyCurrent(result, expectedPath, expectedPackages) {
  const problem = processProblem(result)
  if (problem) return { kind: 'indeterminate', reason: problem }
  if (![0, 1].includes(result.code)) {
    return { kind: 'indeterminate', reason: `scanner exited ${result.code}` }
  }
  let inspected
  try {
    inspected = inspectResultJson(result.stdout, expectedPath, expectedPackages)
  } catch (error) {
    if (error instanceof GateError) {
      if (result.code === 1) {
        return {
          kind: 'vulnerable',
          findings: [],
          reason: `scanner reported findings but its JSON was invalid: ${error.message}`,
        }
      }
      return { kind: 'indeterminate', reason: error.message }
    }
    throw error
  }
  if (result.code === 1) {
    return { kind: 'vulnerable', ...inspected }
  }
  if (result.code === 0 && inspected.findings.length === 0) {
    return { kind: 'clean', ...inspected }
  }
  return {
    kind: 'indeterminate',
    reason: `scanner exit ${result.code} disagrees with ${inspected.findings.length} findings`,
  }
}

export function classifyCanary(result, expectedPath, expectedPackages = 1) {
  const problem = processProblem(result)
  if (problem) return { kind: 'indeterminate', reason: problem }
  if (result.code !== 1) {
    return { kind: 'indeterminate', reason: `canary scanner exited ${result.code}; expected 1` }
  }
  let inspected
  try {
    inspected = inspectResultJson(result.stdout, expectedPath, expectedPackages)
  } catch (error) {
    if (error instanceof GateError) return { kind: 'indeterminate', reason: error.message }
    throw error
  }
  const detected = inspected.findings.some((finding) => finding.ids.includes(CANARY_ADVISORY))
  if (!detected) {
    return {
      kind: 'indeterminate',
      reason: `canary did not report ${CANARY_ADVISORY}`,
    }
  }
  return { kind: 'detected', ...inspected }
}

function findingDetails(findings) {
  return findings.map((finding) => `${finding.package}: ${finding.ids.join(', ')}`)
}

async function verifyScannerIdentity({
  scannerPath,
  expectedVersion,
  expectedSha256,
  root,
  execute,
}) {
  let scannerBytes
  try {
    scannerBytes = await readFile(scannerPath)
  } catch (error) {
    throw new GateError('indeterminate', `could not read osv-scanner (${error.code ?? error.name})`)
  }
  const actualSha256 = createHash('sha256').update(scannerBytes).digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new GateError(
      'indeterminate',
      `osv-scanner checksum mismatch (expected ${expectedSha256}, got ${actualSha256})`,
    )
  }
  const result = await execute({
    target: 'identity',
    mode: 'identity',
    args: ['--version'],
    cwd: root,
    env: process.env,
    timeoutMs: IDENTITY_TIMEOUT_MS,
  })
  const problem = processProblem(result)
  if (problem) throw new GateError('indeterminate', problem)
  if (result.code !== 0) {
    throw new GateError('indeterminate', `osv-scanner --version exited ${result.code}`)
  }
  const match = result.stdout.match(/^osv-scanner version: (\S+)$/m)
  if (!match || match[1] !== expectedVersion) {
    throw new GateError(
      'indeterminate',
      `osv-scanner reports '${match?.[1] ?? 'no version'}'; expected '${expectedVersion}'`,
    )
  }
}

function scanArgs({ lockfile, config, offline, download }) {
  const args = [
    'scan',
    'source',
    '--format=json',
    '--all-packages',
    '--verbosity=error',
    '--config',
    config,
  ]
  if (offline) args.push('--offline-vulnerabilities')
  if (download) args.push('--download-offline-databases')
  args.push('--lockfile', lockfile)
  return args
}

async function runPair({
  mode,
  root,
  currentLock,
  currentPackages,
  canaryLock,
  canaryPackages,
  policyPath,
  emptyConfig,
  cacheDir,
  execute,
}) {
  const offline = mode === 'fresh-database'
  const env = { ...process.env }
  if (offline) env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY = cacheDir
  else delete env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY
  const currentResult = await execute({
    target: 'current',
    mode,
    args: scanArgs({
      lockfile: currentLock,
      config: policyPath,
      offline,
      download: offline,
    }),
    cwd: root,
    env,
    timeoutMs: offline ? DOWNLOAD_TIMEOUT_MS : ONLINE_TIMEOUT_MS,
  })
  const current = classifyCurrent(currentResult, currentLock, currentPackages)
  if (current.kind !== 'clean') {
    return {
      target: 'current',
      classification: current,
      stderr: compactStderr(currentResult.stderr, root, [cacheDir]),
    }
  }

  const canaryResult = await execute({
    target: 'canary',
    mode,
    args: scanArgs({
      lockfile: canaryLock,
      config: emptyConfig,
      offline,
      download: false,
    }),
    cwd: root,
    env,
    timeoutMs: ONLINE_TIMEOUT_MS,
  })
  const canary = classifyCanary(canaryResult, canaryLock, canaryPackages)
  if (canary.kind !== 'detected') {
    return {
      target: 'canary',
      classification: canary,
      stderr: compactStderr(canaryResult.stderr, root, [cacheDir]),
    }
  }
  return { target: 'pair', classification: { kind: 'clean' } }
}

function describePairFailure(result) {
  const detail = result.stderr.length > 0 ? ` (${result.stderr.join(' | ')})` : ''
  return `${result.target}: ${result.classification.reason}${detail}`
}

export async function runGate({
  root,
  scannerPath,
  expectedVersion,
  expectedSha256,
  execute,
  log = console.log,
  warn = console.warn,
}) {
  const canonicalRoot = await realpath(root)
  const currentLock = await realpath(join(canonicalRoot, 'pnpm-lock.yaml'))
  const canaryLock = await realpath(
    join(canonicalRoot, 'test/fixtures/audit-gate/vulnerable/pnpm-lock.yaml'),
  )
  const packagePath = join(canonicalRoot, 'package.json')
  const policyPath = join(canonicalRoot, 'osv-scanner.toml')
  const allowlistPath = join(canonicalRoot, RUNTIME_ALLOWLIST_PATH)
  const command =
    execute ??
    ((options) =>
      runProcess(scannerPath, options.args, {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs,
      }))

  log('==> audit gate: local package invariants')
  let allowlist
  try {
    allowlist = await readFile(allowlistPath, 'utf8')
  } catch (error) {
    throw new GateError(
      'indeterminate',
      `could not read ${RUNTIME_ALLOWLIST_PATH} (${error.code ?? error.name})`,
    )
  }
  const currentLockText = await readFile(currentLock, 'utf8')
  const runtime = validateRuntimePackage(await readFile(packagePath, 'utf8'), {
    allowlist,
    lockfile: currentLockText,
  })
  const exceptions = parsePolicy(await readFile(policyPath, 'utf8'))
  const currentPackages = readPnpmLockPackageCount(currentLockText)
  const canaryPackages = readPnpmLockPackageCount(await readFile(canaryLock, 'utf8'))
  if (canaryPackages !== 1) {
    throw new GateError(
      'indeterminate',
      `canary lockfile contains ${canaryPackages} packages; expected 1`,
    )
  }
  log(
    runtime.length === 0
      ? '    ok: zero runtime dependencies; the reviewed allowlist is empty'
      : `    ok: runtime dependencies match the reviewed allowlist (${runtime.join(', ')})`,
  )
  log(`    ok: ${exceptions.length} active exceptions`)
  log(`    ok: pnpm lockfile schema 9.0 with ${currentPackages} packages`)

  log('==> audit gate: scanner identity')
  await verifyScannerIdentity({
    scannerPath,
    expectedVersion,
    expectedSha256,
    root: canonicalRoot,
    execute: command,
  })
  log(`    ok: OSV-Scanner ${expectedVersion} matches the reviewed checksum`)

  const work = await mkdtemp(join(tmpdir(), 'shotwright-osv-gate-'))
  try {
    const emptyConfig = join(work, 'empty-osv-scanner.toml')
    const cacheDir = join(work, 'fresh-cache')
    await writeFile(emptyConfig, '# Deliberately empty: the canary is never excepted.\n')
    await mkdir(cacheDir)
    if ((await readdir(cacheDir)).length !== 0) {
      throw new GateError('indeterminate', 'fresh fallback cache was not empty')
    }

    log('==> audit gate: online OSV API')
    const online = await runPair({
      mode: 'online',
      root: canonicalRoot,
      currentLock,
      currentPackages,
      canaryLock,
      canaryPackages,
      policyPath,
      emptyConfig,
      cacheDir,
      execute: command,
    })
    if (online.classification.kind === 'vulnerable') {
      throw new GateError(
        'vulnerable',
        'current pnpm lockfile has known vulnerabilities',
        findingDetails(online.classification.findings),
      )
    }
    if (online.classification.kind === 'clean') {
      log(`    ok: ${currentPackages} current packages clean; live canary detected`)
      log('==> audit gate: PASSED')
      return
    }

    warn(`audit gate: online result indeterminate — ${describePairFailure(online)}`)
    warn('audit gate: retrying once with a freshly downloaded OSV database')
    const fallback = await runPair({
      mode: 'fresh-database',
      root: canonicalRoot,
      currentLock,
      currentPackages,
      canaryLock,
      canaryPackages,
      policyPath,
      emptyConfig,
      cacheDir,
      execute: command,
    })
    if (fallback.classification.kind === 'vulnerable') {
      throw new GateError(
        'vulnerable',
        'current pnpm lockfile has known vulnerabilities',
        findingDetails(fallback.classification.findings),
      )
    }
    if (fallback.classification.kind !== 'clean') {
      throw new GateError(
        'indeterminate',
        `online and fresh-database paths failed; ${describePairFailure(fallback)}`,
      )
    }
    log(`    ok: ${currentPackages} current packages clean; live canary detected`)
    log('==> audit gate: PASSED via fresh OSV database')
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function cli() {
  if (process.argv.length !== 6) {
    console.error('usage: osv-gate.mjs <root> <scanner> <version> <sha256>')
    process.exitCode = 2
    return
  }
  const [, , root, scannerPath, expectedVersion, expectedSha256] = process.argv
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion) || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    console.error('audit gate: INDETERMINATE — invalid scanner pin supplied by wrapper')
    process.exitCode = 2
    return
  }
  try {
    await runGate({ root, scannerPath, expectedVersion, expectedSha256 })
  } catch (error) {
    if (!(error instanceof GateError)) {
      console.error(
        `audit gate: INDETERMINATE — internal gate error (${error.code ?? error.name ?? 'unknown'})`,
      )
      process.exitCode = 2
      return
    }
    const label =
      error.kind === 'vulnerable'
        ? 'VULNERABLE'
        : error.kind === 'policy'
          ? 'POLICY FAILURE'
          : 'INDETERMINATE'
    console.error(`audit gate: ${label} — ${error.message}`)
    for (const detail of error.details) console.error(`  ${detail}`)
    process.exitCode = error.kind === 'indeterminate' ? 2 : 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) await cli()

export { GateError }
