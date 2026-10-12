import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, realpath, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { validatePluginManifest, type JsonObject, type JsonValue, type PluginRecipe } from '@lanjian/writing-plugin-contracts'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { buildPluginDraft, buildPluginContent } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { readPluginPackage } from '../../../src/main/modules/writing-plugins/adapters/package-reader'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { executeGuest } from '../../../src/main/modules/writing-plugins/runtime/guest-engine'
import { declarativeSource } from '../../../src/main/modules/writing-plugins/runtime/declarative-source'
import { decodeDraftSaveArgs, decodeDraftRefArgs } from '../../../src/contracts/writing-plugins/authoring'
import { PluginManagement } from '../../../src/main/modules/writing-plugins/application/plugin-management'
import { PluginCompositionService } from '../../../src/main/modules/writing-plugins/application/composition-service'
import { inspectComposition } from '../../../src/main/modules/writing-plugins/domain/composition'
import { pluginDraftTemplate } from '../../../src/main/modules/writing-plugins/domain/draft-templates'
import type { PluginDraft } from '../../../src/contracts/writing-plugins/authoring'

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-authoring-')))
  const store = new PluginDraftStore(root), packages = new PluginPackageStore(root), manager = new WritingPluginManager(packages, async () => {})
  let source: string | null = null
  const service = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => source, installed: async (id, digest) => {
    const version = (await manager.list()).plugins.find(p => p.id === id)!.versions.find(v => v.digest === digest)!
    return { manifest: version.manifest, files: await packages.load(version) }
  } }, manager)
  return { root, store, packages, manager, service, setSource: (s: string | null) => { source = s } }
}
const ref = (d: { id: string; revision: number }) => ({ id: d.id, revision: d.revision })
const save = (d: { id: string; revision: number; manifestText: string; files: { path: string; content: string }[] }) => ({ ...ref(d), manifestText: d.manifestText, files: d.files })

function embeddedQuestionDraft(draft: PluginDraft, question: JsonValue, kind: 'workflow' | 'setting-template' = 'workflow'): PluginDraft {
  const template = pluginDraftTemplate('personal.question-fixture', 'workflow')
  const manifest = validatePluginManifest(JSON.parse(draft.manifestText)), tool = validatePluginManifest(JSON.parse(template.manifestText)).tools[0]
  const recipe: PluginRecipe = JSON.parse(template.files[0].content)
  tool.id = 'contribution__embedded'; recipe.tools[0].id = tool.id; recipe.tools[0].steps[0].args.question = question
  if (kind === 'setting-template') {
    tool.effect = 'candidate'; tool.capabilities.push('planning.candidate')
    recipe.tools[0].steps.push({ id: 'candidate', call: 'candidate.prepare', args: { kind: 'planning', key: 'total', input: { instruction: '准备候选' } } })
  }
  manifest.capabilities = [...new Set([...manifest.capabilities, ...tool.capabilities])]
  manifest.contributions = [...manifest.contributions ?? [], { id: 'embedded', name: 'PRIVATE_CONTRIBUTION_NAME', kind, stages: ['assistant'], configSchema: tool.inputSchema, tool, recipe }]
  return { ...draft, manifestText: JSON.stringify(manifest, null, 2) }
}

test('offline reads and validation are zero-write; saved drafts recover in another service instance', async () => {
  const f = await setup()
  assert.deepEqual(await f.service.list(), []); assert.deepEqual(await readdir(f.root), [])
  const draft = await f.service.create('context'), before = await readFile(join(f.root, 'plugin-drafts.json'))
  const built = await f.service.validate(ref(draft)); assert.equal(built.manifest.id, draft.pluginId)
  assert.deepEqual(await readdir(f.root), ['plugin-drafts.json']); assert.deepEqual(await readFile(join(f.root, 'plugin-drafts.json')), before)
  assert.deepEqual(await new PluginDraftStore(f.root).list(), [draft])
})
test('invalid editing text can be saved, stale simultaneous writes cannot replace it, build fails without altering bytes', async () => {
  const f = await setup(), draft = await f.service.create('code')
  const results = await Promise.allSettled([f.service.save({ ...save(draft), manifestText: '{invalid' }), f.service.save({ ...save(draft), manifestText: 'lost' })])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const saved = (await f.service.list())[0]; assert.equal(saved.manifestText, '{invalid'); assert.equal(saved.revision, 2)
  const before = await readFile(join(f.root, 'plugin-drafts.json'))
  await assert.rejects(f.service.build(ref(saved))); assert.deepEqual(await readFile(join(f.root, 'plugin-drafts.json')), before)
})

