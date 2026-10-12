import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { mkdtemp, realpath, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { ResearchLibraryService } from '../../src/main/modules/library/application/research-library-service'
import { BookImportService } from '../../src/main/modules/library/application/book-import-service'
import { OutlinePlanningService } from '../../src/main/modules/planning/application/outline-planning-service'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'
import { CharacterStateService } from '../../src/main/modules/characters/application/character-state-service'
import { ContinuationAnalysisService } from '../../src/main/modules/library/application/continuation-analysis-service'
import { WorkspaceWriteCoordinator } from '../../src/main/core/application/workspace-write-coordinator'
import { AiClient } from '../../src/main/modules/models/application/ai-client'
import { LOCAL_CONNECTION_ID } from '../../src/contracts/models/local-model-contracts'
import type { TextCompletionInput } from '../../src/main/modules/models/domain/model-provider'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { PluginDraftStore } from '../../src/main/modules/writing-plugins/adapters/draft-store'
import { buildPluginDraft } from '../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginAuthoringService } from '../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginCompositionService } from '../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { createCreativePolicyProvider } from '../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { createContributionContextProvider } from '../../src/main/modules/writing-plugins/runtime/contribution-context'
import { registerLibraryImportCommands } from '../../src/main/modules/library/runtime/import-commands'
import { importIpcValueDecoders } from '../../src/contracts/app/ipc-import-result-contracts'

class ObservedWrites extends WorkspaceWriteCoordinator {
  writeCalls = 0; private fromRead = false
  override read<T>(root: string, fn: () => T | Promise<T>): Promise<T> { const previous = this.fromRead; this.fromRead = true; try { return super.read(root, fn) } finally { this.fromRead = previous } }
  override run<T>(root: string, fn: () => T | Promise<T>): Promise<T> { if (!this.fromRead) this.writeCalls++; return super.run(root, fn) }
}
const areas = ['projectDefinition', 'existingPlot', 'characters', 'worldView', 'powerSystem', 'cheatSystem', 'totalOutline', 'volumeOutline', 'chapterOutline']
const proposal = JSON.stringify({ sections: areas.map(area => ({ area, status: 'missing', content: '', evidence: [] })), rationale: '仅验证整理方法，原材料不足的部分交由作者审阅。' })
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-continuation-policy-'))), releases: Array<() => void> = []
  t.after(async () => { releases.forEach(r => r()); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '旧稿方法隔离验证', genre: '悬疑' })
  const documents = new DocumentService(projects), research = new ResearchLibraryService(projects), imports = new BookImportService(projects, documents, research)
  const outlines = new OutlinePlanningService(projects, documents, research), workspace = new WorkspaceService(projects, outlines, research, documents), characters = new CharacterStateService(projects)
  // Existing static source, never a generated/revised body or an outline confirmation.
  const source = join(root, '原静态材料.txt'); await writeFile(source, '第一章 资料\n资料员核对作者提供的记录。', 'utf8')
  const preview = await imports.previewFiles([source]); await imports.commitManifest({ id: preview.id, files: [{ token: preview.files[0].token, ownership: 'owned', creationMethod: 'human', title: '静态材料', selectedChapterIndexes: [0] }] })
  const journal = JSON.parse(await readFile(join(project.path, '.webnovel', 'imports', 'manifests', preview.id, 'manifest.json'), 'utf8'))
  const staged = join(project.path, journal.files[0].stagedSource), path = join(project.path, '.webnovel', 'imports', 'continuation-analysis-candidate.json'), writes = new ObservedWrites()
  let manager = new WritingPluginManager(new PluginPackageStore(root), async () => {})
  const drafts = new PluginDraftStore(root), authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: b => drafts.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const pkg = await manager.loadAuthorized((await projects.currentSummary()).id, id, digest); return { manifest: pkg.version.manifest, files: pkg.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring), original = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.story-planning')!
  let draft = await bundled.derive({ pluginId: original.manifest.id, digest: original.digest }), manifest = JSON.parse(draft.manifestText)
  manifest.contributions = manifest.contributions.filter((c: { slot: string }) => ['continuation-analysis', 'genre-guidance'].includes(c.slot))
  for (const c of manifest.contributions) c.configSchema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 }, ...(c.slot === 'genre-guidance' ? { genre: { type: 'string', maxLength: 100 }, subgenre: { type: 'string', maxLength: 100 } } : {}) }, required: ['focus'], additionalProperties: false }
  manifest.contributions.push({ id: 'original-fragment', kind: 'context-fragment', name: '原参考', stages: ['planning'], text: 'ORIGINAL_FRAGMENT', configSchema: { type: 'object', properties: {}, additionalProperties: false } })
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => ['continuation-analysis.md', 'genre-guidance.txt'].includes(f.path) ? { ...f, content: `ORIGINAL_${f.path} {{focus}}${f.path.endsWith('.txt') ? ' {{genre}}' : ''}` } : f) })
  async function install() {
    const built = await authoring.build({ id: draft.id, revision: draft.revision }), preview = await authoring.preview({ id: draft.id, revision: draft.revision })
    let index = await manager.install(preview.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision); await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
    return manifest.contributions.map((c: { id: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: c.id === 'original-fragment' ? {} : { focus: 'ORIGINAL_PARAMS' } })) as CompositionEntry[]
  }
  async function select(entries: CompositionEntry[]) { const c = new PluginCompositionService(manager), p = await c.preview(project.id, entries, (await manager.list()).revision, async () => {}); assert.deepEqual(p.conflicts, []); await c.apply(p.planId) }
  await select(await install())
  const capture = async () => manager.captureComposition((await projects.currentSummary()).id), policy = createCreativePolicyProvider(capture, async v => (await manager.loadAuthorized((await projects.currentSummary()).id, v.manifest.id, v.digest)).files), fragments = createContributionContextProvider(capture)
  const calls: TextCompletionInput[] = []; let model = 'original-model', formal = 'AUTHOR_REQUIREMENT\n正式境界：作者定义\n固定系统：[属性]', respond: () => Promise<string> = async () => proposal, contextHook: (() => Promise<void>) | undefined
  const ai = new AiClient({ resolve: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture', profile: { connectionId: LOCAL_CONNECTION_ID, model, temperature: 0, topP: 1, maxTokens: 2000 } }), resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture' }) }, {
    listModels: async () => ['original-model', 'changed-model'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 2000 }), toolStep: async () => assert.fail('no prose/tools'), complete: async input => { calls.push(input); return { content: await respond() } }
  })
  const make = () => new ContinuationAnalysisService(ai, projects, imports, workspace, characters, outlines, undefined, { capturePolicy: policy, writes,
    context: async (_readOnly, selected) => { const profile = await workspace.bookProfile(); selected.resolve('genre-guidance', { genre: profile.genre || '', subgenre: profile.subgenre || '' }); const result = await writes.read(project.path, async () => `${formal}\n${await workspace.planningMaterials(true)}\n${JSON.stringify(await fragments('planning'))}`); await contextHook?.(); return result } })
  let service = make(); const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
  registerLibraryImportCommands({ handle: (channel, handler) => { handlers.set(channel, handler) } }, { bookImports: imports, continuationAnalysis: service })
  return { root, path, project, projects, documents, workspace, imports, writes, calls, manifestId: preview.id, service: () => service,
    start: () => service.generate(preview.id), ipc: () => handlers.get('imports:generate-continuation-analysis')!(undefined, preview.id) as Promise<{ ok: boolean; value: any }>, select,
    respond: (fn: typeof respond) => { respond = fn }, contextHook: (fn?: () => Promise<void>) => { contextHook = fn }, trackRelease: (fn: () => void) => releases.push(fn),
    revoke: async () => manager.setBookEnabled(project.id, draft.pluginId, false, (await manager.list()).revision), changeModel: () => { model = 'changed-model' }, changeFormal: () => { formal += '\nchanged formal' }, tamperSource: () => writeFile(staged, 'changed static source', 'utf8'),
    reopen: () => { manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}); service = make() },
    disable: async (slot: string) => { manifest.version = '1.5.1'; const c = manifest.contributions.find((c: { slot?: string }) => c.slot === slot); c.mode = 'disabled'; delete c.asset; draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files }); await select(await install()) }
  }
}

