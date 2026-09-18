// Uses only a synthetic page snapshot and upstream public ASR test audio.
// Never opens the author's database, microphone or writing API.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { LocalVoiceRuntime } from '../../src/main/modules/companion/adapters/companion-voice/local-runtime'
import type { CompanionVoiceId } from '../../src/contracts/companion/companion-voice-contracts'

const root = resolve('../..', '.local/companion-voice')
const runtime = new LocalVoiceRuntime(root, resolve('src/main/modules/companion/adapters/companion-voice/worker.py'))
const speech = new LocalVoiceRuntime(root, resolve('src/main/modules/companion/adapters/companion-voice/worker.py'), undefined, 'speech')
const artifacts = resolve('artifacts/companion-voice')
await mkdir(artifacts, { recursive: true })
const records: Record<string, unknown>[] = []
function wav(pcm: Buffer, sampleRate: number) {
  const head = Buffer.alloc(44)
  head.write('RIFF',0); head.writeUInt32LE(36+pcm.length,4); head.write('WAVEfmt ',8)
  head.writeUInt32LE(16,16); head.writeUInt16LE(1,20); head.writeUInt16LE(1,22)
  head.writeUInt32LE(sampleRate,24); head.writeUInt32LE(sampleRate*2,28)
  head.writeUInt16LE(2,32); head.writeUInt16LE(16,34); head.write('data',36); head.writeUInt32LE(pcm.length,40)
  return Buffer.concat([head,pcm])
}
try {
  for (const voice of (process.argv.includes('--text-only') ? [] : ['ningguang','ganyu','keqing']) as CompanionVoiceId[]) {
    for (let round=0; round<3; round++) {
      console.log(`start ${voice} round ${round}`)
      const started=performance.now()
      const chunks: Buffer[] = []
      const result=await speech.run({action:'tts',voice,text:'欢迎回来。现在是午后两点，你可以继续创作刚才的故事。我会陪着你，慢慢把这个世界写完整。'},undefined,undefined,pcm=>chunks.push(pcm))
      const record={kind:'tts',voice,round,wallSeconds:(performance.now()-started)/1000,...result.header,rtf:Number(result.header.seconds)/Number(result.header.duration)}
      records.push(record); console.log(JSON.stringify(record))
      await writeFile(resolve(artifacts,`${voice}-${round}.wav`),wav(Buffer.concat(chunks),Number(result.header.sampleRate)))
      await writeFile(resolve(artifacts,'runtime-measurements.json'),JSON.stringify(records,null,2))
    }
  }
  for(let round=0;round<3;round++) {
    const result=await runtime.run({action:'chat',text:'现在可以从哪部作品继续写？',context:JSON.stringify({page:'我的作品',continueWork:{title:'雾城来信',chapter:'第七章'}}),history:[]},undefined,text=>console.log(`text ${text}`))
    records.push({kind:'chat',round,...result.header}); console.log(JSON.stringify(records.at(-1)))
  }
  const file=await readFile(resolve(root,'models/asr/test_wavs/zh.wav'))
  let offset=12,pcm=Buffer.alloc(0)
  while(offset+8<=file.length){const size=file.readUInt32LE(offset+4);if(file.toString('ascii',offset,offset+4)==='data'){pcm=file.subarray(offset+8,offset+8+size);break}offset+=8+size+(size%2)}
  const result=await runtime.run({action:'asr',sampleRate:16000,pcm})
  records.push({kind:'asr',...result.header}); console.log(JSON.stringify(records.at(-1)))
} finally {
  runtime.stop()
  speech.stop()
  await writeFile(resolve(artifacts,'runtime-measurements.json'),JSON.stringify(records,null,2))
}
