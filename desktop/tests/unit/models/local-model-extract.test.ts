import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { extractRuntime } from '../../../src/main/modules/models/adapters/local-models/runtime-extract'

test('fixed runtime extraction preserves bytes and rejects size overflow, Windows aliases and duplicate entries',async()=>{
  for(const mode of ['valid','size','alias','duplicate','escape','link'] as const){
    const root=await mkdtemp(join(tmpdir(),'lanjian-model-zip-')), zip=new JSZip(), path=join(root,'source.zip')
    const name=mode==='alias'?'CON.txt':mode==='escape'?'../escape':'lib/main.py'
    zip.file(name,'hello',{unixPermissions:mode==='link'?0o120777:0o100644})
    if(mode==='duplicate')zip.file('lib/MAIN.py','hello')
    await writeFile(path,await zip.generateAsync({type:'nodebuffer',platform:'UNIX'}))
    const run=()=>extractRuntime(path,{format:'zip',target:'packages',expandedBytes:mode==='size'?4:mode==='duplicate'?10:5},root,new AbortController().signal,new Set())
    if(mode==='valid'){const files=await run();assert.equal(files.length,1);assert.equal(await readFile(join(root,'packages/lib/main.py'),'utf8'),'hello')}
    else await assert.rejects(run())
  }
})