test('real imported evidence and production IPC consume installed analysis/genre methods and retain readable provenance without formal writes', async t => {
  const f = await fixture(t), before = await f.documents.chapters(), result = await f.ipc(); assert.equal(result.ok, true)
  const sent = JSON.stringify(f.calls[0].messages); assert.match(sent, /ORIGINAL_continuation-analysis.md ORIGINAL_PARAMS/); assert.match(sent, /ORIGINAL_genre-guidance.txt ORIGINAL_PARAMS 悬疑/); assert.match(sent, /AUTHOR_REQUIREMENT|ORIGINAL_FRAGMENT|固定系统/)
  assert.equal(result.value.creativePolicy[0].slot, 'continuation-analysis'); assert.equal(result.value.creativePolicy[0].text, undefined)
  f.reopen(); assert.equal((await f.service().state()).candidate?.id, result.value.id); assert.equal(f.calls.length, 1); assert.deepEqual(await f.documents.chapters(), before)
})

test('composition changes during completion retain the original installed method and reference fragment', async t => {
  const f = await fixture(t); f.respond(async () => { await f.select([]); return proposal }); const candidate = await f.start()
  assert.match(JSON.stringify(f.calls[0].messages), /ORIGINAL_continuation-analysis.md|ORIGINAL_FRAGMENT/); assert.equal(candidate.creativePolicy?.[0].version, '1.0.0')
})

