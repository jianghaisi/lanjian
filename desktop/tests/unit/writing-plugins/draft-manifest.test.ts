import assert from 'node:assert/strict'
import test from 'node:test'
import { contributionLimits, validatePluginManifest } from '@lanjian/writing-plugin-contracts'
import { addDraftGuidance, editableDraftManifest, removeDraftGuidance, restoreDraftGuidance } from '../../../src/renderer/features/writing-plugins/draft-manifest'
import { pluginDraftTemplate } from '../../../src/main/modules/writing-plugins/domain/draft-templates'

const fixture = () => JSON.parse(pluginDraftTemplate('personal.test-guidance', 'context').manifestText)

test('unfinished guidance remains editable with exact input while production validation rejects it', () => {
  for (const text of ['', ' \n\t ', '{{unfinished_parameter}}']) {
    const strict = fixture(); strict.contributions[0].text = text
    assert.throws(() => validatePluginManifest(strict))
    const raw = fixture(); raw.name = ''; raw.version = '1.'; raw.description = ''
    raw.contributions[0].name = ' '; raw.contributions[0].text = text
    const editable = editableDraftManifest(JSON.stringify(raw))
    assert.deepEqual(editable, raw)
    assert.throws(() => validatePluginManifest(editable))
    const repaired = { ...editable!, name: '写作方法', version: '1.0.1', description: '简介', contributions: [{ ...raw.contributions[0], name: '声线', text: '保留对话声线。' }] }
    assert.equal(validatePluginManifest(repaired).contributions?.length, 1)
  }
})

test('add/copy/remove/undo preserve mixed contributions, source configuration and authored IDs', () => {
  const raw = fixture(), tool = JSON.parse(pluginDraftTemplate(raw.id, 'code').manifestText).tools[0]
  raw.tools = [tool]; raw.assets = ['notes.txt']
  raw.contributions[0].configSchema.properties.tone = { type: 'string', maxLength: 100 }
  raw.contributions[0].text = '保持 {{tone}} 的叙述。'
  raw.contributions[0].requires = [{ pluginId: 'personal.other', contributionId: 'voice' }]
  raw.contributions[0].exclusiveGroup = 'narration'
  raw.contributions.push({ id: 'guidance-1', kind: 'tool-reference', name: '统计', stages: ['assistant'], configSchema: { type: 'object', properties: {}, additionalProperties: false }, toolId: tool.id })
  const initial = validatePluginManifest(raw), before = structuredClone(initial)
  const added = addDraftGuidance(initial)
  assert.equal(added.id, 'guidance-2'); assert.equal(added.manifest.id, initial.id)
  assert.deepEqual(added.manifest.tools, initial.tools); assert.deepEqual(added.manifest.assets, initial.assets)
  assert.throws(() => validatePluginManifest(added.manifest), 'new blank guidance is a draft, not an installable package')
  const copied = addDraftGuidance(initial, 'voice')
  const copy = copied.manifest.contributions!.at(-1)!
  assert.deepEqual({ ...copy, id: 'voice', name: initial.contributions![0].name }, initial.contributions![0])
  assert.notEqual(copy.configSchema, initial.contributions![0].configSchema)
  assert.equal(validatePluginManifest(copied.manifest).contributions!.length, 3)
  const removed = removeDraftGuidance(copied.manifest, 'voice')
  assert.deepEqual(restoreDraftGuidance(removed.manifest, removed.removed), copied.manifest)
  assert.deepEqual(initial, before, 'no helper mutates its source')
  const empty = removeDraftGuidance(fixture(), 'voice')
  assert.equal(empty.manifest.contributions!.length, 0)
  assert.equal(addDraftGuidance(empty.manifest).manifest.contributions!.length, 1)
})

