import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { WORKSPACE_DATABASE_RELATIVE_PATH, WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { SqliteCutoverSessionService } from '../../../src/main/modules/library/application/sqlite-cutover-session-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { PlanningDraftService } from '../../../src/main/modules/planning/application/planning-draft-service'
import { OutlinePlanningService } from '../../../src/main/modules/planning/application/outline-planning-service'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { WritingAgentService } from '../../../src/main/modules/assistant/application/writing-agent-service'
import { LocalRetrievalService } from '../../../src/main/modules/assistant/application/local-retrieval-service'
import { CharacterStateService } from '../../../src/main/modules/characters/application/character-state-service'
import { BookImportService } from '../../../src/main/modules/library/application/book-import-service'
import { ProjectAiService } from '../../../src/main/modules/models/application/project-ai-service'
import { WritingAgentApprovalService } from '../../../src/main/modules/assistant/application/writing-agent-approval-service'
import type { WritingAgentTask } from '../../../src/contracts/index'
import type { AiClient } from '../../../src/main/modules/models/application/ai-client'
import type { ChapterDraftService } from '../../../src/main/modules/manuscript/application/chapter-draft-service'
import type { ChapterDraftProposal } from '../../../src/contracts/index'
import { contextMaterialEvidenceKey } from '../../../src/contracts/assistant/context-evidence-key'
import { TaskCenterService } from '../../../src/main/modules/assistant/application/task-center-service'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

async function reviewedRevision(base: Awaited<ReturnType<typeof fixture>>, target: { kind: 'body'; chapterId: number } | { kind: 'outline'; key: string }, content: string) {
  const db = await base.databases.openExisting(base.project.path)
  assert.ok(db)
  try {
    const current = target.kind === 'body' ? db.formalChapters().find(item => item.legacyChapterId === target.chapterId)
      : db.formalOutlines().find(item => item.legacyKey === target.key)
    assert.ok(current)
    const digest = (text: string) => createHash('sha256').update(text).digest('hex')
    return { projectFingerprint: digest(base.project.path), target, baseVersionId: current.currentVersionId,
      baseHash: current.contentHash, content, candidateHash: digest(content), reviewManifestHash: digest('reviewed candidate manifest'), creationMethod: 'ai' as const }
  } finally { db.close() }
}

test('reviewed external revisions preserve history, title and origin for body, chapter and volume outlines', async context => {
  const base = await fixture(context)
  const inputs = [
    await reviewedRevision(base, { kind: 'body', chapterId: 10 }, '采用外部审阅后的正文。'),
    await reviewedRevision(base, { kind: 'outline', key: 'chapter-10' }, '采用外部审阅后的章纲。'),
    await reviewedRevision(base, { kind: 'outline', key: 'volume-1' }, '采用外部审阅后的卷纲。')
  ]
  for (const input of inputs) {
    const result = await base.authority.adoptReviewedExternalRevision(base.project.path, input, async () => {})
    assert.equal(result.previousVersionId, input.baseVersionId)
    assert.notEqual(result.adoptedVersionId, input.baseVersionId)
    assert.equal(result.candidateHash, input.candidateHash)
    assert.equal(result.creationMethod, 'ai')
    assert.equal(result.mirrorPending, false)
    await assert.rejects(base.authority.adoptReviewedExternalRevision(base.project.path, input, async () => {}), { code: 'CONFLICT' })
  }
  const revisions = await base.authority.revisions(base.project.path, 10)
  assert.ok(revisions.some(item => item.id.endsWith(inputs[0].baseVersionId)))
  const current = revisions.find(item => item.isCurrent)!
  assert.equal(current.reason, 'restore')
  assert.match(current.label!, /^外部 AI 修订采用 · /)
  assert.equal(current.title, '雨夜来客')
  assert.equal(current.generationArtifactId, null)
  const db = await base.databases.openExisting(base.project.path)
  assert.ok(db)
  try {
    assert.equal(db.formalChapters().find(item => item.legacyChapterId === 20)!.content, '第二天，他沿着旧城墙寻找回声。')
    assert.equal(db.formalOutlines().find(item => item.legacyKey === 'total')!.content, '# 总纲\n\n雨夜来信牵出旧城秘密。')
  } finally { db.close() }
})

test('reviewed external revisions reject stale book, hash, source and final-version changes', async context => {
  const base = await fixture(context)
  const input = await reviewedRevision(base, { kind: 'body', chapterId: 10 }, '外部候选正文。')
  const original = await base.authority.revisions(base.project.path, 10)
  for (const bad of [{ ...input, projectFingerprint: '0'.repeat(64) }, { ...input, content: '候选后来改了。' }]) {
    await assert.rejects(base.authority.adoptReviewedExternalRevision(base.project.path, bad, async () => {}), { code: 'VALIDATION_ERROR' })
  }
  await assert.rejects(base.authority.adoptReviewedExternalRevision(base.project.path, input, async () => { throw new Error('review source changed') }), /review source changed/)
  assert.deepEqual(await base.authority.revisions(base.project.path, 10), original)
  // A second service models another main-process writer during the asynchronous guard.
  const other = new SqliteManuscriptService(base.databases)
  await assert.rejects(base.authority.adoptReviewedExternalRevision(base.project.path, input, async () => {
    await other.updateChapter(base.project.path, 10, { content: '作者在审阅后又写了一句。' })
  }), { code: 'CONFLICT' })
  assert.equal((await base.authority.revisions(base.project.path, 10)).find(item => item.isCurrent)!.content, '作者在审阅后又写了一句。')
})

test('reviewed external revisions reject external mirror drift and report committed mirror failures without replay', async context => {
  const base = await fixture(context)
  const input = await reviewedRevision(base, { kind: 'outline', key: 'volume-1' }, '新的卷纲。')
  const db = await base.databases.openExisting(base.project.path)
  assert.ok(db)
  const path = join(base.project.path, db.formalOutlines().find(item => item.legacyKey === 'volume-1')!.mirrorRelativePath)
  db.close()
  const original = await readFile(path)
  await writeFile(path, '作者外部编辑，不能覆盖。')
  await assert.rejects(base.authority.adoptReviewedExternalRevision(base.project.path, input, async () => {}), { code: 'CONFLICT' })
  assert.equal(await readFile(path, 'utf8'), '作者外部编辑，不能覆盖。')
  await writeFile(path, original)
  // Inject only mirror I/O failure; real SQLite validation and commit still execute.
  Object.defineProperty(base.authority, 'syncPlan', { value: async () => { throw new Error('injected disk failure') } })
  const committed = await base.authority.adoptReviewedExternalRevision(base.project.path, input, async () => {})
  assert.equal(committed.mirrorPending, true)
  assert.notEqual(committed.adoptedVersionId, input.baseVersionId)
  const reopened = await base.databases.openExisting(base.project.path)
  assert.ok(reopened)
  try { assert.equal(reopened.formalOutlines().find(item => item.legacyKey === 'volume-1')!.content, input.content) } finally { reopened.close() }
  await assert.rejects(base.authority.adoptReviewedExternalRevision(base.project.path, input, async () => {}), { code: 'CONFLICT' })
})

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-formal-db-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const trashRoot = join(root, 'trash')
  const trash = {
    trashItem: async (path: string) => {
      await mkdir(trashRoot, { recursive: true })
      await rename(path, join(trashRoot, basename(path)))
    }
  }
  const projects = new ProjectService(settings, trash)
  const created = await projects.create({ parentPath: root, name: '正式存储测试', genre: '玄幻' })
  const fileDocuments = new DocumentService(projects, trash)
  const fileWorkspace = new WorkspaceService(projects)
  await fileWorkspace.saveBookProfile({
    genre: '东方玄幻', subgenre: '悬疑升级', coreIdea: '雨夜来信牵出旧城秘密。',
    plannedVolumes: 3, chaptersPerVolume: 40, targetWordsPerChapter: 3200, targetWords: 1_200_000,
    audienceScale: '成年读者；暴力克制', defaultPov: '第三人称限知', narrativeDistance: '近距离', writingStyle: '冷静、准确',
    proseExpansionMode: 'web-serial', reviewStrictness: 'balanced',
    autosaveEnabled: true, autosaveDelayMs: 1_500, autosaveMergeWindowMs: 30_000
  })
  await fileWorkspace.saveFoundation({
    creationPath: 'research',
    sourceNotes: '旧稿札记：雨夜来信与旧城钟楼有关。',
    worldView: '旧城中的异常回声只能在雨夜被听见。',
    useRealms: true,
    useSystem: false
  })
  await fileWorkspace.savePromptOverride({ task: 'prose', content: '雨夜场景用短句推进，线索必须落在人物动作上。' })
  await fileDocuments.updateChapter(10, { title: '雨夜来客', content: '沈砚在雨夜收到一封信。' })
  await fileDocuments.updateChapter(20, { title: '旧城回声', content: '第二天，他沿着旧城墙寻找回声。' })
  await fileDocuments.reorderChapter(20, 1)
  await fileDocuments.updateOutline('total', '# 总纲\n\n雨夜来信牵出旧城秘密。')
  await fileDocuments.updateOutline(1, '# 第一卷\n\n沈砚追查来信来源。')
  await fileDocuments.updateChapterOutline(10, '收到来信，决定前往旧城。')
  let sequence = 0
  const databases = new SqliteWorkspaceDatabaseFactory(
    () => new Date(`2026-09-01T03:00:${String(sequence).padStart(2, '0')}.000Z`),
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  )
  const source = new CurrentProjectLegacyWorkspaceSource(projects, fileDocuments)
  const importer = new ShadowImportService(source, databases)
  const preview = await importer.preview()
  await importer.import(preview)
  const authority = new SqliteManuscriptService(databases, trash)
  await authority.activate(created.project.path, await source.snapshot())
  const documents = new DocumentService(projects, trash, authority)
  return { root, trashRoot, project: created.project, projects, settings, databases, authority, documents, source, importer }
}

test('keeps SQLite authoritative after new, multi-file-imported and legacy-project activation', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-origin-matrix-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const projects = new ProjectService(settings)
  const databases = new SqliteWorkspaceDatabaseFactory()

  for (const origin of ['new', 'imported', 'legacy'] as const) {
    const created = await projects.create({ parentPath: root, name: `来源-${origin}`, genre: '都市' })
    const fileDocuments = new DocumentService(projects)
    if (origin === 'imported') {
      const manuscriptPath = join(root, '待导入正文.txt')
      const materialPath = join(root, '待导入资料.md')
      await writeFile(manuscriptPath, '第一章 导入开篇\n导入正文中的第一句话。\n第二章 导入后续\n导入正文中的第二句话。', 'utf8')
      await writeFile(materialPath, '# 人物资料\n林澈是本书主角。', 'utf8')
      const imports = new BookImportService(projects, fileDocuments, new ResearchLibraryService(projects))
      const manifest = await imports.previewFiles([manuscriptPath, materialPath])
      await imports.commitManifest({
        id: manifest.id,
        files: [
          { token: manifest.files[0].token, ownership: 'owned', creationMethod: 'human', title: '导入正文', selectedChapterIndexes: [0, 1] },
          { token: manifest.files[1].token, ownership: 'material', title: '人物资料' }
        ]
      })
    } else if (origin === 'legacy') {
      await fileDocuments.updateChapter(7, { title: '旧项目章节', content: '旧格式正文必须无损进入正式存储。' })
      await fileDocuments.updateOutline('total', '# 旧项目总纲\n\n旧格式大纲也必须保留。')
    }

    const source = new CurrentProjectLegacyWorkspaceSource(projects, fileDocuments)
    const importer = new ShadowImportService(source, databases)
    const preview = await importer.preview()
    await importer.import(preview)
    const authority = new SqliteManuscriptService(databases)
    await authority.activate(created.project.path, await source.snapshot())
    const documents = new DocumentService(projects, undefined, authority)
    const existing = (await documents.chapters())[0] ?? await documents.createChapter()
    const formalContent = `${origin} 来源切换后的 SQLite 正文。`
    const saved = await documents.updateChapter(existing.id, {
      title: `${origin}正式章`, content: formalContent, reason: 'manual', expectedRevision: existing.revision
    })
    assert.equal((await documents.chapter(saved.id)).content, formalContent)

    const database = await databases.openExisting(created.project.path)
    assert.ok(database)
    assert.equal(database.storageMode(), 'sqlite')
    assert.equal(database.formalChapters().find((chapter) => chapter.legacyChapterId === saved.id)?.content, formalContent)
    database.assertRollbackReady()
    database.close()

    const mirrorPath = join(created.project.path, '正文', `第${saved.id}章-${origin}正式章.md`)
    assert.equal(await readFile(mirrorPath, 'utf8'), formalContent)
    await writeFile(mirrorPath, '外部修改的可读镜像，不是正式正文。', 'utf8')
    assert.equal((await documents.chapter(saved.id)).content, formalContent, `${origin} 来源不能让 Markdown 外改反向覆盖 SQLite`)
    assert.equal(await readFile(mirrorPath, 'utf8'), '外部修改的可读镜像，不是正式正文。')

    const raw = new DatabaseSync(join(created.project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
    const row = raw.prepare(`SELECT versions.content FROM chapters JOIN body_versions versions ON versions.id = chapters.current_body_version_id WHERE chapters.legacy_chapter_id = ?`).get(saved.id)
    assert.equal(row?.content, formalContent)
    raw.close()
  }
})

test('uses SQLite project identity after activation while retaining bootstrap files without trusting external edits', async (context) => {
  const { project, settings, databases } = await fixture(context)
  const statePath = join(project.path, '.webnovel', 'state.json')
  const profilePath = join(project.path, '.webnovel', 'config', 'book-profile.json')
  const externalState = `${JSON.stringify({ version: 2, schemaVersion: 2, project_info: { title: '外部伪造书名', genre: '外部题材' }, updated_at: '2030-01-01T00:00:00.000Z' }, null, 2)}\n`
  const externalProfile = `${JSON.stringify({ genre: '外部伪造题材' }, null, 2)}\n`
  await writeFile(statePath, externalState, 'utf8')
  await writeFile(profilePath, externalProfile, 'utf8')

  const formalProjects = new ProjectService(settings, undefined, async (path) => {
    const database = await databases.openExisting(path)
    if (!database) return null
    try {
      if (database.storageMode() !== 'sqlite') return null
      return { title: database.inspect().project.name, genre: database.projectWritingConfig().genreText }
    } finally { database.close() }
  })
  const current = await formalProjects.currentSummary()
  assert.equal(current.title, '正式存储测试')
  assert.equal(current.name, '正式存储测试')
  assert.equal(current.genre, '东方玄幻')
  assert.equal((await formalProjects.list()).projects[0].title, '正式存储测试')
  assert.equal(await readFile(statePath, 'utf8'), externalState)
  assert.equal(await readFile(profilePath, 'utf8'), externalProfile)

  const database = await databases.openExisting(project.path)
  assert.ok(database)
  try {
    assert.equal(database.inspect().project.name, '正式存储测试')
    assert.equal(database.projectWritingConfig().genreText, '东方玄幻')
  } finally { database.close() }
})

test('migrates the complete character-state ledger into SQLite and keeps the legacy JSON as a protected mirror', async (context) => {
  const { project, projects, databases, authority } = await fixture(context)
  const legacy = new CharacterStateService(projects)
  const firstSeeds = [{ name: '沈砚', role: '旧城调查者', arcSeed: '追查雨夜来信的来源' }]
  const firstPreview = await legacy.previewPlanningSeeds('legacy-planning', firstSeeds)
  await legacy.adoptPlanningSeeds({
    proposalId: 'legacy-planning', seeds: firstSeeds,
    candidateFingerprint: firstPreview.candidateFingerprint, currentFingerprint: firstPreview.currentFingerprint
  })

  const formal = new CharacterStateService(projects, authority)
  assert.deepEqual((await formal.state()).anchors.map((anchor) => anchor.name), ['沈砚'])
  let database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalCharacterStateReady(), true)
  assert.equal(JSON.parse(database.characterState().content).anchors[0]?.name, '沈砚')
  assert.equal(database.characterStateMirror()?.status, 'synced')
  database.close()

  const secondSeeds = [{ name: '苏晚', role: '钟楼守夜人', arcSeed: '决定是否交出失踪名册' }]
  const secondPreview = await formal.previewPlanningSeeds('formal-planning', secondSeeds)
  await formal.adoptPlanningSeeds({
    proposalId: 'formal-planning', seeds: secondSeeds,
    candidateFingerprint: secondPreview.candidateFingerprint, currentFingerprint: secondPreview.currentFingerprint
  })
  const mirrorPath = join(project.path, '.webnovel', 'story-state', 'characters.json')
  const mirrored = JSON.parse(await readFile(mirrorPath, 'utf8')) as { anchors: Array<{ name: string }> }
  assert.deepEqual(mirrored.anchors.map((anchor) => anchor.name), ['沈砚', '苏晚'])

  const externallyEdited = (await readFile(mirrorPath, 'utf8')).replace('钟楼守夜人', '外部改写')
  await writeFile(mirrorPath, externallyEdited, 'utf8')
  await assert.rejects(formal.state(), /外部修改/)
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(JSON.parse(database.characterState().content).anchors[1]?.role, '钟楼守夜人')
  assert.equal(database.characterStateMirror()?.status, 'conflict')
  database.close()
})

test('migrates outline workflow assignments and confirmations into SQLite while protecting the readable ledger', async (context) => {
  const { project, projects, databases, authority, documents } = await fixture(context)
  const research = new ResearchLibraryService(projects, authority)
  const legacy = new OutlinePlanningService(projects, documents, research)
  await legacy.createVolume('第二卷·钟楼回声')
  const ledgerPath = join(project.path, '.webnovel', 'planning', 'outline-state.json')
  assert.match(await readFile(ledgerPath, 'utf8'), /第二卷·钟楼回声/)

  const formal = new OutlinePlanningService(projects, documents, research, authority)
  assert.ok((await formal.status()).volumes.some((volume) => volume.title === '第二卷·钟楼回声'))
  let database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalOutlinePlanningStateReady(), true)
  assert.equal(database.outlinePlanningStateMirror()?.status, 'synced')
  database.close()

  await formal.createVolume('第三卷·失踪名册')
  const mirrored = JSON.parse(await readFile(ledgerPath, 'utf8')) as { volumes: Array<{ title: string }> }
  assert.ok(mirrored.volumes.some((volume) => volume.title === '第三卷·失踪名册'))
  const externallyEdited = (await readFile(ledgerPath, 'utf8')).replace('第三卷·失踪名册', '外部改写')
  await writeFile(ledgerPath, externallyEdited, 'utf8')
  await assert.rejects(formal.status(), /外部修改/)
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.match(database.outlinePlanningState().content, /第三卷·失踪名册/)
  assert.doesNotMatch(database.outlinePlanningState().content, /外部改写/)
  assert.equal(database.outlinePlanningStateMirror()?.status, 'conflict')
  database.close()
})