test('incomplete literal questions stay saved but every draft build path rejects before freezing, previewing or exporting', async () => {
  const f = await setup(), draft = await f.service.create('workflow'), recipe = JSON.parse(draft.files[0].content)
  recipe.tools[0].steps[0].args.question.questions[0].prompt = ' \n '
  const saved = await f.service.save({ ...save(draft), files: [{ path: 'recipe.json', content: '\ufeff' + JSON.stringify(recipe) + '\r\n' }] })
  const before = await readFile(join(f.root, 'plugin-drafts.json')), paths = await readdir(f.root)
  let persistCalls = 0, pickerCalls = 0
  const guarded = new PluginAuthoringService(f.store, {
    build: buildPluginDraft, persist: async b => { persistCalls++; return f.store.persist(b) },
    chooseExport: async () => { pickerCalls++; return null }, choosePackage: async () => null, chooseSource: async () => null,
    installed: async () => { throw new Error('Not used') }
  }, f.manager)
  for (const run of [() => guarded.validate(ref(saved)), () => guarded.build(ref(saved)), () => guarded.preview(ref(saved)), () => guarded.publication(ref(saved)), () => guarded.export({ ...ref(saved), digest: 'a'.repeat(64) })]) {
    await assert.rejects(run(), error => {
      assert.equal((error as { code: string }).code, 'VALIDATION_ERROR')
      assert.match((error as Error).message, /第 1 个工具的第 1 组提问/)
      assert.match((error as Error).message, /草稿仍可保存/)
      return true
    })
  }
  assert.equal(persistCalls, 0); assert.equal(pickerCalls, 0)
  assert.deepEqual(await readdir(f.root), paths); assert.deepEqual(await readFile(join(f.root, 'plugin-drafts.json')), before)
  assert.deepEqual(await new PluginDraftStore(f.root).list(), [saved]); assert.equal((await f.manager.list()).plugins.length, 0)
  const repaired = await guarded.save({ ...save(saved), files: draft.files })
  const built = await guarded.build(ref(repaired)); assert.equal(built.manifest.version, '1.0.0'); assert.equal(persistCalls, 1)
})

test('draft literal-question validation reuses actual question limits and never leaks authored content in diagnostics', async () => {
  const f = await setup(), draft = await f.service.create('workflow'), original = JSON.parse(draft.files[0].content)
  const question = original.tools[0].steps[0].args.question.questions[0]
  const invalid = [
    { ...question, prompt: '' }, { ...question, prompt: ' '.repeat(1001) }, { ...question, detail: 'x'.repeat(2001) },
    { ...question, mode: 'unknown' }, { ...question, required: 'yes' }, { ...question, id: '__proto__' },
    { ...question, options: [{ id: 'one', label: '一个' }] },
    { ...question, options: Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, label: '选项' })) },
    { ...question, options: [{ id: 'same', label: '甲' }, { id: 'same', label: '乙' }] },
    { ...question, options: [{ id: 'empty', label: ' \n' }, question.options[1]] },
    { ...question, options: [{ id: 'long', label: 'x'.repeat(121) }, question.options[1]] },
    { ...question, options: [{ ...question.options[0], description: 'x'.repeat(501) }, question.options[1]] },
    { ...question, mode: 'text' }, { ...question, hidden: true }
  ]
  const requests = invalid.map(q => ({ questions: [q] }))
  requests.push({ questions: [] }, { questions: [question, question] }, { questions: Array.from({ length: 4 }, (_, i) => ({ ...question, id: `q${i}` })) })
  for (const request of requests) {
    const recipe = structuredClone(original); recipe.tools[0].steps[0].args.question = request
    await assert.rejects(buildPluginDraft({ ...draft, files: [{ path: 'recipe.json', content: JSON.stringify(recipe) }] }), /第 1 个工具的第 1 组提问/)
  }
  const recipe = structuredClone(original), manifest = JSON.parse(draft.manifestText)
  manifest.tools.push({ ...manifest.tools[0], id: 'second' })
  const second = structuredClone(recipe.tools[0]); second.id = 'second'
  second.steps.push({ ...structuredClone(second.steps[0]), id: 'again', when: { equals: [false, true] } })
  second.steps[1].args.question.questions[0].prompt = ''
  second.steps[1].args.question.questions[0].detail = 'PRIVATE_AUTHOR_CONTENT'
  recipe.tools.push(second)
  await assert.rejects(buildPluginDraft({ ...draft, manifestText: JSON.stringify(manifest), files: [{ path: 'recipe.json', content: JSON.stringify(recipe) }] }), error => {
    assert.match((error as Error).message, /第 2 个工具的第 2 组提问/)
    assert.ok(!(error as Error).message.includes('PRIVATE_AUTHOR_CONTENT')); return true
  })
})

