import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, readFile, writeFile, unlink } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { decodeIdeaGenerationArgs, decodeIdeaSaveArgs, decodeOutlineExpansionArgs, decodePlanningOutlineKeyArgs, decodePlannedChapterUpdateArgs, decodePlannedChapterStartArgs } from '../../../src/contracts/ipc'
import type { IdeaGenerationInput } from '../../../src/contracts/index'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { IdeaGenerationService, parseIdeaGeneration } from '../../../src/main/modules/planning/application/idea-generation-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { PlanningDraftService } from '../../../src/main/modules/planning/application/planning-draft-service'
import { OutlineExpansionTaskService } from '../../../src/main/modules/planning/application/outline-expansion-task-service'
import { OutlineExpansionAdoptionService } from '../../../src/main/modules/planning/application/outline-expansion-adoption-service'
import { OutlinePlanningService } from '../../../src/main/modules/planning/application/outline-planning-service'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { StructuredResponseFailure } from '../../../src/main/modules/assistant/application/structured-response-repair'

const output = JSON.stringify({ options: [{ title: '会吐槽的钟楼', content: '钟楼偏偏记住男主最尴尬的一句谎话。', rationale: '用反差制造冲突。' }] })

test('hybrid upgraded storage reserves authoritative Markdown outlines without migrating them', async (t) => {
  const { projects, project, databases, authority } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  const raw = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'))
  try { raw.exec('UPDATE projects SET outline_storage_ready = 0') } finally { raw.close() }
  assert.equal(await authority.active(project.path), true)
  assert.equal(await authority.outlineActive(project.path), false)
  await documents.updateChapterOutline(82, '仍以 Markdown 为正式章纲。')
  const file = join(project.path, '大纲', '章纲', '第82章.md')
  const original = await readFile(file)
  const created = await documents.createChapter()
  assert.equal(created.id, 83)
  assert.equal(created.content, '')
  assert.deepEqual(await readFile(file), original)
  assert.equal(await authority.outlineActive(project.path), false)
  const db = (await databases.openExisting(project.path))!
  try {
    const before = db.formalChapters()
    for (const invalid of [0, -1, 1.2, Number.NaN, 1_000_001]) assert.throws(() => db.createFormalChapter(invalid))
    assert.deepEqual(db.formalChapters(), before)
    db.writeFormalChapter({ legacyChapterId: 90, title: '回收稿', content: '保留历史。', reason: 'manual' })
    db.archiveFormalChapter(90)
    assert.equal((await documents.createChapter()).id, 91)
    await documents.updateChapterOutline(1_000_000, '已占用最后支持身份。')
    const bodies = db.formalChapters()
    await assert.rejects(documents.createChapter(), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.deepEqual(db.formalChapters(), bodies)
  } finally { db.close() }
})

test('new manuscript identities reserve independent and archived outlines and serialize allocation', async (t) => {
  const { projects, project, databases, authority } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '总纲。')
  const db = (await databases.openExisting(project.path))!
  const raw = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'))
  try {
    db.writeFormalChapter({ legacyChapterId: 7, title: '回收站稿', content: '仍应保留。', reason: 'manual' })
    db.archiveFormalChapter(7)
    db.writeFormalOutline({ legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume', seq: 1, title: '卷', content: '卷纲。' })
    for (const id of [15, 21]) db.writeFormalOutline({ legacyKey: `chapter-${id}`, parentLegacyKey: 'volume-1', nodeType: 'chapter', seq: id, title: `章纲${id}`, content: '尚未开始正文。' })
    raw.prepare("UPDATE outline_nodes SET status = 'archived' WHERE legacy_key = 'chapter-21'").run()
    const outlines = db.formalOutlines()
    const before = raw.prepare('SELECT COUNT(*) AS count FROM chapters').get()!.count
    raw.exec("CREATE TRIGGER test_allocate_failure BEFORE INSERT ON body_versions BEGIN SELECT RAISE(ABORT, 'allocation failure'); END")
    try {
      assert.throws(() => db.createFormalChapter())
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM chapters').get()!.count, before)
    } finally { raw.exec('DROP TRIGGER test_allocate_failure') }
    const created = await Promise.all([documents.createChapter(), documents.createChapter()])
    assert.deepEqual(created.map(chapter => chapter.id).sort((a, b) => a - b), [22, 23])
    assert.deepEqual(created.map(chapter => chapter.content), ['', ''])
    assert.deepEqual(db.formalOutlines(), outlines)
    assert.equal(db.formalChapters().some(chapter => [7, 15, 21].includes(chapter.legacyChapterId)), false)
    const nextConnection = (await databases.openExisting(project.path))!
    try { assert.equal(nextConnection.createFormalChapter().chapter.legacyChapterId, 24) } finally { nextConnection.close() }
    assert.equal(raw.prepare("SELECT status FROM chapters WHERE legacy_chapter_id = 7").get()!.status, 'archived')
  } finally { raw.close(); db.close() }
})

test('file-mode new manuscripts reserve outline and deleted-chapter history identities', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-file-create-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'settings'), { available: () => true, encrypt: text => text, decrypt: text => text })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '文件模式新建测试', genre: '轻小说' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '原稿', content: '不能覆盖。' })
  await documents.updateChapterOutline(8, '只有章纲。')
  await mkdir(join(project.path, '.webnovel', 'history', 'chapters', '12'), { recursive: true })
  const created = await Promise.all([documents.createChapter(), documents.createChapter()])
  assert.deepEqual(created.map(chapter => chapter.id).sort((a, b) => a - b), [13, 14])
  assert.equal((await documents.chapter(1)).content, '不能覆盖。')
  assert.equal((await documents.chapterOutline(8)).content, '只有章纲。')
})

test('planned manuscript handoff recovers interruption and never reapplies an author-unassigned volume', async (t) => {
  const { projects, project, databases, authority } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  const research = new ResearchLibraryService(projects)
  let planning = new OutlinePlanningService(projects, documents, research)
  await documents.updateOutline('total', '总纲。')
  const db = (await databases.openExisting(project.path))!
  try {
    db.writeFormalOutline({ legacyKey: 'volume-2', parentLegacyKey: 'total', nodeType: 'volume', seq: 2, title: '第二卷', content: '第二卷故事。' })
    db.writeFormalOutline({ legacyKey: 'stage-4', parentLegacyKey: 'volume-2', nodeType: 'stage', seq: 4, title: '钟楼', content: '阶段。' })
    for (const id of [91, 92]) db.writeFormalOutline({ legacyKey: `chapter-${id}`, parentLegacyKey: 'stage-4', nodeType: 'chapter', seq: id, title: `回声${id}`, content: '保存的章纲。' })
    const input = { chapterId: 91, expectedRevision: (await documents.getPlannedChapter(91)).revision }
    const start = documents.startPlannedChapter.bind(documents)
    documents.startPlannedChapter = async (...args) => {
      await start(...args)
      throw new Error('simulate process loss after SQLite commit')
    }
    await assert.rejects(planning.startPlannedChapter(input))
    const file = join(project.path, '.webnovel', 'planning', 'outline-state.json')
    const pending = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(pending.manuscriptStarts[0].completed, false)
    assert.equal(pending.chapterPlacements.length, 0)
    db.writeFormalChapter({ legacyChapterId: 91, title: '已经写了', content: '正文仍然保留。', reason: 'manual' })
    documents.startPlannedChapter = start
    planning = new OutlinePlanningService(projects, documents, research)
    const replay = await planning.startPlannedChapter(input)
    assert.equal(replay.created, false)
    assert.equal(replay.chapter.content, '正文仍然保留。')
    assert.equal((await planning.status(91)).chapterPlacements.find(item => item.chapterId === 91)!.volume, 2)
    assert.equal((await documents.getPlannedChapter(91)).stage, 4)
    await planning.placeChapter(91, null)
    await planning.startPlannedChapter(input)
    assert.equal((await planning.status(91)).chapterPlacements.some(item => item.chapterId === 91), false)
    const second = { chapterId: 92, expectedRevision: (await documents.getPlannedChapter(92)).revision }
    documents.startPlannedChapter = async (...args) => { await start(...args); throw new Error('interrupted') }
    await assert.rejects(planning.startPlannedChapter(second))
    documents.startPlannedChapter = start
    await planning.placeChapter(92, null) // An explicit no-op must also cancel the pending automatic placement.
    await planning.startPlannedChapter(second)
    assert.equal((await planning.status(92)).chapterPlacements.some(item => item.chapterId === 92), false)
    await assert.rejects(documents.startPlannedChapter(input, 'different-work-item'), (error: { code?: string }) => error.code === 'CONFLICT')
    const ledger = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...ledger, manuscriptStarts: null }), 'utf8')
    await assert.rejects(planning.startPlannedChapter(input), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
  } finally { db.close() }
})

test('starting a planned manuscript accepts only identity and revision', () => {
  const input = { chapterId: 9, expectedRevision: 'a'.repeat(64) }
  assert.deepEqual(decodePlannedChapterStartArgs([input]), [input])
  for (const patch of [{ chapterId: 0 }, { chapterId: 1.5 }, { expectedRevision: '' }, { expectedRevision: 'A'.repeat(64) }, { title: 'override' }, { content: 'override' }, { path: '../outside' }]) {
    assert.throws(() => decodePlannedChapterStartArgs([{ ...input, ...patch }]))
  }
  assert.throws(() => decodePlannedChapterStartArgs([input, input]))
})