test('migrates multi-API model routing into SQLite authority and never lets the readable JSON choose another provider', async (context) => {
  const { project, projects, settings, databases, authority } = await fixture(context)
  const aiPath = join(project.path, '.webnovel', 'ai-settings.json')
  const profile = (connectionId: string, model: string, temperature: number) => ({ connectionId, model, temperature, topP: 1, maxTokens: 8192 })
  const legacy = {
    version: 2 as const,
    connections: [
      { id: 'gpt-route', name: 'GPT 专线', baseUrl: 'https://gpt.example.test/v1' },
      { id: 'gemini-route', name: 'Gemini 专线', baseUrl: 'https://gemini.example.test/v1' }
    ],
    routingMode: 'shared' as const,
    shared: profile('gpt-route', 'shared-name-model', 0.7),
    tasks: {
      outline: profile('gemini-route', 'gemini-outline', 0.6),
      chapterOutline: profile('gpt-route', 'gpt-chapter', 0.65),
      prose: profile('gpt-route', 'gpt-prose', 0.8),
      review: profile('gemini-route', 'gemini-review', 0.2)
    }
  }
  await writeFile(aiPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

  const projectAi = new ProjectAiService(projects, settings, authority)
  const beforeRead = await readFile(aiPath, 'utf8')
  assert.equal((await projectAi.get()).shared.connectionId, 'gpt-route')
  assert.equal(await authority.aiSettingsReady(project.path), false)
  assert.equal(await readFile(aiPath, 'utf8'), beforeRead)
  // Importing readable routing is now an explicit save operation.
  await projectAi.update({})
  let database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalAiSettingsReady(), true)
  assert.equal(JSON.parse(database.aiSettings().content).connections[1]?.id, 'gemini-route')
  assert.equal(database.aiSettingsMirror()?.status, 'synced')
  assert.deepEqual(database.listModelConfigs().filter((item) => item.enabled).map((item) => item.provider), [
    'gpt-route:https://gpt.example.test/v1#shared'
  ])
  database.close()

  const secretMarker = 'sk-must-stay-outside-workspace-sqlite'
  await settings.updateProjectApiKey(project.path, secretMarker, false, 'gemini-route')
  const mirrorBeforeOverride = await readFile(aiPath, 'utf8')
  const override = await projectAi.resolve('prose', 'gemini-route')
  assert.equal(override.connectionName, 'Gemini 专线')
  assert.equal(override.profile.connectionId, 'gemini-route')
  assert.equal(override.profile.temperature, 0.7)
  assert.equal(override.profile.model, 'shared-name-model')
  assert.equal(override.apiKey, secretMarker)
  await assert.rejects(projectAi.resolve('prose'), /尚未配置/)
  assert.equal((await projectAi.get()).shared.connectionId, 'gpt-route')
  assert.equal(await readFile(aiPath, 'utf8'), mirrorBeforeOverride)
  const updated = await projectAi.update({
    connections: [legacy.connections[0], { ...legacy.connections[1], apiKey: secretMarker }],
    shared: profile('gemini-route', 'shared-name-model', 0.75)
  })
  assert.equal(updated.shared.connectionId, 'gemini-route')
  assert.equal((await projectAi.resolve('prose')).connectionName, 'Gemini 专线')
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(JSON.parse(database.aiSettings().content).shared.connectionId, 'gemini-route')
  assert.deepEqual(database.listModelConfigs().filter((item) => item.enabled).map((item) => item.provider), [
    'gemini-route:https://gemini.example.test/v1#shared'
  ])
  database.close()
  const sqliteBytes = await readFile(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')))
  assert.equal(sqliteBytes.includes(Buffer.from(secretMarker)), false)
  assert.doesNotMatch(await readFile(aiPath, 'utf8'), /apiKey|apiKeyConfigured|sk-must/)

  const external = (await readFile(aiPath, 'utf8')).replace('gemini-route', 'external-route')
  await writeFile(aiPath, external, 'utf8')
  assert.equal((await projectAi.get()).shared.connectionId, 'gemini-route')
  assert.equal(await readFile(aiPath, 'utf8'), external)
  await assert.rejects(projectAi.update({}), (error: { code?: string }) => error.code === 'CONFLICT')
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(JSON.parse(database.aiSettings().content).shared.connectionId, 'gemini-route')
  assert.equal(database.aiSettingsMirror()?.status, 'conflict')
  database.close()
})

test('keeps timeline reads in compatibility until explicit save while retaining writing-system configuration behavior', async (context) => {
  const { project, projects, databases, authority } = await fixture(context)
  const configRoot = join(project.path, '.webnovel', 'config')
  await mkdir(configRoot, { recursive: true })
  const legacyFiles = {
    'timeline.json': { events: [{ id: 'event-1', time: '第一夜', characters: '沈砚', location: '旧钟楼', event: '听见第七声回音', result: '决定继续调查' }] },
    'levels.json': { levels: [{ id: 'level-1', name: '听潮', description: '只能辨认近处异常回音' }] },
    'power-system.json': { version: 1, overview: '力量来自对异常回音的理解，不能凭空越级。' },
    'cheat-system.json': { version: 1, overview: '主角可以记住每次异常回音的差异。' },
    'system-ui.json': { template: '[回音]\n来源：{{source}}\n差异：{{difference}}' }
  }
  for (const [name, value] of Object.entries(legacyFiles)) await writeFile(join(configRoot, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')

  const workspace = new WorkspaceService(projects, undefined, undefined, undefined, undefined, undefined, authority)
  assert.equal((await workspace.timeline()).events[0]?.location, '旧钟楼')
  assert.equal((await workspace.realms()).levels[0]?.name, '听潮')
  assert.match((await workspace.powerSystem()).overview, /不能凭空越级/)
  assert.match((await workspace.cheatSystem()).overview, /异常回音/)
  assert.match((await workspace.systemTemplate()).template, /差异/)

  let database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalWorkspaceConfigReady('timeline'), false)
  for (const kind of ['realms', 'power_system', 'cheat_system', 'system_ui'] as const) {
    assert.equal(database.formalWorkspaceConfigReady(kind), true)
    assert.equal(database.workspaceConfigMirror(kind)?.status, 'synced')
  }
  assert.equal(database.workspaceConfig('realms').revision, 1)
  database.close()

  await workspace.saveTimeline(legacyFiles['timeline.json'].events)
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalWorkspaceConfigReady('timeline'), true)
  assert.equal(database.workspaceConfigMirror('timeline')?.status, 'synced')
  assert.deepEqual((await workspace.timeline()).events, legacyFiles['timeline.json'].events)
  database.close()

  await workspace.saveRealms([
    { id: 'level-1', name: '听潮', description: '只能辨认近处异常回音' },
    { id: 'level-2', name: '观澜', description: '可以追踪整座旧城的回音来源' }
  ])
  await workspace.savePowerSystem({ overview: '理解异常回音后逐层提升，但不能跨越境界。' })
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(JSON.parse(database.workspaceConfig('realms').content).levels[1]?.name, '观澜')
  assert.equal(database.workspaceConfig('realms').revision, 2)
  assert.equal(JSON.parse(database.workspaceConfig('power_system').content).overview, '理解异常回音后逐层提升，但不能跨越境界。')
  database.close()
  assert.match(await readFile(join(configRoot, 'levels.json'), 'utf8'), /观澜/)

  const external = '{"levels":[{"id":"external","name":"外部改写","description":"不应进入正式配置"}]}\n'
  await writeFile(join(configRoot, 'levels.json'), external, 'utf8')
  await assert.rejects(workspace.realms(), (error: { code?: string }) => error.code === 'CONFLICT')
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.match(database.workspaceConfig('realms').content, /观澜/)
  assert.doesNotMatch(database.workspaceConfig('realms').content, /外部改写/)
  assert.equal(database.workspaceConfigMirror('realms')?.status, 'conflict')
  database.close()
  assert.equal(await readFile(join(configRoot, 'levels.json'), 'utf8'), external)
})

test('question answer freezes current SQLite prior-body evidence with real display order and zero prose writes', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const quote = '班长把数学笔记递给李远明：“明天还我。”'
  // A normalized index is hundreds of characters ahead of the original here.
  // Exercise real persisted chunks -> question context, not only a stubbed port.
  await documents.updateChapter(20, { title: '课堂上的笔记', content: '甲…'.repeat(200) + quote + '乙'.repeat(900) })
  await documents.updateChapter(30, { title: '之后的事件', content: '数学笔记里未来藏着一张藏宝图。' })
  const before = await documents.chapters()
  const retrieval = new LocalRetrievalService(projects, {
    chapters: async () => { throw new Error('SQLite question must not scan Markdown mirrors') }
  }, undefined, {
    active: root => authority.active(root),
    currentDocumentChunksBefore: (root, id, limit) => authority.currentDocumentChunksBefore(root, id, limit),
    searchCurrentDocumentChunksBefore: (root, id, terms, limit) => authority.searchCurrentDocumentChunksBefore(root, id, terms, limit)
  })
  const library = new ResearchLibraryService(projects, authority)
  const planning = new OutlinePlanningService(projects, documents, library, authority)
  const workspace = new WorkspaceService(projects, planning, library, documents, undefined, retrieval, authority)
  let calls = 0
  let delivered = ''
  const ai = {
    modelFor: async () => 'fixture-query-model',
    complete: async (_instruction: string, _draft: string, systemContext: string) => {
      calls += 1
      delivered = systemContext
      return { content: '第 1 章《课堂上的笔记》有直接借出动作。' }
    }
  } as unknown as AiClient
  const agent = new WritingAgentService(ai, projects, documents, workspace, {
    draft: async () => { throw new Error('Question cannot generate prose') }
  } as unknown as ChapterDraftService)
  const input = { chapterId: 10, message: '前文有没有借数学笔记的情节？', currentDraft: (await documents.chapter(10)).content }
  const prepared = await agent.prepare(input)
  assert.equal(prepared.skill, 'query')
  assert.ok(prepared.contexts.some(item => item.content.includes(quote)))
  const turn = await agent.run(input, undefined, prepared)
  assert.equal(calls, 1)
  assert.equal(turn.candidate, undefined)
  assert.match(delivered, /第 1 章｜课堂上的笔记｜正文版本/)
  assert.ok(delivered.includes(quote))
  assert.doesNotMatch(delivered, /未来藏着一张藏宝图/)
  assert.deepEqual(await documents.chapters(), before)

  // A fresh question uses the current body pointer, never the obsolete version.
  await documents.updateChapter(20, { title: '课堂上的笔记', content: '班长把书包放进抽屉。' })
  const refreshed = await agent.prepare(input)
  assert.ok(!refreshed.contexts.some(item => item.content.includes(quote)))
  assert.ok(prepared.contexts.some(item => item.content.includes(quote)))
  const pack = await workspace.contextFactPack(10, input.message)
  // Title-only matches are candidates, not proof; obsolete body text is absent.
  assert.ok(pack.evidence.every(item => !item.excerpt.includes(quote)))
  assert.ok(await authority.active(project.path))
})

test('imports compatibility material sources only on explicit write and preserves protected JSON during reads', async (context) => {
  const { project, projects, databases, authority, documents } = await fixture(context)
  const sourcePath = join(project.path, '.webnovel', 'research', 'sources.json')
  await mkdir(join(project.path, '.webnovel', 'research'), { recursive: true })
  const excerpt = '旧城邮局只在雨夜留下蓝色邮戳。'
  const legacySource = {
    id: '00000000-0000-4000-8000-100000000001', provider: 'manual', sourceType: 'manual' as const,
    title: '旧城邮局札记', capturedAt: '2026-08-31T12:00:00.000Z', excerpt, userNotes: '用于雨夜来信线索。',
    contentHash: createHash('sha256').update(`旧城邮局札记\n${excerpt}`.toLocaleLowerCase('en-US')).digest('hex')
  }
  const legacyBytes = `${JSON.stringify({ version: 1, sources: [legacySource] }, null, 2)}\n`
  await writeFile(sourcePath, legacyBytes, 'utf8')

  const library = new ResearchLibraryService(projects, authority)
  assert.deepEqual((await library.listSources()).sources.map((source) => source.title), ['旧城邮局札记'])
  let database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalMaterialSourcesReady(), false)
  assert.equal(database.materialSourcesMirror(), null)
  assert.equal(await readFile(sourcePath, 'utf8'), legacyBytes)
  database.close()

  const created = await library.createSource({ sourceType: 'manual', title: '钟楼回声', excerpt: '钟声落下后回声会延迟七秒。', userNotes: '作为第二个线索。' })
  const updated = await library.updateSource(created.id, { title: '钟楼回声记录', excerpt: created.excerpt, userNotes: '用于第二卷。' })
  assert.equal(updated.title, '钟楼回声记录')
  assert.deepEqual((await library.searchSources(['钟楼'])).sources.map((source) => source.id), [created.id])
  assert.deepEqual((await library.searchSources(['完全不命中'], [legacySource.id])).sources.map((source) => source.id), [legacySource.id])
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalMaterialSourcesReady(), true)
  assert.equal(database.listMaterialSources().find((item) => item.id === legacySource.id)?.contentHash, legacySource.contentHash)
  assert.equal(database.materialSourcesMirror()?.status, 'synced')
  assert.deepEqual(database.searchMaterialSources(['邮局']).map((source) => source.id), [legacySource.id])
  database.close()
  const mirror = JSON.parse(await readFile(sourcePath, 'utf8')) as { authority?: string; sources: Array<{ title: string }> }
  assert.equal(mirror.authority, 'sqlite-material-sources')
  assert.deepEqual(mirror.sources.map((source) => source.title), ['钟楼回声记录', '旧城邮局札记'])

  await documents.updateChapterOutline(10, '沈砚前往钟楼调查延迟七秒的回声。')
  const retrieval = new LocalRetrievalService(projects, documents, undefined, {
    active: root => authority.active(root),
    currentDocumentChunksBefore: (root, chapterId, limit) => authority.currentDocumentChunksBefore(root, chapterId, limit),
    searchCurrentDocumentChunksBefore: (root, chapterId, terms, limit) => authority.searchCurrentDocumentChunksBefore(root, chapterId, terms, limit)
  })
  const workspace = new WorkspaceService(projects, undefined, library, documents, undefined, retrieval, authority)
  let pack = await workspace.contextFactPack(10)
  assert.deepEqual(pack.materials?.map((item) => item.sourceId), [created.id])
  assert.equal(pack.materialBudget?.searchMode, 'sqlite')
  assert.match(pack.materials?.[0]?.reason || '', /与当前章匹配/)
  assert.match(await workspace.promptContext(10, 'prose', { mode: 'fast' }), /资料卡 .*钟楼回声记录/)

  const materialKey = contextMaterialEvidenceKey(pack.materials![0])
  const preferences = await workspace.contextBudgetPreferences()
  await workspace.saveContextBudgetPreferences({ ...preferences, pinnedEvidenceKeys: [materialKey], excludedEvidenceKeys: [] })
  await documents.updateChapterOutline(10, '沈砚改去河岸寻找陌生脚印。')
  pack = await workspace.contextFactPack(10)
  assert.equal(pack.materials?.[0]?.sourceId, created.id)
  assert.equal(pack.materials?.[0]?.reason, '作者固定')

  await workspace.saveContextBudgetPreferences({ ...preferences, pinnedEvidenceKeys: [], excludedEvidenceKeys: [materialKey] })
  await documents.updateChapterOutline(10, '沈砚返回钟楼调查回声。')
  pack = await workspace.contextFactPack(10)
  assert.ok(!pack.materials?.some((item) => item.sourceId === created.id))

  const externalBytes = '{"version":1,"sources":[],"external":"作者正在外部整理"}\n'
  await writeFile(sourcePath, externalBytes, 'utf8')
  assert.deepEqual((await library.listSources()).sources.map((item) => item.id).sort(), [created.id, legacySource.id].sort())
  assert.equal(await readFile(sourcePath, 'utf8'), externalBytes)
  await assert.rejects(library.createSource({ sourceType: 'manual', title: '不能覆盖外部修改', excerpt: '保留原件', userNotes: '' }), { code: 'CONFLICT' })
  await assert.rejects(authority.rollback(project.path), (error: { code?: string }) => error.code === 'CONFLICT')
})

test('migrates canonical events into normalized SQLite authority and protects their readable mirror', async (context) => {
  const { project, projects, databases, authority } = await fixture(context)
  const researchRoot = join(project.path, '.webnovel', 'research')
  const sourcePath = join(researchRoot, 'sources.json')
  const eventPath = join(researchRoot, 'events.json')
  await mkdir(researchRoot, { recursive: true })
  const excerpt = '雨夜钟楼只在第七声后留下回音。'
  const source = {
    id: '00000000-0000-4000-8000-200000000001', provider: 'manual', sourceType: 'manual' as const,
    title: '钟楼目击记录', capturedAt: '2026-09-01T12:00:00.000Z', excerpt, userNotes: '',
    contentHash: createHash('sha256').update(`钟楼目击记录\n${excerpt}`.toLocaleLowerCase('en-US')).digest('hex')
  }
  const candidate = {
    id: '00000000-0000-4000-8000-200000000002', time: '第一夜', characters: ['沈砚', '守钟人'], location: '旧钟楼',
    event: '沈砚听见延迟七秒的回音', result: '决定次夜再次调查', evidenceRefs: [{ sourceId: source.id, excerpt }],
    confidence: 1, status: 'candidate' as const, createdAt: '2026-09-01T12:05:00.000Z'
  }
  await writeFile(sourcePath, `${JSON.stringify({ version: 1, sources: [source] }, null, 2)}\n`, 'utf8')
  await writeFile(eventPath, `${JSON.stringify({ version: 1, events: [candidate] }, null, 2)}\n`, 'utf8')

  const library = new ResearchLibraryService(projects, authority)
  assert.deepEqual(await library.listEvents(), { events: [candidate] })
  const approved = await library.approveEvent(candidate.id)
  assert.equal(approved.status, 'approved')
  assert.ok(approved.approvedAt)
  const contradiction = await library.createEventCandidate({
    sourceId: source.id, time: candidate.time, characters: ['沈砚'], location: candidate.location, event: '沈砚确认回音其实来自地下室'
  })
  const conflicted = (await library.listEvents()).events.filter((event) => event.id === candidate.id || event.id === contradiction.id)
  assert.ok(conflicted[0]?.conflictGroupId)
  assert.equal(conflicted[0]?.conflictGroupId, conflicted[1]?.conflictGroupId)
  await assert.rejects(library.createEventCandidate({
    sourceId: source.id, time: candidate.time, characters: [...candidate.characters], location: candidate.location, event: ` ${candidate.event}。`, result: candidate.result
  }), (error: { code?: string }) => error.code === 'CONFLICT')

  let database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalCanonicalEventsReady(), true)
  assert.equal(database.listCanonicalEvents().find((event) => event.id === candidate.id)?.status, 'approved')
  assert.equal(database.canonicalEventsMirror()?.status, 'synced')
  database.close()
  const raw = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM canonical_event_characters').get()?.count, 3)
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM canonical_event_evidence_refs').get()?.count, 2)
  assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length, 0)
  raw.close()

  await unlink(eventPath)
  assert.equal((await library.listEvents()).events.find((event) => event.id === candidate.id)?.status, 'approved')
  await assert.rejects(readFile(eventPath, 'utf8'), { code: 'ENOENT' })

  const external = '{"version":1,"events":[],"external":"作者整理中"}\n'
  await writeFile(eventPath, external, 'utf8')
  assert.equal((await library.listEvents()).events.find((event) => event.id === candidate.id)?.status, 'approved')
  assert.equal(await readFile(eventPath, 'utf8'), external)
  await assert.rejects(authority.rollback(project.path), (error: { code?: string }) => error.code === 'CONFLICT')
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.listCanonicalEvents().find((event) => event.id === candidate.id)?.status, 'approved')
  database.close()
})

test('leaves an empty canonical event ledger unmigrated through repeated reads', async (context) => {
  const { project, projects, databases, authority } = await fixture(context)
  const library = new ResearchLibraryService(projects, authority)
  assert.deepEqual(await library.listEvents(), { events: [] })
  assert.deepEqual(await library.listEvents(), { events: [] })
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.formalCanonicalEventsReady(), false)
  assert.equal(database.canonicalEventsMirror(), null)
  database.close()
  const mirror = join(project.path, '.webnovel', 'research', 'events.json')
  await assert.rejects(readFile(mirror), { code: 'ENOENT' })
  await mkdir(join(project.path, '.webnovel', 'research'), { recursive: true })
  await writeFile(mirror, '{"version":1,"events":[],"external":true}\n', 'utf8')
  assert.deepEqual(await library.listEvents(), { events: [] })
  assert.equal(await readFile(mirror, 'utf8'), '{"version":1,"events":[],"external":true}\n')
})

test('imports project prompts into SQLite authority and protects the readable JSON mirror', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const imported = await workspace.promptProfile()
  assert.equal(imported.storageMode, 'sqlite')
  assert.equal(imported.mirrorStatus, 'synced')
  assert.equal(imported.entries.find((entry) => entry.task === 'prose')?.override, '雨夜场景用短句推进，线索必须落在人物动作上。')

  const mirrorPath = join(project.path, '.webnovel', 'config', 'prompt-profile.json')
  await writeFile(mirrorPath, '{"external":"保留这份外部修改"}\n', 'utf8')
  const saved = await workspace.savePromptOverride({ task: 'prose', content: 'SQLite 中的新正文策略，只写人物当前可见的行动。' })
  assert.equal(saved.storageMode, 'sqlite')
  assert.equal(saved.mirrorStatus, 'conflict')
  assert.equal(saved.entries.find((entry) => entry.task === 'prose')?.effective, 'SQLite 中的新正文策略，只写人物当前可见的行动。')
  assert.equal(await readFile(mirrorPath, 'utf8'), '{"external":"保留这份外部修改"}\n')
  assert.match(await workspace.promptContext(10, 'prose'), /SQLite 中的新正文策略/)
  assert.doesNotMatch(await workspace.promptContext(10, 'prose'), /雨夜场景用短句推进/)
  await assert.rejects(authority.rollback(project.path), (error: { code?: string }) => error.code === 'CONFLICT')

  const profile = await workspace.promptProfile()
  const expectedMirror = `${JSON.stringify({
    version: 1,
    workItemId: profile.workItemId,
    genreFingerprint: profile.genreFingerprint,
    overrides: Object.fromEntries(profile.entries.filter((entry) => entry.customized).map((entry) => [entry.task, entry.override])),
    updatedAt: (await authority.promptProfile(project.path, profile.workItemId)).updatedAt
  }, null, 2)}\n`
  await writeFile(mirrorPath, expectedMirror, 'utf8')
  assert.deepEqual(await authority.retryMirrors(project.path), { pending: 0, conflicts: 0, failed: 0 })
  assert.deepEqual(await authority.rollback(project.path), { storageMode: 'shadow', chapterCount: 2, verified: true })
})

test('upgrades an already-active SQLite project from its existing prompt JSON without losing overrides', async (context) => {
  const { project, projects, databases, authority, documents } = await fixture(context)
  const raw = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')))
  raw.exec("DELETE FROM mirror_entries WHERE source_type = 'prompt_profile_json'; DELETE FROM prompt_templates;")
  raw.prepare('UPDATE projects SET prompt_storage_ready = 0, prompt_work_item_id = ?, prompt_genre_fingerprint = ?, prompt_updated_at = ?').run('', '', '')
  raw.close()

  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const profile = await workspace.promptProfile()
  assert.equal(profile.storageMode, 'sqlite')
  assert.equal(profile.mirrorStatus, 'synced')
  assert.equal(profile.entries.find((entry) => entry.task === 'prose')?.effective, '雨夜场景用短句推进，线索必须落在人物动作上。')
  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  assert.equal(reopened.formalPromptReady(), true)
  assert.equal(reopened.promptProfile().overrides.prose, '雨夜场景用短句推进，线索必须落在人物动作上。')
  reopened.close()
})

test('legacy SQLite fast preferences project to full flow without rewriting stored history on read', async (context) => {
  const { project, projects, authority, documents, databases } = await fixture(context)
  const current = await authority.projectWritingConfig(project.path)
  await authority.updateProjectWritingConfig(project.path, {
    ...current,
    configJson: JSON.stringify({ ...JSON.parse(current.configJson), chapterGenerationMode: 'fast', legacyExtension: { keep: true } })
  })
  const original = await authority.projectWritingConfig(project.path)
  const mirrorPath = join(project.path, '.webnovel', 'config', 'book-profile.json')
  const mirror = await readFile(mirrorPath, 'utf8')
  const manuscript = await documents.chapter(10)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const profile = await workspace.bookProfile()
  assert.equal(profile.chapterGenerationMode, 'reviewed')
  assert.equal((await workspace.bookProfile()).chapterGenerationMode, 'reviewed')
  assert.deepEqual(await authority.projectWritingConfig(project.path), original)
  assert.equal(await readFile(mirrorPath, 'utf8'), mirror)
  await assert.rejects(workspace.saveBookProfile({ ...profile, chapterGenerationMode: 'fast' }), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await authority.projectWritingConfig(project.path), original)
  await workspace.saveBookProfile(profile)
  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  try {
    const stored = JSON.parse(reopened.projectWritingConfig().configJson)
    assert.equal(stored.chapterGenerationMode, 'reviewed')
    assert.deepEqual(stored.legacyExtension, { keep: true })
  } finally { reopened.close() }
  assert.equal(JSON.parse(await readFile(mirrorPath, 'utf8')).chapterGenerationMode, 'reviewed')
  assert.deepEqual(await documents.chapter(10), manuscript)
})

