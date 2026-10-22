import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  GalleryManifestError,
  loadGalleryModel,
  readPngModel,
  validateManifest,
  validateRelativePath,
} from '../../src/gallery/model.js'
import { MANIFEST_VERSION, type Manifest, type ShotEntry } from '../../src/manifest.js'
import { makePng } from '../fixtures/png.js'

const tmpDirs: string[] = []

function tmpDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-gallery-model-'))
  tmpDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function entry(overrides: Partial<ShotEntry> = {}): ShotEntry {
  return {
    name: 'shot',
    spec: 'home.shots.ts',
    file: 'shots/home/shot.png',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    fullPage: true,
    capturedAt: '2026-07-29T00:00:00.000Z',
    durationMs: 50,
    video: null,
    trace: null,
    testId: null, checked: false, retry: 0,
    ...overrides,
  }
}

function manifest(runId = 'run', shots: ShotEntry[] = [entry()]): Manifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    runId,
    startedAt: '2026-07-29T00:00:00.000Z',
    finishedAt: '2026-07-29T00:00:01.000Z',
    shotwrightVersion: '0.1.0',
    playwrightVersion: '1.62.0',
    flags: { only: [], video: false, trace: false },
    status: 'passed', publication: {gallery:{ok:true}, evidence:{ok:true}}, tests:[], artifacts:[], failures:[],
    shots,
  }
}

describe('validateManifest', () => {
  it('accepts the complete v2 shape, including nullable fields and an empty run', () => {
    const value = manifest('run', [
      entry({ viewport: null, deviceScaleFactor: null, video: null, trace: null }),
    ])
    expect(validateManifest(value, 'run')).toEqual(value)
    expect(validateManifest(manifest('run', []), 'run').shots).toEqual([])
  })

  it.each([
    ['non-object root', null, /manifest must be an object/],
    ['wrong version', { ...manifest(), manifestVersion: 3 }, /manifestVersion must be 1 or 2/],
    ['mismatched run id', manifest('other'), /does not match run directory/],
    [
      'invalid flags',
      { ...manifest(), flags: { only: 'x', video: false, trace: false } },
      /flags.only/,
    ],
    ['invalid shots', { ...manifest(), shots: null }, /shots must be an array/],
    [
      'invalid viewport',
      manifest('run', [entry({ viewport: { width: 0, height: 960 } })]),
      /viewport.width/,
    ],
    [
      'invalid nullable',
      manifest('run', [entry({ deviceScaleFactor: '2' as unknown as number })]),
      /deviceScaleFactor/,
    ],
    [
      'missing artifact key',
      {
        ...manifest(),
        shots: [{ ...entry(), trace: undefined }],
      },
      /shots\[0\]\.trace/,
    ],
    [
      'duplicate name',
      manifest('run', [entry(), entry()]),
      /duplicate shot name/,
    ],
  ])('rejects %s', (_label, value, message) => {
    expect(() => validateManifest(value, 'run')).toThrow(message)
  })
})

describe('v1 adapter and strict v2', () => {
  it('normalizes a handwritten v1 manifest and labels publication unrecorded', () => {
    const runDir=tmpDir(), v2=manifest(path.basename(runDir))
    const old={...v2,manifestVersion:1,shots:v2.shots.map(({testId:_id,checked:_checked,retry:_retry,...rest})=>rest)}
    delete (old as Partial<typeof old>).status
    delete (old as Partial<typeof old>).publication
    delete (old as Partial<typeof old>).tests
    delete (old as Partial<typeof old>).artifacts
    delete (old as Partial<typeof old>).failures
    fs.mkdirSync(path.join(runDir,'shots/home'),{recursive:true})
    fs.writeFileSync(path.join(runDir,'shots/home/shot.png'),makePng())
    fs.writeFileSync(path.join(runDir,'manifest.json'),JSON.stringify(old))
    const model=loadGalleryModel(runDir)
    expect(model.sourceManifestVersion).toBe(1)
    expect(model.manifest).toMatchObject({status:'unknown',publication:{gallery:{ok:true},evidence:{ok:true}},tests:[],artifacts:[],failures:[]})
    expect(model.manifest.shots[0]).toMatchObject({testId:null,checked:false,retry:0})
    expect(fs.readFileSync(path.join(runDir,'manifest.json'),'utf8')).toBe(JSON.stringify(old))
  })
  it('rejects a v2 publication failure without an error and missing required arrays', () => {
    const value=manifest()
    expect(()=>validateManifest({...value,publication:{gallery:{ok:false},evidence:{ok:true}}})).toThrow(/error required/)
    expect(()=>validateManifest({...value,tests:undefined})).toThrow(/tests must be an array/)
  })
})

