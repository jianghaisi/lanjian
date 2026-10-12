import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { defaultLimits } from '@lanjian/hosted-contracts'
import { assertTenantSpace } from '../src/files/quota.ts'

async function fixture(t: TestContext) {
  const parent = await fs.realpath(tmpdir())
  const root = await fs.realpath(await fs.mkdtemp(join(parent, 'lanjian-quota-race-')))
  const owner = randomUUID(), book = randomUUID(), books = join(root, 'users', owner, 'books')
  const directory = join(books, book, '.webnovel')
  await fs.mkdir(directory, { recursive: true })
  t.after(async () => {
    t.mock.restoreAll(); syncBuiltinESMExports()
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'lanjian-quota-race-')))
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, owner, book, books, directory }
}

test('quota scan tolerates SQLite WAL cleanup after enumeration and still counts surviving files', async t => {
  const f = await fixture(t), database = join(f.directory, 'workspace.sqlite')
  const db = new DatabaseSync(database)
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE metadata (id INTEGER); INSERT INTO metadata VALUES (1)')
  let closed = false
  t.after(() => { if (!closed) db.close() })
  await fs.access(`${database}-shm`)
  const readdir = fs.readdir
  t.mock.method(fs, 'readdir', async (...args: Parameters<typeof readdir>) => {
    const names = await readdir(...args)
    if (String(args[0]) === f.directory && !closed) {
      assert.ok(names.some(name => String(name) === 'workspace.sqlite-shm'))
      db.close(); closed = true
      await assert.rejects(fs.access(`${database}-shm`), { code: 'ENOENT' })
    }
    return names
  })
  syncBuiltinESMExports()
  await assertTenantSpace(f.root, f.owner, f.book, 1)
  assert.equal(closed, true, 'the real scan must enumerate before the real SQLite close')
  t.mock.restoreAll(); syncBuiltinESMExports()
  await fs.writeFile(join(f.directory, 'retained.bin'), Buffer.alloc(2 * 1024 * 1024))
  await assert.rejects(assertTenantSpace(f.root, f.owner, f.book, 1, { ...defaultLimits, userMiB: 1, bookMiB: 1 }), /quota-exceeded/)
})

test('quota scan propagates access, IO and non-directory errors on enumerated children', async t => {
  const f = await fixture(t), target = join(f.directory, 'retained.bin')
  await fs.writeFile(target, 'metadata')
  const lstat = fs.lstat
  for (const code of ['EACCES', 'EPERM', 'EIO', 'ENOTDIR']) {
    const failure = Object.assign(new Error('synthetic filesystem failure'), { code })
    t.mock.method(fs, 'lstat', async (...args: Parameters<typeof lstat>) => {
      if (String(args[0]) === target) throw failure
      return lstat(...args)
    })
    syncBuiltinESMExports()
    await assert.rejects(assertTenantSpace(f.root, f.owner, f.book, 1), error => error === failure)
    t.mock.restoreAll(); syncBuiltinESMExports()
  }
})

test('quota scan does not suppress missing tenant roots or missing enumerated book roots', async t => {
  const f = await fixture(t), target = join(f.books, f.book), lstat = fs.lstat
  const failure = Object.assign(new Error('synthetic missing book root'), { code: 'ENOENT' })
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof lstat>) => {
    if (String(args[0]) === target) throw failure
    return lstat(...args)
  })
  syncBuiltinESMExports()
  await assert.rejects(assertTenantSpace(f.root, f.owner, f.book, 1), error => error === failure)
  t.mock.restoreAll(); syncBuiltinESMExports()
  await assert.rejects(assertTenantSpace(f.root, randomUUID(), null, 1), { code: 'ENOENT' })
})