test('imports project writing settings into SQLite authority and keeps a readable JSON mirror', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const imported = await workspace.bookProfile()
  assert.equal(imported.genre, '东方玄幻')
  assert.equal(imported.targetWords, 3 * 40 * 3200)
  assert.equal(imported.defaultPov, '第三人称限知')
  assert.equal(imported.narrativeDistance, '近距离')
  assert.equal(imported.autosaveEnabled, true)
  assert.equal(imported.autosaveDelayMs, 1_500)
  assert.equal(imported.autosaveMergeWindowMs, 30_000)
  assert.equal(imported.proseExpansionMode, 'web-serial')
  assert.equal(imported.reviewStrictness, 'balanced')

  await authority.updateChapterPlanning(project.path, {
    legacyChapterId: 10,
    card: {
      status: 'draft',
      goal: '查清雨夜来信的寄件人',
      entryState: '沈砚刚收到没有署名的信',
      beats: ['核对邮戳', '前往旧邮局'],
      conflict: '邮局记录与信封日期互相矛盾',
      characters: ['沈砚'],
      pointOfView: '第三人称限知，跟随沈砚',
      narrativeDistance: '近距离',
      exitChange: '沈砚确认信件曾被人替换',
      hook: '旧邮局的值班表上出现了他的名字'
    }
  })
  const chapterContext = await workspace.promptContext(10, 'chapterOutline')
  assert.match(chapterContext, /当前章卡（作者的本章执行约束/)
  assert.match(chapterContext, /章卡状态：草稿，尚未确认/)
  assert.match(chapterContext, /核心冲突：邮局记录与信封日期互相矛盾/)
  assert.match(chapterContext, /章末钩子：旧邮局的值班表上出现了他的名字/)
  const fastChapterContext = await workspace.promptContext(10, 'prose', { mode: 'fast' })
  assert.match(fastChapterContext, /当前采用“快速生成”/)
  assert.match(fastChapterContext, /核心冲突：邮局记录与信封日期互相矛盾/)
  assert.ok(fastChapterContext.length < (await workspace.promptContext(10, 'prose')).length)

  await workspace.saveBookProfile({
    ...imported,
    targetWords: 1_500_000,
    writingStyle: '冷峻、短句、动作优先',
    proseExpansionMode: 'balanced',
    reviewStrictness: 'strict',
    chapterGenerationMode: 'reviewed',
    autosaveEnabled: false,
    autosaveDelayMs: 2_250,
    autosaveMergeWindowMs: 45_000
  })
  const reopened = await workspace.bookProfile()
  assert.equal(reopened.targetWords, 3 * 40 * 3200)
  assert.equal(reopened.writingStyle, '冷峻、短句、动作优先')
  assert.equal(reopened.autosaveEnabled, false)
  assert.equal(reopened.autosaveDelayMs, 2_250)
  assert.equal(reopened.autosaveMergeWindowMs, 45_000)
  assert.equal(reopened.proseExpansionMode, 'balanced')
  assert.equal(reopened.reviewStrictness, 'strict')
  assert.equal(reopened.chapterGenerationMode, 'reviewed')
  const mirror = JSON.parse(await readFile(join(project.path, '.webnovel', 'config', 'project-writing.json'), 'utf8'))
  assert.equal(mirror.targetWords, 3 * 40 * 3200)
  assert.equal(mirror.chapterTargetWords, 3200)
  assert.equal(mirror.extensions.narrativeDistance, '近距离')
  assert.equal(mirror.extensions.proseExpansionMode, 'balanced')
  assert.equal(mirror.extensions.reviewStrictness, 'strict')
  assert.equal(mirror.extensions.chapterGenerationMode, 'reviewed')
  assert.equal(mirror.autosaveEnabled, false)
  assert.equal(mirror.autosaveDelayMs, 2_250)
  assert.equal(mirror.extensions.autosaveMergeWindowMs, 45_000)
})

test('imports foundation into SQLite authority, recreates its readable JSON mirror and protects external edits', async (context) => {
  const { project, projects, databases, authority, documents } = await fixture(context)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const imported = await workspace.foundation()
  assert.deepEqual(imported, {
    creationPath: 'research',
    sourceNotes: '旧稿札记：雨夜来信与旧城钟楼有关。',
    worldView: '旧城中的异常回声只能在雨夜被听见。',
    useRealms: true,
    useSystem: false
  })

  let database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.deepEqual(database.foundationConfig(), imported)
  assert.equal(database.foundationMirror()?.status, 'synced')
  database.close()

  const mirrorPath = join(project.path, '.webnovel', 'config', 'foundation.json')
  await rm(mirrorPath)
  assert.deepEqual(await workspace.foundation(), imported)
  const rebuilt = await authority.rebuildReadableMirrors(project.path)
  assert.equal(rebuilt.conflicts, 0)
  assert.ok(rebuilt.recreated >= 1)
  assert.deepEqual(JSON.parse(await readFile(mirrorPath, 'utf8')), imported)

  const external = '{"external":"作者在其他工具里的修改必须保留"}\n'
  await writeFile(mirrorPath, external, 'utf8')
  const changed = await workspace.saveFoundation({
    ...imported,
    sourceNotes: 'SQLite 中保存的新札记。',
    worldView: 'SQLite 中保存的新世界观。'
  })
  assert.equal(changed.worldView, 'SQLite 中保存的新世界观。')
  assert.equal(await readFile(mirrorPath, 'utf8'), external)
  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.foundationConfig()?.worldView, 'SQLite 中保存的新世界观。')
  assert.equal(database.foundationMirror()?.status, 'conflict')
  database.close()
  await assert.rejects(authority.rollback(project.path), (error: { code?: string }) => error.code === 'CONFLICT')
})

test('upgrades an already-active SQLite project from its existing foundation JSON exactly once', async (context) => {
  const { project, projects, databases, authority, documents } = await fixture(context)
  const databasePath = join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath)
  const row = raw.prepare('SELECT config_json FROM projects').get() as { config_json: string }
  const extensions = JSON.parse(row.config_json)
  delete extensions.foundation
  raw.prepare('UPDATE projects SET config_json = ?').run(JSON.stringify(extensions))
  raw.exec("DELETE FROM mirror_entries WHERE source_type = 'foundation_json'")
  raw.close()

  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const imported = await workspace.foundation()
  assert.equal(imported.worldView, '旧城中的异常回声只能在雨夜被听见。')
  assert.equal(imported.sourceNotes, '旧稿札记：雨夜来信与旧城钟楼有关。')

  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  assert.deepEqual(reopened.foundationConfig(), imported)
  assert.equal(reopened.foundationMirror()?.status, 'synced')
  reopened.close()
})

test('refuses a damaged foundation JSON before switching a shadow database to formal storage', async (context) => {
  const { project, databases, authority, source } = await fixture(context)
  const snapshot = await source.snapshot()
  const databasePath = join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath)
  raw.prepare("UPDATE projects SET storage_mode = 'shadow'").run()
  raw.close()
  const foundationPath = join(project.path, '.webnovel', 'config', 'foundation.json')
  const damaged = '{ damaged foundation json'
  await writeFile(foundationPath, damaged, 'utf8')

  await assert.rejects(authority.activate(project.path, snapshot), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
  assert.equal(await readFile(foundationPath, 'utf8'), damaged)
  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  assert.equal(reopened.storageMode(), 'shadow')
  reopened.close()
})

test('keeps the writing context budget in SQLite project configuration and its readable mirror', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  assert.deepEqual(await workspace.contextBudgetPreferences(), { version: 1, inputBudgetTokens: 120_000, modelContextLimit: 150_000, outputReservePercent: 25, systemReserveTokens: 10_000, recentSummaryCount: 3, structuredRepairAttempts: 1, minimumFactImportance: 'medium', showFactConfirmations: false, pinnedEvidenceKeys: [], excludedEvidenceKeys: [] })
  assert.deepEqual(await workspace.saveContextBudgetPreferences({ version: 1, inputBudgetTokens: 48_000, modelContextLimit: 96_000, outputReservePercent: 25, systemReserveTokens: 8_000, recentSummaryCount: 5, structuredRepairAttempts: 3, minimumFactImportance: 'low', showFactConfirmations: true, pinnedEvidenceKeys: [], excludedEvidenceKeys: [], alwaysConfirmBeforeSend: true }), {
    version: 1, inputBudgetTokens: 48_000, modelContextLimit: 96_000, outputReservePercent: 25, systemReserveTokens: 8_000, recentSummaryCount: 5, structuredRepairAttempts: 3, minimumFactImportance: 'low', showFactConfirmations: true, pinnedEvidenceKeys: [], excludedEvidenceKeys: [], alwaysConfirmBeforeSend: true
  })
  const mirror = JSON.parse(await readFile(join(project.path, '.webnovel', 'config', 'project-writing.json'), 'utf8'))
  assert.deepEqual(mirror.extensions.contextBudgetPreferences, { version: 1, inputBudgetTokens: 48_000, modelContextLimit: 96_000, outputReservePercent: 25, systemReserveTokens: 8_000, recentSummaryCount: 5, structuredRepairAttempts: 3, minimumFactImportance: 'low', showFactConfirmations: true, pinnedEvidenceKeys: [], excludedEvidenceKeys: [], alwaysConfirmBeforeSend: true })
})

test('records reviewed AI character facts against the exact body version and exposes only approved prior facts', async (context) => {
  const { project, projects, authority, databases, documents } = await fixture(context)
  const sourceChapter = await documents.chapter(20)
  const batch = await authority.recordCharacterFactCandidates(project.path, sourceChapter, [{
    character: '沈砚',
    field: 'location',
    value: '旧城墙下',
    evidence: '他沿着旧城墙寻找回声。'
  }, {
    character: '沈砚',
    field: 'knowledge',
    value: '来信与旧城有关',
    evidence: '回声里反复出现信封上的暗号。'
  }], '44444444-4444-4444-8444-444444444444')
  assert.ok(batch)
  assert.equal(batch.status, 'PENDING')
  assert.equal(batch.contentHash, createHash('sha256').update(sourceChapter.content).digest('hex'))
  assert.equal((await authority.approvedFactsBefore(project.path, 10)).length, 0)
  const location = batch.changes.find((change) => change.predicate === 'location')!
  const knowledge = batch.changes.find((change) => change.predicate === 'knowledge')!

  const decided = await authority.decideFacts(project.path, {
    batchId: batch.id,
    decisions: [
      { changeId: location.id, decision: 'APPROVED', decidedObjectJson: JSON.stringify('旧城墙暗门') },
      { changeId: knowledge.id, decision: 'DEFERRED' }
    ]
  })
  assert.equal(decided.status, 'PARTIALLY_APPROVED')
  const editedLocation = decided.changes.find((change) => change.id === location.id)!
  assert.equal(JSON.parse(editedLocation.objectJson), '旧城墙下')
  assert.equal(JSON.parse(editedLocation.editedObjectJson!), '旧城墙暗门')
  const approved = await authority.approvedFactsBefore(project.path, 10)
  assert.equal(approved.length, 1)
  assert.equal(JSON.parse(approved[0].objectJson), '旧城墙暗门')
  assert.match(approved[0].sources[0].quote, /旧城墙/)
  const snapshots = await authority.characterSnapshotsBefore(project.path, 10)
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].name, '沈砚')
  assert.equal(snapshots[0].location, '旧城墙暗门')
  assert.equal(snapshots[0].throughChapter, 1)
  assert.match(snapshots[0].lastEventId, /^00000000-/)

  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const rebuilt = database.rebuildCharacterSnapshots()
  assert.equal(rebuilt.length, 1)
  assert.equal(rebuilt[0].sourceFactSetHash.length, 64)
  assert.equal(database.characterSnapshotsBefore(10)[0].sourceFactSetHash, rebuilt[0].sourceFactSetHash)
  database.close()
  const snapshotCache = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { allowExtension: false })
  snapshotCache.exec('DELETE FROM character_snapshots')
  assert.equal(snapshotCache.prepare('SELECT COUNT(*) AS count FROM character_snapshots').get()?.count, 0)
  snapshotCache.close()
  const recoveredSnapshots = await authority.characterSnapshotsBefore(project.path, 10)
  assert.equal(recoveredSnapshots.length, 1)
  assert.equal(recoveredSnapshots[0].location, '旧城墙暗门')
  const recoveredCache = await databases.openExisting(project.path)
  assert.ok(recoveredCache)
  assert.equal(recoveredCache.characterSnapshotsBefore(10)[0].sourceFactSetHash, rebuilt[0].sourceFactSetHash)
  recoveredCache.close()
  const snapshotHistory = await authority.characterSnapshotHistory(project.path)
  assert.equal(snapshotHistory.length, 1)
  assert.equal(snapshotHistory[0].chapterId, 20)
  assert.equal(snapshotHistory[0].chapterPosition, 1)
  assert.equal(snapshotHistory[0].source, 'approved_fact')
  assert.equal(snapshotHistory[0].location, '旧城墙暗门')
  const formalWorkspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const characterLines = await formalWorkspace.characterLines()
  assert.equal(characterLines.source, 'sqlite-approved-facts')
  assert.equal(characterLines.lines[0].name, '沈砚')
  assert.equal(characterLines.lines[0].points[0].sourceId, snapshotHistory[0].sourceId)
  const prompt = await formalWorkspace.promptContext(10, 'prose', { mode: 'fast' })
  assert.match(prompt, /当前章之前的人物动态状态：[\s\S]*沈砚｜[\s\S]*地点：旧城墙暗门/)

  const nextChapter = await documents.chapter(10)
  const confirmationSource = await documents.updateChapter(10, {
    content: `${nextChapter.content}\n沈砚仍在旧城墙暗门。\n沈砚看见路边店铺正在换招牌。`, reason: 'manual', expectedRevision: nextChapter.revision
  })
  const confirmationBatch = await authority.recordCharacterFactCandidates(project.path, confirmationSource, [{
    character: '沈砚', field: 'location', value: '　旧城墙暗门 ', evidence: '沈砚仍在旧城墙暗门。'
  }, {
    character: '沈砚', field: 'knowledge', value: '路边店铺正在换招牌', evidence: '沈砚看见路边店铺正在换招牌。',
    importance: 'low', reviewClass: 'low_value'
  }], '77777777-7777-4777-8777-777777777777')
  assert.equal(confirmationBatch?.changes.find((change) => change.predicate === 'location')?.changeType, 'CONFIRMS')
  assert.equal(confirmationBatch?.changes.find((change) => change.predicate === 'knowledge')?.changeType, 'LOW_VALUE')
  assert.deepEqual(JSON.parse(confirmationBatch!.countsJson), { total: 2, high: 0, medium: 1, low: 1, confirmations: 1, lowValue: 1 })

  await documents.updateChapter(20, { content: `${sourceChapter.content}\n沈砚离开城墙。`, reason: 'manual', expectedRevision: sourceChapter.revision })
  const stale = (await authority.factBatches(project.path, 20)).find((item) => item.id === batch.id)
  assert.equal(stale?.status, 'STALE')
  assert.equal((await authority.approvedFactsBefore(project.path, 10))[0].sourceCurrent, false)
})

test('links a fact batch to its persisted extraction task and the exact source version', async (context) => {
  const { project, authority, databases, documents } = await fixture(context)
  const chapter = await documents.chapter(20)
  const taskId = '55555555-5555-4555-8555-555555555555'
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  database.createTaskRun({
    id: taskId,
    legacyChapterId: 20,
    taskType: 'fact_extraction',
    idempotencyKey: taskId,
    contentHash: createHash('sha256').update(chapter.content).digest('hex'),
    checkpointJson: JSON.stringify({ version: 1, workItemId: 'test', chapterId: 20 })
  })
  database.transitionTaskRun({ id: taskId, status: 'preparing' })
  database.transitionTaskRun({ id: taskId, status: 'running' })
  database.close()

  const batch = await authority.recordCharacterFactCandidates(project.path, chapter, [{
    character: '沈砚', field: 'location', value: '旧城墙下', evidence: '他沿着旧城墙寻找回声。'
  }], taskId, taskId)
  assert.ok(batch)
  assert.equal(batch.extractorTaskRunId, taskId)
  assert.equal(batch.bodyVersionId, chapter.bodyVersionId)
  const inspected = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
  assert.equal(inspected.prepare("SELECT type FROM sqlite_schema WHERE name = 'fact_review_batches'").get()?.type, 'view')
  assert.equal(inspected.prepare('SELECT id FROM fact_review_batches WHERE id = ?').get(batch.id)?.id, batch.id)
  assert.equal(inspected.prepare('SELECT COUNT(*) AS count FROM fact_review_batches').get()?.count,
    inspected.prepare('SELECT COUNT(*) AS count FROM fact_batches').get()?.count)
  inspected.close()
})

test('merges equivalent same-event fact candidates while retaining every manuscript quote', async (context) => {
  const { project, authority, documents } = await fixture(context)
  const original = await documents.chapter(20)
  const firstQuote = '沈砚冲出宴会厅，躲进旧城门。'
  const secondQuote = '直到钟声散尽，沈砚仍藏在旧城门。'
  const laterQuote = '夜巡开始后，沈砚再次回到旧城门。'
  const chapter = await documents.updateChapter(20, {
    content: `${original.content}\n${firstQuote}\n${secondQuote}\n${laterQuote}`,
    reason: 'manual',
    expectedRevision: original.revision
  })

  const batch = await authority.recordCharacterFactCandidates(project.path, chapter, [{
    character: '沈砚', field: 'location', value: '旧城门', event: '逃离宴会', evidence: firstQuote,
    importance: 'low', reviewClass: 'low_value'
  }, {
    character: '沈砚', field: 'location', value: '旧城门内', event: ' 逃离宴会 ', evidence: secondQuote,
    importance: 'high', reviewClass: 'reviewable'
  }, {
    character: '沈砚', field: 'location', value: '旧城门', event: '夜巡返回', evidence: laterQuote,
    importance: 'medium', reviewClass: 'reviewable'
  }], '91919191-9191-4919-8919-919191919191')

  assert.ok(batch)
  assert.equal(batch.changes.length, 2)
  const merged = batch.changes.find((change) => JSON.parse(change.evidenceJson).event === '逃离宴会')!
  assert.equal(merged.importance, 'high')
  assert.equal(merged.changeType, 'NEW')
  assert.equal(JSON.parse(merged.objectJson), '旧城门内')
  assert.deepEqual(JSON.parse(merged.evidenceJson).quotes, [firstQuote, secondQuote])
  assert.deepEqual(JSON.parse(merged.evidenceJson).valueVariants, ['旧城门', '旧城门内'])
  assert.deepEqual(JSON.parse(batch.countsJson), { total: 2, high: 1, medium: 1, low: 0, confirmations: 0, lowValue: 0 })

  await authority.decideFacts(project.path, { batchId: batch.id, decisions: [{ changeId: merged.id, decision: 'APPROVED' }] })
  const approved = (await authority.approvedFactsBefore(project.path, 10)).find((fact) => fact.normalizedKey === merged.normalizedKey)!
  assert.equal(approved.sources[0].quote, firstQuote)
  assert.deepEqual(JSON.parse(approved.sources[0].spanJson).evidenceQuotes, [firstQuote, secondQuote])
})

test('persists deterministic continuity findings once per body version and expires the old result after editing', async (context) => {
  const { project, databases, authority, documents } = await fixture(context)
  const firstChapter = await documents.chapter(10)
  assert.ok(firstChapter.bodyVersionId)
  const finding = {
    code: 'character.LOCATION_JUMP',
    severity: 'warning' as const,
    title: '人物连续性 · 地点承接',
    rationale: '沈砚的相邻章节地点缺少移动承接。',
    evidenceJson: JSON.stringify({ character: '沈砚', excerpts: ['旧城墙下', '雨夜城门'] }),
    suggestedAction: '补足移动或转场依据。'
  }
  const firstInput = {
    legacyChapterId: 10,
    bodyVersionId: firstChapter.bodyVersionId,
    contentHash: createHash('sha256').update(firstChapter.content).digest('hex'),
    ruleLayer: 'deterministic' as const,
    findings: [finding]
  }
  await authority.recordConsistencyFindings(project.path, firstInput)
  await authority.recordConsistencyFindings(project.path, firstInput)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.listFindings(10).length, 1)
  assert.equal(database.listFindings(10)[0]?.status, 'open')
  database.close()

  const edited = await documents.updateChapter(10, {
    content: `${firstChapter.content}\n\n沈砚沿旧城墙赶往雨夜城门。`,
    reason: 'manual',
    expectedRevision: firstChapter.revision
  })
  assert.ok(edited.bodyVersionId)
  const immediatelyStale = await databases.openExisting(project.path)
  assert.ok(immediatelyStale)
  assert.equal(immediatelyStale.listFindings(10)[0]?.status, 'stale')
  const staleRun = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
  assert.equal(staleRun.prepare('SELECT status FROM rule_runs ORDER BY created_at DESC LIMIT 1').get()?.status, 'stale')
  staleRun.close()
  immediatelyStale.close()
  await authority.recordConsistencyFindings(project.path, {
    ...firstInput,
    bodyVersionId: edited.bodyVersionId,
    contentHash: createHash('sha256').update(edited.content).digest('hex'),
    findings: []
  })
  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  const records = reopened.listFindings(10)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.status, 'stale')
  reopened.close()
})

test('reports facts, summaries and rule runs as stale immediately after the bound正文 changes', async (context) => {
  const { project, authority, documents } = await fixture(context)
  const original = await documents.chapter(10)
  const source = await documents.updateChapter(10, {
    content: '沈砚站在旧城墙下。',
    reason: 'manual',
    expectedRevision: original.revision
  })
  assert.ok(source.bodyVersionId)
  await authority.recordCharacterFactCandidates(project.path, source, [{
    character: '沈砚', field: 'location', value: '旧城墙下', evidence: '沈砚站在旧城墙下。'
  }], '81818181-8181-4818-8818-818181818181')
  await authority.saveApprovedChapterSummary(project.path, {
    chapterId: 10,
    bodyVersionId: source.bodyVersionId,
    content: '沈砚抵达旧城墙。'
  })
  await authority.recordConsistencyFindings(project.path, {
    legacyChapterId: 10,
    bodyVersionId: source.bodyVersionId,
    contentHash: createHash('sha256').update(source.content).digest('hex'),
    ruleLayer: 'deterministic',
    findings: [{
      code: 'character.LOCATION_JUMP', severity: 'warning', title: '人物连续性 · 地点承接',
      rationale: '地点承接需要核对。', evidenceJson: JSON.stringify({ excerpts: ['沈砚站在旧城墙下。'] })
    }]
  })

  assert.deepEqual(await authority.chapterDerivativeStatus(project.path, 10), {
    bodyVersionId: source.bodyVersionId,
    factBatches: { current: 1, stale: 0 },
    summaries: { current: 1, stale: 0 },
    ruleRuns: { current: 1, stale: 0 }
  })

  const replacement = await documents.updateChapter(10, {
    content: `${source.content}\n\n他转身走进雨幕。`,
    reason: 'manual',
    expectedRevision: source.revision
  })
  assert.deepEqual(await authority.chapterDerivativeStatus(project.path, 10), {
    bodyVersionId: replacement.bodyVersionId,
    factBatches: { current: 0, stale: 1 },
    summaries: { current: 0, stale: 1 },
    ruleRuns: { current: 0, stale: 1 }
  })
})

