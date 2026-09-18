// Transcribe only the three synthetic audition WAVs; not an author microphone or file picker.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LocalVoiceRuntime } from '../../src/main/modules/companion/adapters/companion-voice/local-runtime'

const folder = resolve('artifacts/companion-voice/gpt-sovits-product')
const runtime = new LocalVoiceRuntime(resolve('../../.local/companion-voice'), resolve('src/main/modules/companion/adapters/companion-voice/worker.py'))
const results: unknown[] = []
try {
  for (const [index, voice] of ['ningguang','ganyu','keqing'].entries()) {
    const file = await readFile(resolve(folder, `${voice}-${index}.wav`))
    if(file.toString('ascii',0,4)!=='RIFF'||file.readUInt32LE(24)!==24000||file.readUInt16LE(22)!==1||file.readUInt16LE(34)!==16)throw Error('invalid audition WAV')
    const source=file.subarray(44), count=source.length/2, pcm=Buffer.alloc(Math.floor(count*2/3)*2)
    let square=0, peak=0
    for(let i=0;i<count;i++){const v=source.readInt16LE(i*2)/32768;square+=v*v;peak=Math.max(peak,Math.abs(v))}
    for(let i=0;i<pcm.length/2;i++){const p=i*1.5,left=Math.floor(p),right=Math.min(count-1,left+1);pcm.writeInt16LE(Math.round(source.readInt16LE(left*2)*(1-p+left)+source.readInt16LE(right*2)*(p-left)),i*2)}
    const result=await runtime.run({action:'asr',sampleRate:16000,pcm})
    const record={voice,duration:count/24000,rms:Math.sqrt(square/count),peak,transcript:result.header.text}
    results.push(record);console.log(JSON.stringify(record))
  }
} finally {runtime.stop();await writeFile(resolve(folder,'audio-checks.json'),JSON.stringify(results,null,2))}
