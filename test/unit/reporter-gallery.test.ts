import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { FullConfig, FullResult } from '@playwright/test/reporter'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeSidecar } from '../../src/manifest.js'
import ShotwrightReporter from '../../src/reporter.js'
import { createRunDir, updateLatestSymlink } from '../../src/runs.js'
import { makePng } from '../fixtures/png.js'

const tmpDirs: string[] = []

function tmpDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shotwright-reporter-gallery-'))
  tmpDirs.push(directory)
  return directory
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete process.env.SHOTWRIGHT_RUN_DIR
  for (const directory of tmpDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function prepareRun(outputDir: string): { runDir: string; runId: string } {
  const run = createRunDir(outputDir)
  const file = 'shots/home/example.png'
  fs.mkdirSync(path.join(run.runDir, 'shots/home'), { recursive: true })
  fs.writeFileSync(path.join(run.runDir, file), makePng(100, 80))
  writeSidecar(run.runDir, {
    kind: 'shot', checked: false, retry: 0,
    name: 'example',
    spec: 'home.shots.ts',
    file,
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    fullPage: true,
    capturedAt: '2026-07-29T00:00:00.000Z',
    durationMs: 50,
    testId: 'test-id',
  })
  return run
}

async function endRun(runDir: string, status: FullResult['status']): Promise<void> {
  vi.stubEnv('SHOTWRIGHT_RUN_DIR', runDir)
  const reporter = new ShotwrightReporter()
  reporter.onBegin({ version: '1.62.0' } as FullConfig)
  reporter.onTestEnd({id:'test-id',title:'example',location:{file:'shots/home.shots.ts'},parent:{project:()=>({testDir:'shots',name:'shots'})}} as never,{status:'passed',retry:0,duration:1,attachments:[]} as never)
  await reporter.onEnd({ status } as FullResult)
}

describe('reporter identity layout', () => {
  it('same title gets distinct digest paths and a forced short-prefix collision uses full digest', () => {
    const reporter=new ShotwrightReporter() as unknown as {stem:(spec:string,title:string,id:string,project:string,prefixes:Map<string,string>)=>string}
    const prefixes=new Map<string,string>()
    const first=reporter.stem('sub/a.shots.ts','Équal title','one','project',prefixes)
    const second=reporter.stem('sub/a.shots.ts','Équal title','two','project',prefixes)
    expect(first).toMatch(/^sub\/a\/e-qual-title-[0-9a-f]{12}$/)
    expect(second).not.toBe(first)
    const digest=crypto.createHash('sha256').update('three').update('\0').update('project').digest('hex')
    prefixes.set(digest.slice(0,12),'other-digest')
    expect(reporter.stem('sub/a.shots.ts','Équal title','three','project',prefixes)).toBe(`sub/a/e-qual-title-${digest}`)
  })
  it('duplicate attachment names receive order suffixes', () => {
    const reporter=new ShotwrightReporter() as unknown as {attachmentName:(name:string,source:string,names:Map<string,number>)=>string}
    const names=new Map<string,number>()
    expect(reporter.attachmentName('error-context','context.md',names)).toBe('error-context.md')
    expect(reporter.attachmentName('error-context','context.md',names)).toBe('error-context-2.md')
  })
})

describe('ShotwrightReporter gallery publication', () => {
  it('publishes manifest and gallery atomically, then advances latest for a passed result', async () => {
    const outputDir = tmpDir()
    const run = prepareRun(outputDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await endRun(run.runDir, 'passed')

    expect(fs.existsSync(path.join(run.runDir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(run.runDir, 'gallery.html'))).toBe(true)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(run.runId)
    expect(fs.existsSync(path.join(run.runDir, '.sidecar'))).toBe(false)
    expect(fs.readdirSync(run.runDir).filter((name) => name.startsWith('.gallery.'))).toEqual([])
  })

  it('publishes manifest and gallery for a failed result without advancing latest', async () => {
    const outputDir = tmpDir()
    const previous = createRunDir(outputDir)
    updateLatestSymlink(outputDir, previous.runId)
    const failed = prepareRun(outputDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await endRun(failed.runDir, 'failed')

    expect(fs.existsSync(path.join(failed.runDir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(failed.runDir, 'gallery.html'))).toBe(true)
    expect(fs.readlinkSync(path.join(outputDir, 'latest'))).toBe(previous.runId)
    expect(fs.existsSync(path.join(failed.runDir, '.sidecar'))).toBe(false)
  })

  it('gallery injection records failure and keeps latest at prior fully published run', async () => {
    const outputDir=tmpDir(), prior=createRunDir(outputDir), run=prepareRun(outputDir)
    updateLatestSymlink(outputDir,prior.runId)
    vi.stubEnv('SHOTWRIGHT_INJECT_GALLERY_FAILURE','1')
    await endRun(run.runDir,'passed')
    const manifest=JSON.parse(fs.readFileSync(path.join(run.runDir,'manifest.json'),'utf8'))
    expect(manifest.publication.gallery).toMatchObject({ok:false,error:expect.stringContaining('injected')})
    expect(fs.existsSync(path.join(run.runDir,'gallery.html'))).toBe(false)
    expect(fs.readlinkSync(path.join(outputDir,'latest'))).toBe(prior.runId)
  })

  it('evidence copy failure records publication failure and does not flip latest', async () => {
    const outputDir=tmpDir(), prior=createRunDir(outputDir), run=prepareRun(outputDir)
    updateLatestSymlink(outputDir,prior.runId)
    vi.stubEnv('SHOTWRIGHT_RUN_DIR',run.runDir)
    const reporter=new ShotwrightReporter()
    reporter.onBegin({version:'1.62.0'} as FullConfig)
    reporter.onTestEnd({id:'test-id',title:'fails',location:{file:'shots/home.shots.ts'},parent:{project:()=>({testDir:'shots',name:'shots'})}} as never,
      {status:'failed',retry:0,duration:1,attachments:[{name:'error-context',contentType:'text/markdown',path:'missing-context.md'}]} as never)
    await reporter.onEnd({status:'failed'} as FullResult)
    const manifest=JSON.parse(fs.readFileSync(path.join(run.runDir,'manifest.json'),'utf8'))
    expect(manifest.publication.evidence).toMatchObject({ok:false,error:expect.stringContaining('error-context')})
    expect(manifest.failures[0].files).toEqual([])
    expect(fs.readlinkSync(path.join(outputDir,'latest'))).toBe(prior.runId)
  })

  it('late onExit cleanup error logs without changing manifest gallery or latest', async () => {
    const outputDir=tmpDir(), run=prepareRun(outputDir)
    await endRun(run.runDir,'passed')
    const before=fs.readFileSync(path.join(run.runDir,'manifest.json'),'utf8')
    const original=fs.rmSync
    vi.spyOn(fs,'rmSync').mockImplementation((target,...args) => {
      if (String(target).endsWith('/.pw')) throw new Error('injected cleanup')
      return original(target,...args)
    })
    const error=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    await new ShotwrightReporter().onExit()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('injected cleanup'))
    expect(fs.readFileSync(path.join(run.runDir,'manifest.json'),'utf8')).toBe(before)
    expect(fs.existsSync(path.join(run.runDir,'gallery.html'))).toBe(true)
    expect(fs.readlinkSync(path.join(outputDir,'latest'))).toBe(run.runId)
  })

  it('manifest rename failure leaves no manifest or gallery and does not flip latest', async () => {
    const outputDir=tmpDir(), prior=createRunDir(outputDir), run=prepareRun(outputDir)
    updateLatestSymlink(outputDir,prior.runId)
    const original=fs.renameSync
    vi.spyOn(fs,'renameSync').mockImplementation((from,to) => {
      if (String(to).endsWith('/manifest.json')) throw new Error('injected rename')
      return original(from,to)
    })
    await expect(endRun(run.runDir,'passed')).rejects.toThrow('injected rename')
    expect(fs.existsSync(path.join(run.runDir,'manifest.json'))).toBe(false)
    expect(fs.existsSync(path.join(run.runDir,'gallery.html'))).toBe(false)
    expect(fs.readlinkSync(path.join(outputDir,'latest'))).toBe(prior.runId)
  })

  it('records gallery failure without advancing latest for a broken PNG', async () => {
    const outputDir = tmpDir()
    const run = prepareRun(outputDir)
    const relativePath = 'shots/home/example.png'
    fs.writeFileSync(path.join(run.runDir, relativePath), 'corrupt')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await endRun(run.runDir, 'passed')

    expect(fs.existsSync(path.join(run.runDir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(run.runDir, 'gallery.html'))).toBe(false)
    expect(fs.existsSync(path.join(outputDir, 'latest'))).toBe(false)
    expect(fs.existsSync(path.join(run.runDir, '.sidecar'))).toBe(false)
  })
})
