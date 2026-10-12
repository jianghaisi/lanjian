import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { soundFiles } from '../../../src/renderer/app/services/ui-sound-catalog'

const assets = new URL('../../../public/sounds/v1/', import.meta.url)

/** Read the delivered PCM, not the generator's claimed timing metadata. */
function energy(bytes: Buffer) {
  assert.equal(bytes.toString('ascii',0,4),'RIFF')
  let pcm: Buffer | undefined
  for(let at=12;at+8<=bytes.length;) {
    const size=bytes.readUInt32LE(at+4), kind=bytes.toString('ascii',at,at+4)
    if(kind==='fmt ') {
      assert.equal(bytes.readUInt16LE(at+8),1)
      assert.equal(bytes.readUInt16LE(at+10),2)
      assert.equal(bytes.readUInt32LE(at+12),48000)
      assert.equal(bytes.readUInt16LE(at+22),24)
    }
    if(kind==='data')pcm=bytes.subarray(at+8,at+8+size)
    at+=8+size+(size%2)
  }
  assert.ok(pcm)
  const sums=new Float64Array(pcm.length/6+1)
  for(let i=0;i<sums.length-1;i++) {
    const left=pcm.readIntLE(i*6,3)/8388608,right=pcm.readIntLE(i*6+3,3)/8388608
    sums[i+1]=sums[i]+(left*left+right*right)/2
  }
  return (sample:number)=>sums[Math.min(sums.length-1,sample+480)]-sums[Math.max(0,sample-480)]
}

test('delivered musical prelude places source attacks at the actual visual landmarks',async()=>{
  const targets = {
    B15:[.14,5,8.79,9.25,11.79,12.25],
  } as const
  const manifest=JSON.parse(await readFile(new URL('manifest.json',assets),'utf8')) as Array<{id:string;sha256:string}>
  for(const id of Object.keys(targets) as Array<keyof typeof targets>) {
    const bytes=await readFile(new URL(soundFiles[id],assets)), rms=energy(bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.find(item=>item.id===id)?.sha256)
    for(const target of targets[id]) {
      let peak=0, at=0
      for(let i=Math.max(480,Math.round((target-.15)*48000));i<Math.round((target+.15)*48000);i++) {
        const value=rms(i)
        if(value>peak){peak=value;at=i/48000}
      }
      assert.ok(peak>0,`${id} ${target}: silence`)
      assert.ok(Math.abs(at-target)<.045,`${id} ${target}: actual mixed PCM peak at ${at}`)
    }
  }
})
