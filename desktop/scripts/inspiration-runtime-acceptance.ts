import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { NativeVideoAcquisition } from '../src/main/modules/inspiration/adapters/native-video'
import { BilibiliSubtitles } from '../src/main/modules/inspiration/adapters/bilibili-subtitles'

// Explicit developer acceptance entry; no author books, settings or credentials.
const repo = resolve(import.meta.dirname, '../..')
const root = join(repo, '.local/inspiration-acceptance')
const evidence = join(repo, '.trellis/tasks/10-11-v3-inspiration-library-video/research')
await mkdir(root, { recursive: true })
const native = new NativeVideoAcquisition(root, join(root, 'unused-voice-runtime'),
  join(repo, 'desktop/src/main/modules/inspiration/adapters/video/worker.py'))
const startedAt = new Date().toISOString()
const command = process.argv[2]
try {
  if (command === 'prepare') {
    console.log('Preparing the authorized isolated video runtime.')
    const capabilities = await native.prepare()
    await writeFile(join(evidence, 'acceptance-runtime.json'), JSON.stringify({ startedAt,
      endedAt: new Date().toISOString(), root, capabilities }, null, 2))
    console.log(JSON.stringify(capabilities))
  } else if (command === 'probe') {
    console.log(JSON.stringify(await native.capabilities()))
  } else if (command === 'video' && process.argv[3]) {
    const signal = AbortSignal.timeout(15 * 60_000)
    const subtitles = new BilibiliSubtitles()
    const url = await subtitles.canonical(process.argv[3], signal)
    const document = await subtitles.acquire(url, signal) ?? await native.acquire(url, signal,
      async (stage, percent) => { console.log(JSON.stringify({ stage, percent })) })
    const result = { startedAt, endedAt: new Date().toISOString(), source: document.source,
      segments: document.segments.length, first: document.segments[0]?.startSeconds,
      last: document.segments.at(-1)?.endSeconds }
    await writeFile(join(evidence, `acceptance-video-${document.source.platform}.json`), JSON.stringify(result, null, 2))
    await writeFile(join(root, `${document.source.platform}-acquired.json`), JSON.stringify(document))
    console.log(JSON.stringify(result))
  } else throw new Error('Usage: prepare | probe | video <platform URL>')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Acceptance failed')
  process.exitCode = 1
} finally {
  native.shutdown()
}
