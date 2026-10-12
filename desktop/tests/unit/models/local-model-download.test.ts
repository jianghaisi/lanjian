import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { ModelDownloader, fetchModelArtifact } from '../../../src/main/modules/models/adapters/local-models/model-download'
import { ownedPath, safeRelative } from '../../../src/main/modules/models/adapters/local-models/install-files'

const bytes = Buffer.from('真实下载与断点完整性。'.repeat(1000))
const artifact = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: 'https://example.invalid/fixed' }
test('actual HTTP abort preserves a strong-ETag partial file and resumes exact remaining bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-model-download-')), seen: Array<string|undefined> = []
  const server = createServer((request, response) => {
    seen.push(request.headers.range); const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0)
    response.writeHead(offset ? 206 : 200, { ETag: '"fixed"', 'Content-Length': bytes.length-offset, ...(offset ? { 'Content-Range': `bytes ${offset}-${bytes.length-1}/${bytes.length}` } : {}) })
    response.write(bytes.subarray(offset, offset+1024))
    setTimeout(() => response.end(bytes.subarray(offset+1024)), 100)
  })
  server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(()=>{server.closeAllConnections();server.close()})
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const downloader = new ModelDownloader(root, (_url, headers, signal) => fetch(`http://127.0.0.1:${address.port}/file`, {headers,signal}))
  const controller = new AbortController()
  await assert.rejects(downloader.download(artifact,controller.signal,n=>{if(n>0)controller.abort()}))
  const partial = await readFile(join(root,artifact.sha256+'.part')); assert.equal(partial.length,1024)
  const output = await downloader.download(artifact,new AbortController().signal,()=>{})
  assert.deepEqual(await readFile(output),bytes); assert.deepEqual(seen,[undefined,'bytes=1024-'])
  await downloader.download(artifact,new AbortController().signal,()=>{}); assert.equal(seen.length,2)
})
for (const mode of ['200','etag','range','416','hash'] as const) test(`download handles ${mode} without publishing invalid bytes`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'lanjian-model-edge-'))
  await writeFile(join(root,artifact.sha256+'.part'),bytes.subarray(0,10))
  await writeFile(join(root,artifact.sha256+'.resume.json'),JSON.stringify({...artifact,received:10,etag:'"fixed"'}))
  let headers:Record<string,string>={}
  const downloader=new ModelDownloader(root,async(_url,h)=>{
    headers=h
    if(mode==='416')return new Response(null,{status:416})
    if(mode==='200'||mode==='hash')return new Response(mode==='hash'?Buffer.alloc(bytes.length):bytes,{headers:{'Content-Length':String(bytes.length),ETag:'"new"'}})
    return new Response(bytes.subarray(10),{status:206,headers:{'Content-Length':String(bytes.length-10),ETag:mode==='etag'?'"other"':'"fixed"','Content-Range':mode==='range'?`bytes 0-${bytes.length-11}/${bytes.length}`:`bytes 10-${bytes.length-1}/${bytes.length}`}})
  })
  if(mode==='200')assert.deepEqual(await readFile(await downloader.download(artifact,new AbortController().signal,()=>{})),bytes)
  else {await assert.rejects(downloader.download(artifact,new AbortController().signal,()=>{}));await assert.rejects(readFile(join(root,artifact.sha256+'.asset')))}
  assert.equal(headers.Range,'bytes=10-')
})
test('owned file paths reject Windows escapes and junctions; production transport rejects arbitrary hosts before fetch',async()=>{
  for(const name of ['../escape','C:/escape','x:y','x\\y','con.txt','x.','/escape','a//b'])assert.throws(()=>safeRelative(name))
  const root=await mkdtemp(join(tmpdir(),'lanjian-model-path-')), outside=await mkdtemp(join(tmpdir(),'lanjian-model-outside-'))
  await mkdir(join(root,'nested'));await symlink(outside,join(root,'nested/link'),'junction')
  await assert.rejects(ownedPath(root,'nested/link/file'),/链接/)
  await assert.rejects(fetchModelArtifact('https://example.invalid',{},new AbortController().signal),/来源/)
})

test('large model uses bounded ranges with a stable entity and verifies the complete published file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lanjian-model-chunks-')), data=Buffer.alloc(65*1024*1024,73)
  const large={...artifact,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}
  let requests=0
  const downloader=new ModelDownloader(root,async(_url,headers)=>{
    const match=/^bytes=(\d+)-(\d+)$/.exec(headers.Range);assert.ok(match)
    const start=Number(match[1]),end=Number(match[2]);assert.ok(end-start<8*1024*1024)
    if(requests++)assert.equal(headers['If-Range'],'"large"')
    return new Response(data.subarray(start,end+1),{status:206,headers:{ETag:'"large"','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${data.length}`}})
  })
  const result=await downloader.download(large,new AbortController().signal,()=>{})
  assert.equal(requests,9);assert.equal(createHash('sha256').update(await readFile(result)).digest('hex'),large.sha256)
})

test('crash recovery resumes the durable prefix and discards only its uncheckpointed tail after a valid response',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lanjian-model-crash-')), received=1024
  const part=join(root,artifact.sha256+'.part'), meta=join(root,artifact.sha256+'.resume.json')
  const unconfirmed=Buffer.concat([bytes.subarray(0,received),Buffer.alloc(500,88)])
  await writeFile(part,unconfirmed)
  await writeFile(meta,JSON.stringify({...artifact,received,etag:'"fixed"'}))
  const record=await readFile(meta)
  const offline=new ModelDownloader(root,async(_url,headers)=>{
    assert.equal(headers.Range,`bytes=${received}-`);assert.equal(headers['If-Range'],'"fixed"')
    throw Error('offline fixture')
  })
  await assert.rejects(offline.download(artifact,new AbortController().signal,()=>{}),/offline fixture/)
  assert.deepEqual(await readFile(part),unconfirmed);assert.deepEqual(await readFile(meta),record)
  const downloader=new ModelDownloader(root,async(_url,headers)=>{
    assert.equal(headers.Range,`bytes=${received}-`)
    assert.deepEqual(await readFile(part),unconfirmed)
    return new Response(bytes.subarray(received),{status:206,headers:{ETag:'"fixed"','Content-Range':`bytes ${received}-${bytes.length-1}/${bytes.length}`}})
  })
  const progress:number[]=[]
  assert.deepEqual(await readFile(await downloader.download(artifact,new AbortController().signal,n=>progress.push(n))),bytes)
  assert.equal(progress[0],received)
})

for(const received of [2048,-1,1.5,'1024'])test(`invalid checkpoint ${JSON.stringify(received)} cannot authorize a partial prefix`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'lanjian-model-checkpoint-'))
  await writeFile(join(root,artifact.sha256+'.part'),bytes.subarray(0,1024))
  await writeFile(join(root,artifact.sha256+'.resume.json'),JSON.stringify({...artifact,received,etag:'"fixed"'}))
  const downloader=new ModelDownloader(root,async(_url,headers)=>{
    assert.equal(headers.Range,undefined);assert.equal(headers['If-Range'],undefined)
    return new Response(bytes,{headers:{ETag:'"fixed"'}})
  })
  assert.deepEqual(await readFile(await downloader.download(artifact,new AbortController().signal,()=>{})),bytes)
})