test('stores only concise finding evidence and excludes excess model reasoning fields from rule-run snapshots', async (context) => {
  const { project, authority, documents } = await fixture(context)
  const chapter = await documents.chapter(10)
  assert.ok(chapter.bodyVersionId)
  await authority.recordConsistencyFindings(project.path, {
    legacyChapterId: 10,
    bodyVersionId: chapter.bodyVersionId,
    contentHash: createHash('sha256').update(chapter.content).digest('hex'),
    ruleLayer: 'semantic',
    findings: [{
      code: 'character.IDENTITY_CONFLICT',
      severity: 'warning',
      title: '人物语义 · 身份',
      rationale: '本章说法与已确认身份存在差异，需要作者核对。',
      evidenceJson: JSON.stringify({ excerpt: '我并非沈家后人。', source: '第10章' }),
      suggestedAction: '核对正文证据。',
      confidence: 0.75,
      reasoning: '不应保存的完整模型推理',
      rawResponse: '{"analysis":"不应保存的供应商响应"}',
      prompt: '不应保存的完整提示词'
    } as never]
  })

  const raw = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
  const run = raw.prepare("SELECT input_json, result_json FROM rule_runs WHERE rule_layer = 'semantic' ORDER BY created_at DESC LIMIT 1").get() as { input_json: string; result_json: string }
  const finding = raw.prepare("SELECT rationale, evidence_json FROM findings WHERE rule_layer = 'semantic' ORDER BY created_at DESC LIMIT 1").get() as { rationale: string; evidence_json: string }
  raw.close()

  assert.deepEqual(JSON.parse(run.input_json), {
    version: 1,
    findings: [{
      code: 'character.IDENTITY_CONFLICT',
      severity: 'warning',
      title: '人物语义 · 身份',
      rationale: '本章说法与已确认身份存在差异，需要作者核对。',
      evidenceJson: JSON.stringify({ excerpt: '我并非沈家后人。', source: '第10章' }),
      suggestedAction: '核对正文证据。',
      confidence: 0.75
    }]
  })
  assert.deepEqual(JSON.parse(run.result_json), { findingCount: 1 })
  assert.equal(finding.rationale, '本章说法与已确认身份存在差异，需要作者核对。')
  assert.deepEqual(JSON.parse(finding.evidence_json), { excerpt: '我并非沈家后人。', source: '第10章' })
  assert.equal(run.input_json.includes('reasoning'), false)
  assert.equal(run.input_json.includes('rawResponse'), false)
  assert.equal(run.input_json.includes('prompt'), false)
})

test('supersedes an open semantic finding when the same manuscript is checked again after author resolution', async (context) => {
  const { project, databases, authority, documents } = await fixture(context)
  const chapter = await documents.chapter(10)
  assert.ok(chapter.bodyVersionId)
  const base = {
    legacyChapterId: 10,
    bodyVersionId: chapter.bodyVersionId,
    contentHash: createHash('sha256').update(chapter.content).digest('hex'),
    ruleLayer: 'semantic' as const
  }
  await authority.recordConsistencyFindings(project.path, {
    ...base,
    findings: [{
      code: 'character.IDENTITY_CONFLICT', severity: 'warning', title: '人物语义 · 身份',
      rationale: '沈砚在本章出现了可能改变既有身份的声明。',
      evidenceJson: JSON.stringify({ conflictId: 'conflict-identity', excerpt: '我并非沈家后人。' }),
      suggestedAction: '由作者核对正文证据。', confidence: 0.75
    }]
  })
  await authority.recordConsistencyFindings(project.path, { ...base, findings: [] })

  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const records = database.listFindings(10)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.ruleLayer, 'semantic')
  assert.equal(records[0]?.status, 'stale')
  database.close()
})

test('rejects severity values that would disguise semantic or literary findings as hard rules', async (context) => {
  const { project, databases, authority, documents } = await fixture(context)
  const chapter = await documents.chapter(10)
  assert.ok(chapter.bodyVersionId)
  const base = {
    legacyChapterId: 10,
    bodyVersionId: chapter.bodyVersionId,
    contentHash: createHash('sha256').update(chapter.content).digest('hex')
  }
  const invalidPairs = [
    ['semantic', 'blocker'],
    ['semantic', 'suggestion'],
    ['literary', 'blocker'],
    ['literary', 'warning'],
    ['deterministic', 'suggestion']
  ] as const
  for (const [ruleLayer, severity] of invalidPairs) {
    await assert.rejects(authority.recordConsistencyFindings(project.path, {
      ...base,
      ruleLayer,
      findings: [{
        code: `${ruleLayer}.invalid-severity`,
        severity,
        title: '不应入库的层级错配',
        rationale: '不确定判断不能伪装成硬规则。',
        evidenceJson: JSON.stringify({ excerpts: [chapter.content] })
      }]
    }), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')
  }
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.listFindings(10).length, 0)
  database.close()
})

test('keeps an author decision for a consistency finding without modifying the manuscript', async (context) => {
  const { project, databases, authority, documents } = await fixture(context)
  const chapter = await documents.chapter(10)
  assert.ok(chapter.bodyVersionId)
  await authority.recordConsistencyFindings(project.path, {
    legacyChapterId: 10,
    bodyVersionId: chapter.bodyVersionId,
    contentHash: createHash('sha256').update(chapter.content).digest('hex'),
    ruleLayer: 'deterministic',
    findings: [{
      code: 'character.POWER_REGRESSION', severity: 'warning', title: '人物连续性 · 境界回落',
      rationale: '正文没有说明跌境原因。', evidenceJson: JSON.stringify({ excerpts: ['境界回落'] })
    }]
  })
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const finding = database.listFindings(10)[0]!
  const decided = database.decideFinding({ findingId: finding.id, decision: 'exception', reason: '本章有意留白，后文解释。' })
  assert.equal(decided.status, 'exception')
  assert.equal(database.listFindings(10, ['exception']).length, 1)
  assert.throws(() => database.decideFinding({ findingId: finding.id, decision: 'exception' }), /说明原因/)
  database.close()
  assert.equal((await documents.chapter(10)).content, chapter.content)
})

test('keeps a needs-fix consistency finding visible until the manuscript changes', async (context) => {
  const { project, databases, authority, documents } = await fixture(context)
  const chapter = await documents.chapter(10)
  assert.ok(chapter.bodyVersionId)
  await authority.recordConsistencyFindings(project.path, {
    legacyChapterId: 10,
    bodyVersionId: chapter.bodyVersionId,
    contentHash: createHash('sha256').update(chapter.content).digest('hex'),
    ruleLayer: 'literary',
    findings: [{
      code: 'literary.DUPLICATE_PARAGRAPH', severity: 'suggestion', title: '表达建议 · 重复段落',
      rationale: '相同段落在本章重复出现。', evidenceJson: JSON.stringify({ excerpts: ['他推开门。'] })
    }]
  })
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const finding = database.listFindings(10, ['open'])[0]!
  const decided = database.decideFinding({ findingId: finding.id, decision: 'accepted' })
  assert.equal(decided.status, 'accepted')
  assert.equal(database.listFindings(10, ['accepted'])[0]?.id, finding.id)
  database.close()
  assert.equal((await documents.chapter(10)).content, chapter.content)
  const edited = await documents.updateChapter(10, {
    content: `${chapter.content}\n\n他删去了误粘贴的重复段落。`,
    reason: 'manual',
    expectedRevision: chapter.revision
  })
  assert.ok(edited.bodyVersionId)
  await authority.recordConsistencyFindings(project.path, {
    legacyChapterId: 10,
    bodyVersionId: edited.bodyVersionId,
    contentHash: createHash('sha256').update(edited.content).digest('hex'),
    ruleLayer: 'literary',
    findings: []
  })
  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  assert.equal(reopened.listFindings(10, ['accepted']).length, 0)
  assert.equal(reopened.listFindings(10, ['stale'])[0]?.id, finding.id)
  reopened.close()
})

test('saves the first outline of a new manuscript using its chosen volume without changing body or existing stage ancestry', async (context) => {
  const { project, projects, authority, databases, documents } = await fixture(context)
  const planning = new OutlinePlanningService(projects, documents, new ResearchLibraryService(projects, authority), authority)
  const chapter = await documents.createChapter()
  const before = await documents.chapter(chapter.id)
  await assert.rejects(planning.updateChapterOutline(chapter.id, '等待回应。'), /选择所属篇卷/)
  await planning.updateChapterOutline(chapter.id, '沈砚在桥上等待回应。', 1)
  assert.deepEqual(await documents.chapter(chapter.id), before)
  assert.equal((await planning.chapterVolumeContext(chapter.id))?.volume, 1)
  let db = await databases.openExisting(project.path)
  assert.ok(db)
  try {
    assert.equal(db.formalOutlines().find(item => item.legacyKey === `chapter-${chapter.id}`)?.parentLegacyKey, 'volume-1')
    db.writeFormalOutline({ legacyKey: 'stage-160', parentLegacyKey: 'volume-1', nodeType: 'stage', seq: 1, title: '桥上', content: '等待回应。' })
    db.writeFormalOutline({ legacyKey: `chapter-${chapter.id}`, parentLegacyKey: 'stage-160', nodeType: 'chapter', seq: 1, title: '回应', content: '等待回应。' })
  } finally { db.close() }
  await planning.updateChapterOutline(chapter.id, '改为在桥边等待。', 1)
  db = await databases.openExisting(project.path)
  assert.ok(db)
  try { assert.equal(db.formalOutlines().find(item => item.legacyKey === `chapter-${chapter.id}`)?.parentLegacyKey, 'stage-160') }
  finally { db.close() }
  assert.equal(await readFile(join(project.path, '大纲', '章纲', `第${chapter.id}章.md`), 'utf8'), '改为在桥边等待。')
  const second = await documents.createChapter()
  await planning.placeChapter(second.id, 1)
  await planning.updateChapterOutline(second.id, '沿用已选篇卷。')
  assert.equal((await documents.chapterOutline(second.id)).content, '沿用已选篇卷。')
  await assert.rejects(authority.updateChapterOutline(project.path, second.id, '不得写入', 0), /篇卷编号无效/)
  await assert.rejects(planning.updateChapterOutline(second.id, '不得写入', 999), /篇卷不存在/)
  assert.equal((await documents.chapterOutline(second.id)).content, '沿用已选篇卷。')
})

test('continues from a confirmed chapter with partially approved changes into real compiled next-chapter context', async (context) => {
  const { project, projects, authority, databases, documents } = await fixture(context)
  const original = await documents.chapter(20)
  await documents.updateChapter(20, { content: '沈砚来到石桥。桥洞里有人敲了三下。', reason: 'manual', expectedRevision: original.revision })
  await authority.updateChapterPlanning(project.path, { legacyChapterId: 20, lifecycleStatus: 'REVIEWABLE' })
  const confirmed = await authority.updateChapterPlanning(project.path, { legacyChapterId: 20, lifecycleStatus: 'CONFIRMED' })
  const saved = await documents.chapter(20)
  assert.equal(saved.bodyVersionId, confirmed.confirmedBodyVersionId)
  const batch = await authority.recordCharacterFactCandidates(project.path, saved, [
    { character: '沈砚', field: 'location', value: '石桥', evidence: '沈砚来到石桥。' },
    { character: '沈砚', field: 'knowledge', value: '未核实的三声暗号', evidence: '桥洞里有人敲了三下。' }
  ], '99999999-9999-4999-8999-999999999159')
  assert.ok(batch)
  const decided = await authority.decideFacts(project.path, { batchId: batch.id, decisions: batch.changes.map(change => ({
    changeId: change.id, decision: change.predicate === 'location' ? 'APPROVED' as const : 'DEFERRED' as const
  })) })
  assert.equal(decided.status, 'PARTIALLY_APPROVED')
  assert.equal((await authority.chapterPlanning(project.path, 20)).lifecycleStatus, 'CONFIRMED')
  const db = await databases.openExisting(project.path)
  assert.ok(db)
  const summaryText = '石桥交接尚未完成，下一步等待桥下回应。'
  try { db.writeSummaryVersion({ legacyChapterId: 20, bodyVersionId: saved.bodyVersionId!, content: summaryText, status: 'approved' }) }
  finally { db.close() }
  const planningDb = await databases.openExisting(project.path)
  assert.ok(planningDb)
  try {
    planningDb.writeFormalOutline({ legacyKey: 'stage-159', parentLegacyKey: 'volume-1', nodeType: 'stage', seq: 1, title: '石桥交接', content: '沈砚在石桥等待回应。' })
    planningDb.writeFormalOutline({ legacyKey: 'chapter-21', parentLegacyKey: 'stage-159', nodeType: 'chapter', seq: 1, title: '桥下回应', content: '沈砚停在石桥。' })
  } finally { planningDb.close() }
  const planned = await documents.getPlannedChapter(21)
  await documents.startPlannedChapter({ chapterId: 21, expectedRevision: planned.revision })
  const next = await documents.chapter(21)
  await documents.updateChapterOutline(next.id, '沈砚停在石桥，等待桥下回应，不提前确定暗号含义。')
  const retrieval = new LocalRetrievalService(projects, documents, undefined, {
    active: root => authority.active(root),
    currentDocumentChunksBefore: (root, chapterId) => authority.currentDocumentChunksBefore(root, chapterId)
  })
  const connectedWorkspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, retrieval, authority)
  const agent = new WritingAgentService({ modelFor: async () => 'offline-context-test' } as unknown as AiClient,
    projects, documents, connectedWorkspace, {} as ChapterDraftService)
  const request = { chapterId: next.id, currentDraft: '', message: '继续这一章', preferredSkill: 'continue' as const }
  const pack = await connectedWorkspace.contextFactPack(next.id)
  assert.equal(pack.structured.approvedFacts.length, 1)
  assert.equal(pack.structured.latestApprovedSummary?.bodyVersionId, saved.bodyVersionId)
  const prepared = await agent.prepare(request)
  const compiled = prepared.contexts.map(item => item.content).join('\n')
  assert.match(compiled, /石桥/)
  assert.ok(compiled.includes(summaryText))
  assert.doesNotMatch(compiled, /未核实的三声暗号/)
  assert.equal((await documents.chapter(next.id)).content, '')
  await documents.updateChapter(20, { content: '沈砚离开石桥，回到客栈。', reason: 'manual', expectedRevision: saved.revision })
  const duringRevision = await agent.prepare(request)
  assert.ok(duringRevision.contexts.some(item => item.content.includes(summaryText)), 'unconfirmed edits must not replace the confirmed source')
  await authority.updateChapterPlanning(project.path, { legacyChapterId: 20, lifecycleStatus: 'CONFIRMED' })
  const after = await agent.prepare(request)
  assert.ok(!after.contexts.some(item => item.content.includes(summaryText)), 'stale summary must not enter the next model context')
  assert.equal((await authority.bodyVersion(project.path, 20, saved.bodyVersionId!)).content, saved.content)
})

test('excludes archived chapter summaries from the next writing context while preserving summary history', async (context) => {
  const { databases, project, projects, authority, documents } = await fixture(context)
  const chapter = await documents.chapter(20)
  const db = await databases.openExisting(project.path)
  assert.ok(db)
  const summaryText = '仅归档章出现的紫铜铃交接。'
  try { db.writeSummaryVersion({ legacyChapterId: 20, bodyVersionId: chapter.bodyVersionId!, content: summaryText, status: 'approved' }) }
  finally { db.close() }
  const retrieval = new LocalRetrievalService(projects, documents, undefined, {
    active: root => authority.active(root),
    currentDocumentChunksBefore: (root, id) => authority.currentDocumentChunksBefore(root, id)
  })
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, retrieval, authority)
  assert.equal((await workspace.contextFactPack(10)).structured.latestApprovedSummary?.content, summaryText)
  await documents.deleteChapter(20)
  assert.equal((await workspace.contextFactPack(10)).structured.latestApprovedSummary, undefined)
  const agent = new WritingAgentService({ modelFor: async () => 'offline-context-test' } as unknown as AiClient,
    projects, documents, workspace, {} as ChapterDraftService)
  const prepared = await agent.prepare({ chapterId: 10, currentDraft: '', message: '继续这一章', preferredSkill: 'continue' })
  assert.ok(!prepared.contexts.some(item => item.content.includes(summaryText)))
  const raw = new DatabaseSync(join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH), { readOnly: true })
  try { assert.equal(raw.prepare('SELECT content FROM summary_versions WHERE body_version_id = ?').get(chapter.bodyVersionId!)?.content, summaryText) }
  finally { raw.close() }
})

test('binds an approved chapter summary to its body version and excludes it after that body changes', async (context) => {
  const { databases, project, documents } = await fixture(context)
  const chapter = await documents.chapter(20)
  assert.ok(chapter.bodyVersionId)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const written = database.writeSummaryVersion({
    legacyChapterId: 20,
    bodyVersionId: chapter.bodyVersionId,
    content: '沈砚沿旧城墙追查雨夜来信，准备继续寻找回声来源。',
    status: 'approved'
  })
  assert.equal(written.status, 'approved')
  assert.equal(database.latestApprovedSummaryBefore(10)?.content, written.content)
  database.close()

  await documents.updateChapter(20, {
    content: `${chapter.content}\n\n他决定先回客栈核对信封。`,
    reason: 'manual',
    expectedRevision: chapter.revision
  })
  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  assert.equal(reopened.latestApprovedSummaryBefore(10), null)
  reopened.close()
})

test('returns the configurable number of recent valid chapter summaries from near to far', async (context) => {
  const { databases, documents, project, projects, authority } = await fixture(context)
  const earlier = [await documents.chapter(20), await documents.chapter(10)]
  earlier.push(await documents.createChapter(), await documents.createChapter(), await documents.createChapter())
  const target = await documents.createChapter()
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  try {
    for (const chapter of earlier) {
      assert.ok(chapter.bodyVersionId)
      database.writeSummaryVersion({
        legacyChapterId: chapter.id,
        bodyVersionId: chapter.bodyVersionId,
        content: `第 ${chapter.position} 章的有效承接摘要。`,
        status: 'approved'
      })
    }
    const recent = database.approvedSummariesBefore(target.id, 3)
    assert.deepEqual(recent.map((item) => item.legacyChapterId), earlier.slice(-3).reverse().map((item) => item.id))
    assert.equal(database.latestApprovedSummaryBefore(target.id)?.legacyChapterId, earlier.at(-1)?.id)
    assert.throws(() => database.approvedSummariesBefore(target.id, 6), /摘要数量无效/)
  } finally { database.close() }
  const retrieval = new LocalRetrievalService(projects, documents, undefined, {
    active: root => authority.active(root),
    currentDocumentChunksBefore: (root, chapterId) => authority.currentDocumentChunksBefore(root, chapterId)
  })
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, retrieval, authority)
  await workspace.saveContextBudgetPreferences({
    version: 1, inputBudgetTokens: 48_000, modelContextLimit: 96_000, outputReservePercent: 25,
    systemReserveTokens: 8_000, recentSummaryCount: 2, structuredRepairAttempts: 1, minimumFactImportance: 'medium', showFactConfirmations: false, pinnedEvidenceKeys: [], excludedEvidenceKeys: []
  })
  const pack = await workspace.contextFactPack(target.id)
  assert.deepEqual(pack.structured.recentApprovedSummaries?.map((item) => item.chapterId), earlier.slice(-2).reverse().map((item) => item.id))
  assert.equal(pack.structured.latestApprovedSummary?.chapterId, earlier.at(-1)?.id)
})

test('chunks every formal body version and retrieves only chunks from the current prior version', async (context) => {
  const { authority, project, documents, databases } = await fixture(context)
  const chapter = await documents.chapter(20)
  const longContent = Array.from({ length: 90 }, (_, index) => `第${index + 1}段，沈砚沿旧城墙核对红泥脚印与临江酒馆的来信。`).join('\n\n')
  const updated = await documents.updateChapter(20, { content: longContent, reason: 'manual', expectedRevision: chapter.revision })
  assert.ok(updated.bodyVersionId)

  const chunks = await authority.currentDocumentChunksBefore(project.path, 10)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((item) => item.legacyChapterId === 20 && item.bodyVersionId === updated.bodyVersionId && item.tokenEstimate > 0))
  assert.deepEqual(chunks.map((item) => item.ordinal), chunks.map((_, index) => index))
  assert.match(chunks.map((item) => item.content).join('\n'), /临江酒馆/)
  const matched = await authority.searchCurrentDocumentChunksBefore(project.path, 10, ['临江酒馆', '不存在的词'])
  assert.ok(matched.length > 0)
  assert.ok(matched.every((item) => item.legacyChapterId === 20 && item.bodyVersionId === updated.bodyVersionId))
  assert.match(matched.map((item) => item.content).join('\n'), /临江酒馆/)
  assert.deepEqual(await authority.searchCurrentDocumentChunksBefore(project.path, 10, ['完全不命中']), [])
  await assert.rejects(authority.searchCurrentDocumentChunksBefore(project.path, 10, ['单']), /检索词无效/)

  const replacement = await documents.updateChapter(20, { content: '沈砚改去北门核对新的线索。', reason: 'manual', expectedRevision: updated.revision })
  const current = await authority.currentDocumentChunksBefore(project.path, 10)
  assert.equal(current.length, 1)
  assert.equal(current[0].bodyVersionId, replacement.bodyVersionId)
  assert.doesNotMatch(current[0].content, /临江酒馆/)
  assert.deepEqual(await authority.searchCurrentDocumentChunksBefore(project.path, 10, ['临江酒馆']), [])

  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const raw = new DatabaseSync(join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH), { readOnly: true })
  const historicalChunkCount = raw.prepare('SELECT COUNT(*) AS count FROM document_chunks WHERE body_version_id = ?').get(updated.bodyVersionId) as { count: number }
  assert.ok(Number(historicalChunkCount.count) > 1)
  raw.close()
  database.close()
})

test('normalizes SQLite prior-chunk matching without changing original evidence, versions or mirrors', async (context) => {
  const { authority, project, projects, documents, source } = await fixture(context)
  const original = '口令ＡＢＣ_１２；编号１２３４；兼容连字ﬃ；咖啡店Cafe\u0301。'
  await documents.updateChapter(20, { title: 'ＴＩＴＬＥ＿ＯＮＬＹ', content: original })
  await documents.updateChapter(10, { content: '当前章 ＡＢＣ_１２ CURRENT_ONLY' })
  await documents.updateChapter(30, { content: '未来章 ＡＢＣ_１２ FUTURE_ONLY' })
  const before = await source.snapshot()
  const stored = () => {
    const raw = new DatabaseSync(join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH), { readOnly: true })
    try {
      return {
        versions: raw.prepare('SELECT * FROM body_versions ORDER BY id').all(),
        chunks: raw.prepare('SELECT * FROM document_chunks ORDER BY id').all(),
        schema: raw.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
      }
    } finally { raw.close() }
  }
  const beforeStored = stored()
  for (const term of ['abc_12', 'ＡＢＣ_１２', '1234', 'ffi', 'café', 'title_only']) {
    const found = await authority.searchCurrentDocumentChunksBefore(project.path, 10, [term])
    assert.deepEqual(found.map(item => item.legacyChapterId), [20], `missed normalized search ${term}`)
    assert.equal(found[0].content, original)
    assert.equal(found[0].chapterTitle, 'ＴＩＴＬＥ＿ＯＮＬＹ')
  }
  assert.deepEqual(await authority.searchCurrentDocumentChunksBefore(project.path, 10, ['CURRENT_ONLY', 'FUTURE_ONLY']), [])
  assert.deepEqual(await authority.searchCurrentDocumentChunksBefore(project.path, 10, ['missing_term']), [])
  const retrieval = new LocalRetrievalService(projects, {
    chapters: async () => { throw new Error('must not reread author mirrors') }
  }, undefined, {
    active: root => authority.active(root),
    currentDocumentChunksBefore: (root, id, limit) => authority.currentDocumentChunksBefore(root, id, limit),
    searchCurrentDocumentChunksBefore: (root, id, terms, limit) => authority.searchCurrentDocumentChunksBefore(root, id, terms, limit)
  })
  const pack = await retrieval.build({ chapterId: 10, chapterPosition: 2, queryParts: ['ABC_12'] })
  assert.equal(pack.evidence[0]?.excerpt, original)
  assert.deepEqual(await source.snapshot(), before)
  assert.deepEqual(stored(), beforeStored)
})

