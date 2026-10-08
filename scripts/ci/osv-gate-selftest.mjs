import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CANARY_ADVISORY,
  GateError,
  classifyCanary,
  classifyCurrent,
  parsePolicy,
  readPnpmLockPackageCount,
  runGate,
  runProcess,
  validateRuntimePackage,
} from './osv-gate.mjs'

let failures = 0

async function check(name, test) {
  try {
    await test()
    console.log(`  ok    ${name}`)
  } catch (error) {
    failures += 1
    console.error(`  FAIL  ${name}`)
    console.error(`        ${error.stack ?? error}`)
  }
}

function lockfile(packageKey = 'safe-package@1.0.0') {
  return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .: {}

packages:

  ${packageKey}: {}

snapshots:

  ${packageKey}: {}
`
}

function processResult({ code = 0, stdout = '', stderr = '', ...rest } = {}) {
  return {
    code,
    signal: null,
    stdout,
    stderr,
    spawnError: undefined,
    timedOut: false,
    overflow: false,
    ...rest,
  }
}

function scanJson(
  path,
  { canary = false, differentAdvisory = false, finding = false, severity } = {},
) {
  const vulnerability = differentAdvisory
    ? { id: 'GHSA-aaaa-bbbb-cccc' }
    : {
        id: canary ? 'CVE-2021-23337' : 'GHSA-aaaa-bbbb-cccc',
        aliases: canary ? [CANARY_ADVISORY] : [],
        ...(severity ? { severity } : {}),
      }
  return JSON.stringify({
    results: [
      {
        source: { path, type: 'lockfile' },
        packages: [
          {
            package: {
              name: canary ? 'lodash' : 'safe-package',
              version: canary ? '4.17.20' : '1.0.0',
              ecosystem: 'npm',
            },
            ...(canary || differentAdvisory || finding
              ? { vulnerabilities: [vulnerability] }
              : {}),
          },
        ],
      },
    ],
  })
}

async function expectGateError(action, kind) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof GateError)
    assert.equal(error.kind, kind)
    return true
  })
}

async function createProject({
  packageJson = { name: 'fixture' },
  policy = '# no exceptions\n',
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'shotwright-osv-selftest-'))
  await mkdir(join(root, 'test/fixtures/audit-gate/vulnerable'), { recursive: true })
  await writeFile(join(root, 'package.json'), `${JSON.stringify(packageJson)}\n`)
  await writeFile(join(root, 'osv-scanner.toml'), policy)
  await writeFile(join(root, 'pnpm-lock.yaml'), lockfile())
  await writeFile(
    join(root, 'test/fixtures/audit-gate/vulnerable/pnpm-lock.yaml'),
    lockfile('lodash@4.17.20'),
  )
  const scannerPath = join(root, 'fake-osv-scanner')
  const scannerBytes = Buffer.from('reviewed fake scanner bytes\n')
  await writeFile(scannerPath, scannerBytes)
  return {
    root,
    scannerPath,
    expectedSha256: createHash('sha256').update(scannerBytes).digest('hex'),
  }
}

async function withProject(options, action) {
  const project = await createProject(options)
  try {
    await action(project)
  } finally {
    await rm(project.root, { recursive: true, force: true })
  }
}

function lockfileArg(call) {
  const index = call.args.indexOf('--lockfile')
  assert.ok(index >= 0)
  return call.args[index + 1]
}

function fakeExecutor(calls, overrides = {}) {
  return async (call) => {
    calls.push(call)
    if (call.target === 'identity') {
      return overrides.identity ?? processResult({
        stdout: 'osv-scanner version: 2.5.1\nosv-scalibr version: test\n',
      })
    }
    const key = `${call.mode}:${call.target}`
    if (overrides[key]) return overrides[key](call)

    const path = lockfileArg(call)
    if (call.mode === 'fresh-database' && call.target === 'current') {
      assert.ok(call.args.includes('--download-offline-databases'))
      await writeFile(
        join(call.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY, 'downloaded'),
        'fresh\n',
      )
    }
    if (call.mode === 'fresh-database' && call.target === 'canary') {
      assert.ok(!call.args.includes('--download-offline-databases'))
      assert.equal(
        await readFile(
          join(call.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY, 'downloaded'),
          'utf8',
        ),
        'fresh\n',
      )
    }
    return call.target === 'canary'
      ? processResult({ code: 1, stdout: scanJson(path, { canary: true }) })
      : processResult({ stdout: scanJson(path) })
  }
}

async function runFixtureGate(project, execute, logs = []) {
  await runGate({
    ...project,
    expectedVersion: '2.5.1',
    execute,
    log: (message) => logs.push(message),
    warn: (message) => logs.push(message),
  })
}

console.log('==> audit-gate-selftest: pure policy and classifier checks')

await check('runtime dependency map may be absent or empty', () => {
  validateRuntimePackage('{"name":"fixture"}')
  validateRuntimePackage('{"dependencies":{}}')
})

await check('runtime dependency names are reported as a policy failure', () => {
  assert.throws(
    () => validateRuntimePackage('{"dependencies":{"zeta":"1","alpha":"1"}}'),
    (error) =>
      error instanceof GateError &&
      error.kind === 'policy' &&
      error.message.includes('alpha (dependencies), zeta (dependencies)'),
  )
})

await check('optional, peer and bundled dependencies are runtime dependencies too', () => {
  for (const [key, value] of [
    ['optionalDependencies', '{"opt":"1"}'],
    ['peerDependencies', '{"peer":"1"}'],
    ['bundledDependencies', '["bun"]'],
    ['bundleDependencies', '["bun"]'],
  ]) {
    assert.throws(
      () => validateRuntimePackage(`{"${key}":${value}}`),
      (error) =>
        error instanceof GateError && error.kind === 'policy' && error.message.includes(`(${key})`),
      key,
    )
  }
  assert.throws(
    () => validateRuntimePackage('{"peerDependencies":"nope"}'),
    (error) => error instanceof GateError && error.kind === 'indeterminate',
  )
})

await check('the ADR 0002 peer dependency is the only peer the gate accepts', () => {
  validateRuntimePackage('{"peerDependencies":{"@playwright/test":">=1.60 <2"}}')
  assert.throws(
    () => validateRuntimePackage(
      '{"peerDependencies":{"@playwright/test":">=1.60 <2","left-pad":"1"}}',
    ),
    (error) =>
      error instanceof GateError &&
      error.kind === 'policy' &&
      error.message === 'shotwright has runtime dependencies: left-pad (peerDependencies)',
  )
})

await check('empty policy and complete future exception are valid', () => {
  assert.deepEqual(parsePolicy('# empty\n', '2026-09-03'), [])
  assert.equal(
    parsePolicy(
      '[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nreason = "not reachable"\nignoreUntil = 2026-09-04\n',
      '2026-09-03',
    ).length,
    1,
  )
})

for (const [name, policy] of [
  ['missing id', '[[IgnoredVulns]]\nreason = "x"\nignoreUntil = 2026-09-04\n'],
  ['missing reason', '[[IgnoredVulns]]\nid = "GHSA-a"\nignoreUntil = 2026-09-04\n'],
  ['missing expiry', '[[IgnoredVulns]]\nid = "GHSA-a"\nreason = "x"\n'],
  ['expiry today', '[[IgnoredVulns]]\nid = "GHSA-a"\nreason = "x"\nignoreUntil = 2026-09-03\n'],
  ['past expiry', '[[IgnoredVulns]]\nid = "GHSA-a"\nreason = "x"\nignoreUntil = 2026-09-02\n'],
  ['invalid date', '[[IgnoredVulns]]\nid = "GHSA-a"\nreason = "x"\nignoreUntil = 2026-02-30\n'],
  ['unknown field', '[[IgnoredVulns]]\nid = "GHSA-a"\nreason = "x"\nignoreUntil = 2026-09-04\nwide = true\n'],
  ['package override', '[[PackageOverrides]]\nname = "lodash"\nignore = true\n'],
  ['duplicate ID', '[[IgnoredVulns]]\nid = "GHSA-a"\nreason = "x"\nignoreUntil = 2026-09-04\n[[IgnoredVulns]]\nid = "ghsa-a"\nreason = "y"\nignoreUntil = 2026-09-05\n'],
]) {
  await check(`policy rejects ${name}`, () => {
    assert.throws(() => parsePolicy(policy, '2026-09-03'), GateError)
  })
}

await check('lockfile reader accepts schema 9.0 and quoted scoped keys', () => {
  assert.equal(readPnpmLockPackageCount(lockfile("'@scope/name@1.0.0'")), 1)
})

for (const [name, text] of [
  ['wrong schema', lockfile().replace("'9.0'", "'8.0'")],
  ['empty package map', lockfile().replace('  safe-package@1.0.0: {}\n', '')],
  ['duplicate package key', lockfile().replace('snapshots:', '  safe-package@1.0.0: {}\n\nsnapshots:')],
  ['missing snapshots map', lockfile().replace('snapshots:', 'resolved:')],
]) {
  await check(`lockfile reader rejects ${name}`, () => {
    assert.throws(() => readPnpmLockPackageCount(text), GateError)
  })
}

await withProject({}, async (project) => {
  const current = join(project.root, 'pnpm-lock.yaml')
  const canary = join(project.root, 'test/fixtures/audit-gate/vulnerable/pnpm-lock.yaml')

  await check('clean JSON requires exit 0 and the exact denominator', () => {
    assert.equal(
      classifyCurrent(processResult({ stdout: scanJson(current) }), current, 1).kind,
      'clean',
    )
  })

  await check('findings fail regardless of severity metadata', () => {
    for (const severity of [undefined, 'LOW', 'CRITICAL']) {
      assert.equal(
        classifyCurrent(
          processResult({ code: 1, stdout: scanJson(current, { finding: true, severity }) }),
          current,
          1,
        ).kind,
        'vulnerable',
      )
    }
  })

  for (const [name, result, count] of [
    ['malformed JSON', processResult({ stdout: '{' }), 1],
    ['empty result set', processResult({ stdout: '{"results":[]}' }), 1],
    ['wrong package count', processResult({ stdout: scanJson(current) }), 2],
    ['no-package exit', processResult({ code: 128 }), 1],
    ['general error exit', processResult({ code: 127 }), 1],
    ['timeout', processResult({ timedOut: true }), 1],
    ['exit/finding disagreement', processResult({ code: 0, stdout: scanJson(current, { finding: true, severity: 'LOW' }) }), 1],
    ['wrong source', processResult({ stdout: scanJson(canary) }), 1],
    [
      'duplicate extracted package',
      processResult({
        stdout: (() => {
          const duplicate = JSON.parse(scanJson(current))
          duplicate.results[0].packages.push(duplicate.results[0].packages[0])
          return JSON.stringify(duplicate)
        })(),
      }),
      2,
    ],
  ]) {
    await check(`current classifier marks ${name} indeterminate`, () => {
      assert.equal(classifyCurrent(result, current, count).kind, 'indeterminate')
    })
  }

  await check('canary accepts the pinned GHSA through aliases', () => {
    assert.equal(
      classifyCanary(
        processResult({ code: 1, stdout: scanJson(canary, { canary: true }) }),
        canary,
      ).kind,
      'detected',
    )
  })

  await check('canary rejects a different advisory', () => {
    assert.equal(
      classifyCanary(
        processResult({ code: 1, stdout: scanJson(canary, { differentAdvisory: true }) }),
        canary,
      ).kind,
      'indeterminate',
    )
  })
})

await check('portable process deadline terminates a hung child', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 10_000)'],
    { cwd: process.cwd(), timeoutMs: 20 },
  )
  assert.equal(result.timedOut, true)
  assert.notEqual(result.code, 0)
})

console.log('==> audit-gate-selftest: orchestration checks')

await check('online clean current plus detected canary passes without fallback', () =>
  withProject({}, async (project) => {
    const calls = []
    await runFixtureGate(project, fakeExecutor(calls))
    assert.deepEqual(calls.map(({ mode, target }) => `${mode}:${target}`), [
      'identity:identity',
      'online:current',
      'online:canary',
    ])
  }))

await check('a current finding fails immediately and never falls back', () =>
  withProject({}, async (project) => {
    const calls = []
    const execute = fakeExecutor(calls, {
      'online:current': (call) => processResult({
        code: 1,
        stdout: scanJson(lockfileArg(call), { finding: true, severity: 'LOW' }),
      }),
    })
    await expectGateError(() => runFixtureGate(project, execute), 'vulnerable')
    assert.equal(calls.some(({ mode }) => mode === 'fresh-database'), false)
  }))

await check('current exit 1 with malformed JSON still never falls back', () =>
  withProject({}, async (project) => {
    const calls = []
    const execute = fakeExecutor(calls, {
      'online:current': () => processResult({ code: 1, stdout: '{}' }),
    })
    await expectGateError(() => runFixtureGate(project, execute), 'vulnerable')
    assert.equal(calls.some(({ mode }) => mode === 'fresh-database'), false)
  }))

await check('online error uses one isolated fresh-database pair', () =>
  withProject({}, async (project) => {
    const calls = []
    const logs = []
    const sentinel = join(project.root, 'ordinary-cache')
    await mkdir(sentinel)
    const previous = process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY
    process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY = sentinel
    try {
      const execute = fakeExecutor(calls, {
        'online:current': () => processResult({
          code: 127,
          stderr: `API unavailable while reading ${join(project.root, 'pnpm-lock.yaml')}`,
        }),
      })
      await runFixtureGate(project, execute, logs)
    } finally {
      if (previous === undefined) delete process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY
      else process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY = previous
    }
    const online = calls.filter(({ mode }) => mode === 'online')
    const fallback = calls.filter(({ mode }) => mode === 'fresh-database')
    assert.equal(online[0].env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY, undefined)
    assert.equal(fallback.length, 2)
    assert.equal(
      fallback[0].env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY,
      fallback[1].env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY,
    )
    assert.notEqual(fallback[0].env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY, sentinel)
    assert.equal(logs.join('\n').includes(project.root), false)
  }))

await check('missing online canary retries the complete pair', () =>
  withProject({}, async (project) => {
    const calls = []
    const execute = fakeExecutor(calls, {
      'online:canary': (call) => processResult({
        code: 1,
        stdout: scanJson(lockfileArg(call), { differentAdvisory: true }),
      }),
    })
    await runFixtureGate(project, execute)
    assert.deepEqual(
      calls.filter(({ mode }) => mode === 'fresh-database').map(({ target }) => target),
      ['current', 'canary'],
    )
  }))

await check('two unavailable sources fail indeterminate', () =>
  withProject({}, async (project) => {
    const calls = []
    const unavailable = () => processResult({ code: 127, stderr: 'unavailable' })
    const execute = fakeExecutor(calls, {
      'online:current': unavailable,
      'fresh-database:current': unavailable,
    })
    await expectGateError(() => runFixtureGate(project, execute), 'indeterminate')
  }))

await check('malformed output on both paths never becomes clean', () =>
  withProject({}, async (project) => {
    const calls = []
    const malformed = () => processResult({ stdout: '{}' })
    const execute = fakeExecutor(calls, {
      'online:current': malformed,
      'fresh-database:current': malformed,
    })
    await expectGateError(() => runFixtureGate(project, execute), 'indeterminate')
  }))

await check('production exception cannot mask the canary config', () =>
  withProject(
    {
      policy: `[[IgnoredVulns]]
id = "${CANARY_ADVISORY}"
reason = "self-test only"
ignoreUntil = 2099-01-01
`,
    },
    async (project) => {
      const calls = []
      await runFixtureGate(project, fakeExecutor(calls))
      const canaryCall = calls.find(({ target }) => target === 'canary')
      const configIndex = canaryCall.args.indexOf('--config')
      assert.ok(configIndex >= 0)
      assert.notEqual(canaryCall.args[configIndex + 1], join(project.root, 'osv-scanner.toml'))
    },
  ))

await check('wrong scanner version fails before dependency scans', () =>
  withProject({}, async (project) => {
    const calls = []
    const execute = fakeExecutor(calls, {
      identity: processResult({ stdout: 'osv-scanner version: 2.5.0\n' }),
    })
    await expectGateError(() => runFixtureGate(project, execute), 'indeterminate')
    assert.deepEqual(calls.map(({ target }) => target), ['identity'])
  }))

await check('wrong scanner checksum fails before executing it', () =>
  withProject({}, async (project) => {
    const calls = []
    await expectGateError(
      () => runFixtureGate(
        { ...project, expectedSha256: '0'.repeat(64) },
        fakeExecutor(calls),
      ),
      'indeterminate',
    )
    assert.equal(calls.length, 0)
  }))

await check('missing scanner file fails indeterminate', () =>
  withProject({}, async (project) => {
    const calls = []
    await expectGateError(
      () => runFixtureGate(
        { ...project, scannerPath: join(project.root, 'missing-scanner') },
        fakeExecutor(calls),
      ),
      'indeterminate',
    )
    assert.equal(calls.length, 0)
  }))

await check('runtime dependency fails before scanner identity or network', () =>
  withProject(
    { packageJson: { name: 'fixture', dependencies: { 'left-pad': '1.0.0' } } },
    async (project) => {
      const calls = []
      await expectGateError(() => runFixtureGate(project, fakeExecutor(calls)), 'policy')
      assert.equal(calls.length, 0)
    },
  ))

console.log('')
if (failures > 0) {
  console.error(`==> audit-gate-selftest: FAILED — ${failures} assertion(s)`)
  process.exit(1)
}
console.log('==> audit-gate-selftest: PASSED')