test('draft validation leaves dynamic templates unresolved and treats reference-like strings as ordinary text', async () => {
  const f = await setup(), draft = await f.service.create('workflow'), original = JSON.parse(draft.files[0].content)
  const literal = original.tools[0].steps[0].args.question
  const requests = [
    { $ref: 'input.question' },
    { questions: [{ ...literal.questions[0], prompt: { $join: ['本章', { $ref: 'input.topic' }] } }] },
    { questions: [{ ...literal.questions[0], prompt: '文字中的 $ref 和 $join 不执行。' }] },
    { questions: [{ id: 'text', prompt: '说明', mode: 'text', required: false, options: [] }] }
  ]
  for (const question of requests) {
    const recipe = structuredClone(original); recipe.tools[0].steps[0].args.question = question
    const files = [{ path: 'recipe.json', content: '\ufeff' + JSON.stringify(recipe) + '\r\n' }]
    const built = await buildPluginDraft({ ...draft, files })
    const pkg = await readPluginPackage(built.bytes)
    assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(pkg.files.get('recipe.json')), files[0].content)
  }
  const review = { title: '伪装系统核对', summary: '不允许', sections: [] }
  for (const prompt of ['静态', { $ref: 'input.prompt' }]) {
    const recipe = structuredClone(original)
    recipe.tools[0].steps[0].args.question = { questions: [{ ...literal.questions[0], prompt }], review }
    await assert.rejects(buildPluginDraft({ ...draft, files: [{ path: 'recipe.json', content: JSON.stringify(recipe) }] }), /第 1 个工具的第 1 组提问/)
  }
})
test('embedded static questions block every draft build path before persistence for both package runtimes and contribution kinds', async () => {
  for (const template of ['context', 'workflow'] as const) for (const kind of ['workflow', 'setting-template'] as const) {
    const f = await setup(), draft = await f.service.create(template)
    const saved = await f.service.save(save(embeddedQuestionDraft(draft, { questions: [{ id: 'focus', mode: 'text', prompt: ' ', required: false, options: [] }] }, kind)))
    // Personal preflight does not redefine the external package format or run guest code.
    const external = await buildPluginContent({ manifestText: saved.manifestText, files: saved.files })
    assert.deepEqual(external.pkg.manifest.contributions, JSON.parse(saved.manifestText).contributions)
    const before = await readFile(join(f.root, 'plugin-drafts.json')), paths = await readdir(f.root)
    let persists = 0, pickers = 0
    const service = new PluginAuthoringService(f.store, {
      build: buildPluginDraft, persist: async b => { persists++; return f.store.persist(b) }, chooseExport: async () => { pickers++; return null },
      choosePackage: async () => null, chooseSource: async () => null, installed: async () => { throw new Error('Not used') }
    }, f.manager)
    for (const run of [() => service.validate(ref(saved)), () => service.build(ref(saved)), () => service.preview(ref(saved)), () => service.publication(ref(saved)), () => service.export({ ...ref(saved), digest: 'a'.repeat(64) })]) {
      await assert.rejects(run(), error => {
        assert.equal((error as { code: string }).code, 'VALIDATION_ERROR')
        assert.match((error as Error).message, new RegExp(`第 ${template === 'context' ? 2 : 1} 项贡献的第 1 个工具的第 1 组提问`))
        assert.match((error as Error).message, /草稿仍可保存/); assert.ok(!(error as Error).message.includes('PRIVATE_CONTRIBUTION_NAME'))
        return true
      })
    }
    assert.equal(persists, 0); assert.equal(pickers, 0)
    assert.deepEqual(await readdir(f.root), paths); assert.deepEqual(await readFile(join(f.root, 'plugin-drafts.json')), before)
    assert.deepEqual((await f.manager.list()).plugins, [])
    const manifest = JSON.parse(saved.manifestText); manifest.contributions.at(-1).recipe.tools[0].steps[0].args.question.questions[0].prompt = '本章需要调整什么？'
    const repaired = await service.save({ ...save(saved), manifestText: JSON.stringify(manifest) })
    const built = await service.build(ref(repaired)); assert.equal(built.manifest.version, '1.0.0'); assert.equal(persists, 1)
    assert.deepEqual(repaired.files, draft.files)
  }
})

