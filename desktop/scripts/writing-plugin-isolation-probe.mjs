import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const electron = require('electron')
const { createPackageFromStreams } = require('@electron/asar')
const root = await mkdtemp(join(tmpdir(), 'lanjian-plugin-isolation-'))
const built = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-custom-code-check')
const layout = join(root, 'application')
await mkdir(layout)
await cp(join(built, 'main'), join(layout, 'out/main'), { recursive: true })
await writeFile(join(layout, 'package.json'), JSON.stringify({ type: 'module', main: 'out/main/index.js' }))
const asar = join(root, 'app.asar')
assert.deepEqual(JSON.parse(await readFile('package.json', 'utf8')).build.asarUnpack, ['out/main/writing-plugins/**/*', 'out/main/chunks/**/*'])
// ASAR's legacy glob API tests Windows absolute backslash paths differently from
// electron-builder. Explicit metadata reproduces the declared selective unpack.
const streams = []
for (const entry of (await readdir(layout, { recursive: true })).sort()) {
  const path = entry.replaceAll('\\', '/'), file = join(layout, entry), info = await stat(file)
  streams.push({ path, type: info.isDirectory() ? 'directory' : 'file', unpacked: /^out\/main\/(writing-plugins|chunks)(\/|$)/.test(path), stat: info, streamGenerator: () => createReadStream(file) })
}
await createPackageFromStreams(asar, streams)
const reports = []
for (const [name, appRoot] of [['relocated', layout], ['asar', asar]]) {
  const output = join(root, `${name}.json`)
  const bootstrap = join(root, `${name}.mjs`)
  const hostUrl = pathToFileURL(join(appRoot, 'out/main/writing-plugins/host.mjs')).href
  await writeFile(bootstrap, `
import assert from 'node:assert/strict'
import { app, utilityProcess } from 'electron'
import { writeFile, rename } from 'node:fs/promises'
async function probe() {
app.setPath('userData', ${JSON.stringify(join(root, `profile-${name}`))})
app.disableHardwareAcceleration()
await app.whenReady()
const { createWritingPluginRunHost } = await import(${JSON.stringify(hostUrl)})
const report = { layout: ${JSON.stringify(name)}, checks: [], peakResidentBytes: 0, peakWorkers: 0, pids: [], forks: [] }
const fork = utilityProcess.fork.bind(utilityProcess)
const active = new Set()
let crashNext = false
utilityProcess.fork = (path, args, options) => {
  assert.ok(!path.includes('node_modules'))
  assert.deepEqual(Object.keys(options.env).sort(), process.platform === 'win32' ? ['SystemRoot','WINDIR'].filter(k => process.env[k]).sort() : [])
  assert.ok(!options.env.LANJIAN_PROBE_SECRET)
  assert.equal(options.stdio, 'ignore')
  report.forks.push({ fixedLauncher: path.endsWith('guest-worker.mjs'), noInheritedSecret: true })
  const child = fork(path, args, options)
  child.on('spawn', () => { if(child.pid) report.pids.push(child.pid);active.add(child);report.peakWorkers=Math.max(report.peakWorkers,active.size) })
  child.on('exit', () => active.delete(child))
  if (crashNext) { crashNext = false; child.once('spawn', () => child.kill()) }
  return child
}
const host = createWritingPluginRunHost({ sliceMs: 150, invocationMs: 6000 })
let serial = 0, beats = 0
const beat = setInterval(() => {
  beats++
  for (const m of app.getAppMetrics()) if (m.name === 'Writing plugin guest') report.peakResidentBytes = Math.max(report.peakResidentBytes, m.memory.workingSetSize * 1024)
}, 10)
const deny = async () => { throw Error('PRIVATE_HOST_SECRET') }
async function run(source, broker=deny, signal=new AbortController().signal, continuation) {
  const request = { invocationId: 'probe-' + (++serial), source, toolId: 'new-algorithm', input: { text: '第一句。第二句！第三句？' } }
  if (continuation) request.continuation = continuation
  return host.run(request, broker, signal)
}
async function check(name, fn) { console.log('probe: '+name); await fn(); report.checks.push(name) }
try {
  await check('new algorithm and offline WASM', async () => {
    const r = await run('export function execute(id,input){return {sentences:input.text.split(/[。！？]/).filter(Boolean).length}}')
    assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.value, { sentences: 3 }); assert.ok(r.wasmBytes <= 134217728)
  })
  await check('async JSON bridge', async () => {
    const r = await run('export async function execute(id,input,ctx){const x=await ctx.book.read({section:"outline"}); return {length:x.text.length}}', async (method, input) => {
      assert.equal(method,'book.read'); assert.deepEqual(input,{section:'outline'}); await new Promise(r=>setTimeout(r,20)); return {text:'测试大纲'}
    }); assert.equal(r.ok,true); assert.deepEqual(r.value,{length:4})
  })
  await check('no host globals or constructor escape', async () => {
    const r = await run('export async function execute(id,input,ctx){return [typeof process,typeof require,typeof fetch,typeof Buffer,typeof WebAssembly,await ctx.book.read.constructor("return typeof process")()]}')
    assert.equal(r.ok,true); assert.deepEqual(r.value,Array(6).fill('undefined'))
  })
  await check('imports denied', async () => {
    for (const s of ['import fs from "node:fs";export function execute(){return 1}', 'export async function execute(){try{await import("https://example.invalid/payload.js")}catch{}return 1}']) assert.deepEqual(await run(s),{ok:false,code:'module-denied'})
  })
  await check('CPU interrupt; main event loop stays live', async () => {
    const before=beats; assert.deepEqual(await run('export function execute(){while(true){}}'),{ok:false,code:'timeout'}); assert.ok(beats>before+2)
  })
  await check('heap growth and huge output rejected', async () => {
    assert.equal((await run('export function execute(){const a=[];for(let i=0;i<256;i++)a.push(new ArrayBuffer(1048576));return 1}')).ok,false)
    assert.equal((await run('export function execute(){return "x".repeat(1048577)}')).ok,false)
  })
  await check('checkpoint resumes in a fresh process', async () => {
    const r=await run('export function execute(){throw Error("replay")}export function resume(id,c,a){return {step:c.step,answer:a}}',deny,new AbortController().signal,{checkpoint:{step:2},answer:'继续'})
    assert.equal(r.ok,true); assert.deepEqual(r.value,{step:2,answer:'继续'})
  })
  await check('cancel pending RPC and discard late reply', async () => {
    const abort=new AbortController();let brokerSignal;let finish
    const result=run('export async function execute(id,input,ctx){return await ctx.book.read({})}',async (_m,_i,signal)=>{brokerSignal=signal;setTimeout(()=>abort.abort(),25);return new Promise(r=>{finish=()=>r('late')})},abort.signal)
    assert.deepEqual(await result,{ok:false,code:'cancelled'});assert.ok(brokerSignal.aborted);finish()
  })
  await check('cancel before process spawn', async () => {
    const abort=new AbortController();const result=run('export function execute(){while(true){}}',deny,abort.signal);abort.abort()
    assert.deepEqual(await result,{ok:false,code:'cancelled'})
  })
  await check('unexpected process exit is failure', async () => {
    crashNext=true;assert.deepEqual(await run('export function execute(){return 1}'),{ok:false,code:'process-exit'})
  })
  await check('watchdog ends unresolved invocation', async () => {
    const short=createWritingPluginRunHost({sliceMs:150,invocationMs:1800})
    assert.deepEqual(await short.run({invocationId:'stalled',source:'export function execute(){return new Promise(()=>{})}',toolId:'wait',input:{}},deny,new AbortController().signal),{ok:false,code:'timeout'})
    await short.dispose()
  })
  await check('three requests use at most two guest processes', async () => {
    const results=await Promise.all(Array.from({length:3},()=>run('export async function execute(id,input,ctx){return await ctx.book.read({})}',async()=>{await new Promise(r=>setTimeout(r,60));return {ok:true}})))
    assert.ok(results.every(r=>r.ok));assert.equal(report.peakWorkers,2)
  })
  await check('missing WASM fails before fork and recovers after restore', async () => {
    const wasm=${JSON.stringify(join(name === 'asar' ? asar + '.unpacked' : layout, 'out/main/writing-plugins/quickjs.wasm'))}
    await rename(wasm,wasm+'.held')
    try {assert.deepEqual(await run('export function execute(){return 1}'),{ok:false,code:'unavailable'})}
    finally {await rename(wasm+'.held',wasm)}
  })
  await check('recovery after failures', async () => {const r=await run('export function execute(){return 42}');assert.equal(r.ok,true);assert.equal(r.value,42)})
  await host.dispose()
  await check('all owned guest processes exited', async () => {
    await new Promise(r=>setTimeout(r,100))
    const live=new Set(app.getAppMetrics().map(m=>m.pid));assert.ok(report.pids.length>0);assert.ok(report.pids.every(pid=>!live.has(pid)))
  })
  report.ok=true
} catch(error) { report.ok=false; report.error=String(error.stack || error) }
finally { clearInterval(beat);await host.dispose();await writeFile(${JSON.stringify(output)},JSON.stringify(report,null,2));app.exit(report.ok?0:1) }
}
void probe().catch(error => { console.error(error);app.exit(1) })
`, 'utf8')
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'].includes(k)))
  env.LANJIAN_PROBE_SECRET = 'must-not-inherit'
  await new Promise((resolveRun, reject) => {
    const child = spawn(electron, [bootstrap], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let logs = ''
    const append = data => { logs = (logs + data.toString()).slice(-6000) }
    child.stdout.on('data', append); child.stderr.on('data', append)
    const timer = setTimeout(() => { child.kill(); reject(new Error('Isolation probe exceeded 45 seconds: ' + logs)) }, 45_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error('Isolation probe failed: ' + logs + '\nReport: ' + output)) })
  })
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(report.ok, true); reports.push(report)
  console.log(JSON.stringify({ layout: name, checks: report.checks.length, peakResidentBytes: report.peakResidentBytes, report: output }))
}
const evidence = process.env.LANJIAN_PLUGIN_EVIDENCE_FILE
if (evidence) await writeFile(resolve(evidence), JSON.stringify({ ok: true, reports, root }, null, 2))
console.log('Writing plugin isolation probe PASS: relocated and ASAR layouts, no runtime node_modules.')