test('confirms an explicit body version and keeps later draft edits out of next-chapter retrieval until reconfirmed', async (context) => {
  const { authority, project, documents, databases } = await fixture(context)
  const original = await documents.chapter(20)
  assert.ok(original.bodyVersionId)

  await authority.updateChapterPlanning(project.path, { legacyChapterId: 20, lifecycleStatus: 'REVIEWABLE' })
  const confirmed = await authority.updateChapterPlanning(project.path, { legacyChapterId: 20, lifecycleStatus: 'CONFIRMED' })
  assert.equal(confirmed.lifecycleStatus, 'CONFIRMED')
  assert.equal(confirmed.currentBodyVersionId, confirmed.confirmedBodyVersionId)
  assert.notEqual(confirmed.confirmedBodyVersionId, original.bodyVersionId)
  assert.ok(confirmed.confirmedAt)
  assert.equal(confirmed.hasUnconfirmedChanges, false)

  let chunks = await authority.currentDocumentChunksBefore(project.path, 10)
  assert.ok(chunks.length > 0)
  assert.ok(chunks.every((chunk) => chunk.bodyVersionId === confirmed.confirmedBodyVersionId))
  assert.match(chunks.map((chunk) => chunk.content).join('\n'), /旧城墙寻找回声/)

  const revised = await documents.updateChapter(20, {
    content: '第二天，沈砚改去北门追查另一封信。',
    reason: 'manual',
    expectedRevision: original.revision
  })
  assert.notEqual(revised.bodyVersionId, confirmed.confirmedBodyVersionId)
  const revising = await authority.chapterPlanning(project.path, 20)
  assert.equal(revising.lifecycleStatus, 'REVISING')
  assert.equal(revising.confirmedBodyVersionId, confirmed.confirmedBodyVersionId)
  assert.equal(revising.hasUnconfirmedChanges, true)

  chunks = await authority.currentDocumentChunksBefore(project.path, 10)
  assert.ok(chunks.every((chunk) => chunk.bodyVersionId === confirmed.confirmedBodyVersionId))
  assert.doesNotMatch(chunks.map((chunk) => chunk.content).join('\n'), /北门追查/)

  const frozen = await authority.bodyVersion(project.path, 20, confirmed.confirmedBodyVersionId!)
  const taskId = '77777777-7777-4777-8777-777777777777'
  const taskDatabase = await databases.openExisting(project.path)
  assert.ok(taskDatabase)
  taskDatabase.createTaskRun({
    id: taskId,
    legacyChapterId: 20,
    taskType: 'fact_extraction',
    idempotencyKey: taskId,
    baseBodyVersionId: frozen.bodyVersionId,
    contentHash: createHash('sha256').update(frozen.content).digest('hex'),
    checkpointJson: JSON.stringify({ version: 1, workItemId: project.path, chapterId: 20, bodyVersionId: frozen.bodyVersionId })
  })
  taskDatabase.transitionTaskRun({ id: taskId, status: 'preparing' })
  taskDatabase.transitionTaskRun({ id: taskId, status: 'running' })
  taskDatabase.close()
  const frozenBatch = await authority.recordCharacterFactCandidates(project.path, frozen, [{
    character: '他', field: 'location', value: '旧城墙', evidence: '他沿着旧城墙寻找回声。'
  }], taskId, taskId)
  assert.equal(frozenBatch?.bodyVersionId, confirmed.confirmedBodyVersionId)

  const reconfirmed = await authority.updateChapterPlanning(project.path, { legacyChapterId: 20, lifecycleStatus: 'CONFIRMED' })
  assert.equal(reconfirmed.currentBodyVersionId, reconfirmed.confirmedBodyVersionId)
  assert.notEqual(reconfirmed.confirmedBodyVersionId, revised.bodyVersionId)
  chunks = await authority.currentDocumentChunksBefore(project.path, 10)
  assert.ok(chunks.every((chunk) => chunk.bodyVersionId === reconfirmed.confirmedBodyVersionId))
  assert.match(chunks.map((chunk) => chunk.content).join('\n'), /北门追查/)
  assert.equal((await authority.factBatches(project.path, 20)).find((batch) => batch.id === frozenBatch?.id)?.status, 'STALE')

  const raw = new DatabaseSync(join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH), { readOnly: true })
  const row = raw.prepare(`
    SELECT chapters.status, chapters.current_body_version_id, chapters.confirmed_body_version_id,
      metadata.label
    FROM chapters
    JOIN body_version_metadata metadata ON metadata.version_id = chapters.confirmed_body_version_id
    WHERE chapters.legacy_chapter_id = 20
  `).get() as { status: string; current_body_version_id: string; confirmed_body_version_id: string; label: string }
  raw.close()
  assert.deepEqual({ ...row }, {
    status: 'confirmed',
    current_body_version_id: reconfirmed.confirmedBodyVersionId,
    confirmed_body_version_id: reconfirmed.confirmedBodyVersionId,
    label: '确认定稿'
  })
})

test('keeps non-sensitive model routing metadata in SQLite without storing a credential', async (context) => {
  const { databases, project } = await fixture(context)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const first = database.upsertModelConfig({
    provider: 'https://api.example.test/v1#prose', modelName: 'writer-model', displayName: 'writer-model · prose',
    settingsJson: JSON.stringify({ temperature: 0.8, topP: 0.9, maxTokens: 8192 }), inputTokenBudget: 8192, isDefault: true
  })
  const updated = database.upsertModelConfig({
    provider: 'https://api.example.test/v1#prose', modelName: 'writer-model', displayName: 'writer-model · prose',
    settingsJson: JSON.stringify({ temperature: 0.7, topP: 0.9, maxTokens: 4096 }), inputTokenBudget: 4096, isDefault: true
  })
  const configs = database.listModelConfigs()
  assert.equal(updated.id, first.id)
  assert.equal(configs.length, 1)
  assert.equal(configs[0].inputTokenBudget, 4096)
  const storedSettings = JSON.parse(configs[0].settingsJson) as Record<string, unknown>
  assert.equal('apiKey' in storedSettings, false)
  assert.equal('api_key' in storedSettings, false)
  assert.equal('secret' in storedSettings, false)
  const [replacement] = database.reconcileModelConfigs([{
    provider: 'gemini:https://generativelanguage.example.test/v1#prose', modelName: 'gemini-writer', displayName: 'gemini-writer · prose',
    settingsJson: JSON.stringify({ connectionId: 'gemini', temperature: 0.6 }), inputTokenBudget: 12000, enabled: true, isDefault: true
  }])
  const reconciled = database.listModelConfigs()
  assert.equal(replacement.enabled, true)
  assert.equal(reconciled.length, 2, '旧配置应保留以供历史任务引用')
  assert.equal(reconciled.find((item) => item.id === first.id)?.enabled, false, '已经不再分配的模型必须停用')
  assert.equal(reconciled.find((item) => item.id === first.id)?.isDefault, false)
  database.close()
})

test('stores character aliases as project-scoped formal records and mirrors them as readable JSON', async (context) => {
  const { project, databases, authority } = await fixture(context)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const first = database.replaceCharacterAliases({ canonicalName: '沈砚', aliases: ['阿砚', '沈公子', '阿砚'] })
  assert.equal(first.aliases.length, 2)
  assert.deepEqual(first.aliases.map((item) => item.alias), ['沈公子', '阿砚'])
  const second = database.replaceCharacterAliases({ canonicalName: '沈砚', aliases: ['小沈'] })
  assert.equal(second.aliases.length, 1)
  assert.equal(second.aliases[0]?.alias, '小沈')
  assert.equal(second.mirror.relativePath, '.webnovel/story-state/character-aliases.json')
  assert.deepEqual(JSON.parse(second.mirror.content), {
    version: 1, characters: [{ canonicalName: '沈砚', aliases: ['小沈'] }]
  })
  assert.equal(database.listCharacterAliases().length, 1)
  database.close()
  await authority.replaceCharacterAliases(project.path, { canonicalName: '沈砚', aliases: ['阿砚', '小砚'] })
  const mirrorPath = join(project.path, '.webnovel', 'story-state', 'character-aliases.json')
  const mirror = JSON.parse(await readFile(mirrorPath, 'utf8'))
  assert.deepEqual(mirror, {
    version: 1, characters: [{ canonicalName: '沈砚', aliases: ['小砚', '阿砚'] }]
  })
  const externalAliasMirror = JSON.stringify({ version: 1, characters: [{ canonicalName: '沈砚', aliases: ['外部伪造别名'] }] }, null, 2)
  await writeFile(mirrorPath, externalAliasMirror, 'utf8')
  assert.deepEqual((await authority.characterAliases(project.path)).map((item) => item.alias), ['小砚', '阿砚'])
  assert.equal(await readFile(mirrorPath, 'utf8'), externalAliasMirror, '只读查询不能让外部 JSON 反向覆盖 SQLite，也不能静默覆盖外改文件')
})

test('stores formal story entities and cross-entity relations in a readable JSON mirror', async (context) => {
  const { project, databases, authority } = await fixture(context)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const city = database.upsertEntity({
    entityType: 'location', canonicalName: '雾港', profileJson: JSON.stringify({ climate: '终年有雾', district: '旧港区' })
  })
  const guild = database.upsertEntity({ entityType: 'organization', canonicalName: '巡夜人公会', status: 'candidate' })
  const relation = database.upsertEntityRelation({ subjectEntityId: guild.entity.id, predicate: '驻守于', objectEntityId: city.entity.id, notes: '在旧港区设有哨所。' })
  assert.equal(database.listEntities('location')[0]?.canonicalName, '雾港')
  assert.equal(database.listEntityRelations(city.entity.id)[0]?.id, relation.relation.id)
  assert.equal(relation.mirror.relativePath, '.webnovel/story-state/entities.json')
  const directMirror = JSON.parse(relation.mirror.content)
  assert.equal(directMirror.entities.length, 2)
  assert.deepEqual(directMirror.entities.find((item: { id: string }) => item.id === city.entity.id).profile, { climate: '终年有雾', district: '旧港区' })
  assert.equal(directMirror.relations[0].predicate, '驻守于')
  database.close()

  await authority.saveStoryEntity(project.path, { entityType: 'item', canonicalName: '黑曜钥匙', profileJson: JSON.stringify({ owner: '沈砚' }) })
  const mirror = JSON.parse(await readFile(join(project.path, '.webnovel', 'story-state', 'entities.json'), 'utf8'))
  assert.equal(mirror.entities.some((item: { name: string; type: string }) => item.name === '黑曜钥匙' && item.type === 'item'), true)
})

test('keeps novel world rules in story context and system check rules out of story canon', async (context) => {
  const { project, projects, databases, authority, documents } = await fixture(context)
  const worldRule = await authority.saveStoryEntity(project.path, {
    entityType: 'world_rule',
    canonicalName: '雨夜回声法则',
    profileJson: JSON.stringify({ statement: '雨夜回声只能重复已经说出口的话。' }),
    status: 'approved'
  })
  const chapter = await documents.chapter(10)
  assert.ok(chapter.bodyVersionId)
  const findings = await authority.recordConsistencyFindings(project.path, {
    legacyChapterId: 10,
    bodyVersionId: chapter.bodyVersionId,
    contentHash: createHash('sha256').update(chapter.content).digest('hex'),
    ruleLayer: 'deterministic',
    findings: [{
      code: 'system-check.only-spoken-words',
      severity: 'warning',
      title: '系统检查规则：核对回声来源',
      rationale: '检查器内部规则只用于发现疑点，不是小说世界的新设定。',
      evidenceJson: JSON.stringify({ excerpts: [chapter.content] }),
      suggestedAction: '由作者核对正文。'
    }]
  })
  assert.equal(findings.length, 1)

  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const promptContext = await workspace.promptContext(10, 'prose')
  assert.match(promptContext, /雨夜回声法则/)
  assert.match(promptContext, /雨夜回声只能重复已经说出口的话/)
  assert.doesNotMatch(promptContext, /系统检查规则：核对回声来源/)
  assert.doesNotMatch(promptContext, /检查器内部规则只用于发现疑点/)

  const database = await databases.openExisting(project.path)
  assert.ok(database)
  try {
    assert.equal(database.listEntities('world_rule').some((item) => item.id === worldRule.id), true)
    assert.equal(database.listFindings(10).some((item) => item.code === 'system-check.only-spoken-words'), true)
  } finally { database.close() }

  const mirror = JSON.parse(await readFile(join(project.path, '.webnovel', 'story-state', 'entities.json'), 'utf8'))
  assert.equal(mirror.entities.some((item: { name: string }) => item.name === '雨夜回声法则'), true)
  assert.doesNotMatch(JSON.stringify(mirror), /系统检查规则：核对回声来源/)
})

test('keeps an idea after explicit promotion and copies it once into formal world rules', async (context) => {
  const { project, projects, authority } = await fixture(context)
  const workspace = new WorkspaceService(projects, undefined, undefined, undefined, undefined, undefined, authority)
  const draft = await authority.saveIdea(project.path, {
    title: '月影只照见说谎的人',
    content: '每逢双月重叠，月光只会在说谎者脚下留下影子。'
  })
  assert.equal(draft.status, 'candidate')
  assert.equal(draft.promotedToId, null)
  assert.doesNotMatch(await workspace.planningMaterials(), /月影只照见说谎的人/)

  const approved = await authority.saveIdea(project.path, { ...draft, status: 'approved' })
  assert.match(await workspace.planningMaterials(), /作者已批准灵感｜月影只照见说谎的人/)
  const approvedAfterEdit = await authority.saveIdea(project.path, {
    id: approved.id,
    title: approved.title,
    content: approved.content
  })
  assert.equal(approvedAfterEdit.status, 'approved')
  const promoted = await authority.promoteIdeaToWorldRule(project.path, approvedAfterEdit.id, approvedAfterEdit.updatedAt)
  assert.equal(promoted.idea.status, 'approved')
  assert.equal(promoted.idea.promotedToType, 'world_rule')
  assert.equal(promoted.entity.entityType, 'world_rule')
  assert.deepEqual(JSON.parse(promoted.entity.profileJson), {
    statement: '每逢双月重叠，月光只会在说谎者脚下留下影子。',
    sourceType: 'idea',
    sourceIdeaId: approved.id
  })
  assert.doesNotMatch(await workspace.planningMaterials(), /作者已批准灵感｜月影只照见说谎的人/)

  const repeated = await authority.promoteIdeaToWorldRule(project.path, promoted.idea.id, promoted.idea.updatedAt)
  assert.equal(repeated.entity.id, promoted.entity.id)
  assert.equal((await authority.storyEntities(project.path)).filter((item) => item.entityType === 'world_rule').length, 1)

  const editedSource = await authority.saveIdea(project.path, {
    id: promoted.idea.id,
    title: '月影只照见谎言',
    content: '作者后来修改了原便签，但正式设定不会被静默覆盖。',
    status: 'approved'
  })
  assert.notEqual(editedSource.updatedAt, promoted.idea.updatedAt)
  const formal = (await authority.storyEntities(project.path)).find((item) => item.id === promoted.entity.id)
  assert.equal(formal?.canonicalName, '月影只照见说谎的人')
  assert.equal(JSON.parse(formal!.profileJson).statement, '每逢双月重叠，月光只会在说谎者脚下留下影子。')
  await assert.rejects(authority.promoteIdeaToWorldRule(project.path, editedSource.id, promoted.idea.updatedAt), (error: { code?: string }) => error.code === 'CONFLICT')

  const ideasMirrorPath = join(project.path, '.webnovel', 'ideas', 'ideas.json')
  const ideasMirror = JSON.parse(await readFile(ideasMirrorPath, 'utf8'))
  assert.equal(ideasMirror.authority, 'sqlite-ideas')
  assert.equal(ideasMirror.ideas[0].promotedToId, promoted.entity.id)
  await unlink(ideasMirrorPath)
  const rebuilt = await authority.rebuildReadableMirrors(project.path)
  assert.equal(rebuilt.recreated >= 1, true)
  assert.equal(JSON.parse(await readFile(ideasMirrorPath, 'utf8')).ideas[0].id, draft.id)
  const externalIdeaMirror = '{"external":"作者在外部修改了灵感镜像"}\n'
  await writeFile(ideasMirrorPath, externalIdeaMirror, 'utf8')
  await assert.rejects(authority.rollback(project.path), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(await readFile(ideasMirrorPath, 'utf8'), externalIdeaMirror)
})

test('starts planning from approved ideas alone and preserves promoted canon through every candidate stage', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  await workspace.saveFoundation({ ...(await workspace.foundation()), sourceNotes: '' })
  // This case has only unapproved ideas: the shared fixture's saved summary is
  // itself a valid planning source and must be explicitly removed from the case.
  await documents.updateOutline('total', '')
  const idea = await authority.saveIdea(project.path, { title: '钟楼回声规则', content: '钟楼每天只保留最后一句谎话。' })
  assert.equal(await workspace.hasPlanningMaterials(), false)
  assert.equal(await workspace.planningMaterials(), '')
  assert.notEqual((await workspace.workflowStatus()).steps.find((step) => step.id === 'materials')?.state, 'complete')
  let calls = 0
  const outputs = [
    { premise: '寻找最后一句谎话', worldView: '钟楼之城', characters: [{ name: '沈砚', role: '追查者', arcSeed: '追索真相' }], powerSystem: '', cheatSystem: '', rationale: '围绕回声展开' },
    { title: '钟楼之谜', summary: '从回声发现秘密', content: '发现回声，追查来历，作出选择。' },
    { volumes: [1, 2, 3].map((order) => ({ order, title: `第${order}卷`, goal: '追索线索', summary: '发现线索并行动', ending: '留下新的问题' })) }
  ]
  const requests: string[] = []
  const generator = new PlanningDraftService({ complete: async (instruction) => {
    requests.push(instruction)
    return { content: JSON.stringify(outputs[calls++]) }
  } }, workspace)
  await assert.rejects(generator.generate(project.path), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')
  assert.equal(calls, 0)
  const approved = await authority.saveIdea(project.path, { ...idea, status: 'approved' })
  assert.equal(await workspace.hasPlanningMaterials(), true)
  assert.equal((await workspace.workflowStatus()).steps.find((step) => step.id === 'materials')?.state, 'complete')
  const promoted = await authority.promoteIdeaToWorldRule(project.path, approved.id, approved.updatedAt)
  await authority.saveIdea(project.path, { id: idea.id, title: idea.title, content: '这句后改的便签不能覆盖钟楼规则。' })
  const materials = await workspace.planningMaterials()
  assert.match(materials, /作者已批准的正式设定/)
  assert.match(materials, /钟楼每天只保留最后一句谎话/)
  assert.doesNotMatch(materials, /这句后改的便签/)
  assert.equal(await workspace.hasPlanningMaterials(), true)
  assert.equal((await workspace.workflowStatus()).steps.find((step) => step.id === 'materials')?.state, 'complete')
  const before = (await documents.outline('total')).content
  const proposal = await generator.generate(project.path)
  assert.equal(proposal.volumes.length, 3)
  assert.equal(calls, 3)
  for (const request of requests) assert.match(request, /钟楼每天只保留最后一句谎话/)
  assert.equal((await documents.outline('total')).content, before)
  assert.equal((await authority.storyEntities(project.path)).find((item) => item.id === promoted.entity.id)?.profileJson, promoted.entity.profileJson)
})

test('uses an append-only resource ledger as the only formal quantity source and mirrors derived balances', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const resource = await authority.saveStoryEntity(project.path, {
    entityType: 'item', canonicalName: '黑曜钥匙', profileJson: JSON.stringify({ owner: '沈砚', appearance: '黑色' }), status: 'approved'
  })
  const location = await authority.saveStoryEntity(project.path, { entityType: 'location', canonicalName: '旧港仓库', status: 'approved' })
  await assert.rejects(authority.saveStoryEntity(project.path, {
    entityType: 'item', canonicalName: '铜钱', profileJson: JSON.stringify({ 数量: 12 })
  }), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')
  const firstInput = {
    operationKey: '20000000-0000-4000-8000-000000000001',
    resourceEntityId: resource.id,
    delta: 5,
    eventId: '第10章取得钥匙',
    note: '从旧信封夹层中找到'
  }
  const first = await authority.appendResourceLedger(project.path, firstInput)
  assert.equal(first.balance.quantity, 5)
  assert.equal(first.idempotent, false)
  const replay = await authority.appendResourceLedger(project.path, firstInput)
  assert.equal(replay.entry.id, first.entry.id)
  assert.equal(replay.idempotent, true)
  const spent = await authority.appendResourceLedger(project.path, {
    operationKey: '20000000-0000-4000-8000-000000000002', resourceEntityId: resource.id, delta: -7, note: '开启两道封印门'
  })
  assert.equal(spent.balance.quantity, -2)
  assert.equal(spent.balance.isNegative, true)
  const ledger = await authority.resourceLedger(project.path)
  assert.equal(ledger.entries.length, 2)
  assert.equal(ledger.balances.find((item) => item.resourceEntityId === resource.id)?.quantity, -2)
  await documents.updateChapterOutline(10, '收到来信，携带黑曜钥匙前往旧城。')
  const prompt = await new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority).promptContext(10, 'prose', { mode: 'fast' })
  assert.match(prompt, /与当前章直接相关的资源余额/)
  assert.match(prompt, /"resourceName": "黑曜钥匙"/)
  assert.match(prompt, /"quantity": -2/)
  await assert.rejects(authority.appendResourceLedger(project.path, {
    ...firstInput, delta: 6
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  await assert.rejects(authority.appendResourceLedger(project.path, {
    operationKey: '20000000-0000-4000-8000-000000000003', resourceEntityId: location.id, delta: 1
  }), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')

  const mirror = JSON.parse(await readFile(join(project.path, '.webnovel', 'story-state', 'resource-ledger.json'), 'utf8'))
  assert.equal(mirror.authority, 'sqlite-resource-ledger')
  assert.equal(mirror.balances.find((item: { resourceEntityId: string }) => item.resourceEntityId === resource.id).quantity, -2)
  assert.deepEqual(mirror.entries.map((item: { delta: number }) => item.delta), [-7, 5])

  const resourceMirrorPath = join(project.path, '.webnovel', 'story-state', 'resource-ledger.json')
  const externalResourceMirror = JSON.stringify({ version: 1, authority: 'external-json', balances: [{ resourceEntityId: resource.id, quantity: 999 }], entries: [] }, null, 2)
  await writeFile(resourceMirrorPath, externalResourceMirror, 'utf8')
  assert.equal((await authority.resourceLedger(project.path)).balances.find((item) => item.resourceEntityId === resource.id)?.quantity, -2)
  assert.equal(await readFile(resourceMirrorPath, 'utf8'), externalResourceMirror, '资源镜像外改不能改变正式余额，也不能被只读操作覆盖')

  const raw = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { allowExtension: false })
  assert.throws(() => raw.prepare('UPDATE resource_ledger SET delta = 9 WHERE id = ?').run(first.entry.id), /append-only/)
  assert.throws(() => raw.prepare('DELETE FROM resource_ledger WHERE id = ?').run(first.entry.id), /append-only/)
  raw.close()
})

test('tracks formal foreshadows through immutable actions and mirrors the current projection', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const plantedInput = {
    operationKey: '30000000-0000-4000-8000-000000000001',
    action: 'plant' as const,
    title: '信封边缘残留海盐',
    legacyChapterId: 10,
    description: '主角暂时没有追查海盐来源',
    evidence: '信封边缘沾着一圈发白的细盐。',
    sourceType: 'manual' as const
  }
  const planted = await authority.recordForeshadowAction(project.path, plantedInput)
  assert.equal(planted.foreshadow.status, 'open')
  assert.equal(planted.foreshadow.plantedChapterId, 10)
  assert.equal(planted.idempotent, false)
  const replay = await authority.recordForeshadowAction(project.path, plantedInput)
  assert.equal(replay.action.id, planted.action.id)
  assert.equal(replay.idempotent, true)
  await authority.recordForeshadowAction(project.path, {
    operationKey: '30000000-0000-4000-8000-000000000002', action: 'misdirect', foreshadowId: planted.foreshadow.id,
    legacyChapterId: 10, description: '先让主角误以为来自港口仓库', sourceType: 'manual'
  })
  const open = await authority.foreshadowLedger(project.path, 'open')
  assert.equal(open.foreshadows.length, 1)
  assert.deepEqual(open.actions.map((item) => item.action), ['misdirect', 'plant'])
  const prompt = await new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority).promptContext(10, 'prose', { mode: 'fast' })
  assert.match(prompt, /尚未回收的正式伏笔/)
  assert.match(prompt, /信封边缘残留海盐/)
  const resolved = await authority.recordForeshadowAction(project.path, {
    operationKey: '30000000-0000-4000-8000-000000000003', action: 'resolve', foreshadowId: planted.foreshadow.id,
    legacyChapterId: 10, description: '确认信封来自旧港邮局', sourceType: 'manual'
  })
  assert.equal(resolved.foreshadow.status, 'resolved')
  assert.equal(resolved.foreshadow.payoffChapterId, 10)
  assert.equal((await authority.foreshadowLedger(project.path, 'open')).foreshadows.length, 0)
  await assert.rejects(authority.recordForeshadowAction(project.path, {
    operationKey: '30000000-0000-4000-8000-000000000004', action: 'advance', foreshadowId: planted.foreshadow.id,
    description: '已经回收后不得继续推进', sourceType: 'manual'
  }), (error: { code?: string }) => error.code === 'CONFLICT')

  const mirror = JSON.parse(await readFile(join(project.path, '.webnovel', 'story-state', 'foreshadows.json'), 'utf8'))
  assert.equal(mirror.authority, 'sqlite-foreshadow-ledger')
  assert.equal(mirror.foreshadows[0].status, 'resolved')
  assert.deepEqual(mirror.actions.map((item: { action: string }) => item.action), ['resolve', 'misdirect', 'plant'])
  const raw = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { allowExtension: false })
  assert.throws(() => raw.prepare('UPDATE foreshadow_actions SET description = ? WHERE id = ?').run('改写', planted.action.id), /append-only/)
  assert.throws(() => raw.prepare('DELETE FROM foreshadow_actions WHERE id = ?').run(planted.action.id), /append-only/)
  raw.close()
})