test('embedded question preflight preserves dynamic requests, diagnoses later groups and rejects protected reviews without leaking content', async () => {
  const f = await setup(), draft = await f.service.create('context')
  const question = { id: 'focus', mode: 'text', prompt: '普通文本 $ref', required: false, options: [] }
  const requests: JsonValue[] = [{ questions: [question] }, { $ref: 'input.question' }, { questions: [{ ...question, prompt: { $join: ['本章', { $ref: 'input.topic' }] } }] }]
  for (const request of requests) {
    const input = embeddedQuestionDraft(draft, request), before = structuredClone(input)
    const built = await buildPluginDraft(input), pkg = await readPluginPackage(built.bytes)
    assert.deepEqual(input, before)
    assert.deepEqual(pkg.manifest.contributions, JSON.parse(input.manifestText).contributions)
  }
  for (const prompt of ['普通文本', { $ref: 'input.prompt' }]) {
    const request = { questions: [{ ...question, prompt }], review: { title: 'PRIVATE_REVIEW', summary: 'PRIVATE_BODY', sections: [] } }
    await assert.rejects(buildPluginDraft(embeddedQuestionDraft(draft, request)), error => {
      assert.match((error as Error).message, /第 2 项贡献.*review 字段/)
      assert.ok(!(error as Error).message.includes('PRIVATE_')); return true
    })
  }
  const input = embeddedQuestionDraft(draft, { questions: [question] }), manifest = JSON.parse(input.manifestText)
  const recipe = manifest.contributions[1].recipe, second = structuredClone(recipe.tools[0].steps[0])
  second.id = 'again'; second.when = { equals: [false, true] }; second.args.question.questions[0].prompt = ''
  recipe.tools[0].steps.push(second)
  await assert.rejects(buildPluginDraft({ ...input, manifestText: JSON.stringify(manifest) }), /第 2 项贡献的第 1 个工具的第 2 组提问/)
})