test('explicit manuscript start is atomic, retry-safe and preserves its source outline', async (t) => {
  const { projects, project, databases, authority } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '总纲。')
  const db = (await databases.openExisting(project.path))!
  const raw = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'))
  try {
    db.writeFormalOutline({ legacyKey: 'volume-2', parentLegacyKey: 'total', nodeType: 'volume', seq: 2, title: '第二卷', content: '卷纲。' })
    db.writeFormalOutline({ legacyKey: 'stage-4', parentLegacyKey: 'volume-2', nodeType: 'stage', seq: 4, title: '钟楼', content: '阶段。' })
    db.writeFormalOutline({ legacyKey: 'chapter-9', parentLegacyKey: 'stage-4', nodeType: 'chapter', seq: 9, title: '回声', content: '保存的章纲。', planning: { metadataJson: '{"sourceTaskId":"original-source"}' } })
    const source = await documents.getPlannedChapter(9)
    const originalNode = db.formalOutlines().find(node => node.legacyKey === 'chapter-9')!
    const originalBodies = db.formalChapters()
    await assert.rejects(documents.startPlannedChapter({ chapterId: 9, expectedRevision: '0'.repeat(64) }), (error: { code?: string }) => error.code === 'CONFLICT')
    await assert.rejects(documents.startPlannedChapter({ chapterId: 999, expectedRevision: source.revision }))
    assert.deepEqual(db.formalChapters(), originalBodies)
    const counts = () => Object.fromEntries(['chapters', 'body_versions', 'chapter_workflows', 'mirror_entries'].map(table => [table, raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count]))
    const before = counts()
    raw.exec("CREATE TRIGGER test_start_failure BEFORE INSERT ON body_versions BEGIN SELECT RAISE(ABORT, 'test injected failure'); END")
    try {
      assert.throws(() => db.startChapterFromOutline(9, source.revision))
      assert.deepEqual(counts(), before)
      assert.deepEqual(db.formalChapters(), originalBodies)
    } finally { raw.exec('DROP TRIGGER test_start_failure') }
    const started = await documents.startPlannedChapter({ chapterId: 9, expectedRevision: source.revision })
    assert.equal(started.created, true)
    assert.equal(started.chapter.id, 9)
    assert.equal(started.chapter.title, '回声')
    assert.equal(started.chapter.content, '')
    assert.equal(started.mirrorPending, false)
    db.writeFormalChapter({ legacyChapterId: 9, title: '作者的新标题', content: '作者已经写下的正文。', reason: 'manual' })
    const versions = counts().body_versions
    const replay = await documents.startPlannedChapter({ chapterId: 9, expectedRevision: source.revision })
    assert.equal(replay.created, false)
    assert.equal(replay.chapter.content, '作者已经写下的正文。')
    assert.equal(replay.chapter.title, '作者的新标题')
    assert.equal(counts().body_versions, versions)
    const node = db.formalOutlines().find(item => item.legacyKey === 'chapter-9')!
    for (const key of ['content', 'revision', 'parentLegacyKey', 'planning'] as const) assert.deepEqual(node[key], originalNode[key])
    db.archiveFormalChapter(9)
    await assert.rejects(documents.startPlannedChapter({ chapterId: 9, expectedRevision: source.revision }), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.equal(db.formalChapters().some(chapter => chapter.legacyChapterId === 9), false)
    assert.equal(counts().body_versions, versions)
    db.writeFormalOutline({ legacyKey: 'chapter-10', parentLegacyKey: 'stage-4', nodeType: 'chapter', seq: 10, title: '后续', content: '' })
    const empty = await documents.getPlannedChapter(10)
    await assert.rejects(documents.startPlannedChapter({ chapterId: 10, expectedRevision: empty.revision }), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.equal(counts().body_versions, versions)
    const filled = await documents.updatePlannedChapter({ chapterId: 10, title: '后续', content: '下一章的事件。', expectedRevision: empty.revision })
    const mirrorPath = join(project.path, '正文', '第10章-后续.md')
    await mkdir(join(project.path, '正文'), { recursive: true })
    await writeFile(mirrorPath, '作者外部文件，不能覆盖。', 'utf8')
    const pending = await documents.startPlannedChapter({ chapterId: 10, expectedRevision: filled.revision })
    assert.equal(pending.created, true)
    assert.equal(pending.mirrorPending, true)
    assert.equal(pending.chapter.content, '')
    assert.equal(await readFile(mirrorPath, 'utf8'), '作者外部文件，不能覆盖。')
    assert.equal((await documents.startPlannedChapter({ chapterId: 10, expectedRevision: filled.revision })).created, false)
    assert.equal(await readFile(mirrorPath, 'utf8'), '作者外部文件，不能覆盖。')
  } finally { raw.close(); db.close() }
})

test('standalone outline IPC requires a stable chapter identity and explicit revision, not paths or placement', () => {
  const input = { chapterId: 9, title: '旧街回声', content: '作者修改。', expectedRevision: 'a'.repeat(64) }
  assert.deepEqual(decodePlannedChapterUpdateArgs([input]), [input])
  for (const patch of [{ chapterId: -1 }, { chapterId: 1.5 }, { title: '  ' }, { title: 'x'.repeat(201) }, { expectedRevision: '' }, { content: 3 }, { path: '../outside' }, { volume: 3 }]) {
    assert.throws(() => decodePlannedChapterUpdateArgs([{ ...input, ...patch }]))
  }
  assert.throws(() => decodePlannedChapterUpdateArgs([input, 'extra']))
})

test('independent chapter outlines list, read and save without manuscripts, preserving hierarchy and provenance', async (t) => {
  const { projects, project, databases, authority } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '总纲。')
  const db = (await databases.openExisting(project.path))!
  try {
    db.writeFormalOutline({ legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume', seq: 1, title: '第一卷', content: '卷纲。' })
    db.writeFormalOutline({ legacyKey: 'stage-1', parentLegacyKey: 'volume-1', nodeType: 'stage', seq: 1, title: '校园日常', content: '阶段。' })
    db.writeFormalOutline({ legacyKey: 'chapter-9', parentLegacyKey: 'stage-1', nodeType: 'chapter', seq: 9, title: '旧街回声', content: '章纲初稿。', planning: { metadataJson: '{"sourceTaskId":"original-source","events":[]}' } })
    const manuscripts = db.formalChapters()
    const list = await documents.outlines()
    const entry = list.chapterOutlines!.find(item => item.chapterId === 9)!
    assert.equal(entry.hasManuscript, false)
    assert.equal(entry.volume, 1)
    assert.equal(entry.stage, 1)
    assert.equal('content' in entry, false)
    const opened = await documents.getPlannedChapter(9)
    assert.equal(opened.content, '章纲初稿。')
    const updated = await documents.updatePlannedChapter({ chapterId: 9, title: '钟楼回声', content: '作者新稿\n含两个自然段。', expectedRevision: opened.revision })
    assert.notEqual(updated.revision, opened.revision)
    assert.equal(updated.title, '钟楼回声')
    assert.equal(updated.stage, 1)
    const saved = db.formalOutlines().find(node => node.legacyKey === 'chapter-9')!
    assert.equal(JSON.parse(saved.planning.metadataJson).sourceTaskId, 'original-source')
    assert.equal(await readFile(join(project.path, saved.mirrorRelativePath), 'utf8'), updated.content)
    assert.deepEqual(db.formalChapters(), manuscripts)
    await assert.rejects(documents.updatePlannedChapter({ chapterId: 9, title: '过期', content: '不能覆盖', expectedRevision: opened.revision }), (error: { code?: string }) => error.code === 'CONFLICT')
    await assert.rejects(documents.getPlannedChapter(999))
    await assert.rejects(documents.updatePlannedChapter({ chapterId: 999, title: '不可凭空创建', content: '', expectedRevision: updated.revision }))
    assert.equal((await documents.getPlannedChapter(9)).content, updated.content)
    assert.equal((await documents.outlines()).chapterOutlines!.length, 1)
    // External Markdown edits stay untouched; SQLite remains authoritative and reports the conflict.
    await writeFile(join(project.path, saved.mirrorRelativePath), '作者外部修改', 'utf8')
    const conflicted = await documents.updatePlannedChapter({ chapterId: 9, title: updated.title, content: '数据库新稿', expectedRevision: updated.revision })
    assert.equal(conflicted.mirrorStatus, 'conflict')
    assert.equal(await readFile(join(project.path, saved.mirrorRelativePath), 'utf8'), '作者外部修改')
    assert.deepEqual(db.formalChapters(), manuscripts)
    db.writeFormalChapter({ legacyChapterId: 9, title: '已有正文', content: '作者已开始写这一章。', reason: 'manual' })
    assert.equal((await documents.getPlannedChapter(9)).hasManuscript, true)
    const body = db.formalChapters()
    await assert.rejects(documents.updatePlannedChapter({ chapterId: 9, title: '旧独立编辑器', content: '不能继续提交', expectedRevision: conflicted.revision }), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.deepEqual(db.formalChapters(), body)
    assert.equal((await documents.getPlannedChapter(9)).content, '数据库新稿')
  } finally { db.close() }
})

async function adoptionFixture(t: TestContext) {
  const base = await fixture(t)
  const documents = new DocumentService(base.projects, undefined, base.authority)
  await documents.updateOutline('total', '主角追查钟楼回声。')
  const workspace = new WorkspaceService(base.projects, undefined, undefined, documents, undefined, undefined, base.authority)
  const parent = (await workspace.planningOutline('total'))!
  const tasks = new OutlineExpansionTaskService(base.projects, base.databases, {
    expandNextLayer: async () => ({ id: randomUUID(), createdAt: new Date().toISOString(), source: parent, sourceStale: false,
      methodVersion: 'story-v2-direct-chapter', childType: 'volume',
      children: [{ title: '旧街回声', content: '追索线索。', events: [{ time: '翌日', characters: ['主角'], location: '钟楼', event: '发现线索并出发。' }] }] })
  }, key => workspace.planningOutline(key), async () => 'test')
  const task = await tasks.start({ operationId: randomUUID(), parentKey: 'total', expectedRevision: parent.revision, count: 1, instruction: '' })
  assert.equal((await expansionTerminal(tasks, task.id)).status, 'succeeded')
  await base.authority.retryMirrors(base.project.path)
  const adoption = new OutlineExpansionAdoptionService(base.projects, base.databases, key => workspace.planningOutline(key), root => base.authority.retryMirrors(root))
  return { ...base, documents, workspace, tasks, task, adoption }
}

test('failed outline expansion preserves the first invalid model result as an inspectable artifact', async (t) => {
  const base = await fixture(t)
  const documents = new DocumentService(base.projects, undefined, base.authority)
  await documents.updateOutline('total', '主角追查钟楼回声。')
  const workspace = new WorkspaceService(base.projects, undefined, undefined, documents, undefined, undefined, base.authority)
  const parent = (await workspace.planningOutline('total'))!
  const original = '模型返回了无法解析、但作者仍可能需要查看的原文。'
  const tasks = new OutlineExpansionTaskService(base.projects, base.databases, {
    expandNextLayer: async () => { throw new StructuredResponseFailure('结构化结果失败，原始结果已保留。', original, '仍然无效', 1) }
  }, key => workspace.planningOutline(key), async () => 'test')
  const started = await tasks.start({ operationId: randomUUID(), parentKey: 'total', expectedRevision: parent.revision, count: 1, instruction: '' })
  const failed = await expansionTerminal(tasks, started.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.rawResult, original)
  assert.match(failed.error || '', /原始结果已保留/)
  const db = (await base.databases.openExisting(base.project.path))!
  try {
    const artifact = db.generationArtifactForTask(started.id, 'outline_expansion')!
    assert.equal(artifact.status, 'invalid')
    assert.equal(artifact.schemaValid, false)
    assert.equal(artifact.content, original)
  } finally { db.close() }
})

test('explicit expansion preview is zero-write and adoption durably links candidate, nodes and mirrors', async (t) => {
  const { project, databases, adoption, task, tasks, authority } = await adoptionFixture(t)
  const db = (await databases.openExisting(project.path))!
  try {
    const before = db.formalOutlines()
    const manuscripts = db.formalChapters()
    const candidatePath = join(project.path, '.webnovel/planning/expansions', `${task.id}.json`)
    const candidateBefore = await readFile(candidatePath, 'utf8')
    const preview = await adoption.preview(task.id)
    assert.equal(preview.children[0].key, 'volume-1')
    assert.match(preview.children[0].content, /追索线索。/)
    assert.doesNotMatch(preview.children[0].content, /时间：|人物：|地点：|事件与结果：/)
    assert.deepEqual((await tasks.status(task.id)).proposal?.children[0].events,[{time:'翌日',characters:['主角'],location:'钟楼',event:'发现线索并出发。'}])
    assert.deepEqual(db.formalOutlines(), before)
    assert.equal(await readFile(candidatePath, 'utf8'), candidateBefore)
    assert.equal(db.generationArtifactForTask(task.id, 'outline_expansion')!.status, 'complete')
    const result = await adoption.adopt(preview.token)
    assert.deepEqual(result, { keys: ['volume-1'], mirrorPending: false })
    const node = db.formalOutlines().find(item => item.legacyKey === 'volume-1')!
    assert.equal(node.content, preview.children[0].content)
    assert.equal(JSON.parse(node.planning.metadataJson).sourceTaskId, task.id)
    assert.deepEqual(db.formalChapters(), manuscripts)
    assert.deepEqual(db.formalOutlines()[0], before[0])
    assert.deepEqual((await tasks.recent())[0].adoptedKeys, ['volume-1'])
    assert.deepEqual(JSON.parse(await readFile(candidatePath, 'utf8')).adoption.keys, ['volume-1'])
    assert.equal(await readFile(join(project.path, node.mirrorRelativePath), 'utf8'), node.content)
    await assert.rejects(adoption.adopt(preview.token))
    await assert.rejects(adoption.preview(task.id))
    const reopened = (await databases.openExisting(project.path))!
    try { assert.equal(reopened.generationArtifactForTask(task.id, 'outline_expansion')!.status, 'applied') }
    finally { reopened.close() }
    assert.equal(db.formalOutlines().length, 2)
    assert.deepEqual(await authority.retryMirrors(project.path), { pending: 0, conflicts: 0, failed: 0 })
  } finally { db.close() }
})

test('expansion confirmation rejects changed parent, directory, expiry and cross-book without writes', async (t) => {
  const { project, databases, adoption, task, documents } = await adoptionFixture(t)
  const preview = await adoption.preview(task.id)
  await documents.updateOutline('total', '父稿已修改。')
  await assert.rejects(adoption.adopt(preview.token))
  await documents.updateOutline('total', '主角追查钟楼回声。')
  // A content restore can have a new revision; use a separate fresh fixture for directory/expiry checks.
  const fresh = await adoptionFixture(t)
  const directoryPreview = await fresh.adoption.preview(fresh.task.id)
  const db = (await databases.openExisting(fresh.project.path))!
  try { db.writeFormalOutline({ legacyKey: 'volume-9', parentLegacyKey: 'total', nodeType: 'volume', seq: 9, title: '作者原卷', content: '保留。' }) }
  finally { db.close() }
  await assert.rejects(fresh.adoption.adopt(directoryPreview.token))
  const newPreview = await fresh.adoption.preview(fresh.task.id)
  assert.equal(newPreview.children[0].key, 'volume-10')
  let clock = 100
  let activeRoot = fresh.project.path
  const timed = new OutlineExpansionAdoptionService({ currentPath: async () => activeRoot }, fresh.databases,
    key => fresh.workspace.planningOutline(key), root => fresh.authority.retryMirrors(root), () => clock)
  const expired = await timed.preview(fresh.task.id)
  clock += 15 * 60_000
  await assert.rejects(timed.adopt(expired.token))
  const foreign = await timed.preview(fresh.task.id)
  activeRoot = project.path
  await assert.rejects(timed.adopt(foreign.token))
  const checked = (await fresh.databases.openExisting(fresh.project.path))!
  try { assert.deepEqual(checked.formalOutlines().map(node => node.legacyKey), ['total', 'volume-9']) }
  finally { checked.close() }
})

test('mirror failure after expansion adoption reports pending and cannot cause duplicate adoption', async (t) => {
  const { projects, project, databases, workspace, task, authority } = await adoptionFixture(t)
  const service = new OutlineExpansionAdoptionService(projects, databases, key => workspace.planningOutline(key), async () => { throw new Error('file unavailable') })
  const preview = await service.preview(task.id)
  assert.deepEqual(await service.adopt(preview.token), { keys: ['volume-1'], mirrorPending: true })
  await assert.rejects(service.preview(task.id))
  assert.deepEqual(await authority.retryMirrors(project.path), { pending: 0, conflicts: 0, failed: 0 })
})

test('failed batch adoption keeps its artifact unapplied and leaves no provenance or mirror fragments', async (t) => {
  const { databases, project, task } = await adoptionFixture(t)
  const db = (await databases.openExisting(project.path))!
  try {
    const parent = db.formalOutlines()[0]
    const artifact = db.generationArtifactForTask(task.id, 'outline_expansion')!
    const candidatePath = join(project.path, '.webnovel/planning/expansions', `${task.id}.json`)
    const before = await readFile(candidatePath, 'utf8')
    const child = { legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume' as const, seq: 1, title: '回声', content: '追查。' }
    assert.throws(() => db.appendFormalOutlineChildren({ parentLegacyKey: 'total', expectedParentRevision: parent.revision, expectedChildKeys: [],
      adoption: { taskId: task.id, artifactId: artifact.id, artifactHash: artifact.contentHash },
      children: [child, { ...child, legacyKey: 'volume-2', seq: 2, title: '' }] }))
    assert.deepEqual(db.formalOutlines(), [parent])
    assert.deepEqual(db.generationArtifactForTask(task.id, 'outline_expansion'), artifact)
    assert.equal(await readFile(candidatePath, 'utf8'), before)
    assert.deepEqual(db.reservedOutlineKeys(), ['total'])
  } finally { db.close() }
})

test('next-layer adoption transaction preserves author nodes and rolls back every partial write', async (t) => {
  const { projects, databases, authority, project } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '钟楼失声，主角寻找回声。')
  const db = (await databases.openExisting(project.path))!
  try {
  const parent = db.formalOutlines()[0]
  const manuscripts = db.formalChapters()
  const child = (seq: number) => ({ legacyKey: `volume-${seq}`, parentLegacyKey: 'total', nodeType: 'volume' as const, seq, title: `第${seq}卷`, content: `卷${seq}：追查回声。` })
  const input = { parentLegacyKey: 'total', expectedParentRevision: parent.revision, expectedChildKeys: [] as string[], children: [child(1), child(2)] }
  const inspect = () => {
    const raw = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'))
    try { return ['outline_nodes', 'outline_versions', 'mirror_entries'].map(table => Number(raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count)) }
    finally { raw.close() }
  }
  const before = inspect()
  // The second write fails after the first node/version/mirror have been inserted.
  assert.throws(() => db.appendFormalOutlineChildren({ ...input, children: [child(1), { ...child(2), title: '' }] }))
  assert.deepEqual(inspect(), before)
  assert.deepEqual(db.formalOutlines(), [parent])
  assert.throws(() => db.appendFormalOutlineChildren({ ...input, expectedParentRevision: 'a'.repeat(64) }))
  assert.throws(() => db.appendFormalOutlineChildren({ ...input, children: [child(1), child(1)] }))
  assert.throws(() => db.appendFormalOutlineChildren({ ...input, children: [{ ...child(1), nodeType: 'stage', legacyKey: 'stage-1' }] }))
  assert.deepEqual(inspect(), before)
  const adopted = db.appendFormalOutlineChildren(input)
  assert.deepEqual(adopted.map(node => node.legacyKey), ['volume-1', 'volume-2'])
  assert.equal(adopted.every(node => node.parentLegacyKey === 'total'), true)
  assert.deepEqual(db.formalOutlines()[0], parent)
  assert.deepEqual(db.formalChapters(), manuscripts)
  const after = inspect()
  // A stale preview and an attempted overwrite both fail without appending versions.
  assert.throws(() => db.appendFormalOutlineChildren({ ...input, children: [child(3)] }))
  assert.throws(() => db.appendFormalOutlineChildren({ ...input, expectedChildKeys: ['volume-1', 'volume-2'] }))
  assert.deepEqual(inspect(), after)
  await authority.retryMirrors(project.path)
  for (const node of adopted) assert.equal(await readFile(join(project.path, node.mirrorRelativePath), 'utf8'), node.content)
  const raw = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'))
  try { raw.prepare("UPDATE outline_nodes SET status = 'archived' WHERE legacy_key = 'volume-2'").run() }
  finally { raw.close() }
  // An archived identity is still reserved, even though it is no longer in the visible tree.
  assert.throws(() => db.appendFormalOutlineChildren({ ...input, expectedChildKeys: ['volume-1'], children: [child(2)] }))
  assert.deepEqual(inspect(), after)
  assert.deepEqual(db.formalOutlines().map(node => node.legacyKey), ['total', 'volume-1'])
  } finally { db.close() }
})

test('next-layer adoption supports volume to stage to chapter without creating manuscript rows', async (t) => {
  const { projects, databases, authority, project } = await fixture(t)
  await new DocumentService(projects, undefined, authority).updateOutline('total', '寻找回声。')
  const db = (await databases.openExisting(project.path))!
  try {
  const manuscripts = db.formalChapters()
  let parent = db.formalOutlines()[0]
  for (const nodeType of ['volume', 'stage', 'chapter'] as const) {
    const result = db.appendFormalOutlineChildren({ parentLegacyKey: parent.legacyKey, expectedParentRevision: parent.revision, expectedChildKeys: [],
      children: [{ legacyKey: `${nodeType}-1`, parentLegacyKey: parent.legacyKey, nodeType, seq: 1, title: '回声线索', content: '第一日，主角在旧街发现线索。', planning: { metadataJson: JSON.stringify({ events: [{ time: '第一日', characters: ['主角'], location: '旧街', event: '发现线索。' }] }) } }] })
    assert.equal(result[0].parentLegacyKey, parent.legacyKey)
    assert.equal(JSON.parse(result[0].planning.metadataJson).events[0].location, '旧街')
    parent = result[0]
  }
  assert.deepEqual(db.formalChapters(), manuscripts)
  assert.equal(db.formalOutlines().length, 4)
  assert.throws(() => db.appendFormalOutlineChildren({ parentLegacyKey: parent.legacyKey, expectedParentRevision: parent.revision, expectedChildKeys: [], children: [] }))
  } finally { db.close() }
})

test('runs the complete approved idea to setting, summary, volume and direct chapter-outline chain', async (t) => {
  const { projects, databases, authority, project, idea } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  const approvedSetting = await authority.saveIdea(project.path, { ...idea, status: 'approved' })
  const promotedSetting = await authority.promoteIdeaToWorldRule(project.path, approvedSetting.id, approvedSetting.updatedAt)
  const summaryIdea = await authority.saveIdea(project.path, {
    title: '钟楼回声梗概',
    content: '主角从一段被钟楼记住的谎话出发，逐步发现城市回声的来源，并作出是否公开真相的选择。',
    status: 'approved'
  })
  const promotedSummary = await authority.promoteIdeaToSummary(project.path, summaryIdea.id, summaryIdea.updatedAt)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const manuscriptsBefore = (await databases.openExisting(project.path))!
  const originalManuscripts = manuscriptsBefore.formalChapters()
  manuscriptsBefore.close()

  const responses = [
    { title: '失声之城', content: '第一卷追查钟楼回声的来源，并发现它与旧街谎言有关。', event: '主角确认钟楼会保留最后一句谎话，决定追查。' },
    { title: '旧街取证', content: '主角在旧街寻找说谎者留下的回声证据，遭遇熟人阻拦。', event: '主角在旧街取得第一份回声证据。' },
    { title: '会说话的证据', content: '主角以玩笑掩饰试探，从熟人口中确认回声出现的条件。', event: '主角确认回声只记录谎话，并带着证据离开。' }
  ]
  let calls = 0
  let sawContinuation = false
  const runner = new PlanningDraftService({ complete: async (_instruction, _draft, context) => {
    if(_instruction.startsWith('复核下方完整候选'))return {content:'{"issues":[]}'} // Draft-generation count below excludes the independent review fixture.
    if (calls === 2) {
      assert.match(_instruction, /本卷已有 1 份直属章纲/)
      assert.match(_instruction, /主角在旧街寻找说谎者留下的回声证据/)
      sawContinuation = true
    }
    assert.match(context || '', /作者已批准的正式设定/)
    assert.match(context || '', /钟楼只记住谎话/)
    const response = responses[calls++]
    return { content: JSON.stringify({ children: [{ title: response.title, content: response.content, events: [{ time: `第${calls}日`, characters: ['主角'], location: calls === 1 ? '钟楼' : '旧街', event: response.event }] }] }) }
  } }, workspace)
  const tasks = new OutlineExpansionTaskService(projects, databases, runner, key => workspace.planningOutline(key), async () => 'planning-model', root => authority.retryMirrors(root))
  const adoption = new OutlineExpansionAdoptionService(projects, databases, key => workspace.planningOutline(key), root => authority.retryMirrors(root))

  let parentKey = 'total'
  const adoptedKeys: string[] = []
  for (const expectedType of ['volume', 'chapter'] as const) {
    const parent = await workspace.planningOutline(parentKey)
    assert.ok(parent)
    const started = await tasks.start({ operationId: randomUUID(), parentKey, expectedRevision: parent.revision, count: 1, instruction: '保留轻松对白与吐槽空间' })
    const completed = await expansionTerminal(tasks, started.id)
    assert.equal(completed.status, 'succeeded')
    assert.equal(completed.proposal?.childType, expectedType)
    const preview = await adoption.preview(started.id)
    const adopted = await adoption.adopt(preview.token)
    assert.equal(adopted.keys.length, 1)
    parentKey = adopted.keys[0]
    adoptedKeys.push(parentKey)
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  const volume = (await workspace.planningOutline(adoptedKeys[0]))!
  const continued = await tasks.start({ operationId: randomUUID(), parentKey: volume.key,
    expectedRevision: volume.revision, count: 1, instruction: '接续前章结果' })
  assert.equal((await expansionTerminal(tasks, continued.id)).status, 'succeeded')
  const nextPreview = await adoption.preview(continued.id)
  adoptedKeys.push((await adoption.adopt(nextPreview.token)).keys[0])

  assert.equal(calls, 3)
  assert.equal(sawContinuation, true)
  const database = (await databases.openExisting(project.path))!
  try {
    const outlines = database.formalOutlines()
    assert.deepEqual(outlines.map(node => node.nodeType), ['summary', 'volume', 'chapter', 'chapter'])
    assert.deepEqual(outlines.slice(1).map(node => node.legacyKey), adoptedKeys)
    assert.equal(outlines[1].parentLegacyKey, 'total')
    assert.equal(outlines[2].parentLegacyKey, outlines[1].legacyKey)
    assert.equal(outlines[3].parentLegacyKey, outlines[1].legacyKey)
    assert.equal(JSON.parse(outlines[0].planning.metadataJson).sourceIdeaId, promotedSummary.idea.id)
    assert.equal(JSON.parse(promotedSetting.entity.profileJson).sourceIdeaId, approvedSetting.id)
    assert.equal(outlines.slice(1).every(node => JSON.parse(node.planning.metadataJson).events[0].characters[0] === '主角'), true)
    assert.deepEqual(database.formalChapters(), originalManuscripts)
  } finally { database.close() }
})

test('direct chapter candidate becomes stale when the volume chapter directory changes', async (t) => {
  const { projects, databases, authority, project } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '主角追查钟楼回声。')
  const db = (await databases.openExisting(project.path))!
  db.writeFormalOutline({ legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume', seq: 1,
    title: '回声之卷', content: '主角追查旧街回声的来源。' })
  db.close()
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const source = (await workspace.planningOutline('volume-1'))!
  const runner = new PlanningDraftService({ complete: async (instruction) => {
    if (instruction.startsWith('复核下方完整候选')) return { content: '{"issues":[]}' }
    return { content: JSON.stringify({ children: [{ title: '旧街取证', content: '主角前往旧街取得回声证据。',
      events: [{ time: '次日', characters: ['主角'], location: '旧街', event: '主角取得回声证据。' }] }] }) }
  } }, workspace)
  const tasks = new OutlineExpansionTaskService(projects, databases, runner, key => workspace.planningOutline(key), async () => 'test')
  const adoption = new OutlineExpansionAdoptionService(projects, databases, key => workspace.planningOutline(key), root => authority.retryMirrors(root))
  const started = await tasks.start({ operationId: randomUUID(), parentKey: source.key,
    expectedRevision: source.revision, count: 1, instruction: '' })
  assert.equal((await expansionTerminal(tasks, started.id)).proposal?.childType, 'chapter')
  const preview = await adoption.preview(started.id)
  const changed = (await databases.openExisting(project.path))!
  changed.writeFormalOutline({ legacyKey: 'chapter-1', parentLegacyKey: 'volume-1', nodeType: 'chapter', seq: 1,
    title: '作者新增章', content: '作者先写下的章纲。' })
  changed.close()
  assert.equal((await tasks.status(started.id)).sourceStale, true)
  await assert.rejects(adoption.adopt(preview.token), /目录已经变化|章节目录已经变化/)
  const final = (await databases.openExisting(project.path))!
  try { assert.deepEqual(final.formalOutlines().filter(node => node.parentLegacyKey === 'volume-1').map(node => node.title), ['作者新增章']) }
  finally { final.close() }
})

test('outline expansion IPC only accepts bounded next-layer requests', () => {
  const request = { operationId: randomUUID(), parentKey: 'total', expectedRevision: 'a'.repeat(64), count: 1, instruction: '' }
  assert.deepEqual(decodeOutlineExpansionArgs([request]), [request])
  for (const patch of [{ count: 13 }, { count: 1.5 }, { parentKey: '../outside' }, { parentKey: 'chapter-1' }, { expectedRevision: 'old' }, { operationId: 'bad' }, { instruction: 'x'.repeat(2001) }, { path: 'outside' }]) {
    assert.throws(() => decodeOutlineExpansionArgs([{ ...request, ...patch }]))
  }
  assert.deepEqual(decodePlanningOutlineKeyArgs(['stage-2']), ['stage-2'])
  assert.throws(() => decodePlanningOutlineKeyArgs(['stage-2', 'extra']))
})

async function expansionTerminal(service: OutlineExpansionTaskService, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const task = (await service.recent()).find(item => item.id === id)!
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status)) return task
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('expansion did not finish')
}

test('persists single-layer tasks, replays without a model call, and recovers only its task type', async (t) => {
  const { projects, databases, authority, project } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '主角追查钟楼回声。')
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const source = (await workspace.planningOutline('total'))!
  let calls = 0
  const runner = new PlanningDraftService({ complete: async (_instruction, _draft, _context, _task, _signal, model) => {
    if(_instruction.startsWith('复核下方完整候选'))return {content:'{"issues":[]}'}
    assert.equal(model, 'pinned-model')
    calls++
    return { content: JSON.stringify({ children: [{ title: '回声', content: '追索线索。', events: [{ time: '翌日', characters: ['主角'], location: '钟楼', event: '发现线索并出发。' }] }] }) }
  } }, workspace)
  const service = new OutlineExpansionTaskService(projects, databases, runner, key => workspace.planningOutline(key), async () => 'pinned-model')
  const input = { operationId: randomUUID(), parentKey: 'total', expectedRevision: source.revision, count: 1, instruction: '' }
  const first = await service.start(input)
  const completed = await expansionTerminal(service, first.id)
  assert.equal(completed.status, 'succeeded')
  assert.equal(completed.proposal?.childType, 'volume')
  assert.equal((await service.start(input)).id, first.id)
  assert.equal(calls, 1)
  await authority.retryMirrors(project.path)
  const mirrorPath = join(project.path, '.webnovel', 'planning', 'expansions', `${first.id}.json`)
  const mirror = JSON.parse(await readFile(mirrorPath, 'utf8'))
  assert.equal(mirror.taskId, first.id)
  assert.deepEqual(mirror.proposal, completed.proposal)
  assert.equal(mirror.model, 'pinned-model')
  assert.equal(mirror.context, undefined)
  await unlink(mirrorPath)
  await authority.rebuildReadableMirrors(project.path)
  assert.deepEqual(JSON.parse(await readFile(mirrorPath, 'utf8')), mirror)
  await writeFile(mirrorPath, '作者外部修改的候选备忘', 'utf8')
  assert.ok((await authority.rebuildReadableMirrors(project.path)).conflicts > 0)
  assert.equal(await readFile(mirrorPath, 'utf8'), '作者外部修改的候选备忘')
  await assert.rejects(service.start({ ...input, count: 2 }))
  assert.deepEqual(await workspace.planningOutline('total'), source)
  assert.equal((await documents.outlines()).volumes.length, 0)
  const db = (await databases.openExisting(project.path))!
  const checkpointJson = db.taskRun(first.id)!.checkpointJson
  const orphan = db.createTaskRun({ id: randomUUID(), taskType: 'outline_expansion', idempotencyKey: randomUUID(), checkpointJson })
  const unrelated = db.createTaskRun({ id: randomUUID(), taskType: 'idea_generation', idempotencyKey: randomUUID(), checkpointJson: '{}' })
  db.close()
  const reopened = new OutlineExpansionTaskService(projects, databases, runner, key => workspace.planningOutline(key), async () => { throw new Error('no new model lookup') })
  const recovered = await reopened.recent()
  assert.equal(recovered.find(task => task.id === orphan.id)?.status, 'interrupted')
  assert.deepEqual(recovered.find(task => task.id === first.id)?.proposal, completed.proposal)
  const checked = (await databases.openExisting(project.path))!
  assert.equal(checked.taskRun(unrelated.id)!.status, 'queued')
  checked.close()
  await documents.updateOutline('total', '父稿后来改了。')
  assert.equal((await reopened.start(input)).sourceStale, true)
  assert.equal(calls, 1)
})

