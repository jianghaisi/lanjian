import { join } from 'node:path'
import { lstat } from 'node:fs/promises'
import { SettingsStore } from '../../../../desktop/src/main/platform/settings/settings-store'
import { ProjectService } from '../../../../desktop/src/main/modules/library/application/project-service'
import { ProjectCreation } from '../../../../desktop/src/main/modules/library/application/project-creation'
import { NewFileProjectStorage } from '../../../../desktop/src/main/modules/library/application/new-file-project-storage'
import { SqliteWorkspaceDatabaseFactory } from '../../../../desktop/src/main/platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../../desktop/src/main/core/application/workspace-write-coordinator'
import { SqliteManuscriptService } from '../../../../desktop/src/main/modules/manuscript/application/sqlite-manuscript-service'
import { DocumentService } from '../../../../desktop/src/main/modules/manuscript/application/document-service'
import { ResearchLibraryService } from '../../../../desktop/src/main/modules/library/application/research-library-service'
import { OutlinePlanningService } from '../../../../desktop/src/main/modules/planning/application/outline-planning-service'
import { CharacterStateService } from '../../../../desktop/src/main/modules/characters/application/character-state-service'
import { LocalRetrievalService } from '../../../../desktop/src/main/modules/assistant/application/local-retrieval-service'
import { WorkspaceService } from '../../../../desktop/src/main/modules/library/application/workspace-service'
import { createEventRuntime } from '../../../../desktop/src/main/modules/timeline/runtime/event-runtime'
import { ManuscriptExportService } from '../../../../desktop/src/main/modules/manuscript/application/manuscript-export-service'
import { BookImportService } from '../../../../desktop/src/main/modules/library/application/book-import-service'
import { WorldMapService } from '../../../../desktop/src/main/modules/world-map/application/world-map-service'
import { BookRegistry } from '../storage/books.ts'
import { HostedDatabase, dbString } from '../storage/database.ts'
import { tenantParent, verifiedBookRoot } from '../files/tenant-root.ts'
import { fail } from '../http/errors.ts'
import type { AiClient } from '../../../../desktop/src/main/modules/models/application/ai-client'