test('corrupt draft storage is preserved and cannot be reset by create', async () => {
  const f = await setup(), bytes = '{broken'; await writeFile(join(f.root, 'plugin-drafts.json'), bytes)
  await assert.rejects(f.service.list()); await assert.rejects(f.service.create('code'))
  assert.equal(await readFile(join(f.root, 'plugin-drafts.json'), 'utf8'), bytes)
})
test('deterministic immutable build installs disabled, then version edits require a new version number', async () => {
  const f = await setup(), draft = await f.service.create('code'), first = await f.service.build(ref(draft))
  assert.deepEqual(await f.service.build(ref(draft)), first)
  const plan = await f.service.preview(ref(draft)); assert.equal(plan.digest, first.digest)
  const index = await f.manager.install(plan.planId)
  assert.equal(index.plugins[0].enabled, false); assert.deepEqual(index.plugins[0].versions[0].grants, [])
  const changed = await f.service.save({ ...save(draft), files: [{ path: 'main.js', content: draft.files[0].content + '// changed' }] })
  await assert.rejects(f.service.build(ref(changed)), /版本/)
  const m = JSON.parse(changed.manifestText); m.version = '1.0.1'
  const next = await f.service.save({ ...save(changed), manifestText: JSON.stringify(m) }); await f.service.build(ref(next))
  assert.equal((await f.manager.list()).plugins[0].current, first.digest)
})
test('manifest identity, undeclared files and unsafe file paths are rejected before build', async () => {
  const f = await setup(), draft = await f.service.create('context'), manifest = JSON.parse(draft.manifestText)
  await assert.rejects(buildPluginDraft({ ...draft, manifestText: JSON.stringify({ ...manifest, id: 'official.forged' }) }))
  await assert.rejects(buildPluginDraft({ ...draft, files: [...draft.files, { path: 'extra.js', content: '' }] }))
  for (const path of ['../escape.js', 'C:/private.js', 'main.js/inside', 'CON', 'lanjian-plugin.json']) {
    await assert.rejects(buildPluginDraft({ ...draft, files: [{ path, content: '' }] }))
  }
  assert.throws(() => decodeDraftRefArgs([{ ...ref(draft), path: 'private' }]))
  assert.throws(() => decodeDraftSaveArgs([{ ...save(draft), token: 'secret' }]))
})
test('source import requires explicit picker and current revision; cancelled selection leaves draft untouched', async () => {
  const f = await setup(), draft = await f.service.create('code')
  assert.equal(await f.service.importSource(ref(draft)), null)
  f.setSource('export async function execute() { return { characters: 7 }; }')
  const changed = await f.service.importSource(ref(draft)); assert.equal(changed?.revision, 2)
  await assert.rejects(f.service.importSource(ref(draft)))
  assert.match(changed!.files[0].content, /characters: 7/)
})
test('derived plugins receive new owned identities and explicit upstream provenance', async () => {
  const f = await setup(), draft = await f.service.create('context'), preview = await f.service.preview(ref(draft))
  await f.manager.install(preview.planId)
  const derived = await f.service.derive(draft.pluginId, preview.digest)
  assert.notEqual(derived.pluginId, draft.pluginId); assert.deepEqual(derived.upstream, { pluginId: draft.pluginId, version: '1.0.0', digest: preview.digest })
  assert.equal(JSON.parse(derived.manifestText).id, derived.pluginId)
  const management = new PluginManagement(f.manager, { currentBook: async () => null, chooseZip: async () => null, provenance: async id => ({ distribution: 'local', createdByMe: await f.service.owns(id) }) })
  assert.deepEqual((await management.list(false)).plugins[0].provenance, { distribution: 'local', createdByMe: true })
  assert.equal(await f.service.owns('official.external'), false)
})

test('installed copies compose using their own dependencies without enabling the original plugin', async () => {
  const f = await setup(), draft = await f.service.create('context'), manifest = JSON.parse(draft.manifestText)
  manifest.contributions.push({ ...manifest.contributions[0], id: 'dependent', requires: [{ pluginId: draft.pluginId, contributionId: 'voice' }] })
  const saved = await f.service.save({ ...save(draft), manifestText: JSON.stringify(manifest) })
  const preview = await f.service.preview(ref(saved)), originalIndex = await f.manager.install(preview.planId)
  const originalFiles = await f.packages.load(originalIndex.plugins[0].versions[0])
  const derived = await f.service.derive(saved.pluginId, preview.digest)
  assert.deepEqual(JSON.parse(derived.manifestText).contributions[1].requires, [{ pluginId: derived.pluginId, contributionId: 'voice' }])
  assert.deepEqual(derived.files, saved.files)
  assert.deepEqual(await f.manager.list(), originalIndex)
  assert.deepEqual((await f.service.list()).find(d => d.id === saved.id), saved)
  const copyPreview = await f.service.preview(ref(derived))
  let index = await f.manager.install(copyPreview.planId)
  index = await f.manager.setEnabled(derived.pluginId, true, [], index.revision)
  index = await f.manager.setBookEnabled('book-copy', derived.pluginId, true, index.revision)
  const entries = ['voice', 'dependent'].map(contributionId => ({ pluginId: derived.pluginId, digest: copyPreview.digest, contributionId, params: {} }))
  const composition = new PluginCompositionService(f.manager)
  const missing = await composition.preview('book-copy', entries.slice(1), index.revision, async () => {})
  assert.deepEqual(missing.conflicts.map(c => c.code), ['missing'])
  await assert.rejects(composition.apply(missing.planId), { code: 'CONFLICT' })
  const valid = await composition.preview('book-copy', entries, index.revision, async () => {})
  assert.deepEqual(valid.conflicts, []); await composition.apply(valid.planId)
  const captured = await f.manager.captureComposition('book-copy')
  assert.deepEqual(captured.composition.entries, entries)
  assert.deepEqual(captured.resolved.map(c => c.contribution.id), ['voice', 'dependent'])
  assert.deepEqual(captured.versions.map(v => v.manifest.id), [derived.pluginId])
  assert.deepEqual((await f.manager.list()).plugins.find(p => p.id === saved.pluginId), originalIndex.plugins[0])
  assert.deepEqual(await f.packages.load(originalIndex.plugins[0].versions[0]), originalFiles)
})