test('cancelled expansion ignores late output and allows another start', async (t) => {
  const { projects, databases, authority, project } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '待拆解父稿。')
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const source = (await workspace.planningOutline('total'))!
  let finish!: () => void
  const runner = { expandNextLayer: async () => {
    await new Promise<void>(resolve => { finish = resolve })
    return { id: randomUUID(), createdAt: new Date().toISOString(), source, sourceStale: false, childType: 'volume' as const, children: [] }
  } }
  const service = new OutlineExpansionTaskService(projects, databases, runner, key => workspace.planningOutline(key), async () => 'test')
  const input = { operationId: randomUUID(), parentKey: 'total', expectedRevision: source.revision, count: 1, instruction: '' }
  const first = await service.start(input)
  for (let attempt = 0; !finish && attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await service.cancel(first.id)).status, 'cancelled')
  finish()
  const second = await service.start({ ...input, operationId: randomUUID() })
  await service.cancel(second.id)
  finish?.()
  await new Promise(resolve => setTimeout(resolve, 30))
  const db = (await databases.openExisting(project.path))!
  assert.equal(db.taskRun(first.id)!.status, 'cancelled')
  assert.equal(db.generationArtifactForTask(first.id, 'outline_expansion'), null)
  assert.equal(db.pendingMirrorPlans().some(plan => plan.sourceType === 'outline_expansion_json'), false)
  db.close()
})

