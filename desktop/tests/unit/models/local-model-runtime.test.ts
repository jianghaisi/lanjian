import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalTextRuntime } from '../../../src/main/modules/models/adapters/local-models/text-runtime'
import { resolvePortablePython } from '../../../src/main/platform/processes/portable-python-runtime'
import type { LocalTextRequest } from '../../../src/main/modules/models/domain/model-provider'

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