test('offline and repeated copies rebind only exact structured self references, preserving external dependencies and bytes', async () => {
  const f = await setup(), draft = await f.service.create('context'), manifest = JSON.parse(draft.manifestText)
  const external = [{ pluginId: 'community.other', contributionId: 'voice' }, { pluginId: `${draft.pluginId}.extension`, contributionId: 'voice' }]
  manifest.contributions[0].text = `Reference in authored text: ${draft.pluginId}`
  manifest.contributions.push({ ...manifest.contributions[0], id: 'empty', requires: [] }, {
    ...manifest.contributions[0], id: 'dependent', requires: [external[0], { pluginId: draft.pluginId, contributionId: 'voice' }, external[1]]
  })
  manifest.assets = ['notes.txt']
  const files = [{ path: 'main.js', content: `\ufeff// ${draft.pluginId}\r\n${draft.files[0].content}` }, { path: 'notes.txt', content: `\ufeff${draft.pluginId}\r\n保持源码和资源原文` }]
  const built = await buildPluginDraft({ ...draft, manifestText: JSON.stringify(manifest), files })
  const source = await readPluginPackage(built.bytes), before = structuredClone(source), originalZip = Buffer.from(built.bytes)
  const importer = new PluginAuthoringService(f.store, {
    build: buildPluginDraft, persist: b => f.store.persist(b), chooseExport: async () => null, chooseSource: async () => null,
    choosePackage: async () => source, installed: async () => { throw new Error('Offline copy must not read installed packages') }
  }, f.manager)
  const copied = (await importer.importPackage())!, copiedManifest = JSON.parse(copied.manifestText)
  assert.deepEqual(copiedManifest.contributions, manifest.contributions.map((c: typeof manifest.contributions[0]) => c.id === 'dependent'
    ? { ...c, requires: [external[0], { pluginId: copied.pluginId, contributionId: 'voice' }, external[1]] } : c))
  assert.deepEqual(copied.files, files); assert.deepEqual(structuredClone(source), before); assert.deepEqual(built.bytes, originalZip)
  const copyBuild = await buildPluginDraft(copied), copyPackage = await readPluginPackage(copyBuild.bytes)
  const second = await f.service.derivePackage(copyPackage, copyPackage.digest)
  assert.deepEqual(JSON.parse(second.manifestText).contributions[2].requires, [external[0], { pluginId: second.pluginId, contributionId: 'voice' }, external[1]])
  assert.deepEqual(second.upstream, { pluginId: copied.pluginId, version: '1.0.0', digest: copyPackage.digest })
  assert.deepEqual(second.files, files); assert.deepEqual((await f.service.list()).find(d => d.id === copied.id), copied)
  for (const file of files) assert.deepEqual(copyPackage.files.get(file.path), source.files.get(file.path))
  assert.deepEqual((await f.manager.list()).plugins, [])
  const plan = await f.service.preview(ref(copied))
  let index = await f.manager.install(plan.planId)
  index = await f.manager.setEnabled(copied.pluginId, true, [], index.revision)
  index = await f.manager.setBookEnabled('book-copy', copied.pluginId, true, index.revision)
  const entries = ['voice', 'dependent'].map(contributionId => ({ pluginId: copied.pluginId, digest: plan.digest, contributionId, params: {} }))
  const conflicts = inspectComposition(index, 'book-copy', entries).conflicts
  assert.deepEqual(conflicts.map(c => c.code), ['missing', 'missing'])
  for (const dependency of external) assert.ok(conflicts.some(c => c.message.includes(`${dependency.pluginId}/${dependency.contributionId}`)))
})

