import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { assertManuscriptTextSchema } from '../../../src/main/modules/manuscript/adapters/manuscript-text-objects'
import { assertEventMigrationReceiptSchema } from '../../../src/main/modules/timeline/adapters/event-migration-receipt-schema'
import { assertEventStateSchema } from '../../../src/main/modules/timeline/adapters/event-state-schema'
import { assertEventOperationSchema } from '../../../src/main/modules/timeline/adapters/event-operation-schema'

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'lanjian-schema-read-'))
  t.after(async () => {
    assert.equal(await realpath(root), root)
    assert.equal(dirname(root), parent)
    await rm(root, { recursive: true, force: true })
  })
  const factory = new SqliteWorkspaceDatabaseFactory()
  ;(await factory.open(root)).close()
  const original = join(root, 'original.md')
  await writeFile(original, '隔离原稿必须保持不变。\r\n')
  return { root, factory, path: join(root, '.webnovel', 'workspace.sqlite'), original }
}

async function catalogQueries(run: () => Promise<void>) {
  const prepare = DatabaseSync.prototype.prepare
  let queries = 0
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql)
    if (/FROM\s+sqlite_schema\b/i.test(sql)) {
      const get = statement.get, all = statement.all
      statement.get = function(...args) { queries++; return Reflect.apply(get, this, args) }
      statement.all = function(...args) { queries++; return Reflect.apply(all, this, args) }
    }
    return statement
  }
  try { await run(); return queries }
  finally { DatabaseSync.prototype.prepare = prepare }
}

test('each writable and private readonly open reads one fresh catalog plus the independent identity check', async t => {
  const f = await fixture(t)
  const original = await readFile(f.original)
  for (const mode of ['write', 'readonly'] as const) {
    const queries = await catalogQueries(async () => {
      const database = mode === 'write' ? await f.factory.openExisting(f.root) : await f.factory.openEventReadOnly(f.root)
      assert.ok(database)
      database.close()
    })
    assert.equal(queries, 2, `${mode} catalog query count`)
  }
  assert.deepEqual(await readFile(f.original), original)
})

test('standalone guards still validate the database and an incomplete provided catalog cannot fall back', async t => {
  const f = await fixture(t)
  const raw = new DatabaseSync(f.path, { readOnly: true })
  try {
    const checks = [
      (catalog?: ReadonlyMap<string, string | null>) => assertManuscriptTextSchema(raw, WORKSPACE_DATABASE_SCHEMA_VERSION, catalog),
      (catalog?: ReadonlyMap<string, string | null>) => assertEventMigrationReceiptSchema(raw, WORKSPACE_DATABASE_SCHEMA_VERSION, catalog),
      (catalog?: ReadonlyMap<string, string | null>) => assertEventStateSchema(raw, catalog),
      (catalog?: ReadonlyMap<string, string | null>) => assertEventOperationSchema(raw, catalog)
    ]
    for (const check of checks) {
      assert.doesNotThrow(() => check())
      assert.throws(() => check(new Map()), { code: 'DATABASE_INTEGRITY_FAILED' })
    }
  } finally { raw.close() }
})

for (const guard of [
  'manuscript_text_objects_no_update',
  'event_migration_receipts_no_update',
  'event_lifecycle_versions_no_update',
  'event_operation_receipts_no_update'
]) {
  test(`every new open rejects a missing or replaced ${guard} without repair`, async t => {
    const f = await fixture(t)
    const raw = new DatabaseSync(f.path)
    const definition = raw.prepare("SELECT sql, tbl_name FROM sqlite_schema WHERE type='trigger' AND name=?").get(guard)!
    raw.close()
    const original = await readFile(f.original)
    for (const replace of [false, true]) {
      const edit = new DatabaseSync(f.path)
      try {
        edit.exec(`DROP TRIGGER ${guard}`)
        if (replace) edit.exec(`CREATE TRIGGER ${guard} BEFORE UPDATE ON ${definition.tbl_name} BEGIN SELECT 1; END;`)
      } finally { edit.close() }
      const bytes = await readFile(f.path)
      await assert.rejects(f.factory.openExisting(f.root), { code: 'DATABASE_INTEGRITY_FAILED' })
      await assert.rejects(f.factory.openEventReadOnly(f.root), { code: 'DATABASE_INTEGRITY_FAILED' })
      assert.deepEqual(await readFile(f.path), bytes)
      assert.deepEqual(await readFile(f.original), original)
      const repair = new DatabaseSync(f.path)
      try {
        if (replace) repair.exec(`DROP TRIGGER ${guard}`)
        repair.exec(String(definition.sql))
      } finally { repair.close() }
      // Only this explicit fixture repair restores validity; no trusted result survives reopening.
      ;(await f.factory.openExisting(f.root))!.close()
      ;(await f.factory.openEventReadOnly(f.root))!.close()
    }
  })
}