class FixedProject extends ProjectService {
  constructor(readonly verifyRoot: () => Promise<string>, profile: string, identity: () => { title: string }) {
    super(new SettingsStore(profile, { available: () => false, encrypt: () => fail('configuration-required'), decrypt: () => fail('configuration-required') }),
      undefined, async () => identity())
  }
  override currentPath() { return this.verifyRoot() }
}
function compose(root: string, verifyRoot: () => Promise<string>, identity: () => { title: string }, ai?: AiClient) {
  const databases = new SqliteWorkspaceDatabaseFactory(), writes = new WorkspaceWriteCoordinator()
  // Hosted book identity is owned by the tenant registry, not a desktop shelf
  // snapshot. Writing definitions still come from the book's formal authority.
  const projects = new FixedProject(verifyRoot, join(root, '.webnovel', 'hosted'), identity)
  const manuscripts = new SqliteManuscriptService(databases, undefined, writes)
  const documents = new DocumentService(projects, undefined, manuscripts)
  const research = new ResearchLibraryService(projects, manuscripts)
  const events = createEventRuntime(projects, databases, writes, ai)
  const planning = new OutlinePlanningService(projects, documents, research, manuscripts, {
    read: () => events.projection.readForConsumer(), sync: async captured => (await events.mirrors.retryCaptured(captured)).status === 'synced'
  })
  const characters = new CharacterStateService(projects, manuscripts)
  const retrieval = new LocalRetrievalService(projects, documents)
  const workspace = new WorkspaceService(projects, planning, research, documents, characters, retrieval, manuscripts, { read: () => events.projection.readForConsumer() })
  const exports = new ManuscriptExportService(projects, documents)
  const imports = new BookImportService(projects, documents, research)
  const worldMap = new WorldMapService(projects, manuscripts)
  const settings = new SettingsStore(join(root, '.webnovel', 'hosted'), { available: () => false, encrypt: () => fail('configuration-required'), decrypt: () => fail('configuration-required') })
  return { root, projects, databases, writes, manuscripts, documents, research, events, planning, characters, workspace, exports, imports, worldMap, settings }
}
export type BookRuntime = ReturnType<typeof compose>
export class BookRuntimes {
  modelAi?: AiClient
  private readonly cache = new Map<string, { runtime: BookRuntime; physical: string; touched: number; active: number }>()
  private readonly setup = new WorkspaceWriteCoordinator()
  readonly mutations = new WorkspaceWriteCoordinator()
  constructor(readonly db: HostedDatabase, readonly books: BookRegistry) {}
  async run<T>(owner: string, id: string, operation: (runtime: BookRuntime) => Promise<T>): Promise<T> {
    this.books.get(owner, id)
    if (this.db.get('SELECT disabled FROM users WHERE id=?', owner)?.disabled !== 0) fail('account-disabled')
    const entry = await this.setup.run(id, async () => {
      const book = this.books.get(owner, id), key = `workspace:${id}`
      const state = this.db.get('SELECT value FROM settings WHERE key=?', key)
      if (!state) {
        const parent = await tenantParent(this.db.root, owner, true)
        this.db.run('INSERT INTO settings VALUES(?,?,1)', key, 'creating')
        const factory = new SqliteWorkspaceDatabaseFactory(), initialize = new NewFileProjectStorage(factory)
        const creation = new ProjectCreation(async () => undefined, 2, root => initialize.initialize(root))
        const result = await creation.create({ title: book.title, path: join(parent, id) })
        if (result.status !== 'created') fail('conflict')
        // This root was exclusively created above and has no imported/user content.
        // Initialize the existing V3 event authority through its reviewed transaction.
        const initial = compose(result.path, () => verifiedBookRoot(this.db.root, owner, id), () => this.books.get(owner, id), this.modelAi)
        const preview = await initial.events.reviews.preview()
        if (preview.summary.rowCount !== 0 || preview.summary.referenceCount !== 0 || preview.summary.groupCount !== 0) fail('conflict')
        const confirmed = await initial.events.reviews.review(preview.previewId, { fingerprint: preview.fingerprint, rows: [],
          acknowledgedGroups: [], acknowledgedPlanningFindings: [], acknowledgedMirrors: [...preview.requiredMirrorAcknowledgements] })
        await initial.events.migrations.commit(confirmed.token)
        this.db.run('UPDATE settings SET value=? WHERE key=?', 'ready', key)
      } else if (dbString(state.value) !== 'ready') fail('conflict')
      const root = await verifiedBookRoot(this.db.root, owner, id)
      const info = await lstat(root, { bigint: true }), physical = `${info.dev}:${info.ino}:${info.birthtimeNs}`
      let current = this.cache.get(id)
      if (current && current.physical !== physical) fail('conflict')
      if (!current) {
        if (this.cache.size >= 64) {
          const idle = [...this.cache].filter(([, value]) => value.active === 0).sort((a, b) => a[1].touched - b[1].touched)[0]
          if (!idle) fail('request-limit')
          this.cache.delete(idle[0])
        }
        const verifyRoot = async () => {
          this.books.get(owner, id)
          if (this.db.get('SELECT disabled FROM users WHERE id=?', owner)?.disabled !== 0) fail('account-disabled')
          const path = await verifiedBookRoot(this.db.root, owner, id), info = await lstat(path, { bigint: true })
          if (`${info.dev}:${info.ino}:${info.birthtimeNs}` !== physical) fail('conflict')
          return path
        }
        current = { runtime: compose(root, verifyRoot, () => this.books.get(owner, id), this.modelAi), physical, touched: this.db.now(), active: 0 }
        this.cache.set(id, current)
      }
      current.active++; current.touched = this.db.now()
      return current
    })
    try { return await entry.runtime.projects.runInCurrentBook(() => operation(entry.runtime)) }
    finally { entry.active-- }
  }
}
