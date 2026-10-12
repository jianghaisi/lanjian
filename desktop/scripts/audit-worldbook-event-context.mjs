// Read-only event disclosure audit of the existing isolated five-chapter trial.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ProjectService } from '../src/main/modules/library/application/project-service.ts'
import { SettingsStore } from '../src/main/platform/settings/settings-store.ts'
import { DocumentService } from '../src/main/modules/manuscript/application/document-service.ts'
import { SqliteWorkspaceDatabaseFactory } from '../src/main/platform/storage/workspace-database.ts'
import { SqliteManuscriptService } from '../src/main/modules/manuscript/application/sqlite-manuscript-service.ts'
import { ResearchLibraryService } from '../src/main/modules/library/application/research-library-service.ts'
import { OutlinePlanningService } from '../src/main/modules/planning/application/outline-planning-service.ts'
import { WorkspaceService } from '../src/main/modules/library/application/workspace-service.ts'
import { LocalRetrievalService } from '../src/main/modules/assistant/application/local-retrieval-service.ts'

const denied = () => { throw new Error('This context audit cannot call providers or access credentials') }
globalThis.fetch = denied
const digest = text => createHash('sha256').update(text).digest('hex')
const research = resolve(dirname(fileURLToPath(import.meta.url)), '../../.trellis/tasks/09-28-v3-worldbook-generation/research')
const manifest = JSON.parse(await readFile(join(research, 'live-trial/trial.json'), 'utf8'))
const root = await realpath(manifest.root), book = await realpath(manifest.project.path)
assert.match(relative(await realpath(tmpdir()), root), /^lanjian-worldbook-trial-[a-zA-Z0-9]+$/)
assert.equal(dirname(book), root)
assert.equal(relative(root, book), '雨汛钟楼·世界书试写')
const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: denied, decrypt: denied }))
await projects.switch(book)
const databases = new SqliteWorkspaceDatabaseFactory(), authority = new SqliteManuscriptService(databases)
assert.equal(await authority.active(book), true)
const documents = new DocumentService(projects, undefined, authority)
const library = new ResearchLibraryService(projects, authority)
const planning = new OutlinePlanningService(projects, documents, library, authority)
const workspace = new WorkspaceService(projects, planning, library, documents, undefined, new LocalRetrievalService(projects, documents, undefined, authority), authority)


const output = await mkdtemp(join(research, 'event-context-audit-'))
const before = JSON.stringify({ chapters: await documents.chapters(), events: await library.listEvents() })
const old = JSON.parse(await readFile(join(research, 'codex-ch4-7wcz6K/base.json'), 'utf8')).context
assert.ok(old.includes('周叔承认十六年前'))
const checks = []
for (const chapterId of [4, 5]) {
  for (const task of ['prose', 'review']) {
    const context = await workspace.promptContext(chapterId, task)
    await writeFile(join(output, `chapter-${chapterId}-${task}.txt`), context)
    assert.ok(!context.includes('# 《雨汛钟楼》完整短篇验证'))
    if (chapterId === 4) assert.ok(!context.includes('周叔承认十六年前'), 'Future event or source excerpt leaked')
    if (chapterId === 5) assert.ok(context.includes('周叔亲手将十六年前'))
    assert.ok(context.includes('章级事件范围：只展开本章已分配事件'))
    checks.push({ chapterId, task, contextHash: digest(context), removedCopiedResearchExcerpt: true })
  }
}
assert.equal(JSON.stringify({ chapters: await documents.chapters(), events: await library.listEvents() }), before)
const planningContext = await workspace.promptContext(4, 'chapterOutline')
assert.ok(planningContext.includes('周叔承认十六年前'))
const result = { checks, priorFailureReproducedFromFrozenEvidence: true, bookAndSourceHistoryUnchanged: true, planningRetainsEvidence: true, providerCalls: 0, universalSecrecyClaimed: false }
await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ output, ...result }))