test('malformed stored or public method provenance is evidence and cannot carry method text or authorize a new run', async t => {
  const f = await fixture(t), candidate = await f.start(), malformed = { ...candidate, creativePolicy: candidate.creativePolicy!.map(c => ({ ...c, text: 'UNTRUSTED_METHOD_TEXT' })) }
  assert.throws(() => importIpcValueDecoders['imports:generate-continuation-analysis']!(malformed, 'candidate'))
  const bytes = JSON.stringify(malformed); await writeFile(f.path, bytes)
  assert.ok((await f.service().state()).blockedReason); await assert.rejects(f.start()); assert.equal(f.calls.length, 1); assert.equal(await readFile(f.path, 'utf8'), bytes)
})

test('selected analysis or genre disabled refuses the first request and creates no candidate', async t => {
  for (const slot of ['continuation-analysis', 'genre-guidance']) { const f = await fixture(t); await f.disable(slot); await assert.rejects(f.start()); assert.equal(f.calls.length, 0); await assert.rejects(readFile(f.path), { code: 'ENOENT' }) }
})

test('late withdrawn, model-changed or formally changed output is withheld before candidate file publication', async t => {
  for (const action of ['revoke', 'model', 'formal']) { const f = await fixture(t); f.respond(async () => { await ({ revoke: f.revoke, model: f.changeModel, formal: f.changeFormal }[action]!)(); return proposal }); await assert.rejects(f.start()); assert.equal(f.calls.length, 1); await assert.rejects(readFile(f.path), { code: 'ENOENT' }) }
})

test('source or model changing during async context reads refuses dispatch with zero requests', async t => {
  for (const action of ['source', 'model']) { const f = await fixture(t); let reads = 0; f.contextHook(async () => { if (++reads === 2) await (action === 'source' ? f.tamperSource() : f.changeModel()) }); await assert.rejects(f.start()); assert.equal(f.calls.length, 0) }
})

test('all JSON repair requests retain the original installed policy and withdrawal prevents the next repair', async t => {
  const f = await fixture(t); f.respond(async () => f.calls.length === 1 ? 'invalid synthetic analysis' : proposal); await f.start(); assert.equal(f.calls.length, 2)
  for (const input of f.calls) assert.match(JSON.stringify(input.messages), /ORIGINAL_continuation-analysis.md ORIGINAL_PARAMS/)
  const other = await fixture(t); other.respond(async () => { await other.revoke(); return 'invalid synthetic analysis' }); await assert.rejects(other.start()); assert.equal(other.calls.length, 1); await assert.rejects(readFile(other.path), { code: 'ENOENT' })
})

test('an invalid new generation preserves an older valid candidate and writes only a guarded raw diagnostic', async t => {
  const f = await fixture(t); await f.start(); const before = await readFile(f.path); f.respond(async () => 'invalid synthetic analysis')
  await assert.rejects(f.start()); assert.deepEqual(await readFile(f.path), before)
  const raw = (await readdir(dirname(f.path))).filter(p => /^continuation-analysis-failed-.*\.txt$/.test(p)); assert.equal(raw.length, 1); assert.equal(await readFile(join(dirname(f.path), raw[0]), 'utf8'), 'invalid synthetic analysis')
})

test('author editing a valid candidate during generation prevents a late overwrite', async t => {
  const f = await fixture(t), candidate = await f.start(); let edited: unknown
  f.respond(async () => { edited = await f.service().saveEdits({ candidateId: candidate.id, sections: candidate.sections.map(s => ({ area: s.area, content: s.content })), rationale: 'AUTHOR_NEW_EDIT' }); return proposal })
  await assert.rejects(f.start()); assert.equal(JSON.parse(await readFile(f.path, 'utf8')).rationale, 'AUTHOR_NEW_EDIT'); assert.ok(edited)
})

test('valid and invalid file publication queued in the actual book write lane rejects late withdrawal and leaves no raw or candidate', async t => {
  for (const output of [proposal, 'invalid synthetic analysis']) {
    const f = await fixture(t); await f.workspace.saveContextBudgetPreferences({ ...await f.workspace.contextBudgetPreferences(), structuredRepairAttempts: 0 })
    let reads = 0, post!: () => void, releasePost!: () => void, lane!: () => void, releaseLane!: () => void
    const atPost = new Promise<void>(r => { post = r }), postGate = new Promise<void>(r => { releasePost = r }), inLane = new Promise<void>(r => { lane = r }), laneGate = new Promise<void>(r => { releaseLane = r })
    f.trackRelease(releasePost); f.trackRelease(releaseLane); f.respond(async () => output); f.contextHook(async () => { if (++reads === 3) { post(); await postGate } })
    const pending = f.start().then(() => assert.fail('withdrawn candidate cannot publish'), error => error); await atPost
    const blocker = f.writes.run(f.project.path, async () => { lane(); await laneGate }); await inLane; const before = f.writes.writeCalls; releasePost()
    for (let i = 0; f.writes.writeCalls === before && i < 200; i++) await new Promise(r => setTimeout(r, 10))
    assert.ok(f.writes.writeCalls > before, 'file publication must actually queue, independently of reads'); await f.revoke(); releaseLane(); await blocker; await pending
    await assert.rejects(readFile(f.path), { code: 'ENOENT' }); assert.equal(f.calls.length, 1)
  }
})
