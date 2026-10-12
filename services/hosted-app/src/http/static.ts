import { createReadStream } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { FastifyInstance } from 'fastify'

/** Enumerate the immutable build once; request paths never reach the filesystem. */
export async function registerStatic(app: FastifyInstance, directory: string) {
  const root = await realpath(directory), assets = new Map<string, { path: string; type: string; size: number; etag: string }>()
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.moc3': 'application/octet-stream', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' }
  async function visit(path: string, prefix: string) {
    for (const name of await readdir(path)) {
      const child = join(path, name), stat = await lstat(child)
      if (stat.isSymbolicLink()) throw new Error('Static links are unsupported.')
      if (stat.isDirectory()) await visit(child, `${prefix}/${name}`)
      else if (stat.isFile() && types[extname(name)]) assets.set(`${prefix}/${name}`, { path: child, type: types[extname(name)]!, size: stat.size, etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"` })
    }
  }
  Object.assign(types, { '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.webm': 'video/webm' })
  await visit(root, '')
  for (const [path, entry] of Object.entries({ '/': 'index', '/login': 'login', '/app': 'studio', '/admin': 'admin', '/app/reference': 'reference' })) {
    const file = assets.get(`/${entry}.html`)
    if (!file) throw new Error(`Missing web entry: ${entry}.`)
    assets.set(path, file)
  }
  app.get('/*', async (request, reply) => {
    const file = assets.get(request.url.split('?')[0]!)
    if (!file) return reply.callNotFound()
    reply.header('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
      .header('x-frame-options', 'DENY').header('content-type', file.type)
    if (!file.type.startsWith('text/html')) {
      reply.header('cache-control', request.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600').header('etag', file.etag)
      if (request.headers['if-none-match'] === file.etag) return reply.code(304).send()
    }
    if (/^(audio|video)\//.test(file.type)) {
      reply.header('accept-ranges', 'bytes')
      const range = request.headers.range
      if (range && (!request.headers['if-range'] || request.headers['if-range'] === file.etag)) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        let start = match?.[1] ? Number(match[1]) : 0
        let end = match?.[2] ? Number(match[2]) : file.size - 1
        if (match && !match[1] && match[2]) { start = Math.max(0, file.size - Number(match[2])); end = file.size - 1 }
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= file.size || start > end) return reply.code(416).header('content-range', `bytes */${file.size}`).send()
        end = Math.min(end, file.size - 1)
        return reply.code(206).header('content-range', `bytes ${start}-${end}/${file.size}`).header('content-length', end - start + 1).send(createReadStream(file.path, { start, end }))
      }
    }
    reply.header('content-length', file.size)
    return reply.send(createReadStream(file.path))
  })
}
