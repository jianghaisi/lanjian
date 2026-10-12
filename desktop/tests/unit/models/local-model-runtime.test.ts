import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setImmediate } from 'node:timers/promises'
import { Readable } from 'node:stream'
import { LocalTextRuntime } from '../../../src/main/modules/models/adapters/local-models/text-runtime'
import { resolvePortablePython } from '../../../src/main/platform/processes/portable-python-runtime'
import type { LocalTextRequest } from '../../../src/main/modules/models/domain/model-provider'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const request = (content: string): LocalTextRequest => ({ action: 'complete', messages: [{ role: 'user', content }], maxTokens: 128, temperature: .1, topP: .9 })
async function deliveryFixture(t: TestContext) {
  const { python } = await resolvePortablePython(resolve('../../.local/companion-voice'), resolve('../../.local/companion-voice/venv'))
  const root = await mkdtemp(join(tmpdir(), 'lanjian-model-delivery-')), worker = join(root, 'delivery.py')
  // A single pipe write contains both deltas and the terminal frame, so a
  // pending consumer outlives receipt of the worker's result deterministically.
  await writeFile(worker, `import sys,struct,json
profile=json.loads(sys.argv[2])['promptProfile']
while True:
 h=sys.stdin.buffer.read(4)
 if not h: break
 v=json.loads(sys.stdin.buffer.read(struct.unpack('<I',h)[0]));base={'v':1,'id':v['id']}
 parts=[profile+':',v['messages'][0]['content']]
 frames=[dict(base,kind='delta',seq=i,text=text) for i,text in enumerate(parts)]
 if v['messages'][0]['content'].startswith('worker-error:'):
  frames.append(dict(base,kind='error',code=v['messages'][0]['content'].split(':',1)[1]))
 else:
  frames.append(dict(base,kind='result',content=''.join(parts),finishReason='stop',promptTokens=4,completionTokens=4,seconds=0.01))
 raw=[json.dumps(frame,ensure_ascii=False).encode('utf8') for frame in frames]
 sys.stdout.buffer.write(b''.join(struct.pack('<I',len(b))+b for b in raw));sys.stdout.buffer.flush()
`, 'utf8')
  const runtime = new LocalTextRuntime(worker)
  t.after(() => runtime.stop())
  return { runtime, assets: { root, python, modelPath: 'inert-fixture', sitePackages: 'inert-fixture', fingerprint: 'delivery-fixture', promptProfile: 'glm4' as const } }
}

test('a completed early delta cannot resume the pipe while a later consumer from the same batch is pending', async t => {
  const { runtime, assets } = await deliveryFixture(t)
  const entered = deferred<void>(), delivery = deferred<void>(); t.after(() => delivery.resolve())
  // Observe the actual pipe while retaining the real Node pause implementation.
  let output: Readable | undefined
  const pause = Readable.prototype.pause
  t.mock.method(Readable.prototype, 'pause', function (this: Readable) { output = this; return pause.call(this) })
  const deltas: string[] = []
  const result = runtime.run(assets, request('慢速交付'), undefined, async text => {
    deltas.push(text)
    if (text === 'glm4:') return
    entered.resolve(); await delivery.promise
  }).then(value => ({ value }), error => ({ error }))
  await entered.promise; await setImmediate()
  assert.ok(output, 'the real worker pipe must have been paused')
  assert.equal(output.isPaused(), true, 'the first consumer must not bypass the still-pending second consumer')
  const pid = runtime.pid; delivery.resolve()
  const completed = await result; assert.ok('value' in completed)
  assert.equal(completed.value.content, 'glm4:慢速交付'); assert.deepEqual(deltas, ['glm4:', '慢速交付'])
  assert.equal((await runtime.run(assets, request('继续'))).content, 'glm4:继续')
  assert.equal(runtime.pid, pid)
})

