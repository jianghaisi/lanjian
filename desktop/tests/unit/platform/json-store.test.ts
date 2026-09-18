import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { writeJson } from '../../../src/main/platform/storage/json-store'

test('uses isolated staging files when concurrent JSON saves target the same document', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-json-store-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const path = join(root, 'outline-state.json')
  const values = Array.from({ length: 24 }, (_, revision) => ({ revision, title: `版本 ${revision}` }))
  await Promise.all(values.map((value) => writeJson(path, value)))
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.ok(values.some((value) => value.revision === stored.revision && value.title === stored.title))
  assert.equal((await readdir(root)).filter((name) => name.includes('.tmp')).length, 0)
})
