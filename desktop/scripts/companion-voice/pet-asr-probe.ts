// Public upstream Chinese sample only. No microphone, author text or recording persistence.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LocalVoiceRuntime } from '../../src/main/modules/companion/adapters/companion-voice/local-runtime'
const root = resolve('../..', '.local/companion-voice')
const runtime = new LocalVoiceRuntime(root, resolve('src/main/modules/companion/adapters/companion-voice/worker.py'))
try {
  const installed = await runtime.available('asr')
  if (!installed) throw new Error('ASR_ASSETS_MISSING')
  const wav = await readFile(resolve(root,'models/asr/test_wavs/zh.wav'))
  let offset=12, pcm=Buffer.alloc(0)
  while(offset+8<=wav.length) { const size=wav.readUInt32LE(offset+4); if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break} offset+=8+size+(size%2) }
  const started = performance.now(), result = await runtime.run({ action:'asr',sampleRate:16000,pcm })
  if (typeof result.header.text !== 'string' || !result.header.text.trim()) throw new Error('ASR_EMPTY')
  const evidence = { installed, source:'upstream public test_wavs/zh.wav', seconds:(performance.now()-started)/1000, transcriptCharacters:result.header.text.length, textModelRequested:false, speechModelRequested:false, realMicrophone:false }
  const output = resolve('artifacts/companion-voice/pet-asr-probe.json'); await mkdir(resolve(output,'..'),{recursive:true}); await writeFile(output,JSON.stringify(evidence,null,2)); console.log(JSON.stringify(evidence))
} finally { runtime.stop() }