for (const code of ['OUTPUT_LIMIT', 'private-worker-error'] as const) {
  test(`a batched ${code} discards undelivered text and releases the resident pipe for explicit retry`, { timeout: 5000 }, async t => {
    const { runtime, assets } = await deliveryFixture(t)
    const deltas: string[] = []
    await assert.rejects(runtime.run(assets, request('worker-error:' + code), undefined, text => { deltas.push(text) }), error => {
      assert.ok(error instanceof Error)
      assert.match(error.message, code === 'OUTPUT_LIMIT' ? /输出上限/ : /运行失败/)
      assert.doesNotMatch(error.message, /private-worker-error|worker-error|glm4:/)
      return true
    })
    const pid = runtime.pid; assert.ok(pid); assert.equal(deltas.length, 0)
    const retry = await runtime.run(assets, request('恢复正文'), undefined, text => { deltas.push(text) })
      .then(value => ({ value }), error => ({ error }))
    assert.ok('value' in retry, 'worker error must not leave the reusable pipe paused')
    assert.equal(retry.value.content, 'glm4:恢复正文'); assert.deepEqual(deltas, ['glm4:', '恢复正文'])
    assert.equal(runtime.pid, pid, 'recoverable errors preserve the existing resident process')
  })
}

for (const outcome of ['reject', 'resolve'] as const) {
  test(`late ${outcome} of a cancelled GLM consumer leaves the successor DeepSeek process and output intact`, async t => {
    const { runtime, assets } = await deliveryFixture(t)
    const entered = deferred<void>(), oldDelivery = deferred<void>(), newEntered = deferred<void>(), newDelivery = deferred<void>()
    t.after(() => { oldDelivery.resolve(); newDelivery.resolve() })
    const controller = new AbortController(), oldDeltas: string[] = [], newDeltas: string[] = []
    const original = runtime.run(assets, request('旧正文'), controller.signal, async (text) => {
      oldDeltas.push(text); entered.resolve(); await oldDelivery.promise
    })
    const cancelled = assert.rejects(original, /已停止/)
    await entered.promise; const oldPid = runtime.pid
    controller.abort(); await cancelled
    const successor = runtime.run({ ...assets, promptProfile: 'deepseek-r1', fingerprint: 'successor-model' }, request('新正文'), undefined, async text => {
      newDeltas.push(text); newEntered.resolve(); await newDelivery.promise
    })
    const result = successor.then(value => ({ value }), error => ({ error }))
    await newEntered.promise; const newPid = runtime.pid
    assert.ok(newPid && newPid !== oldPid)
    if (outcome === 'reject') oldDelivery.reject(Error('old consumer private failure'))
    else oldDelivery.resolve()
    await setImmediate(); await setImmediate()
    assert.equal(runtime.pid, newPid, 'late consumer settlement must not stop the successor process')
    newDelivery.resolve()
    const completed = await result
    assert.ok('value' in completed, 'successor must finish normally')
    assert.equal(completed.value.content, 'deepseek-r1:新正文')
    assert.deepEqual(oldDeltas, ['glm4:']); assert.deepEqual(newDeltas, ['deepseek-r1:', '新正文'])
    assert.equal((await runtime.run({ ...assets, promptProfile: 'deepseek-r1', fingerprint: 'successor-model' }, request('继续'))).content, 'deepseek-r1:继续')
    assert.equal(runtime.pid, newPid, 'successful successor remains reusable')
  })
}

test('the request deadline includes delivery after the terminal frame and timeout permits recovery', async t => {
  const { runtime, assets } = await deliveryFixture(t)
  const entered = deferred<void>(), delivery = deferred<void>(); t.after(() => delivery.resolve())
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const result = runtime.run(assets, request('等待交付'), undefined, async () => { entered.resolve(); await delivery.promise })
    .then(value => ({ value }), error => ({ error }))
  await entered.promise
  t.mock.timers.tick(299_999); await setImmediate(); assert.ok(runtime.pid, 'deadline must not fire early')
  t.mock.timers.tick(1); await setImmediate()
  assert.equal(runtime.pid, undefined, 'terminal receipt must not remove the deadline while delivery is pending')
  const timedOut = await result; assert.ok('error' in timedOut); assert.match(timedOut.error.message, /耗时过长/)
  delivery.resolve(); await setImmediate()
  assert.equal((await runtime.run(assets, request('重试'))).content, 'glm4:重试')
})

