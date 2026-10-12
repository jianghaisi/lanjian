import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, realpath, rm, readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { eventReadSnapshot, stableEventReadSnapshot } from '../../../src/main/modules/timeline/adapters/event-read-snapshot'
import { isChangingWorkspaceSnapshot } from '../../../src/main/core/errors/workspace-snapshot-error'

test('closing a normal WAL reader invalidates a byte snapshot even without editing prose; a settled reread succeeds', async t => {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-load-lifecycle-'))
  t.after(async () => { assert.equal(await realpath(root), root); assert.ok(root.startsWith(parent + sep)); await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, '.webnovel'))
  const path = join(root, '.webnovel/workspace.sqlite')
  let connection: DatabaseSync | undefined = new DatabaseSync(path)
  connection.exec('PRAGMA journal_mode=WAL; CREATE TABLE chapters(id INTEGER PRIMARY KEY, content TEXT); BEGIN')
  const insert = connection.prepare('INSERT INTO chapters VALUES (?, ?)')
  for (let id = 1; id <= 351; id++) insert.run(id, '合成正文。'.repeat(2000))
  connection.exec('COMMIT'); connection.close()
  const before = await readFile(path)
  connection = new DatabaseSync(path)
  connection.prepare('SELECT count(*) FROM chapters').get() // opens an empty WAL with no author edits
  try {
    await assert.rejects(eventReadSnapshot(root, async () => { connection!.close(); connection = undefined }), isChangingWorkspaceSnapshot)
    assert.deepEqual(await readFile(path), before)
    const snapshot = await stableEventReadSnapshot(root)
    assert.ok(snapshot)
    const reader = new DatabaseSync(snapshot.path, { readOnly: true })
    try { assert.equal(reader.prepare('SELECT count(*) AS total FROM chapters').get()!.total, 351) }
    finally { reader.close(); snapshot.dispose() }
    assert.deepEqual(await readFile(path), before)
    t.diagnostic(JSON.stringify({ chapters: 351, databaseBytes: before.length, sourceBytesUnchanged: true, retryRecovered: true }))
  } finally { connection?.close() }
})
