import assert from 'node:assert/strict'
import test from 'node:test'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'
import type { CreativeSlot } from '@lanjian/writing-plugin-contracts'
import { creativePolicyRun } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { FieldAssistantService } from '../../../src/main/modules/assistant/application/field-assistant-service'
import { fieldPolicySlot } from '../../../src/main/modules/assistant/domain/field-policy-slot'
import { decodeFieldCandidate, decodeFieldRequest, type FieldTask } from '../../../src/contracts/assistant/field-assistant-contracts'

function fixture(fieldId: string, disabled?: CreativeSlot) {
  const source = officialCreativePackages().find(p => p.manifest.id === 'lanjian.official.story-planning')!
  const manifest = structuredClone(source.manifest), files = new Map(source.files), digest = 'a'.repeat(64)
  manifest.id = 'personal.fields'
  const slot = fieldPolicySlot(fieldId)
  manifest.contributions = manifest.contributions!.filter(c => c.kind === 'creative-policy' && [slot, 'outline-review'].includes(c.slot))
  for (const c of manifest.contributions) if (c.kind === 'creative-policy') {
    if (c.slot === disabled) { c.mode = 'disabled'; delete c.asset }
    else files.set(c.asset!, `个人字段方法 ${c.slot}：依据人物选择分析当前输入。`)
  }
  const composition = { revision: 8, entries: manifest.contributions.map(c => ({ pluginId: manifest.id, digest, contributionId: c.id, params: {} })) }
  const calls: { instruction: string; context: string }[] = [], tasks = new Map<string, FieldTask>()
  let captures = 0, scope: string | null = 'book-a', output = '周子昂留下，承担选择后的代价。', release: Promise<void> | undefined
  const service = new FieldAssistantService({
    assertScope: async s => { assert.equal(s, scope) }, context: async () => '本书正式依据：周子昂留在城市。',
    prepareModel: async () => ({ model: 'fixture', connectionId: 'fixture', complete: async (instruction, _draft, context) => {
      calls.push({ instruction, context }); composition.revision = 99
      for (const file of files.keys()) if (file.endsWith('.md')) files.set(file, '以后修改的方法')
      await release
      return { content: instruction.startsWith('复核下方') ? '{"issues":[]}' : JSON.stringify({ value: output }) }
    } }), readTasks: async () => [...tasks.values()].map(t => structuredClone(t)), writeTask: async t => { tasks.set(t.id, structuredClone(t)) }
  }, async () => { captures++; return creativePolicyRun([{ manifest, files, digest }], composition) })
  const request = () => decodeFieldRequest({ operationId: 'field-policy-fixture', target: { fieldId, instanceId: 'fixture', editorSessionId: 'fixture', workItemId: scope, pageId: 'fixture', label: '字段', revision: 1, value: '旧输入' }, instruction: '作者当前要求标记：只修改这一项。' })
  const settle = async () => { for (let i = 0; i < 200; i++) { const t = tasks.get('field-policy-fixture'); if (t && t.status !== 'running') return t; await new Promise(r => setTimeout(r, 2)) } throw Error('Timed out') }
  return { service, request, settle, calls, tasks, captures: () => captures, scope: (s: string | null) => { scope = s }, output: (s: string) => { output = s }, wait: (p: Promise<void>) => { release = p } }
}

test('field families use actual selected methods, keep one snapshot through review and persist closed diagnostic sources', async () => {
  for (const [id, slot, reviewed] of [
    ['definition.bookProfile.coreIdea', 'field-edit', false], ['Realm.name', 'foundation', false],
    ['AppShell.storyEntityDraft.profileJson', 'characters', false], ['AppShell.item.arcSeed', 'characters', true],
    ['ChronicleEvents.event', 'events', true], ['AppShell.totalOutline', 'revision', true]
  ] as const) {
    const f = fixture(id); if (id.endsWith('profileJson')) f.output('{"description":"周子昂承担选择后的代价。"}')
    await f.service.start(f.request()); const task = await f.settle()
    assert.equal(task.status, 'completed', task.error ?? 'field candidate failed'); assert.equal(f.captures(), 1); assert.equal(f.calls.length, reviewed ? 2 : 1)
    assert.match(f.calls[0].context, new RegExp('个人字段方法 ' + slot)); assert.match(f.calls[0].instruction, /作者当前要求标记/)
    for (const call of f.calls) assert.doesNotMatch(call.context + call.instruction, /以后修改的方法|先规划故事，再组织文档/)
    if (reviewed) assert.match(f.calls[1].instruction, /个人字段方法 outline-review/)
    const candidate = decodeFieldCandidate(JSON.parse(JSON.stringify(task.candidate)))
    assert.ok(candidate.creativePolicy?.every(p => p.pluginId === 'personal.fields' && p.compositionRevision === 8))
    assert.deepEqual(candidate.creativePolicy?.map(p => p.slot), reviewed ? [slot, 'outline-review'] : [slot])
    assert.throws(() => decodeFieldCandidate({ ...candidate, creativePolicy: [{ ...candidate.creativePolicy![0], approved: true }] }))
    assert.equal(f.request().target.value, '旧输入'); assert.equal(candidate.status, 'candidate')
  }
})

test('disabled methods including a later review prevent the first model send and cannot widen the value schema', async () => {
  for (const disabled of ['revision', 'outline-review'] as const) {
    const f = fixture('AppShell.totalOutline', disabled); await f.service.start(f.request()); const task = await f.settle()
    assert.equal(task.status, 'failed'); assert.equal(task.candidate, undefined); assert.equal(f.calls.length, 0)
  }
  const f = fixture('definition.bookProfile.plannedVolumes'); await f.service.start(f.request()); const task = await f.settle()
  assert.equal(task.status, 'failed'); assert.equal(task.candidate, undefined)
})

test('application and projectless fields use official methods without capturing another book composition', async () => {
  const f = fixture('AppShell.createForm.name'); f.scope(null); f.output('合成作品名')
  await f.service.start(f.request()); const task = await f.settle()
  assert.equal(task.status, 'completed'); assert.equal(f.captures(), 0); assert.doesNotMatch(f.calls[0].context, /个人字段方法/)
  assert.equal(task.candidate?.creativePolicy?.[0].pluginId, 'lanjian.official.story-planning')
  const application = fixture('LibraryAppearance.background'); application.output('paper')
  const request = application.request(); request.target.options = ['paper', 'wood']
  await application.service.start(request); assert.equal((await application.settle()).status, 'completed'); assert.equal(application.captures(), 0)
})

test('cancellation or book changes cannot publish a late plugin-driven field candidate', async () => {
  for (const action of ['cancel', 'switch'] as const) {
    const f = fixture('AppShell.totalOutline'); let release!: () => void
    f.wait(new Promise<void>(r => { release = r })); await f.service.start(f.request())
    for (let i = 0; !f.calls.length && i < 100; i++) await new Promise(r => setTimeout(r, 2))
    if (action === 'cancel') await f.service.cancel('field-policy-fixture', 'book-a'); else f.scope('book-b')
    release(); await new Promise(r => setTimeout(r, 15))
    assert.equal(f.tasks.get('field-policy-fixture')?.candidate, undefined)
    assert.equal(f.tasks.get('field-policy-fixture')?.status, action === 'cancel' ? 'cancelled' : 'failed')
  }
})