test('a current consumer failure stops only its request, hides private errors and allows a fresh worker', async t => {
  const { runtime, assets } = await deliveryFixture(t)
  let failedPid: number | undefined
  await assert.rejects(runtime.run(assets, request('未交付正文'), undefined, () => {
    failedPid = runtime.pid; throw Error('PRIVATE_CONSUMER_BODY_AND_PATH')
  }), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /运行失败/)
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_CONSUMER_BODY_AND_PATH|未交付正文/); return true
  })
  assert.equal(runtime.pid, undefined)
  assert.equal((await runtime.run(assets, request('恢复'))).content, 'glm4:恢复')
  assert.notEqual(runtime.pid, failedPid)
})

test('successful delivery removes its deadline before another model begins', async t => {
  const { runtime, assets } = await deliveryFixture(t)
  const entered = deferred<void>(), delivery = deferred<void>(), nextEntered = deferred<void>(), nextDelivery = deferred<void>()
  t.after(() => { delivery.resolve(); nextDelivery.resolve() })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const first = runtime.run(assets, request('完成交付'), undefined, async () => { entered.resolve(); await delivery.promise })
  await entered.promise; t.mock.timers.tick(200_000); delivery.resolve()
  assert.equal((await first).content, 'glm4:完成交付')
  const next = runtime.run({ ...assets, promptProfile: 'deepseek-r1' }, request('下一次'), undefined, async () => { nextEntered.resolve(); await nextDelivery.promise })
    .then(value => ({ value }), error => ({ error }))
  await nextEntered.promise; const pid = runtime.pid
  t.mock.timers.tick(100_001); await setImmediate()
  assert.equal(runtime.pid, pid, 'the completed request deadline must not stop the next active model')
  nextDelivery.resolve(); const finished = await next
  assert.ok('value' in finished); assert.equal(finished.value.content, 'deepseek-r1:下一次')
})

// Exercises actual pipes/process ownership; the fixture imports no inference package or weights.
test('private worker reports truncation/crash, preserves deltas and kills its own cancelled PID',async t=>{
  let python:string
  try{python=(await resolvePortablePython(resolve('../../.local/companion-voice'),resolve('../../.local/companion-voice/venv'))).python}
  catch{t.skip('existing isolated Python is unavailable');return}
  const root=await mkdtemp(join(tmpdir(),'lanjian-local-pipes-')),worker=join(root,'fixture.py')
  await writeFile(worker,`import sys,struct,json,time,os
def emit(v):
 b=json.dumps(v,ensure_ascii=False).encode('utf8');sys.stdout.buffer.write(struct.pack('<I',len(b))+b);sys.stdout.buffer.flush()
while True:
 h=sys.stdin.buffer.read(4)
 if not h: break
 v=json.loads(sys.stdin.buffer.read(struct.unpack('<I',h)[0]));mode=v['messages'][0]['content'];base={'v':1,'id':v['id']}
 if mode=='crash': os._exit(7)
 emit(dict(base,kind='delta',seq=0,text='雨夜'))
 emit(dict(base,kind='delta',seq=1,text='来信'))
 if mode=='wait': time.sleep(15)
 emit(dict(base,kind='result',content='雨夜来信',finishReason='length' if mode=='length' else 'stop',promptTokens=4,completionTokens=4,seconds=0.01))
`,'utf8')
  const runtime=new LocalTextRuntime(worker),assets={root,python,modelPath:'unused',sitePackages:'unused',fingerprint:'fixture'}
  const request=(mode:string):LocalTextRequest=>({action:'complete',messages:[{role:'user',content:mode}],maxTokens:128,temperature:.1,topP:.9})
  t.after(()=>runtime.stop())
  const deltas:string[]=[]
  assert.equal((await runtime.run(assets,request('ok'),undefined,async(_text,all)=>{await new Promise(r=>setTimeout(r,5));deltas.push(all)})).content,'雨夜来信')
  assert.deepEqual(deltas,['雨夜','雨夜来信'])
  await assert.rejects(runtime.run(assets,request('length')),/输出上限/)
  await assert.rejects(runtime.run(assets,request('crash')),/运行失败/)
  const controller=new AbortController();let pid=0
  await assert.rejects(runtime.run(assets,request('wait'),controller.signal,()=>{pid=runtime.pid!;controller.abort()}),/已停止/)
  await new Promise(r=>setTimeout(r,150));assert.ok(pid>0);assert.throws(()=>process.kill(pid,0))
  assert.equal((await runtime.run(assets,request('ok'))).content,'雨夜来信')
})
