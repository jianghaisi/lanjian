import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fixture } from './helpers.ts'
import { registerStatic } from '../src/http/static.ts'
test('independent web entries share immutable assets, arbitrary paths and API fallbacks stay closed', async t => {
  const f = fixture(t), root = join(f.root, 'web')
  await mkdir(root); await writeFile(join(root, 'index.html'), '<html>fixture</html>'); await writeFile(join(root, 'app.js'), 'export const fixture=true'); await writeFile(join(root, 'secret.env'), 'sentinel')
  for (const entry of ['login', 'studio', 'admin', 'reference']) await writeFile(join(root, `${entry}.html`), `<html>fixture ${entry}</html>`)
  await registerStatic(f.app, root)
  for (const url of ['/', '/login', '/app', '/admin', '/app/reference']) { const res = await f.app.inject(url); assert.equal(res.statusCode, 200); assert.match(res.headers['content-security-policy']!, /frame-ancestors 'none'/); assert.match(res.body, /fixture/) }
  for (const url of ['/secret.env', '/%2e%2e/config.ts', '/api/absent', '/app/unknown', '/node_modules/fastify/package.json']) assert.equal((await f.app.inject(url)).statusCode, 404, url)
  assert.equal((await f.app.inject('/api/me')).statusCode, 401)
  assert.equal((await f.app.inject('/app.js')).headers['content-type'], 'text/javascript; charset=utf-8')
})

test('streaming audio supports byte ranges, seeking and conditional cache without exposing files', async t => {
  const f=fixture(t), root=join(f.root,'media')
  await mkdir(root)
  for(const name of ['index','login','studio','admin','reference']) await writeFile(join(root,`${name}.html`),'entry')
  await writeFile(join(root,'sample.mp3'),Buffer.from('0123456789'))
  await registerStatic(f.app,root)
  const ranged=await f.app.inject({url:'/sample.mp3',headers:{range:'bytes=2-5'}})
  assert.equal(ranged.statusCode,206); assert.equal(ranged.body,'2345'); assert.equal(ranged.headers['content-range'],'bytes 2-5/10')
  assert.equal((await f.app.inject({url:'/sample.mp3',headers:{range:'bytes=-3'}})).body,'789')
  assert.equal((await f.app.inject({url:'/sample.mp3',headers:{range:'bytes=99-'}})).statusCode,416)
  assert.equal((await f.app.inject({url:'/sample.mp3',headers:{'if-none-match':ranged.headers.etag!}})).statusCode,304)
  assert.equal((await f.app.inject({url:'/sample.mp3',headers:{range:'bytes=2-5','if-range':'old'}})).body,'0123456789')
})
