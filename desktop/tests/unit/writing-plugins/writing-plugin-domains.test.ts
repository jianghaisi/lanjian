import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { PlanningDraftService } from '../../../src/main/modules/planning/application/planning-draft-service'
import { PlanningJobService } from '../../../src/main/modules/planning/application/planning-job-service'
import { bookContextTools } from '../../../src/main/modules/writing-plugins/adapters/builtin/book-context'
import { manuscriptTools } from '../../../src/main/modules/writing-plugins/adapters/builtin/manuscript'
import { planningTools, operationKey } from '../../../src/main/modules/writing-plugins/adapters/builtin/planning'
import { decodeWritingAgentStartArgs, decodeOutlineExpansionArgs } from '../../../src/contracts/ipc'
import { WritingPluginRegistry, modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher } from '../../../src/main/modules/writing-plugins/application/dispatcher'
import type { CapabilityTool } from '../../../src/main/modules/writing-plugins/domain/types'
import type { AssistantConversationRequest } from '../../../src/contracts/assistant/assistant-conversation-contracts'

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'writing-plugin-domains-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'settings'), { available: () => true, encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '插件隔离测试', genre: '仙侠' })
  const workspace = new WorkspaceService(projects), documents = new DocumentService(projects), research = new ResearchLibraryService(projects)
  const request: AssistantConversationRequest = { operationId: 'domain-test', workItemId: project.id, page: 'world', message: '帮我写小说', targets: [], chapterId: null, selectedCharacters: 0, history: [] }
  const dispatcher = (tools: CapabilityTool[]) => {
    const registry = new WritingPluginRegistry()
    for (const tool of tools) registry.register(tool, 'builtin')
    return new WritingPluginDispatcher(registry, { workItemId: project.id, signal: new AbortController().signal, allowedCapabilities: new Set(tools.flatMap(tool => tool.capabilities)), async assertScope() { assert.equal((await projects.currentSummary()).id, project.id) } })
  }
  return { root, project, projects, workspace, documents, research, request, dispatcher }
}
async function hashes(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return Object.fromEntries(await Promise.all(entries.filter(item => item.isFile()).map(async item => { const path = join(item.parentPath, item.name); return [path, createHash('sha256').update(await readFile(path)).digest('hex')] })))
}
const invoke = (dispatcher: WritingPluginDispatcher, id: string, input = {}) => dispatcher.execute(modelToolName('builtin.core', id), JSON.stringify(input))

test('host operation identities satisfy both real domain decoders and remain stable per book', () => {
  const request: AssistantConversationRequest = { operationId: 'assistant-operation', workItemId: 'book-a', page: 'world', message: '继续', targets: [], chapterId: null, selectedCharacters: 0, history: [] }
  const operationId = operationKey(request, 'expand', {})
  assert.equal(operationKey(request, 'expand', {}), operationId)
  assert.notEqual(operationKey({ ...request, workItemId: 'book-b' }, 'expand', {}), operationId)
  assert.doesNotThrow(() => decodeOutlineExpansionArgs([{ operationId, parentKey: 'total', expectedRevision: 'a'.repeat(64), count: 1, instruction: '' }]))
  assert.doesNotThrow(() => decodeWritingAgentStartArgs([{ operationId, request: { chapterId: 1, currentDraft: '', message: '继续', preferredSkill: 'continue' } }]))
})

test('real book/material readers expose exact evidence without mutating book files or requiring a chapter', async t => {
  const f = await fixture(t)
  const material = await f.research.createSource({ title: '雨夜设想', excerpt: '主角听见旧物的声音。', userNotes: '不要直接当成已发生事件' })
  const before = await hashes(f.project.path), dispatcher = f.dispatcher(bookContextTools(f))
  const context = await invoke(dispatcher, 'read_book_context')
  assert.equal(context.kind, 'completed')
  if (context.kind === 'completed') assert.match(JSON.stringify(context.value), /仙侠/)
  const sources = await invoke(dispatcher, 'read_materials')
  assert.equal(sources.kind, 'completed')
  if (sources.kind === 'completed') assert.deepEqual(sources.evidence, [{ kind: 'material', id: material.id, revision: material.contentHash }])
  assert.deepEqual(await hashes(f.project.path), before)
})

