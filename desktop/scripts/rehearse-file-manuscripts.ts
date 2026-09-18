/** Offline developer rehearsal. Reads the explicit source root, writes ONLY a
 * freshly allocated isolated directory, and retains that copy for desktop QA. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { stableEventReadSnapshot } from '../src/main/modules/timeline/adapters/event-read-snapshot'
import { previewLegacyTextMigration } from '../src/main/modules/manuscript/adapters/manuscript-text-export'
import { SqliteWorkspaceDatabaseFactory } from '../src/main/platform/storage/workspace-database'
import { ManuscriptTextMigrationService } from '../src/main/modules/manuscript/application/manuscript-text-migration-service'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--source-root') throw new Error('Usage: tsx scripts/rehearse-file-manuscripts.ts --source-root <explicit works directory>')
const source = await realpath(args[1])
const output = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-file-first-rehearsal-'))
const works = join(output, 'works')
await mkdir(works)
const report: { source: string; output: string; books: Array<Record<string, unknown>>; sourceUnchanged?: boolean; complete?: boolean; failure?: string } = { source, output, books: [] }
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const sidecar = (name: string) => /^\.webnovel\/workspace\.sqlite(?:-wal|-shm|-journal)?$/.test(name)
async function files(root: string, prefix = ''): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name, path = join(root, name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || await realpath(path) !== path) throw new Error('Rehearsal refuses redirected source entries')
    if (entry.isDirectory()) for (const [childName, digest] of await files(root, name + '/')) result.set(childName, digest)
    else if (entry.isFile()) result.set(name, hash(await readFile(path)))
    else throw new Error('Rehearsal requires ordinary files')
  }
  return result
}
async function size(root: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) total += await size(path)
    else total += (await lstat(path)).size
  }
  return total
}
function logicalSnapshot(db: DatabaseSync): Map<string, string> {
  const result = new Map<string, string>()
  for (const row of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const name = String(row.name)
    // Only these authority/projection tables are intentionally changed by migration.
    if (['schema_migrations', 'projects', 'mirror_entries', 'manuscript_text_objects', 'manuscript_file_heads', 'manuscript_file_commits'].includes(name)) continue
    const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => {
      if (!['body_versions', 'outline_versions', 'outline_nodes', 'autosave_checkpoints', 'document_chunks'].includes(name)) return JSON.stringify(row)
      const { content, ...metadata } = row
      return JSON.stringify(metadata)
    }).sort()
    result.set(name, hash(Buffer.from(JSON.stringify(rows))))
  }
  return result
}
// Physical Markdown calls, not SQLite page/cache activity. Instrument only this
// isolated measurement interval and restore every Node built-in afterwards.
function instrumentMarkdown(root: string) {
  const original = { openSync: fs.openSync, closeSync: fs.closeSync, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, unlinkSync: fs.unlinkSync, linkSync: fs.linkSync }
  const descriptors = new Map<number, string>(), currentPaths = new Set<string>()
  const counts = { reads: 0, writes: 0, replaces: 0, links: 0, removals: 0 }
  const markdown = (value: unknown) => {
    const path = typeof value === 'number' ? descriptors.get(value) : String(value)
    if (!path || !path.startsWith(root) || !/\.md(?:\.|$)/.test(path)) return false
    if (relative(root, path).startsWith('正文')) currentPaths.add(relative(root, path))
    return true
  }
  fs.openSync = ((...args: Parameters<typeof fs.openSync>) => { const fd = original.openSync(...args); descriptors.set(fd, String(args[0])); return fd }) as typeof fs.openSync
  fs.closeSync = ((fd: number) => { descriptors.delete(fd); original.closeSync(fd) }) as typeof fs.closeSync
  fs.readFileSync = ((...args: any[]) => { if (markdown(args[0])) counts.reads++; return (original.readFileSync as any)(...args) }) as typeof fs.readFileSync
  fs.writeFileSync = ((...args: any[]) => { if (markdown(args[0])) counts.writes++; return (original.writeFileSync as any)(...args) }) as typeof fs.writeFileSync
  fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => { if (markdown(args[1])) counts.replaces++; return original.renameSync(...args) }) as typeof fs.renameSync
  fs.linkSync = ((...args: Parameters<typeof fs.linkSync>) => { if (markdown(args[1])) counts.links++; return original.linkSync(...args) }) as typeof fs.linkSync
  fs.unlinkSync = ((...args: Parameters<typeof fs.unlinkSync>) => { if (markdown(args[0])) counts.removals++; return original.unlinkSync(...args) }) as typeof fs.unlinkSync
  syncBuiltinESMExports()
  return () => { Object.assign(fs, original); syncBuiltinESMExports(); return { ...counts, currentPaths: [...currentPaths] } }
}
const beforeByBook = new Map<string, Map<string, string>>()
try {
  const candidates = (await readdir(source, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
  for (const entry of candidates) {
    const originalRoot = join(source, entry.name)
    const before = await files(originalRoot)
    if (![...before.keys()].some(name => name.startsWith('.webnovel/') || name.startsWith('正文/'))) continue
    beforeByBook.set(originalRoot, before)
    const root = join(works, entry.name)
    await mkdir(root)
    for (const [name, digest] of before) {
      if (sidecar(name)) continue
      const destination = join(root, name)
      await mkdir(join(destination, '..'), { recursive: true })
      await copyFile(join(originalRoot, name), destination)
      assert.equal(hash(await readFile(destination)), digest)
    }
    const snapshot = await stableEventReadSnapshot(originalRoot)
    const item: Record<string, unknown> = { name: entry.name, isolatedPath: root }
    report.books.push(item)
    if (!snapshot) { item.authority = 'existing-files'; continue }
    try {
      await mkdir(join(root, '.webnovel'), { recursive: true })
      for (const suffix of ['', '-wal']) {
        try { await copyFile(snapshot.path + suffix, join(root, '.webnovel/workspace.sqlite') + suffix) }
        catch (error) { if (suffix && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      }
    } finally { snapshot.dispose() }
    const path = join(root, '.webnovel/workspace.sqlite')
    const old = new DatabaseSync(path, { readOnly: true })
    item.sourceSchema = Number(old.prepare('PRAGMA user_version').get()?.user_version)
    item.chapterCount = Number(old.prepare("SELECT count(*) AS n FROM chapters WHERE status <> 'archived'").get()?.n)
    const logicalBefore = logicalSnapshot(old)
    old.close()
    item.databaseBytesBefore = (await lstat(path)).size
    const factory = new SqliteWorkspaceDatabaseFactory()
    const preview = await previewLegacyTextMigration(root)
    item.references = preview.counts
    item.currentFiles = preview.current.length
    item.conflicts = preview.current.filter(head => head.state === 'external-conflict').map(head => ({ documentId: head.documentId, kind: head.kind, relativePath: head.relativePath }))
    if ((item.conflicts as unknown[]).length) { item.authority = 'blocked-external-conflict'; continue }
    const bundle = join(output, 'migration-' + basename(root))
    await mkdir(bundle)
    const migration = new ManuscriptTextMigrationService(factory)
    const start = performance.now()
    await migration.prepare(root, bundle, preview.fingerprint)
    const result = await migration.resume(root, bundle)
    item.migrationMs = Math.round(performance.now() - start)
    item.authority = result.authority
    item.backupPath = result.backupPath
    const raw = new DatabaseSync(path, { readOnly: true })
    assert.deepEqual(logicalSnapshot(raw), logicalBefore, 'all non-authority metadata and version identity preserved')
    for (const table of ['body_versions', 'outline_versions', 'outline_nodes', 'autosave_checkpoints', 'document_chunks']) {
      assert.equal(raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE content <> ''`).get()?.n, 0)
    }
    raw.close()
    item.databaseBytesAfter = (await lstat(path)).size
    item.historyBytesAfter = await size(join(root, '.webnovel/history/text'))
    const database = await factory.openExisting(root)
    assert.ok(database)
    const chapter = database.formalChapters()[0]
    assert.ok(chapter)
    const versionsBefore = database.formalRevisions(chapter.legacyChapterId).length
    const historiesBefore = (await readdir(join(root, '.webnovel/history/text'))).length
    const durations: number[] = []
    let checkpoint = ''
    const endMeasure = instrumentMarkdown(root)
    try {
      for (let i = 0; i < 20; i++) {
        const start = performance.now()
        const result = database.stageAutosaveCheckpoint({ legacyChapterId: chapter.legacyChapterId,
          baseBodyVersionId: chapter.currentVersionId, clientOperationId: randomUUID(), title: chapter.title,
          content: chapter.content + '\n\n隔离演练草稿 ' + i })
        checkpoint = result.checkpoint.id
        durations.push(performance.now() - start)
      }
    } finally { item.autosaveIO = endMeasure() }
    item.autosaveMs = { median: durations.sort((a, b) => a - b)[10], max: Math.max(...durations) }
    item.newAutosaveObjects = (await readdir(join(root, '.webnovel/history/text'))).length - historiesBefore
    assert.equal(database.formalRevisions(chapter.legacyChapterId).length, versionsBefore)
    database.finalizeAutosaveCheckpoint(checkpoint)
    assert.equal(database.formalRevisions(chapter.legacyChapterId).length, versionsBefore + 1)
    database.close()
    const reopened = await factory.openExisting(root)
    assert.ok(reopened)
    try {
      assert.equal(reopened.formalChapter(chapter.legacyChapterId)?.content, chapter.content + '\n\n隔离演练草稿 19')
      reopened.writeFormalChapter({ legacyChapterId: chapter.legacyChapterId, title: chapter.title, content: chapter.content,
        reason: 'restore', restoredFromVersionId: chapter.currentVersionId })
      assert.equal(reopened.formalChapter(chapter.legacyChapterId)?.content, chapter.content)
    } finally { reopened.close() }
    item.restartAndRestore = true
  }
  report.complete = report.books.every(book => book.authority === 'files-v1' || book.authority === 'existing-files')
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'rehearsal failed'
  process.exitCode = 1
} finally {
  report.sourceUnchanged = true
  for (const [root, expected] of beforeByBook) {
    if (JSON.stringify([...(await files(root))]) !== JSON.stringify([...expected])) report.sourceUnchanged = false
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ report: join(output, 'report.json'), complete: report.complete, sourceUnchanged: report.sourceUnchanged, failure: report.failure }))
}