describe('relative path validation', () => {
  it('accepts consumer-controlled but relative segments', () => {
    expect(validateRelativePath('shots/<script>/quote"\'.png')).toEqual([
      'shots',
      '<script>',
      'quote"\'.png',
    ])
  })

  it.each([
    '',
    '/absolute.png',
    '../escape.png',
    'shots/../escape.png',
    'shots//empty.png',
    'shots\\windows.png',
    'https://example.test/a.png',
    'data:image/png;base64,x',
    'nul\0file.png',
  ])('rejects %j', (value) => {
    expect(() => validateRelativePath(value)).toThrow(GalleryManifestError)
  })

  it('validates every manifest path before reading referenced files', () => {
    const runDir = tmpDir()
    fs.writeFileSync(
      path.join(runDir, 'manifest.json'),
      JSON.stringify(
        manifest(path.basename(runDir), [
          entry({ file: 'shots/home/shot.png' }),
          entry({ name: 'bad', file: '../escape.png' }),
        ]),
      ),
    )
    expect(() => loadGalleryModel(runDir)).toThrow(/dot segments/)
  })
})

describe('PNG model', () => {
  it('reads signature, IHDR dimensions, byte length, and one data URI', () => {
    const runDir = tmpDir()
    fs.mkdirSync(path.join(runDir, 'shots'))
    const contents = makePng(1040, 816)
    fs.writeFileSync(path.join(runDir, 'shots/example.png'), contents)
    const model = readPngModel(runDir, 'shots/example.png')
    expect(model).toMatchObject({ width: 1040, height: 816, byteLength: contents.byteLength })
    expect(model.dataUri).toBe(`data:image/png;base64,${contents.toString('base64')}`)
  })

  it.each([
    ['signature', Buffer.alloc(33), /signature/],
    ['truncated chunk', makePng().subarray(0, -1), /truncated/],
    [
      'bad CRC',
      (() => {
        const contents = makePng()
        contents[29] = contents[29]! ^ 1
        return contents
      })(),
      /CRC/,
    ],
    ['missing IEND', makePng().subarray(0, -12), /IEND/],
    ['missing IDAT', Buffer.concat([makePng().subarray(0, 33), makePng().subarray(-12)]), /IDAT/],
    [
      'IHDR',
      (() => {
        const contents = makePng()
        contents.write('NOPE', 12, 'ascii')
        return contents
      })(),
      /IHDR/,
    ],
    ['zero dimension', makePng(0, 10), /nonzero/],
  ])('rejects invalid %s data', (_label, contents, message) => {
    const runDir = tmpDir()
    fs.mkdirSync(path.join(runDir, 'shots'))
    fs.writeFileSync(path.join(runDir, 'shots/example.png'), contents)
    expect(() => readPngModel(runDir, 'shots/example.png')).toThrow(message)
  })

  it('rejects a symlink that escapes the run directory', () => {
    const root = tmpDir()
    const runDir = path.join(root, 'run')
    fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true })
    fs.writeFileSync(path.join(root, 'outside.png'), makePng())
    fs.symlinkSync(path.join(root, 'outside.png'), path.join(runDir, 'shots/escape.png'))
    expect(() => readPngModel(runDir, 'shots/escape.png')).toThrow(/escapes/)
  })
})