test('real manuscript versions reject stale generation before the domain task can start', async t => {
  const f = await fixture(t), chapter = await f.documents.createChapter()
  await f.documents.updateChapter(chapter.id, { content: '原稿', title: '雨夜' })
  let starts = 0
  const dispatcher = f.dispatcher(manuscriptTools({ ...f, writing: { async start() { starts++; assert.fail('stale input must not start a writing task') }, async status() { assert.fail() }, async cancel() { assert.fail() } } }, f.request, new Map()))
  const output = await invoke(dispatcher, 'read_manuscript', { chapterId: chapter.id })
  assert.equal(output.kind, 'completed')
  if (output.kind !== 'completed') return
  const revision = (output.value as { revision: string }).revision
  await f.documents.updateChapter(chapter.id, { content: '作者后续手写' })
  await assert.rejects(() => invoke(dispatcher, 'generate_manuscript', { chapterId: chapter.id, expectedRevision: revision, instruction: '继续' }), { code: 'CONFLICT' })
  await assert.rejects(() => invoke(dispatcher, 'read_manuscript', { chapterId: chapter.id + 100 }))
  assert.equal(starts, 0)
  assert.equal((await f.documents.chapter(chapter.id)).content, '作者后续手写')
})

test('real planning generator produces a non-canon package through the candidate adapter with no fake chapter', async t => {
  const f = await fixture(t)
  await f.workspace.saveBookProfile({ ...await f.workspace.bookProfile(), plannedVolumes: 1 })
  await f.workspace.saveFoundation({ ...await f.workspace.foundation(true), sourceNotes: '少年修复师听见旧物记忆，追查雨夜旧案。' })
  const before = await hashes(f.project.path)
  const responses = [
    { premise: '旧物有记忆', worldView: '记忆留存在旧物里，使用能力会疲倦', characters: [{ name: '沈砚', role: '修复师', arcSeed: '寻找失踪的人' }], powerSystem: '从听见片段到辨明完整记忆', cheatSystem: '触碰旧物可听见声音', rationale: '围绕记忆与真相展开' },
    { title: '雨夜旧案', summary: '修复师追查旧案', content: '从修复旧物发现疑点，追索线索与阻挠，最终查明真相。' },
    { volumes: [{ order: 1, title: '旧城雨声', goal: '发现关键线索', summary: '寻找第一件遗失的物品并查明旧案', storyContent:'沈砚修复旧物听见旧案中的争吵，循声音找到失踪者留下的物品，再根据物品追查当年的目击者。', ending: '真相浮现后面对新的选择' }] }
  ]
  let calls = 0
  const drafts = new PlanningDraftService({ async complete(instruction) { if(instruction.startsWith('复核下方完整候选'))return {content:'{"issues":[]}'};calls++; return { content: JSON.stringify(responses.shift()) } } }, f.workspace)
  const planning = new PlanningJobService(drafts)
  const dispatcher = f.dispatcher(planningTools({ ...f, planning, expansion: { async start() { assert.fail() }, async status() { assert.fail() }, async cancel() { assert.fail() } } }, f.request))
  const output = await f.projects.runInCurrentBook(() => invoke(dispatcher, 'generate_planning'))
  assert.equal(output.kind, 'completed')
  if (output.kind !== 'completed') return
  const taskId = (output.value as { taskId: string }).taskId
  let job = planning.status(taskId)
  for (let i = 0; i < 100 && job.status === 'running'; i++) { await new Promise(resolve => setTimeout(resolve, 10)); job = planning.status(taskId) }
  assert.equal(job.status, 'completed', JSON.stringify(job.error))
  assert.equal(job.proposal?.workItemId, f.project.id)
  assert.equal(job.proposal?.volumes.length, 1)
  assert.equal(calls, 3)
  assert.deepEqual(await f.documents.chapters(), [])
  assert.deepEqual(await hashes(f.project.path), before)
})