test('settles fast-generation foreshadows only from prose the author has already saved', async (context) => {
  const { project, authority, documents } = await fixture(context)
  const acceptedText = '沈砚拆开雨夜来信，发现信封边缘残留着一圈海盐。'
  const chapter = await documents.updateChapter(10, { content: acceptedText, reason: 'manual' })
  const proposal: ChapterDraftProposal = {
    id: 'fast-foreshadow-proposal', chapterId: 10, createdAt: '2026-09-01T04:00:00.000Z', content: acceptedText,
    contract: {
      chapterId: 10, chapterPosition: 1, outlineSnapshot: '埋设海盐伏笔', beats: [], forbiddenEvents: [],
      entryState: '收到来信', exitState: '发现海盐', allowedFacts: [],
      foreshadowActions: [{ id: 'F1', action: 'plant', description: '信封边缘残留海盐' }],
      version: { fingerprint: 'chapter:test', totalFingerprint: 'total:test', outlineHash: 'outline:test', eventIds: [], confirmedAt: '2026-09-01T03:59:00.000Z' }
    },
    report: {
      reviewMode: 'fast', passed: true, summary: '本地快速门通过', beats: [],
      boundary: { entryRespected: true, exitReached: true, evidence: acceptedText },
      foreshadowing: [], violations: [], introducedFacts: [], characterChanges: [], characterConflicts: []
    }
  }
  const settled = await authority.settleForeshadowActions(project.path, chapter, proposal, 'chapter_draft', 'fast-job-1')
  assert.equal(settled.foreshadows[0]?.title, '信封边缘残留海盐')
  assert.equal(settled.actions[0]?.sourceType, 'chapter_draft')
  const replay = await authority.settleForeshadowActions(project.path, chapter, proposal, 'chapter_draft', 'fast-job-1')
  assert.equal(replay.actions.length, 1)

  await assert.rejects(authority.settleForeshadowActions(project.path, chapter, { ...proposal, content: '未被作者采用的另一版候选' }, 'chapter_draft', 'fast-job-2'),
    (error: { code?: string }) => error.code === 'CONFLICT')
})

test('stages autosave through the document service and promotes one merged formal version', async (context) => {
  const { project, documents } = await fixture(context)
  const before = await documents.chapter(10)
  assert.ok(before.bodyVersionId)
  const first = await documents.stageAutosave(10, {
    title: before.title,
    content: '雨声敲在窗纸上。',
    clientOperationId: '10000000-0000-4000-8000-000000000001',
    baseBodyVersionId: before.bodyVersionId,
    expectedRevision: before.revision,
    mergeWindowMs: 30_000
  })
  const second = await documents.stageAutosave(10, {
    title: before.title,
    content: '雨声敲在窗纸上，信封压着半枚铜钱。',
    clientOperationId: '10000000-0000-4000-8000-000000000002',
    baseBodyVersionId: before.bodyVersionId,
    expectedRevision: before.revision,
    mergeWindowMs: 30_000
  })
  assert.equal(second.checkpoint?.id, first.checkpoint?.id)
  assert.equal(second.merged, true)
  assert.equal((await documents.chapter(10)).content, before.content)
  assert.equal((await documents.autosaveRecoveries(10)).length, 1)

  const finalized = await documents.finalizeAutosave(second.checkpoint!.id)
  assert.equal(finalized.insertedVersion, true)
  assert.equal(finalized.chapter.content, '雨声敲在窗纸上，信封压着半枚铜钱。')
  assert.equal((await documents.autosaveRecoveries(10)).length, 0)
  assert.equal(await readFile(join(project.path, '正文', `第10章-${before.title}.md`), 'utf8'), finalized.chapter.content)
})

test('uses SQLite as chapter authority while keeping exact Markdown and order mirrors', async (context) => {
  const { project, databases, authority, documents, source, importer } = await fixture(context)
  assert.deepEqual((await documents.chapters()).map(({ id, position, storageMode, mirrorStatus }) => ({ id, position, storageMode, mirrorStatus })), [
    { id: 20, position: 1, storageMode: 'sqlite', mirrorStatus: 'synced' },
    { id: 10, position: 2, storageMode: 'sqlite', mirrorStatus: 'synced' }
  ])

  const before = await documents.chapter(10)
  const changed = await documents.updateChapter(10, {
    title: '旧城地址',
    content: '信上只有旧城地址。',
    expectedRevision: before.revision,
    reason: 'manual'
  })
  assert.equal(changed.content, '信上只有旧城地址。')
  assert.equal(changed.mirrorStatus, 'synced')
  assert.equal(await readFile(join(project.path, '正文', '第10章-旧城地址.md'), 'utf8'), changed.content)
  await assert.rejects(readFile(join(project.path, '正文', '第10章-雨夜来客.md'), 'utf8'), { code: 'ENOENT' })

  const revisions = await documents.revisions(10)
  assert.equal(revisions.length, 2)
  assert.equal(revisions[0].isCurrent, true)
  const previous = revisions.find((revision) => !revision.isCurrent)
  assert.ok(previous)
  assert.equal(previous.content, '沈砚在雨夜收到一封信。')
  assert.equal(previous.reason, 'legacy_import')
  const restored = await documents.restoreRevision(10, previous.id)
  assert.equal(restored.title, '雨夜来客')
  assert.equal(restored.content, '沈砚在雨夜收到一封信。')
  assert.equal(await readFile(join(project.path, '正文', '第10章-雨夜来客.md'), 'utf8'), restored.content)

  const reordered = await documents.reorderChapter(10, 1)
  assert.deepEqual(reordered.map((chapter) => chapter.id), [10, 20])
  assert.deepEqual(JSON.parse(await readFile(join(project.path, '.webnovel', 'manuscript', 'chapter-order.json'), 'utf8')), {
    version: 1,
    chapterIds: [10, 20]
  })

  const database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.inspect().chapters.find((chapter) => chapter.legacyChapterId === 10)?.versionCount, 3)
  database.close()
  assert.deepEqual(await authority.rollback(project.path), { storageMode: 'shadow', chapterCount: 2, verified: true })
  assert.equal((await documents.chapter(10)).storageMode, undefined)
  assert.equal((await documents.chapter(10)).content, restored.content)
  const repeatPreview = await importer.preview()
  await importer.import(repeatPreview)
  await authority.activate(project.path, await source.snapshot())
  assert.equal((await documents.chapter(10)).storageMode, 'sqlite')
})

test('names the current formal body version without duplicating or rewriting正文', async (context) => {
  const { project, databases, documents } = await fixture(context)
  const before = await documents.chapter(10)
  const databaseBefore = await databases.openExisting(project.path)
  assert.ok(databaseBefore)
  const versionCountBefore = databaseBefore.inspect().chapters.find((chapter) => chapter.legacyChapterId === 10)?.versionCount
  databaseBefore.close()

  const named = await documents.nameCurrentRevision(10, ' 第一幕定稿 ')
  assert.equal(named.label, '第一幕定稿')
  assert.equal(named.isCurrent, true)
  assert.equal(named.content, before.content)

  const revisions = await documents.revisions(10)
  assert.equal(revisions[0].id, named.id)
  assert.equal(revisions[0].label, '第一幕定稿')
  assert.equal(revisions[0].isCurrent, true)
  assert.equal((await documents.chapter(10)).revision, before.revision)

  const databaseAfter = await databases.openExisting(project.path)
  assert.ok(databaseAfter)
  assert.equal(databaseAfter.inspect().chapters.find((chapter) => chapter.legacyChapterId === 10)?.versionCount, versionCountBefore)
  databaseAfter.close()
})

test('rebuilds deleted readable mirrors from SQLite without changing正文 or overwriting external edits', async (context) => {
  const { project, databases, authority, documents } = await fixture(context)
  const chapterPath = join(project.path, '正文', '第10章-雨夜来客.md')
  const orderPath = join(project.path, '.webnovel', 'manuscript', 'chapter-order.json')
  const before = await documents.chapter(10)
  const databaseBefore = await databases.openExisting(project.path)
  assert.ok(databaseBefore)
  const versionCountBefore = databaseBefore.inspect().chapters.find((chapter) => chapter.legacyChapterId === 10)?.versionCount
  databaseBefore.close()

  await rm(chapterPath)
  await rm(orderPath)
  const rebuilt = await authority.rebuildReadableMirrors(project.path)
  assert.equal(rebuilt.recreated, 2)
  assert.equal(rebuilt.conflicts, 0)
  assert.equal(rebuilt.failed, 0)
  assert.equal(await readFile(chapterPath, 'utf8'), before.content)
  assert.deepEqual(JSON.parse(await readFile(orderPath, 'utf8')), { version: 1, chapterIds: [20, 10] })
  assert.equal((await documents.chapter(10)).revision, before.revision)

  const databaseAfter = await databases.openExisting(project.path)
  assert.ok(databaseAfter)
  assert.equal(databaseAfter.inspect().chapters.find((chapter) => chapter.legacyChapterId === 10)?.versionCount, versionCountBefore)
  databaseAfter.close()

  await writeFile(chapterPath, '外部编辑器保留的正文。', 'utf8')
  const protectedResult = await authority.rebuildReadableMirrors(project.path)
  assert.equal(protectedResult.conflicts, 1)
  assert.equal(protectedResult.failed, 0)
  assert.equal(await readFile(chapterPath, 'utf8'), '外部编辑器保留的正文。')
  assert.equal((await documents.chapter(10)).content, before.content)
})

test('retries pending Markdown mirrors when the chapter list is opened', async (context) => {
  const { project, databases, documents } = await fixture(context)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const before = database.formalChapters().find((chapter) => chapter.legacyChapterId === 10)
  assert.ok(before)
  database.writeFormalChapter({
    legacyChapterId: 10,
    title: before.title,
    content: '这次写入在镜像同步前中断。',
    reason: 'manual',
    expectedRevision: before.revision
  })
  assert.equal(database.formalChapters().find((chapter) => chapter.legacyChapterId === 10)?.mirrorStatus, 'pending')
  database.close()

  const reopened = (await documents.chapters()).find((chapter) => chapter.id === 10)
  assert.equal(reopened?.mirrorStatus, 'synced')
  assert.equal(await readFile(join(project.path, '正文', '第10章-雨夜来客.md'), 'utf8'), '这次写入在镜像同步前中断。')
})

test('outline mirror preview is read-only and adoption preserves history while rejecting replay and stale sources', async context => {
  const { project, documents, databases } = await fixture(context)
  const path = join(project.path, '大纲', '章纲', '第10章.md')
  const body = await documents.chapter(10)
  await writeFile(path, '外部章纲：收到来信，先核对地址。')
  const dbPath = join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH)
  const before = await readFile(dbPath)
  const preview = await documents.previewExternalOutlineMirror(10)
  assert.equal(preview.sqliteContent, '收到来信，决定前往旧城。')
  assert.match(preview.externalContent, /核对地址/)
  assert.deepEqual(await readFile(dbPath), before)
  await writeFile(path, '外部章纲：第二稿先向邻居确认门牌。')
  await assert.rejects(documents.adoptExternalOutlineMirror(preview.token), { code: 'CONFLICT' })
  const fresh = await documents.previewExternalOutlineMirror(10)
  const results = await Promise.allSettled([documents.adoptExternalOutlineMirror(fresh.token), documents.adoptExternalOutlineMirror(fresh.token)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  assert.equal((await documents.chapterOutline(10)).content, fresh.externalContent)
  assert.equal((await documents.chapter(10)).content, body.content)
  await assert.rejects(documents.adoptExternalOutlineMirror(fresh.token), { code: 'CONFLICT' })
  const db = await databases.openExisting(project.path)
  assert.ok(db)
  const node = db.formalOutlines().find(item => item.legacyKey === 'chapter-10')!
  db.close()
  const raw = new DatabaseSync(dbPath, { readOnly: true })
  const versions = raw.prepare('SELECT v.content,v.source_type FROM outline_versions v JOIN outline_nodes n ON n.id=v.outline_node_id WHERE n.legacy_key=? ORDER BY v.version_no').all(node.legacyKey)
  raw.close()
  assert.equal(versions.length, 2)
  assert.equal(versions[0]!.content, preview.sqliteContent)
  assert.equal(versions[1]!.source_type, 'restore')
})

test('body and outline previews reject identical or invalid content without source sidecars or writes', async context => {
  const { project, documents } = await fixture(context)
  const dbPath = join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH)
  const before = await readFile(dbPath)
  const namesBefore = (await readdir(join(project.path, '.webnovel'))).sort()
  for (const preview of [() => documents.previewExternalMirror(10), () => documents.previewExternalOutlineMirror(10)]) {
    await assert.rejects(preview(), { code: 'CONFLICT' })
    assert.deepEqual(await readFile(dbPath), before)
    assert.deepEqual((await readdir(join(project.path, '.webnovel'))).sort(), namesBefore)
  }
  await writeFile(join(project.path, '大纲', '章纲', '第10章.md'), '含空字符\u0000的无效章纲')
  await assert.rejects(documents.previewExternalOutlineMirror(10), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await readFile(dbPath), before)
  assert.deepEqual((await readdir(join(project.path, '.webnovel'))).sort(), namesBefore)
})

test('recovery previews read the WAL without touching its source and never upgrade an older schema', async context => {
  const { root, project, documents, authority } = await fixture(context)
  const path = join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH)
  const raw = new DatabaseSync(path)
  try {
    raw.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE projects SET name='WAL 核对作品';")
    await writeFile(join(project.path, '正文', '第10章-雨夜来客.md'), '外部正文。')
    await writeFile(join(project.path, '大纲', '章纲', '第10章.md'), '外部章纲。')
    const files = [path, `${path}-wal`, `${path}-shm`]
    const before = await Promise.all(files.map(file => readFile(file)))
    assert.ok(before[1]!.length > 0)
    const body = await documents.previewExternalMirror(10)
    const outline = await documents.previewExternalOutlineMirror(10)
    assert.equal(body.externalExcerpt, '外部正文。')
    assert.equal(outline.externalContent, '外部章纲。')
    assert.deepEqual(await Promise.all(files.map(file => readFile(file))), before)
    assert.equal(raw.prepare('PRAGMA user_version').get()!.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
  } finally { raw.close() }
  const oldRoot = join(root, 'old-schema')
  await mkdir(join(oldRoot, '.webnovel'), { recursive: true })
  const oldPath = join(oldRoot, WORKSPACE_DATABASE_RELATIVE_PATH)
  const old = new DatabaseSync(oldPath)
  try {
    old.exec('PRAGMA foreign_keys=ON')
    for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= 25)) {
      old.exec(migration.sql)
      old.prepare('INSERT INTO schema_migrations(version,name,applied_at,checksum) VALUES(?,?,?,?)').run(migration.version, migration.name, '2026-09-12T00:00:00.000Z', migration.checksum)
      old.exec(`PRAGMA user_version=${migration.version}`)
    }
    old.prepare("INSERT INTO projects(id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES('old-book','旧版书','active',?,'sqlite',?,?)").run('a'.repeat(64), '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z')
  } finally { old.close() }
  const oldBefore = await readFile(oldPath)
  await assert.rejects(authority.previewExternalMirror(oldRoot, 10), { code: 'UNSUPPORTED_PROJECT_VERSION' })
  assert.deepEqual(await readFile(oldPath), oldBefore)
  assert.deepEqual(await readdir(join(oldRoot, '.webnovel')), ['workspace.sqlite'])
})

test('body and outline recovery recheck expiration immediately before committing', async context => {
  const { project, documents, authority } = await fixture(context)
  await writeFile(join(project.path, '正文', '第10章-雨夜来客.md'), '外部正文。')
  await writeFile(join(project.path, '大纲', '章纲', '第10章.md'), '外部章纲。')
  const body = await documents.previewExternalMirror(10)
  const outline = await documents.previewExternalOutlineMirror(10)
  const beforeBody = (await documents.chapter(10)).bodyVersionId
  const expire = async () => { context.mock.method(Date, 'now', () => Date.parse(body.expiresAt) + 1000) }
  try { await assert.rejects(authority.adoptExternalMirror(project.path, body.token, expire), { code: 'CONFLICT' }) }
  finally { context.mock.restoreAll() }
  const expireOutline = async () => { context.mock.method(Date, 'now', () => Date.parse(outline.expiresAt) + 1000) }
  try { await assert.rejects(authority.adoptExternalOutlineMirror(project.path, outline.token, expireOutline), { code: 'CONFLICT' }) }
  finally { context.mock.restoreAll() }
  assert.equal((await documents.chapter(10)).bodyVersionId, beforeBody)
  assert.equal((await documents.chapterOutline(10)).content, outline.sqliteContent)
})

test('recovery returns a committed version when the mirror changes during commit and never applies twice', async context => {
  const { project, documents, authority } = await fixture(context)
  const bodyPath = join(project.path, '正文', '第10章-雨夜来客.md')
  await writeFile(bodyPath, '已审阅的外部正文。')
  const bodyPreview = await documents.previewExternalMirror(10)
  const bodyResult = await authority.adoptExternalMirror(project.path, bodyPreview.token, async () => { await writeFile(bodyPath, '采用同时出现的第三份正文。') })
  assert.equal(bodyResult.chapter.content, '已审阅的外部正文。')
  assert.equal(bodyResult.mirrorPending, true)
  assert.equal(await readFile(bodyPath, 'utf8'), '采用同时出现的第三份正文。')
  await assert.rejects(authority.adoptExternalMirror(project.path, bodyPreview.token), { code: 'CONFLICT' })
  const outlinePath = join(project.path, '大纲', '章纲', '第10章.md')
  await writeFile(outlinePath, '已审阅的外部章纲。')
  const preview = await documents.previewExternalOutlineMirror(10)
  const result = await authority.adoptExternalOutlineMirror(project.path, preview.token, async () => { await writeFile(outlinePath, '采用同时出现的第三份章纲。') })
  assert.equal(result.outline.content, preview.externalContent)
  assert.equal(result.mirrorPending, true)
  assert.equal(await readFile(outlinePath, 'utf8'), '采用同时出现的第三份章纲。')
  await assert.rejects(authority.adoptExternalOutlineMirror(project.path, preview.token), { code: 'CONFLICT' })
})

test('outline recovery rejects another book, a changed formal version and a failed current-book guard', async context => {
  const { project, documents, authority } = await fixture(context)
  const outlinePath = join(project.path, '大纲', '章纲', '第10章.md')
  await writeFile(outlinePath, '外部核对稿。')
  const preview = await documents.previewExternalOutlineMirror(10)
  await assert.rejects(authority.adoptExternalOutlineMirror(project.path + '-other', preview.token), { code: 'CONFLICT' })
  await assert.rejects(authority.adoptExternalOutlineMirror(project.path, preview.token, async () => { throw Object.assign(new Error('book changed'), { code: 'CONFLICT' }) }), { code: 'CONFLICT' })
  assert.equal((await documents.chapterOutline(10)).content, preview.sqliteContent)
  await documents.updateChapterOutline(10, '作者在正式编辑器保存的新章纲。')
  await assert.rejects(documents.adoptExternalOutlineMirror(preview.token), { code: 'CONFLICT' })
  assert.equal((await documents.chapterOutline(10)).content, '作者在正式编辑器保存的新章纲。')
  assert.equal(await readFile(outlinePath, 'utf8'), '外部核对稿。')
})

