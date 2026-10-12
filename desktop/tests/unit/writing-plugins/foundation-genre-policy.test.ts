import assert from 'node:assert/strict'
import test from 'node:test'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'
import type { CompositionEntry, CreativePackage, CreativeSlot, PluginComposition } from '@lanjian/writing-plugin-contracts'
import { FoundationDraftService } from '../../../src/main/modules/planning/application/foundation-draft-service'
import { creativePolicyRun } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import type { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'

const candidate = { worldView: '用于验证题材方法的合成设定。', useRealms: false, realms: [], useSystem: false, systemTemplate: '', rationale: '只作为待作者审阅候选。' }
function fixture(disabled?: CreativeSlot, explicitGenre?: string) {
  const pkg: CreativePackage = structuredClone(officialCreativePackages().find(p => p.manifest.id.endsWith('story-planning'))!)
  pkg.manifest.id = 'personal.foundation-genre'; pkg.digest = 'a'.repeat(64)
  const files = new Map(pkg.files); pkg.files = files
  for (const c of pkg.manifest.contributions!) if (c.kind === 'creative-policy') {
    if (c.slot === 'foundation') files.set(c.asset!, 'PERSONAL_FOUNDATION_ONLY')
    if (c.slot === 'genre-guidance') files.set(c.asset!, 'PERSONAL_GENRE_ONLY {{genre}} {{subgenre}}')
    if (c.slot === disabled) { c.mode = 'disabled'; delete c.asset }
  }
  const composition: PluginComposition = { revision: 4, entries: pkg.manifest.contributions!.filter(c => c.kind === 'creative-policy' && ['foundation', 'genre-guidance'].includes(c.slot)).map(c => {
    const params: CompositionEntry['params'] = c.id === 'genre-guidance' && explicitGenre ? { genre: explicitGenre, subgenre: '组合子题材' } : {}
    return { pluginId: pkg.manifest.id, digest: pkg.digest, contributionId: c.id, params }
  }) }
  let current = creativePolicyRun([pkg], composition), captures = 0, authorized = true
  const calls: Array<{ instruction: string; context: string }> = []
  const workspace = { bookProfile: async () => ({ genre: '都市', subgenre: '娱乐圈' }), foundation: async () => ({}), hasPlanningMaterials: async () => true,
    authorPrompt: async () => 'AUTHOR_OVERRIDE', promptContext: async (_id: unknown, _task: unknown, options: { policyManaged?: boolean }) => { assert.equal(options.policyManaged, true); return '正式事实与自定义境界/系统模板。' },
    contextBudgetPreferences: async () => ({ structuredRepairAttempts: 1 }) } as unknown as WorkspaceService
  const capture = async () => { captures++; const run = current; return { ...run, assertAuthorized: async () => { if (!authorized) throw Error('revoked') } } }
  const service = (reply?: (count: number) => Promise<string>) => new FoundationDraftService({ complete: async (instruction, _draft, context) => {
    calls.push({ instruction, context: context ?? '' }); return { content: reply ? await reply(calls.length) : JSON.stringify(candidate) }
  } }, workspace, undefined, capture)
  return { calls, service, captures: () => captures, revoke: () => { authorized = false }, change: () => { current = creativePolicyRun() } }
}

test('foundation consumes selected genre asset and declared book defaults; explicit composition parameters override defaults', async () => {
  for (const genre of [undefined, '悬疑']) {
    const f = fixture(undefined, genre); assert.deepEqual(await f.service().generate(), candidate)
    assert.equal(f.captures(), 1); assert.equal(f.calls.length, 1)
    assert.match(f.calls[0].instruction, /PERSONAL_FOUNDATION_ONLY/)
    assert.ok(f.calls[0].instruction.includes(`PERSONAL_GENRE_ONLY ${genre ?? '都市'} ${genre ? '组合子题材' : '娱乐圈'}`))
    assert.match(f.calls[0].instruction, /AUTHOR_OVERRIDE/); assert.match(f.calls[0].context, /genre-guidance/)
    assert.doesNotMatch(f.calls[0].instruction, /社会关系、职业细节和利益交换要可信/)
  }
})

test('disabled later genre method blocks foundation before the first request', async () => {
  const f = fixture('genre-guidance'); await assert.rejects(f.service().generate(), { code: 'FEATURE_UNAVAILABLE' }); assert.equal(f.calls.length, 0)
})

test('foundation JSON repair freezes the same genre method and parameters despite a changed current composition', async () => {
  const f = fixture(); assert.deepEqual(await f.service(async count => { f.change(); return count === 1 ? '{}' : JSON.stringify(candidate) }).generate(), candidate)
  assert.equal(f.captures(), 1); assert.equal(f.calls.length, 2)
  for (const call of f.calls) assert.match(call.instruction, /PERSONAL_GENRE_ONLY 都市 娱乐圈/)
})

test('withdrawal during a received foundation response rejects output and sends no repair with another/default method', async () => {
  const f = fixture(); await assert.rejects(f.service(async () => { f.revoke(); return '{}' }).generate(), /revoked/); assert.equal(f.calls.length, 1)
})
