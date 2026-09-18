import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LocalVoiceRuntime } from '../../src/main/modules/companion/adapters/companion-voice/local-runtime'

// Synthetic, silent preparation through the production adapter. No author profile,
// text, audio output device or network. Close only the worker this probe owns.
const output = resolve('artifacts/companion-voice/preparation-correction')
const diagnostics: string[] = []
const runtime = new LocalVoiceRuntime(resolve('../../.local/companion-voice'), resolve('src/main/modules/companion/adapters/companion-voice/worker.py'), undefined, 'speech', undefined, chunk => {
  // Retain error TYPE only, not raw third-party diagnostics/path/source text.
  const found = chunk.toString().match(/\b(?:\w*Error|\w*Exception)\b/g) ?? []
  for (const type of found) if (!diagnostics.includes(type) && diagnostics.length < 20) diagnostics.push(type)
})
const results: object[] = []
await mkdir(output, { recursive: true })
try {
  assert.equal(await runtime.available(), true, 'selected runtime assets available')
  const started = performance.now()
  const prepared = await runtime.run({ action: 'prepare', voice: 'ningguang' })
  assert.equal(prepared.header.prepared, true)
  assert.equal(prepared.pcm.length, 0)
  results.push({ step: 'cold-silent-prepare', elapsedMs: performance.now() - started })
  console.log(JSON.stringify(results.at(-1)))
  const warm = performance.now()
  let firstAudioMs: number | undefined, bytes = 0, peak = 0
  await runtime.run({ action: 'tts', voice: 'ningguang', text: '欢迎回来。故事还在等你继续。' }, undefined, undefined, pcm => {
    firstAudioMs ??= performance.now() - warm
    bytes += pcm.length
    for (let index = 0; index < pcm.length; index += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(index)))
  })
  assert.ok(bytes > 4800 && peak > 100)
  results.push({ step: 'prepared-synthesis', elapsedMs: performance.now() - warm, firstAudioMs, bytes, peak })
  console.log(JSON.stringify(results.at(-1)))
} catch (error) {
  results.push({ failed: error instanceof Error ? error.message : 'unknown', diagnostics })
  throw error
} finally {
  runtime.stop()
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ results, diagnostics }, null, 2))
}