test('external mirror preview preserves database and mirror bytes even before drift was recorded', async (context) => {
  const { project, documents } = await fixture(context)
  const path = join(project.path, '正文', '第10章-雨夜来客.md')
  await writeFile(path, '作者在外部编辑器修改的正文。', 'utf8')
  const dbPath = join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH)
  const before = await readFile(dbPath)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const mirrors = db.prepare('SELECT * FROM mirror_entries ORDER BY id').all()
  db.close()
  const preview = await documents.previewExternalMirror(10)
  assert.match(preview.externalExcerpt, /外部编辑器/)
  const after = new DatabaseSync(dbPath, { readOnly: true })
  assert.deepEqual(after.prepare('SELECT * FROM mirror_entries ORDER BY id').all(), mirrors)
  after.close()
  assert.deepEqual(await readFile(dbPath), before)
  assert.equal(await readFile(path, 'utf8'), '作者在外部编辑器修改的正文。')
})

test('detects a changed synced Markdown mirror and adopts it only after a fresh explicit preview', async (context) => {
  const { project, documents } = await fixture(context)
  const path = join(project.path, '正文', '第10章-雨夜来客.md')
  const before = await documents.chapter(10)
  const firstExternal = '外部编辑器写下的第一份正文。'
  await writeFile(path, firstExternal, 'utf8')

  const detected = (await documents.chapters()).find((chapter) => chapter.id === 10)
  assert.equal(detected?.mirrorStatus, 'conflict')
  assert.equal(detected?.content, before.content)
  assert.equal(await readFile(path, 'utf8'), firstExternal)

  const stalePreview = await documents.previewExternalMirror(10)
  assert.equal(stalePreview.sqliteCharacterCount, before.content.length)
  assert.equal(stalePreview.externalCharacterCount, firstExternal.length)
  assert.match(stalePreview.externalExcerpt, /第一份正文/)
  assert.equal(stalePreview.externalTitle, '雨夜来客')

  const finalExternal = '外部编辑器在预览后继续写完的正文。\n\n这一段也必须完整保留。'
  await writeFile(path, finalExternal, 'utf8')
  await assert.rejects(documents.adoptExternalMirror(stalePreview.token), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal((await documents.chapter(10)).content, before.content)
  assert.equal(await readFile(path, 'utf8'), finalExternal)

  const freshPreview = await documents.previewExternalMirror(10)
  const recovered = await documents.adoptExternalMirror(freshPreview.token)
  assert.equal(recovered.previousBodyVersionId, before.bodyVersionId)
  assert.equal(recovered.chapter.content, finalExternal)
  assert.equal(recovered.chapter.mirrorStatus, 'synced')
  assert.equal(await readFile(path, 'utf8'), finalExternal)
  const revisions = await documents.revisions(10)
  assert.ok(revisions.some((revision) => revision.content === before.content && !revision.isCurrent))
  assert.equal(revisions.find((revision) => revision.isCurrent)?.reason, 'restore')
  await assert.rejects(documents.adoptExternalMirror(freshPreview.token), (error: { code?: string }) => error.code === 'CONFLICT')
})

test('never overwrites an externally changed Markdown mirror and blocks rollback until reconciled', async (context) => {
  const { project, authority, documents } = await fixture(context)
  const path = join(project.path, '正文', '第10章-雨夜来客.md')
  await writeFile(path, '外部编辑器里的新文字。', 'utf8')
  const before = await documents.chapter(10)
  const saved = await documents.updateChapter(10, {
    content: 'SQLite 中已保存的新正文。',
    expectedRevision: before.revision,
    reason: 'autosave'
  })
  assert.equal(saved.content, 'SQLite 中已保存的新正文。')
  assert.equal(saved.mirrorStatus, 'conflict')
  assert.equal(await readFile(path, 'utf8'), '外部编辑器里的新文字。')
  await assert.rejects(authority.rollback(project.path), (error: { code?: string }) => error.code === 'CONFLICT')

  await writeFile(path, saved.content, 'utf8')
  assert.deepEqual(await authority.retryMirrors(project.path), { pending: 0, conflicts: 0, failed: 0 })
  assert.deepEqual(await authority.rollback(project.path), { storageMode: 'shadow', chapterCount: 2, verified: true })
})

test('uses SQLite as outline authority and keeps readable Markdown mirrors without overwriting external edits', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  await authority.replaceCharacterAliases(project.path, { canonicalName: '沈砚', aliases: ['阿砚', '小沈'] })
  await workspace.saveRealms([{ id: 'realm-rain', name: '听雨境', description: '只能分辨十步内雨声中的异常回响。' }])
  await workspace.saveSystemTemplate('[雨夜书契]\n任务：{{quests}}')
  await workspace.saveFoundation({
    creationPath: 'materials', sourceNotes: '', worldView: '旧城的回声不能穿过城墙。', useRealms: true, useSystem: false
  })
  assert.equal((await documents.outline('total')).content, '# 总纲\n\n雨夜来信牵出旧城秘密。')
  assert.deepEqual(await documents.chapterOutline(10), { chapterId: 10, content: '收到来信，决定前往旧城。' })

  const totalPath = join(project.path, '大纲', '总纲.md')
  await writeFile(totalPath, '外部编辑器里的总纲。', 'utf8')
  assert.equal((await documents.outline('total')).content, '# 总纲\n\n雨夜来信牵出旧城秘密。')
  await documents.updateOutline('total', '# 总纲\n\nSQLite 中的新总纲。')
  assert.equal((await documents.outline('total')).content, '# 总纲\n\nSQLite 中的新总纲。')
  assert.equal(await readFile(totalPath, 'utf8'), '外部编辑器里的总纲。')
  const chapterOutlinePath = join(project.path, '大纲', '章纲', '第10章.md')
  await writeFile(chapterOutlinePath, '外部编辑器里的旧章纲。', 'utf8')
  const prosePromptContext = await workspace.promptContext(10, 'prose')
  const outlinePromptContext = await workspace.promptContext(10, 'outline')
  for (const promptContext of [prosePromptContext, outlinePromptContext]) {
    assert.match(promptContext, /SQLite 中的新总纲/)
    assert.match(promptContext, /收到来信，决定前往旧城/)
    assert.doesNotMatch(promptContext, /外部编辑器里的总纲|外部编辑器里的旧章纲/)
    assert.match(promptContext, /听雨境/)
    assert.match(promptContext, /只能分辨十步内雨声中的异常回响/)
    assert.match(promptContext, /人物别名对照/)
    assert.match(promptContext, /沈砚：小沈、阿砚/)
    assert.match(promptContext, /本书未启用系统界面；不得擅自描写系统弹窗/)
    assert.doesNotMatch(promptContext, /雨夜书契/)
  }

  await workspace.saveFoundation({
    creationPath: 'materials', sourceNotes: '', worldView: '旧城的回声不能穿过城墙。', useRealms: true, useSystem: true
  })
  const systemEnabledContext = await workspace.promptContext(10, 'prose')
  assert.match(systemEnabledContext, /\[雨夜书契\]/)
  assert.match(systemEnabledContext, /任务：\{\{quests\}\}/)
  assert.doesNotMatch(systemEnabledContext, /本书未启用系统界面/)
  assert.doesNotMatch(systemEnabledContext, /外部编辑器里的总纲|外部编辑器里的旧章纲/)
  await assert.rejects(authority.rollback(project.path), (error: { code?: string }) => error.code === 'CONFLICT')

  await writeFile(totalPath, '# 总纲\n\nSQLite 中的新总纲。', 'utf8')
  await writeFile(chapterOutlinePath, '收到来信，决定前往旧城。', 'utf8')
  assert.deepEqual(await authority.retryMirrors(project.path), { pending: 0, conflicts: 0, failed: 0 })
  await documents.updateChapterOutline(10, '来信指向旧城钟楼。')
  assert.equal(await readFile(join(project.path, '大纲', '章纲', '第10章.md'), 'utf8'), '来信指向旧城钟楼。')
  assert.deepEqual(await authority.rollback(project.path), { storageMode: 'shadow', chapterCount: 2, verified: true })
  assert.equal((await documents.outline('total')).content, '# 总纲\n\nSQLite 中的新总纲。')
})

test('persists stage outlines, chapter placement, readable mirrors, and generation context', async (context) => {
  const { project, projects, authority, documents } = await fixture(context)
  const created = await documents.createStage(1, '旧城追索')
  assert.equal(created.stage.volume, 1)
  assert.equal(created.stage.title, '旧城追索')
  assert.deepEqual(created.stage.chapterIds, [])

  const updated = await documents.updateStage(created.stage.stage, '钟楼回声', '沈砚追查来信，在旧城钟楼找到第一处回声机关。')
  assert.equal(updated.stage.content, '沈砚追查来信，在旧城钟楼找到第一处回声机关。')
  assert.equal(await readFile(join(project.path, '大纲', '阶段纲', `第${created.stage.stage}阶段-大纲.md`), 'utf8'), updated.stage.content)

  const placed = await documents.placeChapterInStage(10, created.stage.stage, 1)
  assert.notEqual(placed.stage, null)
  assert.deepEqual(placed.stage?.chapterIds, [10])
  const hierarchy = await documents.outlines()
  assert.deepEqual(hierarchy.stages?.[0], { ...updated.stage, chapterIds: [10] })

  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  for (const mode of ['full', 'fast'] as const) {
    const prompt = await workspace.promptContext(10, 'prose', { mode })
    assert.match(prompt, /当前阶段纲/)
    assert.match(prompt, /钟楼回声/)
    assert.match(prompt, /第一处回声机关/)
  }

  await assert.rejects(documents.createStage(1, '钟楼回声'), (error: { code?: string }) => error.code === 'CONFLICT')
  await documents.placeChapterInStage(10, null, 1)
  assert.deepEqual((await documents.outlines()).stages?.[0].chapterIds, [])
  assert.deepEqual(await authority.rollback(project.path), { storageMode: 'shadow', chapterCount: 2, verified: true })
})

test('archives, lists and restores deleted chapters before a safe return to file mode', async (context) => {
  const { trashRoot, project, authority, documents } = await fixture(context)
  assert.deepEqual(await documents.deleteChapter(20), { success: true, recovery: 'chapter-trash' })
  assert.deepEqual((await documents.chapters()).map((chapter) => chapter.id), [10])
  assert.equal(await readFile(join(trashRoot, '第20章-旧城回声.md'), 'utf8'), '第二天，他沿着旧城墙寻找回声。')
  assert.deepEqual((await documents.trashedChapters()).map((chapter) => [chapter.id, chapter.position, chapter.title]), [[20, 2, '旧城回声']])
  assert.deepEqual(JSON.parse(await readFile(join(project.path, '.webnovel', 'manuscript', 'chapter-order.json'), 'utf8')), {
    version: 1,
    chapterIds: [10]
  })
  const restored = await documents.restoreChapter(20)
  assert.equal(restored.content, '第二天，他沿着旧城墙寻找回声。')
  assert.equal(restored.position, 2)
  assert.deepEqual(await documents.trashedChapters(), [])
  assert.deepEqual((await documents.chapters()).map((chapter) => chapter.id), [10, 20])
  assert.deepEqual(JSON.parse(await readFile(join(project.path, '.webnovel', 'manuscript', 'chapter-order.json'), 'utf8')), {
    version: 1,
    chapterIds: [10, 20]
  })
  assert.deepEqual(await authority.rollback(project.path), { storageMode: 'shadow', chapterCount: 2, verified: true })
  assert.deepEqual((await documents.chapters()).map((chapter) => chapter.id), [10, 20])
})

test('requires a bounded one-time confirmation before formal activation', async (context) => {
  const { project, databases, authority, documents, source, importer } = await fixture(context)
  await authority.rollback(project.path)
  const sessions = new SqliteCutoverSessionService(source, importer, databases, authority, () => Promise.resolve(project.path))
  assert.equal((await sessions.status()).storageMode, 'shadow')
  const preview = await sessions.preview()
  assert.equal(preview.canActivate, true)
  assert.ok(preview.token)
  assert.equal(preview.chapterCount, 2)
  const result = await sessions.commit(preview.token!)
  assert.deepEqual(result, { storageMode: 'sqlite', chapterCount: 2, pendingMirrors: 0, conflicts: 0, verified: true })
  assert.equal((await documents.chapter(10)).storageMode, 'sqlite')
  await assert.rejects(sessions.commit(preview.token!), (error: { code?: string }) => error.code === 'CONFLICT')
})