test('copying does not repair missing targets or dependency cycles, and preserves manifests without contributions', async () => {
  const f = await setup(), empty = await f.service.create('code'), emptyBuild = await buildPluginDraft(empty)
  const plain = await f.service.derivePackage(await readPluginPackage(emptyBuild.bytes), emptyBuild.view.digest)
  assert.equal(Object.hasOwn(JSON.parse(plain.manifestText), 'contributions'), false)
  for (const target of ['missing', 'voice']) {
    const draft = await f.service.create('context'), manifest = JSON.parse(draft.manifestText)
    manifest.contributions[0].requires = [{ pluginId: draft.pluginId, contributionId: target }]
    const built = await buildPluginDraft({ ...draft, manifestText: JSON.stringify(manifest) })
    const copied = await f.service.derivePackage(await readPluginPackage(built.bytes), built.view.digest)
    assert.deepEqual(JSON.parse(copied.manifestText).contributions[0].requires, [{ pluginId: copied.pluginId, contributionId: target }])
    const plan = await f.service.preview(ref(copied))
    let index = await f.manager.install(plan.planId)
    index = await f.manager.setEnabled(copied.pluginId, true, [], index.revision)
    index = await f.manager.setBookEnabled('book-copy', copied.pluginId, true, index.revision)
    const entries = [{ pluginId: copied.pluginId, digest: plan.digest, contributionId: 'voice', params: {} }]
    assert.deepEqual(inspectComposition(index, 'book-copy', entries).conflicts.map(c => c.code), [target === 'voice' ? 'cycle' : 'missing'])
    await assert.rejects(f.manager.applyComposition('book-copy', entries, index.revision, async () => {}), { code: 'CONFLICT' })
  }
})
test('draft symlink/junction storage escape preserves both target and unrelated files', async () => {
  const f = await setup(), other = await setup()
  await symlink(other.root, join(f.root, 'plugin-builds'), process.platform === 'win32' ? 'junction' : 'dir')
  const draft = await f.service.create('code'); await assert.rejects(f.service.build(ref(draft)))
  assert.deepEqual(await readdir(other.root), [])
})
test('all templates pass production validation and both code and interaction templates run inside QuickJS', async () => {
  const f = await setup(), wasm = new Uint8Array(await readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))).buffer
  for (const template of ['context', 'workflow', 'code'] as const) {
    const draft = await f.service.create(template), built = await f.service.validate(ref(draft))
    if (template === 'context') continue
    const source = template === 'workflow' ? declarativeSource(draft.files[0].content, built.manifest) : draft.files[0].content
    const calls: string[] = []; let checkpoint: JsonValue = null
    let result = await executeGuest({ invocationId: template, toolId: built.manifest.tools[0].id, source, input: template === 'code' ? { text: '你好🌏' } : {} }, wasm, async (method, input) => { calls.push(method); checkpoint = (input as JsonObject).checkpoint; return {} }, new AbortController().signal)
    assert.equal(result.ok, true)
    const answers = [{ id: 'focus', chosenOptionIds: ['plot'], customText: '保留伏笔，不提前揭晓。', skipped: false }]
    if (template === 'workflow') result = await executeGuest({ invocationId: 'resumed', toolId: built.manifest.tools[0].id, source, input: {}, continuation: { checkpoint, answer: { answers } } }, wasm, async () => { throw new Error('must not ask again') }, new AbortController().signal)
    assert.equal(result.ok, true)
    if (result.ok) {
      if (template === 'code') assert.deepEqual(result.value, { characters: 3 })
      else { assert.deepEqual((result.value as JsonObject).answers, answers); assert.match(String((result.value as JsonObject).text), /plot 表示情节/) }
    }
    assert.deepEqual(calls, template === 'code' ? [] : ['interaction.request'])
  }
})