test('cancelled outline expansion retries as one traceable child task', async (t) => {
  const { projects, databases, authority, project } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '待拆解父稿。')
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const source = (await workspace.planningOutline('total'))!
  let releaseFirst!: () => void
  let calls = 0
  const runner = { expandNextLayer: async () => {
    calls += 1
    if (calls === 1) await new Promise<void>(resolve => { releaseFirst = resolve })
    return { id: randomUUID(), createdAt: new Date().toISOString(), source, sourceStale: false, childType: 'volume' as const,
      children: [{ title: '第一卷', content: '主角开始调查。', events: [{ time: '第一天', characters: ['主角'], location: '教室', event: '发现异常。' }] }] }
  } }
  const service = new OutlineExpansionTaskService(projects, databases, runner, key => workspace.planningOutline(key), async () => 'test')
  const first = await service.start({ operationId: randomUUID(), parentKey: 'total', expectedRevision: source.revision, count: 1, instruction: '' })
  for (let attempt = 0; !releaseFirst && attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  await service.cancel(first.id)
  const operationId = randomUUID()
  const child = await service.retry(first.id, operationId)
  assert.equal((await service.retry(first.id, operationId)).id, child.id)
  assert.equal((await expansionTerminal(service, child.id)).status, 'succeeded')
  releaseFirst()
  await new Promise(resolve => setTimeout(resolve, 20))
  const db = (await databases.openExisting(project.path))!
  try {
    const record = db.taskRun(child.id)!
    assert.equal(record.parentTaskRunId, first.id)
    assert.equal(record.attempt, 2)
    assert.equal(db.recentTaskRuns('outline_expansion').length, 2)
  } finally { db.close() }
})