test('guidance limits, dependencies and undo collisions fail without dropping existing content', () => {
  const raw = fixture()
  raw.contributions.push({ ...raw.contributions[0], id: 'dependent', name: '依赖项', requires: [{ pluginId: raw.id, contributionId: 'voice' }] })
  assert.throws(() => removeDraftGuidance(raw, 'voice'), /仍依赖/)
  assert.throws(() => addDraftGuidance(raw, 'missing'), /已变化/)
  assert.throws(() => removeDraftGuidance(raw, 'missing'), /已变化/)
  const full = fixture(); full.contributions = Array.from({ length: contributionLimits.count }, (_, i) => ({ ...full.contributions[0], id: `entry-${i}` }))
  assert.throws(() => addDraftGuidance(full), /上限|最多/)
  const removed = removeDraftGuidance(raw, 'dependent')
  assert.throws(() => restoreDraftGuidance(full, removed.removed), /上限|最多/)
  assert.throws(() => restoreDraftGuidance(raw, removed.removed), /标识已被使用/)
  const first = addDraftGuidance(fixture()), deleted = removeDraftGuidance(first.manifest, first.id)
  assert.notEqual(addDraftGuidance(deleted.manifest, undefined, deleted.removed.contribution.id).id, first.id, 'new additions reserve the pending undo ID')
})

test('all guidance and non-guidance contributions preserve identity, schemas, dependencies, tools and assets', () => {
  const raw = fixture(), code = JSON.parse(pluginDraftTemplate(raw.id, 'code').manifestText)
  raw.tools = code.tools; raw.assets = ['notes.txt']
  raw.contributions.push({ ...raw.contributions[0], id: 'second', name: '', text: '', stages: ['review'], configSchema: { type: 'object', properties: { tone: { type: 'string', maxLength: 100 } }, additionalProperties: false }, requires: [{ pluginId: 'personal.other', contributionId: 'voice' }], exclusiveGroup: 'voice' })
  raw.contributions.push({ id: 'count', kind: 'tool-reference', name: '统计', stages: ['assistant'], configSchema: { type: 'object', properties: {}, additionalProperties: false }, toolId: 'count_text' })
  assert.deepEqual(editableDraftManifest(JSON.stringify(raw)), raw)
})

test('malformed structures use the advanced editor without accepting invalid contribution identities', () => {
  assert.equal(editableDraftManifest('{broken'), null)
  for (const mutate of [
    (m: ReturnType<typeof fixture>) => { m.contributions[0].stages = [] },
    (m: ReturnType<typeof fixture>) => { m.contributions[0].text = 3 },
    (m: ReturnType<typeof fixture>) => { m.contributions[0].configSchema = {} },
    (m: ReturnType<typeof fixture>) => { m.contributions.push(m.contributions[0]) },
    (m: ReturnType<typeof fixture>) => { m.capabilities = [3] },
    (m: ReturnType<typeof fixture>) => { m.id = 'builtin.forged' }
  ]) { const raw = fixture(); mutate(raw); assert.equal(editableDraftManifest(JSON.stringify(raw)), null) }
})

test('unfinished string tags remain editable and exact while production rejects duplicates and limits', () => {
  for (const tags of [['仙侠', '仙侠'], ['界'.repeat(41)], Array.from({ length: 25 }, (_, i) => `标签${i}`), [''], [' \t '], ['含\n换行']]) {
    const raw = fixture(); raw.tags = tags
    assert.throws(() => validatePluginManifest(raw))
    const projected = editableDraftManifest(JSON.stringify(raw))
    assert.deepEqual(projected, raw, 'invalid authored tags must not disappear or be repaired by the form projection')
    assert.throws(() => validatePluginManifest(projected))
    const repaired = { ...projected, tags: ['仙侠', '热血'] }
    assert.deepEqual(validatePluginManifest(repaired).tags, ['仙侠', '热血'])
  }
})

test('tag form projection preserves valid boundary values and rejects structural substitutions', () => {
  for (const tags of [undefined, [], ['界'.repeat(40)], Array.from({ length: 24 }, (_, i) => `标签${i}`), [' 保留源码空白 ', '逗号,是标签内容']]) {
    const raw = fixture(); if (tags === undefined) delete raw.tags; else raw.tags = tags
    assert.deepEqual(editableDraftManifest(JSON.stringify(raw)), raw)
    assert.deepEqual(validatePluginManifest(raw), raw)
  }
  for (const tags of ['仙侠,热血', null, [1], ['仙侠', {}], { 0: '仙侠' }]) {
    const raw = fixture(); raw.tags = tags
    assert.equal(editableDraftManifest(JSON.stringify(raw)), null)
  }
  const wrongIdentity = fixture(); wrongIdentity.tags = ['重复', '重复']; wrongIdentity.id = 'builtin.forged'
  assert.equal(editableDraftManifest(JSON.stringify(wrongIdentity)), null, 'draft-only tag tolerance cannot relax identity validation')
})