test('links an applied writing Artifact to the explicit AI body version and rejects cross-chapter provenance', async (context) => {
  const { project, databases, documents } = await fixture(context)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const projectId = database.promptProfile().workItemId
  const baseChapter = database.formalChapters().find((item) => item.legacyChapterId === 10)!
  const checkpoint = (phase: string) => JSON.stringify({
    version: 1, phase, workItemId: projectId,
    request: { chapterId: 10, message: '继续', currentDraft: baseChapter.content }
  })
  database.createTaskRun({
    id: 'task-provenance', legacyChapterId: 10, taskType: 'writing_agent', idempotencyKey: 'operation-provenance',
    contentHash: baseChapter.contentHash, checkpointJson: checkpoint('queued')
  })
  database.transitionTaskRun({ id: 'task-provenance', status: 'running', checkpointJson: checkpoint('model') })
  const artifactContent = JSON.stringify({ candidate: 'AI 候选。' })
  const completed = database.completeTaskRunWithArtifact('task-provenance', checkpoint('approval'), {
    id: 'artifact-provenance', taskRunId: 'task-provenance', artifactType: 'writing_agent_turn', status: 'complete',
    content: artifactContent, contentHash: createHash('sha256').update(artifactContent).digest('hex'), schemaValid: true,
    metadataJson: JSON.stringify({ model: 'test' })
  })
  database.updateGenerationArtifactStatus(completed.artifact.id, 'applied', JSON.stringify({ accepted: true }))
  database.createTaskRun({
    id: 'task-partial-provenance', legacyChapterId: 10, taskType: 'writing_agent', idempotencyKey: 'operation-partial-provenance',
    contentHash: baseChapter.contentHash, checkpointJson: checkpoint('queued')
  })
  database.transitionTaskRun({ id: 'task-partial-provenance', status: 'running' })
  const partial = database.savePartialGenerationArtifact({
    id: 'artifact-partial-provenance', taskRunId: 'task-partial-provenance', artifactType: 'writing_agent_stream', status: 'partial',
    content: '中断但采用的片段。', contentHash: createHash('sha256').update('中断但采用的片段。').digest('hex'), schemaValid: true,
    metadataJson: JSON.stringify({ partial: true })
  })
  database.transitionTaskRun({ id: 'task-partial-provenance', status: 'cancelled' })
  database.updateGenerationArtifactStatus(partial.id, 'applied', JSON.stringify({ accepted: true, partial: true }))
  database.close()

  const other = await documents.chapter(20)
  await assert.rejects(documents.updateChapter(20, {
    content: `${other.content}跨章伪造。`, reason: 'ai', expectedRevision: other.revision,
    sourceTaskRunId: 'task-provenance', generationArtifactId: 'artifact-provenance'
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  const chapter = await documents.chapter(10)
  const saved = await documents.updateChapter(10, {
    content: `${chapter.content}AI 候选。`, reason: 'ai', expectedRevision: chapter.revision,
    sourceTaskRunId: 'task-provenance', generationArtifactId: 'artifact-provenance'
  })
  assert.match(saved.content, /AI 候选/)
  const partialSaved = await documents.updateChapter(10, {
    content: `${saved.content}中断但采用的片段。`, reason: 'ai', expectedRevision: saved.revision,
    sourceTaskRunId: 'task-partial-provenance', generationArtifactId: 'artifact-partial-provenance'
  })
  assert.match(partialSaved.content, /中断但采用的片段/)
  const revisions = await documents.revisions(10)
  const completeRevision = revisions.find((revision) => revision.sourceTaskRunId === 'task-provenance')
  const partialRevision = revisions.find((revision) => revision.sourceTaskRunId === 'task-partial-provenance')
  assert.equal(completeRevision?.generationArtifactId, 'artifact-provenance')
  assert.equal(partialRevision?.generationArtifactId, 'artifact-partial-provenance')
  assert.ok(revisions.filter((revision) => revision.reason !== 'ai')
    .every((revision) => revision.sourceTaskRunId === null && revision.generationArtifactId === null))

  const raw = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
  const source = raw.prepare(`
    SELECT versions.source_task_run_id, versions.generation_artifact_id FROM chapters
    JOIN body_versions versions ON versions.id = chapters.current_body_version_id
    WHERE chapters.legacy_chapter_id = 10
  `).get()
  assert.equal(source?.source_task_run_id, 'task-partial-provenance')
  assert.equal(source?.generation_artifact_id, 'artifact-partial-provenance')
  raw.close()
})

test('rebases author-approved AI output on newer SQLite prose without losing the author version or artifact provenance', async context => {
  const { project, projects, databases, documents, authority } = await fixture(context)
  const base = await documents.chapter(10)
  const task: WritingAgentTask = {
    id: 'task-rebase', workItemId: (await projects.currentSummary()).id, chapterId: 10, status: 'succeeded', attempt: 1,
    message: '继续', baseDraft: base.content, artifact: { id: 'artifact-rebase', status: 'complete' },
    turn: { id: 'turn-rebase', workItemId: (await projects.currentSummary()).id, chapterId: 10, createdAt: new Date().toISOString(), model: 'fixture',
      skill: { id: 'continue', label: '续写' }, answer: '', tools: [],
      candidate: { mode: 'append', content: 'AI 增加的结尾。', baseDraftFingerprint: createHash('sha256').update(base.content).digest('hex') } }
  }
  const db = (await databases.openExisting(project.path))!
  const projectId = db.promptProfile().workItemId
  db.createTaskRun({ id: task.id, legacyChapterId: 10, taskType: 'writing_agent', idempotencyKey: 'op-rebase', contentHash: createHash('sha256').update(base.content).digest('hex'),
    checkpointJson: JSON.stringify({ version: 1, phase: 'queued', workItemId: projectId,
      request: { chapterId: 10, message: task.message, currentDraft: base.content } }) })
  db.transitionTaskRun({ id: task.id, status: 'running', checkpointJson: '{}' })
  const content = JSON.stringify(task.turn)
  db.completeTaskRunWithArtifact(task.id, JSON.stringify({ version: 1, phase: 'approval', workItemId: projectId,
    request: { chapterId: 10, message: task.message, currentDraft: base.content } }), { id: 'artifact-rebase', taskRunId: task.id, artifactType: 'writing_agent_turn', status: 'complete', content,
    contentHash: createHash('sha256').update(content).digest('hex'), schemaValid: true, metadataJson: '{}' })
  db.close()
  const mine = await documents.updateChapter(10, { title: base.title, content: '作者新增开场。\n\n' + base.content, expectedRevision: base.revision, reason: 'manual' })
  const approval = new WritingAgentApprovalService(projects, documents, { status: async () => {
    const database = (await databases.openExisting(project.path))!
    try { return { ...task, artifact: { id: 'artifact-rebase', status: database.generationArtifactForTask(task.id, 'writing_agent_turn')!.status } } }
    finally { database.close() }
  } }, databases, async () => authority.retryMirrors(project.path))
  const input = { taskId: task.id, title: mine.title, expectedRevision: mine.revision!, formatting: { firstLineIndent: false, paragraphSpacing: true } }
  await assert.rejects(approval.apply(input), { code: 'CONFLICT' })
  await assert.rejects(approval.apply({ ...input, expectedRevision: base.revision!, rebase: { choices: {} } }), { code: 'CONFLICT' })
  assert.equal((await documents.chapter(10)).content, mine.content)
  const result = await approval.apply({ ...input, rebase: { choices: {} } })
  assert.equal(result.chapter.content, mine.content + '\n\nAI 增加的结尾。')
  assert.equal(result.task.artifact?.status, 'applied')
  const reopened = (await databases.openExisting(project.path))!
  try {
    const current = reopened.formalChapters().find(chapter => chapter.legacyChapterId === 10)!
    assert.equal(current.content, result.chapter.content)
    assert.notEqual(current.currentVersionId, mine.bodyVersionId)
    assert.match(reopened.generationArtifactForTask(task.id, 'writing_agent_turn')!.metadataJson, /rebasedFromRevision/)
  } finally { reopened.close() }
  assert.ok((await documents.revisions(10)).some(version => version.content === mine.content))
})

test('atomically applies a writing Artifact with one body version and rolls both sides back on conflict', async (context) => {
  const { project, databases } = await fixture(context)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const before = database.formalChapters().find((chapter) => chapter.legacyChapterId === 10)!
  const checkpoint = (phase: string) => JSON.stringify({ version: 1, phase, workItemId: database.promptProfile().workItemId,
    request: { chapterId: 10, message: '继续', currentDraft: before.content } })
  database.createTaskRun({
    id: 'task-atomic-application', legacyChapterId: 10, taskType: 'writing_agent', idempotencyKey: 'operation-atomic-application',
    contentHash: before.contentHash, checkpointJson: checkpoint('queued')
  })
  database.transitionTaskRun({ id: 'task-atomic-application', status: 'running', checkpointJson: checkpoint('model') })
  const artifactContent = JSON.stringify({ candidate: '原子采用候选。' })
  database.completeTaskRunWithArtifact('task-atomic-application', checkpoint('approval'), {
    id: 'artifact-atomic-application', taskRunId: 'task-atomic-application', artifactType: 'writing_agent_turn', status: 'complete',
    content: artifactContent, contentHash: createHash('sha256').update(artifactContent).digest('hex'), schemaValid: true,
    metadataJson: JSON.stringify({ model: 'test' })
  })

  assert.throws(() => database.applyWritingAgentArtifact({
    taskRunId: 'task-atomic-application', artifactId: 'artifact-atomic-application', artifactType: 'writing_agent_turn',
    legacyChapterId: 10, title: before.title, content: `${before.content}\n\n原子采用候选。`, expectedRevision: 'b'.repeat(64),
    metadataJson: JSON.stringify({ decision: 'applied' })
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(database.generationArtifactForTask('task-atomic-application', 'writing_agent_turn')?.status, 'complete')
  assert.equal(database.formalChapters().find((chapter) => chapter.legacyChapterId === 10)?.currentVersionId, before.currentVersionId)

  const applied = database.applyWritingAgentArtifact({
    taskRunId: 'task-atomic-application', artifactId: 'artifact-atomic-application', artifactType: 'writing_agent_turn',
    legacyChapterId: 10, title: before.title, content: `${before.content}\n\n原子采用候选。`, expectedRevision: before.revision,
    metadataJson: JSON.stringify({ decision: 'applied' })
  })
  assert.equal(applied.insertedVersion, true)
  assert.equal(applied.artifact.status, 'applied')
  assert.equal(JSON.parse(applied.artifact.metadataJson).appliedBodyVersionId, applied.chapter.currentVersionId)

  const retried = database.applyWritingAgentArtifact({
    taskRunId: 'task-atomic-application', artifactId: 'artifact-atomic-application', artifactType: 'writing_agent_turn',
    legacyChapterId: 10, title: before.title, content: `${before.content}\n\n原子采用候选。`, expectedRevision: before.revision,
    metadataJson: JSON.stringify({ decision: 'applied' })
  })
  assert.equal(retried.insertedVersion, false)
  assert.equal(retried.chapter.currentVersionId, applied.chapter.currentVersionId)
  assert.throws(() => database.applyWritingAgentArtifact({
    taskRunId: 'task-atomic-application', artifactId: 'artifact-atomic-application', artifactType: 'writing_agent_turn',
    legacyChapterId: 10, title: before.title, content: `${before.content}\n\n另一份内容。`, expectedRevision: applied.chapter.revision,
    metadataJson: JSON.stringify({ decision: 'applied' })
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  database.close()

  const raw = new DatabaseSync(join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
  const sourceVersions = raw.prepare('SELECT COUNT(*) AS value FROM body_versions WHERE source_task_run_id = ?').get('task-atomic-application')
  assert.equal(sourceVersions?.value, 1)
  raw.close()
})

test('matches the complete V2 critical schema and migration ledger without duplicating fact review authority', async (context) => {
  const { project } = await fixture(context)
  const databasePath = join(project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  const criticalTables = [
    'chapters', 'body_versions', 'task_runs', 'rules', 'rule_runs', 'findings', 'finding_decisions',
    'fact_batches', 'facts', 'prompt_templates', 'context_packages', 'summary_versions', 'document_chunks',
    'model_configs', 'generation_artifacts'
  ]
  const schemaRows = raw.prepare("SELECT name, type FROM sqlite_schema WHERE name IN (SELECT value FROM json_each(?))")
    .all(JSON.stringify([...criticalTables, 'fact_review_batches'])) as Array<{ name: string; type: string }>
  const schemaTypes = new Map(schemaRows.map((row) => [row.name, row.type]))
  for (const table of criticalTables) assert.equal(schemaTypes.get(table), 'table', `V2 critical table missing: ${table}`)
  assert.equal(schemaTypes.get('fact_review_batches'), 'view')
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM fact_review_batches').get()?.count,
    raw.prepare('SELECT COUNT(*) AS count FROM fact_batches').get()?.count)
  assert.throws(() => raw.prepare(`INSERT INTO fact_review_batches
    (id, project_id, chapter_id, body_version_id, content_hash, status, idempotency_key, counts_json, created_at, updated_at)
    VALUES ('forbidden-view-write', 'x', 'x', 'x', ?, 'PENDING', 'x', '{}', 'x', 'x')`).run('a'.repeat(64)), /view/)

  const bodyColumns = new Set((raw.prepare("PRAGMA table_info('body_versions')").all() as Array<{ name: string }>).map((row) => row.name))
  assert.equal(bodyColumns.has('content'), true)
  assert.equal(bodyColumns.has('content_hash'), true)
  assert.equal(bodyColumns.has('source_task_run_id'), true)
  assert.equal(bodyColumns.has('generation_artifact_id'), true)
  const taskColumns = new Set((raw.prepare("PRAGMA table_info('task_runs')").all() as Array<{ name: string }>).map((row) => row.name))
  for (const column of ['template_id', 'template_version', 'template_hash', 'input_schema_json', 'output_schema_json',
    'allowed_operations_json', 'forbidden_operations_json', 'task_contract_hash']) assert.equal(taskColumns.has(column), true, column)
  const promptColumns = new Set((raw.prepare("PRAGMA table_info('prompt_templates')").all() as Array<{ name: string }>).map((row) => row.name))
  for (const column of ['system_template', 'input_schema_json', 'output_schema_json']) assert.equal(promptColumns.has(column), true, column)
  for (const trigger of ['task_runs_contract_insert_guard', 'task_runs_contract_immutable', 'task_runs_retry_contract_guard', 'prompt_templates_contract_immutable']) {
    assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name = ?").get(trigger), trigger)
  }
  const ledger = (raw.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all() as Array<{ version: number; name: string; checksum: string }>)
    .map(({ version, name, checksum }) => ({ version, name, checksum }))
  assert.deepEqual(ledger, workspaceDatabaseMigrations.map(({ version, name, checksum }) => ({ version, name, checksum })))
  assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(raw.prepare('PRAGMA quick_check').get()?.quick_check, 'ok')
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), [])
  raw.close()
})

test('upgrades v32正文 provenance only when one exact Artifact is provable and leaves uncertain history unguessed', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v32-artifact-provenance-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'), { recursive: true })
  const databasePath = join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 32)) {
    raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
      .run(migration.version, migration.name, '2026-09-08T00:00:00.000Z', migration.checksum)
    raw.exec(`PRAGMA user_version = ${migration.version}`)
  }
  const baseContent = '作者基线。'
  const firstAiContent = `${baseContent}第一份 AI 候选。`
  const secondAiContent = `${firstAiContent}来源已经无法唯一证明。`
  const baseHash = createHash('sha256').update(baseContent).digest('hex')
  const firstHash = createHash('sha256').update(firstAiContent).digest('hex')
  const secondHash = createHash('sha256').update(secondAiContent).digest('hex')
  const checkpoint = (content: string) => JSON.stringify({ version: 1, phase: 'approval', workItemId: 'project-v32',
    request: { chapterId: 1, message: '继续', currentDraft: content } })
  raw.prepare(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at)
    VALUES ('project-v32', '来源迁移作品', 'active', ?, 'shadow', ?, ?)`).run('a'.repeat(64), '2026-09-08', '2026-09-08')
  raw.prepare(`INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, current_body_version_id, confirmed_body_version_id, created_at, updated_at)
    VALUES ('chapter-v32', 'project-v32', 1, 1, '第一章', 'draft', NULL, NULL, ?, ?)`).run('2026-09-08', '2026-09-08')
  raw.prepare(`INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id, source_type, source_task_run_id, created_at)
    VALUES ('base-v32', 'chapter-v32', 1, ?, ?, NULL, NULL, 'manual', NULL, ?)`).run(baseContent, baseHash, '2026-09-08T00:00:00.000Z')
  raw.prepare(`INSERT INTO body_version_metadata (version_id, title, reason, label) VALUES ('base-v32', '第一章', 'manual', NULL)`).run()
  raw.prepare(`UPDATE chapters SET current_body_version_id = 'base-v32' WHERE id = 'chapter-v32'`).run()

  const insertTaskAndArtifact = (taskId: string, artifactId: string, baseId: string, contentHash: string, requestContent: string) => {
    raw.prepare(`INSERT INTO task_runs (id, project_id, chapter_id, task_type, status, idempotency_key, parent_task_run_id,
      base_body_version_id, content_hash, context_package_id, model_config_id, attempt, checkpoint_json, error_code, error_message,
      started_at, ended_at, created_at, updated_at)
      VALUES (?, 'project-v32', 'chapter-v32', 'writing_agent', 'succeeded', ?, NULL, ?, ?, NULL, NULL, 1, ?, NULL, NULL, ?, ?, ?, ?)`)
      .run(taskId, `operation-${taskId}`, baseId, contentHash, checkpoint(requestContent), '2026-09-08', '2026-09-08', '2026-09-08', '2026-09-08')
    const artifactContent = JSON.stringify({ candidate: artifactId })
    raw.prepare(`INSERT INTO generation_artifacts (id, task_run_id, artifact_type, status, content, content_hash, schema_valid,
      base_body_version_id, selection_anchor_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, 'writing_agent_turn', 'applied', ?, ?, 1, ?, NULL, '{}', ?, ?)`)
      .run(artifactId, taskId, artifactContent, createHash('sha256').update(artifactContent).digest('hex'), baseId, '2026-09-08', '2026-09-08')
  }
  insertTaskAndArtifact('task-v32-exact', 'artifact-v32-exact', 'base-v32', baseHash, baseContent)
  raw.prepare(`INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id, source_type, source_task_run_id, created_at)
    VALUES ('ai-v32-exact', 'chapter-v32', 2, ?, ?, 'base-v32', NULL, 'ai', 'task-v32-exact', ?)`)
    .run(firstAiContent, firstHash, '2026-09-08T00:01:00.000Z')
  raw.prepare(`INSERT INTO body_version_metadata (version_id, title, reason, label) VALUES ('ai-v32-exact', '第一章', 'ai', NULL)`).run()
  raw.prepare(`UPDATE chapters SET current_body_version_id = 'ai-v32-exact' WHERE id = 'chapter-v32'`).run()

  insertTaskAndArtifact('task-v32-uncertain', 'artifact-v32-uncertain', 'ai-v32-exact', firstHash, firstAiContent)
  raw.prepare(`INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id, source_type, source_task_run_id, created_at)
    VALUES ('ai-v32-uncertain', 'chapter-v32', 3, ?, ?, 'ai-v32-exact', NULL, 'ai', 'task-v32-uncertain', ?)`)
    .run(secondAiContent, secondHash, '2026-09-08T00:02:00.000Z')
  raw.prepare(`INSERT INTO body_version_metadata (version_id, title, reason, label) VALUES ('ai-v32-uncertain', '第一章', 'ai', NULL)`).run()
  raw.prepare(`UPDATE generation_artifacts SET artifact_type = 'unrelated_output' WHERE id = 'artifact-v32-uncertain'`).run()
  raw.prepare(`UPDATE chapters SET current_body_version_id = 'ai-v32-uncertain' WHERE id = 'chapter-v32'`).run()
  raw.prepare('UPDATE projects SET prompt_work_item_id=? WHERE id=?').run(root, 'project-v32')
  for (const [id, status, phase] of [['legacy-paused', 'cancelled', 'paused'], ['legacy-failed', 'failed', 'failed']]) {
    raw.prepare(`INSERT INTO task_runs (id, project_id, chapter_id, task_type, status, idempotency_key, attempt, checkpoint_json, created_at, updated_at)
      VALUES (?, 'project-v32', 'chapter-v32', 'writing_agent', ?, ?, 1, ?, ?, ?)`)
      .run(id, status, id, JSON.stringify({ version: 1, phase, workItemId: root, request: { chapterId: 1, message: '继续', currentDraft: secondAiContent } }), '2026-09-08T00:03:00.000Z', '2026-09-08T00:03:00.000Z')
  }
  raw.close()

  const upgraded = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.ok(upgraded)
  const historicalTask = upgraded.taskRun('task-v32-exact')
  assert.equal(historicalTask?.taskContract.templateId, 'legacy:writing_agent')
  assert.equal(historicalTask?.taskContract.templateVersion, 0)
  assert.deepEqual(JSON.parse(historicalTask?.taskContract.allowedOperationsJson || 'null'), [])
  assert.deepEqual(JSON.parse(historicalTask?.taskContract.forbiddenOperationsJson || 'null'), ['*'])
  assert.throws(() => upgraded.createTaskRun({
    id: 'task-v34-unsafe-retry', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'operation-v34-unsafe-retry',
    parentTaskRunId: 'task-v32-exact', checkpointJson: checkpoint(baseContent)
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  const tasksBeforeList = upgraded.recentProjectTaskRuns(100)
  const migratedItems = await new TaskCenterService({ currentPath: async () => root }, new SqliteWorkspaceDatabaseFactory()).list()
  const pausedItem = migratedItems.find(item => item.id === 'legacy-paused')
  assert.equal(pausedItem?.status, 'paused')
  assert.equal(pausedItem?.hasContinuation, false)
  assert.deepEqual(pausedItem?.actions, ['view', 'cancel'])
  assert.match(pausedItem?.detail || '', /当前正文重新发起/)
  assert.deepEqual(migratedItems.find(item => item.id === 'legacy-failed')?.actions, ['view'])
  assert.deepEqual(upgraded.recentProjectTaskRuns(100), tasksBeforeList)
  upgraded.close()
  const inspected = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false })
  const rows = (inspected.prepare(`SELECT id, source_task_run_id, generation_artifact_id FROM body_versions ORDER BY version_no`).all() as Array<Record<string, unknown>>)
    .map((row) => ({ ...row }))
  assert.deepEqual(rows, [
    { id: 'base-v32', source_task_run_id: null, generation_artifact_id: null },
    { id: 'ai-v32-exact', source_task_run_id: 'task-v32-exact', generation_artifact_id: 'artifact-v32-exact' },
    { id: 'ai-v32-uncertain', source_task_run_id: 'task-v32-uncertain', generation_artifact_id: null }
  ])
  assert.equal(inspected.prepare('PRAGMA user_version').get()?.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.deepEqual(inspected.prepare('PRAGMA foreign_key_check').all(), [])
  inspected.close()
})

test('migrates a real version-one shadow database in place and backfills revision metadata', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v1-db-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const metadataRoot = join(root, '.webnovel')
  await mkdir(metadataRoot, { recursive: true })
  const databasePath = join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const database = new DatabaseSync(databasePath, { allowExtension: false })
  const v1 = workspaceDatabaseMigrations[0]
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(v1.sql)
  database.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(1, v1.name, '2026-09-01T03:00:00.000Z', v1.checksum)
  database.exec('PRAGMA user_version = 1')
  const digest = createHash('sha256').update('第一版正文。').digest('hex')
  database.prepare(`INSERT INTO projects VALUES (?, ?, 'active', ?, 'shadow', ?, ?)`).run('project-1', '旧版作品', 'a'.repeat(64), '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
  database.prepare(`INSERT INTO chapters VALUES (?, ?, 1, 1, ?, 'draft', NULL, NULL, ?, ?)`).run('chapter-1', 'project-1', '第一章', '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
  database.prepare(`INSERT INTO body_versions VALUES (?, ?, 1, ?, ?, NULL, NULL, 'legacy_import', NULL, ?)`).run('version-1', 'chapter-1', '第一版正文。', digest, '2026-09-01T03:00:00.000Z')
  database.prepare('UPDATE chapters SET current_body_version_id = ? WHERE id = ?').run('version-1', 'chapter-1')
  database.prepare(`INSERT INTO mirror_entries VALUES (?, ?, 'chapter_markdown', ?, ?, ?, ?, NULL, 'pending', NULL, ?)`).run('mirror-1', 'project-1', 'chapter-1', 'version-1', '正文/第1章-第一章.md', digest, '2026-09-01T03:00:00.000Z')
  database.close()

  const factory = new SqliteWorkspaceDatabaseFactory()
  const upgraded = await factory.openExisting(root)
  assert.ok(upgraded)
  const latestSchemaVersion = workspaceDatabaseMigrations.at(-1)!.version
  assert.equal(upgraded.inspect().schemaVersion, latestSchemaVersion)
  upgraded.close()
  const raw = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false })
  const metadata = raw.prepare('SELECT title, reason FROM body_version_metadata WHERE version_id = ?').get('version-1')
  assert.equal(metadata?.title, '第一章')
  assert.equal(metadata?.reason, 'legacy_import')
  assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, latestSchemaVersion)
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'task_runs'").get())
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'generation_artifacts'").get())
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'outline_nodes'").get())
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'rules'").get())
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'findings'").get())
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'summary_versions'").get())
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'document_chunks'").get())
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'model_configs'").get())
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'character_aliases'").get())
  raw.close()
})

test('upgrades a version-sixteen database with nullable names while preserving existing metadata', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v16-named-version-db-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'), { recursive: true })
  const databasePath = join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 16)) {
    raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, '2026-09-01T03:00:00.000Z', migration.checksum)
    raw.exec(`PRAGMA user_version = ${migration.version}`)
  }
  raw.prepare(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES (?, ?, 'active', ?, 'shadow', ?, ?)`)
    .run('project-v16', '旧版命名测试作品', 'a'.repeat(64), '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('body_version_metadata') WHERE name = 'label'").get()?.count, 0)
  raw.close()

  const upgraded = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.ok(upgraded)
  assert.equal(upgraded.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  upgraded.close()

  const inspected = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false })
  assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('body_version_metadata') WHERE name = 'label'").get()?.count, 1)
  assert.equal(inspected.prepare('PRAGMA user_version').get()?.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
  inspected.close()
})

test('upgrades version twenty-two fact changes additively without rewriting existing review history', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v22-fact-review-db-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'), { recursive: true })
  const databasePath = join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 22)) {
    raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
      .run(migration.version, migration.name, '2026-09-05T00:00:00.000Z', migration.checksum)
    raw.exec(`PRAGMA user_version = ${migration.version}`)
  }
  const content = '沈砚仍在旧城墙下。'
  const contentHash = createHash('sha256').update(content).digest('hex')
  raw.prepare(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at)
    VALUES ('project-v22', '旧事实审阅作品', 'active', ?, 'sqlite', ?, ?)`).run('a'.repeat(64), '2026-09-05', '2026-09-05')
  raw.prepare(`INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, current_body_version_id, confirmed_body_version_id, created_at, updated_at)
    VALUES ('chapter-v22', 'project-v22', 1, 1, '第一章', 'confirmed', NULL, NULL, ?, ?)`).run('2026-09-05', '2026-09-05')
  raw.prepare(`INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id, source_type, source_task_run_id, created_at)
    VALUES ('body-v22', 'chapter-v22', 1, ?, ?, NULL, NULL, 'legacy_import', NULL, ?)`).run(content, contentHash, '2026-09-05')
  raw.prepare(`UPDATE chapters SET current_body_version_id = 'body-v22', confirmed_body_version_id = 'body-v22' WHERE id = 'chapter-v22'`).run()
  raw.prepare(`INSERT INTO fact_batches (id, project_id, chapter_id, body_version_id, content_hash, status, extractor_task_run_id, idempotency_key, counts_json, created_at, updated_at)
    VALUES ('batch-v22', 'project-v22', 'chapter-v22', 'body-v22', ?, 'PENDING', NULL, 'extract-v22', '{"total":1}', ?, ?)`).run(contentHash, '2026-09-05', '2026-09-05')
  raw.prepare(`INSERT INTO fact_changes (id, batch_id, candidate_type, subject_type, subject_id, subject_json, predicate, object_json, normalized_key, evidence_json, confidence, importance, change_type, decision_status, matched_fact_id, edited_object_json, created_at, updated_at)
    VALUES ('change-v22', 'batch-v22', 'character_dynamic', 'character', NULL, ?, 'location', ?, 'character:shenyan:location', ?, NULL, 'medium', 'NEW', 'PENDING', NULL, NULL, ?, ?)`)
    .run(JSON.stringify({ name: '沈砚' }), JSON.stringify('旧城墙下'), JSON.stringify({ quote: content }), '2026-09-05', '2026-09-05')
  raw.close()

  const upgraded = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.ok(upgraded)
  assert.equal(upgraded.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  const preserved = upgraded.listFactBatches(1)[0]
  assert.equal(preserved.changes[0].reviewClass, 'reviewable')
  assert.equal(preserved.changes[0].changeType, 'NEW')
  assert.equal(JSON.parse(preserved.changes[0].objectJson), '旧城墙下')
  upgraded.close()

  const inspected = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false })
  assert.equal(inspected.prepare("SELECT review_class FROM fact_changes WHERE id = 'change-v22'").get()?.review_class, 'reviewable')
  assert.equal(inspected.prepare('PRAGMA foreign_key_check').all().length, 0)
  inspected.close()
})

test('upgrades a version twenty-four project additively for canonical event authority', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v24-events-db-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'), { recursive: true })
  const databasePath = join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 24)) {
    raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
      .run(migration.version, migration.name, '2026-09-06T00:00:00.000Z', migration.checksum)
    raw.exec(`PRAGMA user_version = ${migration.version}`)
  }
  raw.prepare(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at)
    VALUES ('project-v24', '旧素材正式作品', 'active', ?, 'sqlite', ?, ?)`).run('b'.repeat(64), '2026-09-06', '2026-09-06')
  raw.prepare(`INSERT INTO material_sources (id, project_id, provider, source_type, title, captured_at, excerpt, user_notes, content_hash)
    VALUES ('source-v24', 'project-v24', 'manual', 'manual', '旧资料', '2026-09-06', '原始摘录', '', ?)`).run('c'.repeat(64))
  raw.prepare('UPDATE projects SET material_sources_ready = 1 WHERE id = ?').run('project-v24')
  raw.close()

  const upgraded = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.ok(upgraded)
  assert.equal(upgraded.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(upgraded.listMaterialSources()[0]?.title, '旧资料')
  assert.equal(upgraded.formalCanonicalEventsReady(), false)
  upgraded.close()
  const inspected = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false })
  assert.equal(inspected.prepare('PRAGMA user_version').get()?.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('projects') WHERE name = 'canonical_events_ready'").get()?.count, 1)
  assert.ok(inspected.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'canonical_event_evidence_refs'").get())
  assert.equal(inspected.prepare('PRAGMA foreign_key_check').all().length, 0)
  inspected.close()
})

test('upgrades a version twenty-five project additively for character-state authority', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v25-character-state-db-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'), { recursive: true })
  const databasePath = join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 25)) {
    raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
      .run(migration.version, migration.name, '2026-09-06T00:00:00.000Z', migration.checksum)
    raw.exec(`PRAGMA user_version = ${migration.version}`)
  }
  raw.prepare(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at)
    VALUES ('project-v25', '旧人物状态作品', 'active', ?, 'sqlite', ?, ?)`).run('d'.repeat(64), '2026-09-06', '2026-09-06')
  raw.close()

  const upgraded = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.ok(upgraded)
  assert.equal(upgraded.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(upgraded.formalCharacterStateReady(), false)
  upgraded.close()
  const inspected = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false })
  assert.equal(inspected.prepare('PRAGMA user_version').get()?.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('projects') WHERE name = 'character_state_ready'").get()?.count, 1)
  assert.ok(inspected.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'character_state_documents'").get())
  assert.ok(inspected.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'outline_planning_state_documents'").get())
  assert.ok(inspected.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'ai_settings_documents'").get())
  assert.ok(inspected.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'workspace_config_documents'").get())
  assert.ok(inspected.prepare("SELECT name FROM sqlite_schema WHERE type = 'view' AND name = 'fact_review_batches'").get())
  assert.equal(inspected.prepare('PRAGMA foreign_key_check').all().length, 0)
  inspected.close()
})

test('upgrades version-eleven character aliases into the generic entity schema without data loss', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v11-entity-db-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'), { recursive: true })
  const databasePath = join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 11)) {
    raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, '2026-09-01T03:00:00.000Z', migration.checksum)
    raw.exec(`PRAGMA user_version = ${migration.version}`)
  }
  raw.prepare(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES (?, ?, 'active', ?, 'shadow', ?, ?)`)
    .run('project-1', '旧版别名作品', 'a'.repeat(64), '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
  raw.prepare(`INSERT INTO entities (id, project_id, entity_type, canonical_name, normalized_name, profile_json, status, created_at, updated_at) VALUES (?, ?, 'character', ?, ?, '{}', 'approved', ?, ?)`)
    .run('character-1', 'project-1', '沈砚', '沈砚', '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
  raw.prepare(`INSERT INTO character_aliases (id, project_id, character_id, alias, normalized_alias, valid_from_chapter_id, valid_to_chapter_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`)
    .run('alias-1', 'project-1', 'character-1', '阿砚', '阿砚', '2026-09-01T03:00:00.000Z')
  raw.prepare("UPDATE projects SET storage_mode = 'sqlite' WHERE id = ?").run('project-1')
  raw.close()

  const database = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.ok(database)
  assert.equal(database.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(database.listCharacterAliases()[0]?.alias, '阿砚')
  assert.equal(database.listEntities('character')[0]?.canonicalName, '沈砚')
  database.close()
})
