// Explicit developer setup, never invoked by the renderer or at application launch.
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { models } from './models.mjs'
import { kokoroModel, kokoroFloatModel } from './kokoro-model.mjs'
import { gptSovitsModels, gptSovitsVoiceModels } from './gpt-sovits-model.mjs'
import { fetch, ProxyAgent } from 'undici'

// Setup only: honor the author's explicit proxy environment, never change system proxy.
const dispatcher = process.env.HTTPS_PROXY ? new ProxyAgent(process.env.HTTPS_PROXY) : undefined

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.local/companion-voice/models')
async function verified(path, bytes, type, digest) {
  if ((await stat(path).catch(() => null))?.size !== bytes) return false
  const hash = createHash(type === 'git' ? 'sha1' : 'sha256')
  if (type === 'git') hash.update(`blob ${bytes}\0`)
  for await (const data of createReadStream(path)) hash.update(data)
  return hash.digest('hex') === digest
}
async function download(model, [name, bytes, type, digest]) {
  const dest = resolve(root, model.key, name)
  if (await verified(dest, bytes, type, digest)) return console.log(`verified ${model.key}/${name}`)
  // Existing unexpected final data is preserved for investigation.
  if (await stat(dest).catch(() => null)) throw Error(`Unexpected existing asset: ${model.key}/${name}`)
  await mkdir(dirname(dest), { recursive: true })
  const partial = `${dest}.partial`
  for (let attempt = 0; attempt < 4; attempt++) {
    let offset = (await stat(partial).catch(() => null))?.size || 0
    if (offset > bytes) throw Error('Partial asset exceeds pinned size')
    try {
      while (offset < bytes) {
        // The audition host throttles long responses; bounded ranges preserve
        // resume/hash guarantees without redownloading already received bytes.
        const ranged = process.argv.includes('--gpt-sovits') || process.argv.includes('--gpt-sovits-voices')
        const end = ranged ? Math.min(bytes - 1, offset + 16 * 1024**2 - 1) : bytes - 1
        const url = model.url || `https://huggingface.co/${model.repo}/resolve/${model.revision}/${name}`
        const response = await fetch(`${url}?download=true&resume=${offset}&end=${end}`, {
          headers: ranged || offset ? { Range: `bytes=${offset}-${end}` } : {}, signal: AbortSignal.timeout(ranged ? 120_000 : 30 * 60_000), dispatcher,
        })
        if (!response.ok) throw Error(`Asset response ${response.status}`)
        if (ranged && response.status !== 206 && (offset > 0 || end !== bytes - 1)) throw Error('Invalid resume response')
        if (ranged && response.status === 206 && response.headers.get('content-range') !== `bytes ${offset}-${end}/${bytes}`) throw Error('Invalid resume response')
        if (offset && response.status !== 206) offset = 0
        if (offset && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw Error('Invalid resume response')
        let received = offset, last = Date.now()
        const source = Readable.fromWeb(response.body)
        source.on('data', chunk => {
          received += chunk.length
          if (received > (ranged ? end + 1 : bytes)) source.destroy(Error('Asset exceeded pinned size'))
          if (Date.now() - last > 15000) { last = Date.now(); console.log(`${model.key}/${name}: ${Math.round(received / bytes * 100)}%`) }
        })
        await pipeline(source, createWriteStream(partial, { flags: offset ? 'a' : 'w' }))
        if (received !== (ranged ? end + 1 : bytes)) throw Error('Incomplete asset response')
        offset = received
        if (ranged) console.log(`${model.key}/${name}: ${Math.round(offset / bytes * 100)}%`)
      }
      if (!await verified(partial, bytes, type, digest)) throw Error(`Hash verification failed: ${model.key}/${name}`)
      await rename(partial, dest)
      return console.log(`verified ${model.key}/${name}`)
    } catch (error) {
      if (attempt === 3 || /Hash verification|size|resume/.test(String(error))) throw error
      console.log(`retry ${model.key}/${name}: ${error.message}`)
    }
  }
}
const selected = process.argv.includes('--gpt-sovits-voices') ? gptSovitsVoiceModels : process.argv.includes('--gpt-sovits') ? gptSovitsModels : process.argv.includes('--kokoro-fp32') ? [kokoroFloatModel] : process.argv.includes('--kokoro') ? [kokoroModel] : models
console.log(`Pinned model data: ${(selected.flatMap(m => m.files).reduce((sum, f) => sum + f[1], 0) / 1024**3).toFixed(2)} GiB; ${root}`)
// Two concurrent streams, all small files verified too. No token or login is required.
const queue = selected.flatMap(model => model.files.map(file => () => download(model, file)))
await Promise.all([0, 1].map(async () => { while (queue.length) await queue.shift()() }))
