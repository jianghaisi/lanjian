// Synthetic developer-only audition through the same bounded private pipe as the app.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LocalVoiceRuntime } from '../../src/main/modules/companion/adapters/companion-voice/local-runtime'
import type { CompanionVoiceId } from '../../src/contracts/companion/companion-voice-contracts'

const root = resolve('../../.local/companion-voice')
const output = resolve('artifacts/companion-voice/gpt-sovits-product')
const runtime = new LocalVoiceRuntime(root, resolve('src/main/modules/companion/adapters/companion-voice/worker.py'), undefined,
  'speech', undefined, process.argv.includes('--verbose') ? chunk => process.stderr.write(chunk) : undefined)
const voices: CompanionVoiceId[] = process.argv.includes('--warm') ? Array(11).fill('ningguang') : ['ningguang','ganyu','keqing']
const results: unknown[] = []
await mkdir(output, { recursive: true })
try {
  for (const [index, voice] of voices.entries()) {
    const started = performance.now(), chunks: Buffer[] = []
    let firstAudioMs: number | undefined
    const result = await runtime.run({ action:'tts', voice, text:'欢迎回来。故事还在等你继续。' }, undefined, undefined, pcm => {
      firstAudioMs ??= performance.now() - started
      chunks.push(pcm)
    })
    const pcm = Buffer.concat(chunks), wav = Buffer.alloc(44)
    wav.write('RIFF'); wav.writeUInt32LE(36+pcm.length,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16)
    wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(24000,24); wav.writeUInt32LE(48000,28)
    wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(pcm.length,40)
    await writeFile(resolve(output,`${voice}-${index}.wav`), Buffer.concat([wav,pcm]))
    const record = { voice, index, firstAudioMs, totalMs:performance.now()-started, ...result.header }
    results.push(record); console.log(JSON.stringify(record))
  }
} finally {
  runtime.stop()
  await writeFile(resolve(output, process.argv.includes('--warm') ? 'warm-results.json' : 'voices-results.json'),JSON.stringify(results,null,2))
}