test('candidate provenance survives edits, mirrors, reopen and summary promotion', async (t) => {
  const { projects, databases, authority, project, request } = await fixture(t)
  const service = new IdeaGenerationService(projects, databases, { modelFor: async () => 'test', complete: async () => ({ content: output }) }, async () => '')
  const task = await terminal(service, (await service.start(request)).id)
  const generationSource = { taskId: task.id, optionIndex: 0 }
  const input = { title: '作者调整的标题', content: '作者调整过的候选内容。', generationSource }
  assert.deepEqual(decodeIdeaSaveArgs([input]), [input])
  for (const source of [{ taskId: 'bad', optionIndex: 0 }, { taskId: task.id, optionIndex: -1 }, { taskId: task.id, optionIndex: 0.5 }, { ...generationSource, path: 'outside' }]) {
    assert.throws(() => decodeIdeaSaveArgs([{ ...input, generationSource: source }]))
  }
  await assert.rejects(authority.saveIdea(project.path, { ...input, generationSource: { taskId: randomUUID(), optionIndex: 0 } }))
  await assert.rejects(authority.saveIdea(project.path, { ...input, generationSource: { taskId: task.id, optionIndex: 1 } }))
  const saved = await authority.saveIdea(project.path, input)
  assert.deepEqual(saved.generationSource, generationSource)
  const edited = await authority.saveIdea(project.path, { id: saved.id, title: saved.title, content: '再次修改。' })
  assert.deepEqual(edited.generationSource, generationSource)
  const reopenedService = new IdeaGenerationService(projects, databases, { modelFor: async () => 'unused', complete: async () => { throw new Error('must not regenerate') } }, async () => '')
  const origin = await reopenedService.status(task.id)
  assert.equal(origin.id, task.id)
  assert.equal(origin.status, 'succeeded')
  assert.deepEqual(origin.proposal?.options[generationSource.optionIndex], task.proposal?.options[generationSource.optionIndex])
  await assert.rejects(authority.saveIdea(project.path, { ...input, id: saved.id, generationSource: { taskId: task.id, optionIndex: 1 } }))
  const promoted = await authority.promoteIdeaToSummary(project.path, saved.id, edited.updatedAt)
  assert.deepEqual(promoted.idea.generationSource, generationSource)
  const database = await databases.openExisting(project.path)
  try {
    assert.deepEqual(database!.listIdeas().find(idea => idea.id === saved.id)?.generationSource, generationSource)
    const mirror = database!.ideasMirror()!
    const readable = JSON.parse(await readFile(join(project.path, mirror.relativePath), 'utf8'))
    assert.deepEqual(readable.ideas.find((idea: { id: string }) => idea.id === saved.id).generationSource, generationSource)
  } finally { database?.close() }
})
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-idea-generation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'settings'), { available: () => true, encrypt: (text) => text, decrypt: (text) => text })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '灵感生成测试', genre: '轻小说' })
  const documents = new DocumentService(projects)
  const databases = new SqliteWorkspaceDatabaseFactory()
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const shadow = new ShadowImportService(source, databases)
  await shadow.import(await shadow.preview())
  const authority = new SqliteManuscriptService(databases)
  await authority.activate(project.path, await source.snapshot())
  const idea = await authority.saveIdea(project.path, { title: '钟楼', content: '钟楼只记住谎话。' })
  const request: IdeaGenerationInput = { operationId: randomUUID(), ideaId: idea.id, expectedUpdatedAt: idea.updatedAt, mode: 'synopsis', instruction: '多些吐槽' }
  return { project, projects, databases, authority, idea, request }
}

