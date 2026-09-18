/** Explicit offline author-book migration. The caller must close the desktop app.
 * Every migrated book receives its own export, verified full backup and receipt
 * below a new empty bundle root outside the works directory. */
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { stableEventReadSnapshot } from '../src/main/modules/timeline/adapters/event-read-snapshot'
import { previewLegacyTextMigration } from '../src/main/modules/manuscript/adapters/manuscript-text-export'
import { SqliteWorkspaceDatabaseFactory } from '../src/main/platform/storage/workspace-database'
import { ManuscriptTextMigrationService } from '../src/main/modules/manuscript/application/manuscript-text-migration-service'

const values = new Map<string, string>()
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]
  const value = args[index + 1]
  if (!key?.startsWith('--') || !value) throw new Error('Usage: tsx scripts/migrate-file-manuscripts.ts --source-root <works> --bundle-root <empty-directory> --confirm APPLY')
  values.set(key, value)
}
if (values.get('--confirm') !== 'APPLY' || !values.get('--source-root') || !values.get('--bundle-root')) {
  throw new Error('Usage: tsx scripts/migrate-file-manuscripts.ts --source-root <works> --bundle-root <empty-directory> --confirm APPLY')
}

const sourceRoot = await realpath(values.get('--source-root')!)
await mkdir(values.get('--bundle-root')!, { recursive: true })
const bundleRoot = await realpath(values.get('--bundle-root')!)
for (const [parent, child] of [[sourceRoot, bundleRoot], [bundleRoot, sourceRoot]]) {
  const path = relative(parent, child)
  if (!path || (path !== '..' && !path.startsWith(`..${sep}`))) throw new Error('Source and migration bundle roots must be separate siblings')
}
if ((await readdir(bundleRoot)).length) throw new Error('Migration bundle root must be empty')

type PlannedBook = { name: string; root: string; fingerprint: string; currentFiles: number; references: number; conflicts: number }
const planned: PlannedBook[] = []
const report: { version: 1; sourceRoot: string; bundleRoot: string; startedAt: string; completedAt?: string;
  books: Array<Record<string, unknown>>; failure?: string } = {
  version: 1, sourceRoot, bundleRoot, startedAt: new Date().toISOString(), books: []
}

try {
  const entries = (await readdir(sourceRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
  if (entries.length > 1_000) throw new Error('Works root contains too many direct child directories')
  for (const entry of entries) {
    const root = await realpath(join(sourceRoot, entry.name))
    const rootRelative = relative(sourceRoot, root)
    if (!rootRelative || rootRelative === '..' || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) {
      throw new Error('Work item resolves outside the selected works root')
    }
    const snapshot = await stableEventReadSnapshot(root)
    if (!snapshot) {
      report.books.push({ name: entry.name, status: 'existing-files-no-database' })
      continue
    }
    let authority = '', storageMode = '', schemaVersion = 0
    try {
      const database = new DatabaseSync(snapshot.path, { readOnly: true, allowExtension: false })
      try {
        schemaVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version)
        const projectColumns = new Set(database.prepare('PRAGMA table_info(projects)').all().map(row => String(row.name)))
        const rows = database.prepare(projectColumns.has('text_authority')
          ? 'SELECT storage_mode, text_authority FROM projects LIMIT 2'
          : 'SELECT storage_mode FROM projects LIMIT 2').all()
        if (rows.length !== 1) throw new Error('Work item database has ambiguous project identity')
        storageMode = String(rows[0].storage_mode)
        authority = rows[0].text_authority === undefined ? 'legacy-sqlite' : String(rows[0].text_authority)
      } finally { database.close() }
    } finally { snapshot.dispose() }
    if (authority === 'files-v1') {
      report.books.push({ name: entry.name, status: 'already-files-v1', schemaVersion })
      continue
    }
    if (storageMode !== 'sqlite' || authority !== 'legacy-sqlite') {
      report.books.push({ name: entry.name, status: 'not-eligible', storageMode, authority, schemaVersion })
      continue
    }
    const preview = await previewLegacyTextMigration(root)
    const conflicts = preview.current.filter(item => item.state === 'external-conflict').length
    planned.push({ name: entry.name, root, fingerprint: preview.fingerprint, currentFiles: preview.current.length,
      references: preview.references.length, conflicts })
    report.books.push({ name: entry.name, status: conflicts ? 'blocked-conflict' : 'planned', schemaVersion,
      currentFiles: preview.current.length, references: preview.references.length, conflicts })
  }
  if (planned.some(book => book.conflicts)) throw new Error('At least one work item has an external manuscript conflict; no migration was started')

  const migration = new ManuscriptTextMigrationService(new SqliteWorkspaceDatabaseFactory())
  for (const book of planned) {
    const bundle = join(bundleRoot, basename(book.root))
    await mkdir(bundle)
    await migration.prepare(book.root, bundle, book.fingerprint)
    const result = await migration.resume(book.root, bundle)
    const database = await new SqliteWorkspaceDatabaseFactory().openExisting(book.root)
    if (!database) throw new Error('Migrated work item database disappeared')
    try {
      if (database.textAuthority() !== 'files-v1') throw new Error('Migrated work item did not retain file text authority')
    } finally { database.close() }
    const item = report.books.find(value => value.name === book.name)!
    Object.assign(item, { status: 'migrated', authority: result.authority, backupPath: result.backupPath,
      currentFiles: result.currentFiles, references: result.references, vacuumed: result.vacuumed })
  }
  report.completedAt = new Date().toISOString()
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Migration failed'
  process.exitCode = 1
} finally {
  const reportPath = join(bundleRoot, 'migration-report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ report: reportPath, migrated: report.books.filter(book => book.status === 'migrated').length,
    skipped: report.books.filter(book => String(book.status).startsWith('existing-files') || book.status === 'already-files-v1').length,
    failure: report.failure }))
}
