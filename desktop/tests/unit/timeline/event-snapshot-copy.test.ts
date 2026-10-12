import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout } from 'node:timers/promises'
import test from 'node:test'
import { eventReadSnapshot } from '../../../src/main/modules/timeline/adapters/event-read-snapshot'

test('private snapshot copying does not make concurrent source connections readonly', async context => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-snapshot-copy-'))
  context.after(async () => {
    assert.equal(await realpath(root), root)
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, '.webnovel'))
  const path = join(root, '.webnovel', 'workspace.sqlite')
  const seed = new DatabaseSync(path)
  try {
    seed.exec('PRAGMA journal_mode=WAL; CREATE TABLE payload(value BLOB); INSERT INTO payload VALUES(zeroblob(16000000)); CREATE TABLE writes(value INTEGER);')
  } finally { seed.close() }

  const writeErrors: string[] = []
  let writes = 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let settled = false
    let snapshotError: { code?: string } | undefined
    const snapshot = eventReadSnapshot(root).then(result => result?.dispose(), error => {
      // Concurrent source changes may invalidate inspection; never suppress a
      // storage failure or change the source connection to obtain a snapshot.
      snapshotError = error
    }).finally(() => { settled = true })
    while (!settled) {
      let writer: DatabaseSync | undefined
      try {
        writer = new DatabaseSync(path)
        writer.exec('BEGIN IMMEDIATE; INSERT INTO writes VALUES(1); COMMIT')
        writes += 1
      } catch (error) { writeErrors.push(String(error)) }
      finally { writer?.close() }
      await setTimeout(1)
    }
    await snapshot
    if (snapshotError) assert.equal(snapshotError.code, 'CONFLICT')
  }
  assert.ok(writes > 0)
  assert.deepEqual(writeErrors, [])
})
