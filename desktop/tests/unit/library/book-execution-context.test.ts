import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BookExecutionContext } from '../../../src/main/modules/library/application/book-execution-context'

test('overlapping books retain their own paths across await and detached background work', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-book-scope-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const a = join(root, 'a'), b = join(root, 'b')
  await Promise.all([mkdir(a), mkdir(b)])
  const scopes = new BookExecutionContext()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let background!: Promise<string | undefined>
  await scopes.run(a, async () => {
    background = gate.then(() => scopes.path())
    assert.equal(await scopes.path(), a)
  })
  assert.equal(scopes.current(), undefined)
  await scopes.run(b, async () => {
    release()
    assert.equal(await background, a)
    assert.equal(await scopes.path(), b)
  })
  assert.equal(await scopes.path(), undefined)
})

test('replacing a captured book directory revokes access instead of following the new book', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-book-scope-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const a = join(root, 'a')
  await mkdir(a)
  const scopes = new BookExecutionContext()
  await scopes.run(a, async () => {
    await rename(a, join(root, 'original'))
    await mkdir(a)
    await assert.rejects(scopes.path(), { code: 'CONFLICT' })
  })
})