test('book-bound idea jobs with identical task IDs finish in their own stores and cancellation only touches the selected book', async t => {
  const a = await fixture(t)
  const { projects, databases, authority } = a
  const b = (await projects.create({ parentPath: dirname(a.project.path), name: '并行灵感乙' })).project
  const documents = new DocumentService(projects)
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const importer = new ShadowImportService(source, databases)
  await importer.import(await importer.preview())
  await authority.activate(b.path, await source.snapshot())
  const idea = await authority.saveIdea(b.path, { title: '乙书灵感', content: '乙书独立内容。' })
  const requestB: IdeaGenerationInput = { ...a.request, operationId: randomUUID(), ideaId: idea.id, expectedUpdatedAt: idea.updatedAt }
  const signals = new Map<string, AbortSignal>()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  t.after(() => release())
  const service = new IdeaGenerationService(projects, databases, {
    modelFor: async () => 'test', complete: async (_instruction, _draft, _context, _task, signal) => {
      const root = await projects.currentPath()
      signals.set(root, signal)
      await gate
      assert.equal(await projects.currentPath(), root)
      return { content: output }
    }
  }, async () => '', () => '00000000-0000-4000-8000-000000000099')
  await projects.switch(a.project.path)
  const first = await projects.runBookTask('灵感生成', () => service.start(a.request), id => service.status(id))
  await projects.switch(b.path)
  const second = await projects.runBookTask('灵感生成', () => service.start(requestB), id => service.status(id))
  assert.equal(first.id, second.id)
  for (let i = 0; signals.size < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(signals.size, 2)
  await service.cancel(second.id)
  assert.equal(signals.get(b.path)?.aborted, true)
  assert.equal(signals.get(a.project.path)?.aborted, false)
  release()
  await projects.switch(a.project.path)
  assert.equal((await terminal(service, first.id)).status, 'succeeded')
  await projects.switch(b.path)
  assert.equal((await service.status(second.id)).status, 'cancelled')
})

test('book-bound expansion survives switching, and stopping B leaves A to finish in its original database', async t => {
  const a = await fixture(t)
  const { projects, databases, authority } = a
  const documents = new DocumentService(projects, undefined, authority)
  await documents.updateOutline('total', '甲书钟楼。')
  const b = (await projects.create({ parentPath: dirname(a.project.path), name: '并行谋篇乙' })).project
  const legacy = new CurrentProjectLegacyWorkspaceSource(projects, new DocumentService(projects))
  const importer = new ShadowImportService(legacy, databases)
  await importer.import(await importer.preview())
  await authority.activate(b.path, await legacy.snapshot())
  await documents.updateOutline('total', '乙书钟楼。')
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  t.after(() => release())
  const signals = new Map<string, AbortSignal>()
  const runner = new PlanningDraftService({ complete: async (_instruction, _draft, _context, _task, signal) => {
    if(_instruction.startsWith('复核下方完整候选'))return {content:'{"issues":[]}'}
    const root = await projects.currentPath()
    assert.ok(signal)
    signals.set(root, signal)
    await gate
    assert.equal(await projects.currentPath(), root)
    return { content: JSON.stringify({ children: [{ title: '回声', content: root === a.project.path ? '甲书线索。' : '乙书线索。', events: [{ time: '翌日', characters: ['主角'], location: '钟楼', event: '发现线索并出发。' }] }] }) }
  } }, workspace)
  const service = new OutlineExpansionTaskService(projects, databases, runner, key => workspace.planningOutline(key), async () => 'test')
  const start = async () => service.start({ operationId: randomUUID(), parentKey: 'total', expectedRevision: (await workspace.planningOutline('total'))!.revision, count: 1, instruction: '' })
  await projects.switch(a.project.path)
  const first = await projects.runBookTask('章纲扩展', start, id => service.status(id))
  await projects.switch(b.path)
  const second = await projects.runBookTask('章纲扩展', start, id => service.status(id))
  for (let i = 0; signals.size < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(signals.size, 2)
  await assert.rejects(service.cancel(first.id))
  await service.cancel(second.id)
  assert.equal(signals.get(b.path)?.aborted, true)
  assert.equal(signals.get(a.project.path)?.aborted, false)
  release()
  await projects.switch(a.project.path)
  const result = await expansionTerminal(service, first.id)
  assert.equal(result.status, 'succeeded')
  assert.match(JSON.stringify(result.proposal), /甲书线索/)
  assert.doesNotMatch(JSON.stringify(result.proposal), /乙书线索/)
  assert.equal((await documents.outlines()).volumes.length, 0)
  await projects.switch(b.path)
  assert.equal((await service.status(second.id)).status, 'cancelled')
  assert.equal((await documents.outlines()).volumes.length, 0)
})

async function terminal(service: IdeaGenerationService, id: string) {
  for (let n = 0; n < 80; n++) {
    const task = (await service.recent()).find((item) => item.id === id)!
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status)) return task
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('task did not finish')
}

test('validates bounded structured idea options and exact generation IPC inputs', () => {
  assert.equal(parseIdeaGeneration(`\`\`\`json\n${output}\n\`\`\``).options.length, 1)
  for (const invalid of ['null', '{"options":[]}', '{"options":[{}]}', JSON.stringify({ options: Array(4).fill({ title: 'x', content: 'x', rationale: 'x' }) })]) {
    assert.throws(() => parseIdeaGeneration(invalid))
  }
  const input = { operationId: randomUUID(), ideaId: randomUUID(), expectedUpdatedAt: new Date().toISOString(), mode: 'diverge', instruction: '' }
  assert.deepEqual(decodeIdeaGenerationArgs([input]), [input])
  for (const change of [{ mode: 'write' }, { instruction: 'x'.repeat(2001) }, { expectedUpdatedAt: 'yesterday' }, { operationId: 'bad' }, { path: 'outside' }]) {
    assert.throws(() => decodeIdeaGenerationArgs([{ ...input, ...change }]))
  }
})

test('generates once, persists candidates across restart, and marks changed source without changing canon', async (t) => {
  const { projects, databases, authority, project, idea, request } = await fixture(t)
  let calls = 0
  const ai = { modelFor: async () => 'test-model', complete: async (instruction: string, _draft: string, context: string) => {
    calls++
    assert.match(instruction, /梗概方案任务/)
    assert.match(instruction, /钟楼只记住谎话/)
    assert.match(context, /已批准设定/)
    return { content: output }
  } }
  const service = new IdeaGenerationService(projects, databases, ai, async () => '已批准设定：钟楼没有意识。')
  const started = await service.start(request)
  assert.equal((await service.start(request)).id, started.id)
  const result = await terminal(service, started.id)
  assert.equal(result.status, 'succeeded')
  assert.equal(result.proposal?.options[0].title, '会吐槽的钟楼')
  assert.equal(result.model, 'test-model')
  assert.equal(calls, 1)
  assert.deepEqual(await authority.ideas(project.path), [idea])
  assert.equal((await authority.storyEntities(project.path)).length, 0)
  const reopened = new IdeaGenerationService(projects, databases, ai, async () => '')
  assert.deepEqual((await reopened.recent())[0].proposal, result.proposal)
  assert.equal(calls, 1)
  await authority.saveIdea(project.path, { ...idea, content: '钟楼改为只记住真话。' })
  assert.equal((await reopened.recent())[0].sourceStale, true)
  await assert.rejects(service.start({ ...request, operationId: randomUUID() }), (error: { code?: string }) => error.code === 'CONFLICT')
  await assert.rejects(service.start({ ...request, instruction: 'different' }), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(calls, 1)
})

test('idea generation retains its first malformed response after configured repairs fail', async (t) => {
  const { projects, databases, request, project } = await fixture(t)
  let calls = 0
  const original = '这是一段没有形成 JSON 的灵感原文。'
  const service = new IdeaGenerationService(projects, databases, {
    modelFor: async () => 'test-model',
    complete: async () => { calls += 1; return { content: calls === 1 ? original : '仍然不是 JSON' } }
  }, async () => '', undefined, undefined, undefined, async () => 1)
  const result = await terminal(service, (await service.start(request)).id)
  assert.equal(calls, 2)
  assert.equal(result.status, 'failed')
  assert.equal(result.rawResult, original)
  assert.match(result.error || '', /已尝试自动修复 1 次，仍未通过/)
  assert.doesNotMatch(result.error || '', /已自动修复/)
  const database = (await databases.openExisting(project.path))!
  try {
    const artifact = database.generationArtifactForTask(result.id, 'idea_generation')!
    assert.equal(artifact.status, 'invalid')
    assert.equal(artifact.schemaValid, false)
    assert.equal(artifact.content, original)
  } finally { database.close() }
})

test('cancellation ignores a late model response and never creates an artifact', async (t) => {
  const { projects, databases, request, project } = await fixture(t)
  let respond!: (value: { content: string }) => void
  let entered!: () => void
  const enteredModel = new Promise<void>((resolve) => { entered = resolve })
  const service = new IdeaGenerationService(projects, databases, {
    modelFor: async () => 'test-model', complete: async () => { entered(); return new Promise((resolve) => { respond = resolve }) }
  }, async () => '')
  const started = await service.start(request)
  await enteredModel
  await assert.rejects(service.start({ ...request, operationId: randomUUID() }), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal((await service.cancel(started.id)).status, 'cancelled')
  respond({ content: output })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal((await service.recent())[0].proposal, null)
  assert.equal((await service.recent())[0].status, 'cancelled')
  const database = (await databases.openExisting(project.path))!
  assert.equal(database.pendingMirrorPlans().some((plan) => plan.sourceType === 'idea_generation_json'), false)
  database.close()
})

test('cancelled idea generation retries as one traceable child task', async (t) => {
  const { projects, databases, request, project } = await fixture(t)
  let releaseFirst!: (value: { content: string }) => void
  let calls = 0
  const service = new IdeaGenerationService(projects, databases, {
    modelFor: async () => 'test-model',
    complete: async () => {
      calls += 1
      if (calls === 1) return new Promise(resolve => { releaseFirst = resolve })
      return { content: output }
    }
  }, async () => '')
  const first = await service.start(request)
  for (let attempt = 0; !releaseFirst && attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  await service.cancel(first.id)
  const operationId = randomUUID()
  const child = await service.retry(first.id, operationId)
  assert.equal((await service.retry(first.id, operationId)).id, child.id)
  assert.equal((await terminal(service, child.id)).status, 'succeeded')
  releaseFirst({ content: output })
  await new Promise(resolve => setTimeout(resolve, 20))
  const database = (await databases.openExisting(project.path))!
  try {
    const record = database.taskRun(child.id)!
    assert.equal(record.parentTaskRunId, first.id)
    assert.equal(record.attempt, 2)
    assert.equal(database.recentTaskRuns('idea_generation').length, 2)
  } finally { database.close() }
})

test('recovers only its own orphan tasks and stores safe failures', async (t) => {
  const { projects, databases, request, project } = await fixture(t)
  const service = new IdeaGenerationService(projects, databases, { modelFor: async () => 'test', complete: async () => { throw new Error('secret-key-provider-trace') } }, async () => '')
  const started = await service.start(request)
  const result = await terminal(service, started.id)
  assert.equal(result.status, 'failed')
  assert.doesNotMatch(JSON.stringify(result), /secret-key/)
  const database = (await databases.openExisting(project.path))!
  const original = database.taskRun(started.id)!
  assert.ok(original.contentHash)
  database.createTaskRun({ id: randomUUID(), taskType: 'idea_generation', idempotencyKey: randomUUID(), checkpointJson: original.checkpointJson, contentHash: original.contentHash })
  const writing = database.createTaskRun({ id: randomUUID(), taskType: 'writing_agent', idempotencyKey: randomUUID(), checkpointJson: '{}' })
  database.close()
  const restarted = new IdeaGenerationService(projects, databases, { modelFor: async () => 'test', complete: async () => ({ content: output }) }, async () => '')
  assert.equal((await restarted.recent()).some((item) => item.status === 'interrupted'), true)
  const after = (await databases.openExisting(project.path))!
  assert.equal(after.taskRun(writing.id)?.status, 'queued')
  after.close()
})

test('rejects a work-item switch during preparation before persisting or calling the model', async (t) => {
  const { databases, project, request } = await fixture(t)
  let currentPath = project.path
  let calls = 0
  const service = new IdeaGenerationService({ currentPath: async () => currentPath }, databases, {
    modelFor: async () => 'test', complete: async () => { calls++; return { content: output } }
  }, async () => { currentPath = join(project.path, 'another-book'); return '' })
  await assert.rejects(service.start(request), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(calls, 0)
  const database = (await databases.openExisting(project.path))!
  assert.equal(database.recentTaskRuns('idea_generation').length, 0)
  database.close()
})

test('candidate mirrors preserve provenance, rebuild deleted files and protect external changes', async (t) => {
  const { projects, databases, authority, project, idea, request } = await fixture(t)
  let calls = 0
  let synced!: () => void
  const syncFinished = new Promise<void>((resolve) => { synced = resolve })
  const service = new IdeaGenerationService(projects, databases, {
    modelFor: async () => 'test-model', complete: async () => { calls++; return { content: output } }
  }, async () => 'private-context-not-for-readable-export', undefined, async (root) => {
    const result = await authority.retryMirrors(root)
    if (calls) synced()
    return result
  })
  const started = await service.start(request)
  assert.equal((await terminal(service, started.id)).status, 'succeeded')
  await syncFinished
  const path = join(project.path, '.webnovel', 'ideas', 'generations', `${started.id}.json`)
  const original = await readFile(path, 'utf8')
  const mirror = JSON.parse(original)
  assert.equal(mirror.taskId, started.id)
  assert.equal(mirror.model, 'test-model')
  assert.equal(mirror.mode, 'synopsis')
  assert.equal(mirror.instruction, request.instruction)
  assert.deepEqual(mirror.source, idea)
  assert.deepEqual(mirror.proposal, JSON.parse(output))
  assert.doesNotMatch(original, /private-context-not-for-readable-export/)
  await unlink(path)
  assert.deepEqual((await service.recent())[0].proposal, mirror.proposal)
  assert.equal((await authority.rebuildReadableMirrors(project.path)).recreated, 1)
  assert.equal(await readFile(path, 'utf8'), original)
  await writeFile(path, '作者在外部留下的候选修改', 'utf8')
  assert.equal((await authority.rebuildReadableMirrors(project.path)).conflicts, 1)
  assert.deepEqual(await authority.retryMirrors(project.path), { pending: 1, conflicts: 1, failed: 0 })
  await assert.rejects(authority.rollback(project.path), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(await readFile(path, 'utf8'), '作者在外部留下的候选修改')
  assert.deepEqual((await service.recent())[0].proposal, mirror.proposal)
  await writeFile(path, original, 'utf8')
  assert.deepEqual(await authority.retryMirrors(project.path), { pending: 0, conflicts: 0, failed: 0 })
  assert.equal(calls, 1)
  assert.deepEqual(await authority.ideas(project.path), [idea])
})

test('older successful tasks backfill mirrors without a model call, even after a mirror callback fails', async (t) => {
  const { projects, databases, authority, project, request } = await fixture(t)
  const service = new IdeaGenerationService(projects, databases, {
    modelFor: async () => 'test', complete: async () => ({ content: output })
  }, async () => '', undefined, async () => { throw new Error('file writer unavailable') })
  const task = await service.start(request)
  assert.equal((await terminal(service, task.id)).status, 'succeeded')
  // Simulate a pre-mirror release: the successful artifact exists, the new mirror row does not.
  const legacy = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'))
  legacy.prepare("DELETE FROM mirror_entries WHERE source_type = 'idea_generation_json'").run()
  legacy.close()
  const reopened = new IdeaGenerationService(projects, databases, {
    modelFor: async () => { throw new Error('must not call model') },
    complete: async () => { throw new Error('must not call model') }
  }, async () => '', undefined, (root) => authority.retryMirrors(root))
  assert.equal((await reopened.recent())[0].status, 'succeeded')
  const mirror = JSON.parse(await readFile(join(project.path, '.webnovel', 'ideas', 'generations', `${task.id}.json`), 'utf8'))
  assert.deepEqual(mirror.proposal, JSON.parse(output))
  assert.deepEqual(await authority.retryMirrors(project.path), { pending: 0, conflicts: 0, failed: 0 })
})

test('promotes an idea into the formal summary root without replacing outlines or losing its source', async (t) => {
  const { projects, databases, authority, project, idea } = await fixture(t)
  const before = (await databases.openExisting(project.path))!
  const manuscripts = before.formalChapters()
  assert.equal(before.formalOutlines().length, 0)
  before.close()
  const result = await authority.promoteIdeaToSummary(project.path, idea.id, idea.updatedAt)
  assert.equal(result.idea.promotedToType, 'summary')
  assert.equal(result.idea.content, idea.content)
  const database = (await databases.openExisting(project.path))!
  const summary = database.formalOutlines()[0]
  assert.equal(summary.legacyKey, 'total')
  assert.equal(summary.nodeType, 'summary')
  assert.equal(summary.content, idea.content)
  assert.equal(JSON.parse(summary.planning.metadataJson).sourceIdeaId, idea.id)
  assert.deepEqual(database.formalChapters(), manuscripts)
  database.close()
  assert.equal(await readFile(join(project.path, '大纲', '总纲.md'), 'utf8'), idea.content)
  const repeated = await authority.promoteIdeaToSummary(project.path, result.idea.id, result.idea.updatedAt)
  assert.equal(repeated.idea.promotedToId, result.idea.promotedToId)
  await assert.rejects(authority.promoteIdeaToWorldRule(project.path, result.idea.id, result.idea.updatedAt), (error: { code?: string }) => error.code === 'CONFLICT')
  const changed = await authority.saveIdea(project.path, { ...result.idea, status: 'candidate', content: '修改后的源便签不能替换正式梗概。' })
  await assert.rejects(authority.promoteIdeaToSummary(project.path, idea.id, idea.updatedAt), (error: { code?: string }) => error.code === 'CONFLICT')
  const another = await authority.saveIdea(project.path, { title: '另一份梗概', content: '不能覆盖已有总纲。' })
  await assert.rejects(authority.promoteIdeaToSummary(project.path, another.id, another.updatedAt), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(await readFile(join(project.path, '大纲', '总纲.md'), 'utf8'), idea.content)
  const workspace = new WorkspaceService(projects, undefined, undefined, undefined, undefined, undefined, authority)
  assert.match(await workspace.planningMaterials(), /钟楼只记住谎话/)
  assert.doesNotMatch(await workspace.planningMaterials(), /修改后的源便签/)
  assert.equal(changed.promotedToId, result.idea.promotedToId)
})

test('manually saved summaries enable planning and SQLite remains authoritative over edited mirrors', async (t) => {
  const { projects, authority, project, idea } = await fixture(t)
  const documents = new DocumentService(projects, undefined, authority)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  assert.equal(await workspace.hasPlanningMaterials(), false)
  await documents.updateOutline('total', '作者手写梗概：钟楼失声后，主角决定追查最后的回声。')
  assert.equal(await workspace.hasPlanningMaterials(), true)
  assert.match(await workspace.planningMaterials(), /作者手写梗概/)
  assert.doesNotMatch(await workspace.planningMaterials(), new RegExp(idea.content))
  await writeFile(join(project.path, '大纲', '总纲.md'), '外部修改只留在镜像，不得进入规划。', 'utf8')
  const context = await workspace.planningMaterials()
  assert.match(context, /作者手写梗概/)
  assert.doesNotMatch(context, /外部修改只留在镜像/)
  assert.equal((await authority.ideas(project.path))[0].promotedToId, null)
  const parent = (await workspace.planningOutline('total'))!
  const expansion = new PlanningDraftService({ complete: async (instruction) => {
    if(instruction.startsWith('复核下方完整候选'))return {content:'{"issues":[]}'}
    assert.match(instruction, /作者手写梗概/)
    assert.doesNotMatch(instruction, /外部修改只留在镜像/)
    return { content: JSON.stringify({ children: [{ title: '失声之城', content: '主角追查回声，在旧街发现线索。', events: [{ time: '第一日', characters: ['主角'], location: '旧街', event: '发现线索，决定夜探钟楼。' }] }] }) }
  } }, workspace)
  const proposal = await expansion.expandNextLayer({ parentKey: 'total', expectedRevision: parent.revision, count: 1, instruction: '' })
  assert.equal(proposal.childType, 'volume')
  assert.equal(proposal.sourceStale, false)
  assert.deepEqual(await workspace.planningOutline('total'), parent)
  assert.equal((await documents.outlines()).volumes.length, 0)
})

test('old retries do not regenerate and history reads use one database connection', async (t) => {
  const { projects, databases, project, request } = await fixture(t)
  let opens = 0
  let calls = 0
  const counted = {
    open: (root: string) => databases.open(root),
    openExisting: (root: string) => { opens++; return databases.openExisting(root) }
  }
  const service = new IdeaGenerationService(projects, counted, {
    modelFor: async () => 'test', complete: async () => { calls++; return { content: output } }
  }, async () => '')
  const first = await service.start(request)
  await terminal(service, first.id)
  const database = (await databases.openExisting(project.path))!
  const checkpointJson = database.taskRun(first.id)!.checkpointJson
  const contentHash = database.taskRun(first.id)!.contentHash
  assert.ok(contentHash)
  for (let index = 0; index < 101; index++) {
    const task = database.createTaskRun({ id: randomUUID(), taskType: 'idea_generation', idempotencyKey: randomUUID(), checkpointJson, contentHash })
    database.transitionTaskRun({ id: task.id, status: 'cancelled' })
  }
  assert.equal(database.recentTaskRuns('idea_generation', undefined, 100).some((task) => task.id === first.id), false)
  database.close()
  const beforeReads = opens
  const recent = await service.recent()
  assert.equal(recent.length, 50)
  assert.equal(opens - beforeReads, 1)
  assert.equal((await service.start(request)).id, first.id)
  assert.equal(calls, 1)
  await assert.rejects(service.start({ ...request, instruction: 'different' }), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(calls, 1)
})

test('upgrades v20 ideas losslessly and enforces the summary promotion target', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v20-ideas-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'))
  const path = join(root, '.webnovel', 'workspace.sqlite')
  const raw = new DatabaseSync(path)
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 20)) {
    raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, '2026-09-04T00:00:00.000Z', migration.checksum)
    raw.exec(`PRAGMA user_version = ${migration.version}`)
  }
  raw.exec(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at)
    VALUES ('book', '旧灵感作品', 'active', '${'a'.repeat(64)}', 'sqlite', '2026-09-04', '2026-09-04');
    INSERT INTO entities (id, project_id, entity_type, canonical_name, normalized_name, profile_json, status, created_at, updated_at)
    VALUES ('rule', 'book', 'world_rule', '旧设定', '旧设定', '{}', 'approved', '2026-09-04', '2026-09-04');
    INSERT INTO ideas VALUES ('idea', 'book', '旧便签', '保留正文与来源', 'approved', 'world_rule', 'rule', '2026-09-04', '2026-09-04');`)
  const previous = { ...raw.prepare('SELECT * FROM ideas').get() }
  raw.close()
  const migrated = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.equal(migrated!.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(migrated!.listIdeas()[0].promotedToId, 'rule')
  migrated!.close()
  const checked = new DatabaseSync(path)
  assert.deepEqual({ ...checked.prepare('SELECT * FROM ideas').get() }, { ...previous, source_task_run_id: null, source_option_index: null })
  assert.throws(() => checked.exec("UPDATE ideas SET promoted_to_type = 'summary', promoted_to_id = 'rule' WHERE id = 'idea'"))
  assert.deepEqual({ ...checked.prepare('SELECT * FROM ideas').get() }, { ...previous, source_task_run_id: null, source_option_index: null })
  assert.equal(checked.prepare('PRAGMA foreign_key_check').all().length, 0)
  checked.close()
})
