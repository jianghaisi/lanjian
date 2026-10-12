import test from 'node:test'
import assert from 'node:assert/strict'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'
import { creativePolicyRun, withCreativePolicy } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { createCreativePolicyProvider } from '../../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { completeStoryOutline } from '../../../src/main/modules/planning/application/story-outline-review'
import { FoundationDraftService } from '../../../src/main/modules/planning/application/foundation-draft-service'
import { FieldAssistantService } from '../../../src/main/modules/assistant/application/field-assistant-service'
import type { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import type { InstalledVersion, PluginIndex, PluginPackageStorePort } from '../../../src/main/modules/writing-plugins/domain/installed'
import type { FieldTask } from '../../../src/contracts/assistant/field-assistant-contracts'
import { AppError } from '../../../src/main/core/errors/app-error'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'

function guarded() {
  let allowed = true, checks = 0
  return { policy: { ...creativePolicyRun(), assertAuthorized: async () => { checks++; if (!allowed) throw Error('revoked') } }, revoke: () => { allowed = false }, checks: () => checks }
}

test('provider copies original versions and composition before asynchronous load; current authorization remains book scoped', async () => {
  const pkg = officialCreativePackages().find(p => p.manifest.id === 'lanjian.official.story-planning')!
  const version: InstalledVersion = { manifest: structuredClone(pkg.manifest), digest: 'a'.repeat(64), files: [], installedAt: 'fixture', origin: 'local', grants: [] }
  const snapshot = { versions: [version], composition: { revision: 7, entries: [{ pluginId: version.manifest.id, digest: version.digest, contributionId: 'foundation', params: {} }] } }
  const bytes = new Map([...pkg.files].map(([path, text]) => [path, new TextEncoder().encode(text)])), allowed = new Set(['book-a', 'book-b'])
  let captures = 0
  const provider = (book: string) => createCreativePolicyProvider(async () => { captures++; return snapshot }, async v => {
    assert.equal(v.digest, 'a'.repeat(64)); assert.equal(v.manifest.version, pkg.manifest.version)
    snapshot.composition.revision = 99; version.digest = 'b'.repeat(64); version.manifest.version = '9.0.0'
    if (!allowed.has(book)) throw Error('book grant revoked')
    return bytes
  })
  const first = await provider('book-a')(); assert.equal(first.resolve('foundation')[0].compositionRevision, 7)
  allowed.delete('book-a'); await assert.rejects(first.assertAuthorized!(), /book grant revoked/)
  // A second captured book retains independent grants; do not recapture the mutated source.
  const second = createCreativePolicyProvider(async () => ({ versions: [{ ...version, manifest: structuredClone(pkg.manifest), digest: 'a'.repeat(64) }], composition: { revision: 0, entries: [] } }), async () => { assert.ok(allowed.has('book-b')); return bytes })
  await (await second()).assertAuthorized!(); assert.equal(captures, 1)
})

test('authorization checks surround the operation, prevent a first send and discard already received output', async () => {
  const f = guarded(); let sends = 0
  await assert.rejects(withCreativePolicy(f.policy, async () => { sends++; f.revoke(); return { content: '合成字段' } }), /revoked/)
  assert.equal(sends, 1); assert.equal(f.checks(), 2)
  await assert.rejects(withCreativePolicy(f.policy, async () => { sends++; return null }), /revoked/); assert.equal(sends, 1)
})

test('story generation, parser repair and review share one frozen route; revocation cannot become another repair or review call', async () => {
  const f = guarded(); let captures = 0, sends = 0
  const complete = async (instruction: string) => { sends++; return { content: instruction.startsWith('复核下方') ? '{"issues":[]}' : sends === 1 ? 'invalid' : '{"content":"周子昂留下。"}' } }
  await completeStoryOutline({ ai: { captureRun: async () => { captures++; return { complete } }, complete: async () => { throw Error('unfrozen route') } }, policy: f.policy, task: 'outline', instruction: '生成合成大纲', systemContext: '', repairAttempts: 1, parent: '周子昂留下。', parse: text => { try { return JSON.parse(text) } catch { throw new AppError('AI_RESPONSE_INVALID', 'invalid') } } })
  assert.equal(captures, 1); assert.equal(sends, 3); assert.equal(f.checks(), 6)
  const revoked = guarded(); let lateSends = 0
  await assert.rejects(completeStoryOutline({ ai: { complete: async () => { lateSends++; revoked.revoke(); return { content: '{"content":"周子昂留下。"}' } } }, policy: revoked.policy, task: 'outline', instruction: '合成大纲', systemContext: '', repairAttempts: 3, parent: '', parse: JSON.parse }), /revoked/)
  assert.equal(lateSends, 1)
})

test('foundation freezes once and refuses a late candidate after grant withdrawal', async () => {
  const f = guarded(); let captures = 0, sends = 0
  const complete = async () => { sends++; f.revoke(); return { content: '{"worldView":"合成设定","useRealms":false,"realms":[],"useSystem":false,"systemTemplate":"","rationale":"校验"}' } }
  const workspace = { bookProfile: async () => ({}), foundation: async () => ({}), hasPlanningMaterials: async () => true, authorPrompt: async () => '', promptContext: async () => '正式资料', contextBudgetPreferences: async () => ({ structuredRepairAttempts: 3 }) } as unknown as WorkspaceService
  const service = new FoundationDraftService({ captureRun: async () => { captures++; return { complete } }, complete: async () => { throw Error('unfrozen') } }, workspace, undefined, async () => f.policy)
  await assert.rejects(service.generate(), /revoked/); assert.equal(captures, 1); assert.equal(sends, 1)
})

test('ordinary and reviewed fields cannot publish a late revoked candidate, including revocation during review', async () => {
  for (const [fieldId, revokeAt] of [['definition.bookProfile.coreIdea', 1], ['AppShell.totalOutline', 1], ['AppShell.totalOutline', 2]] as const) {
    const f = guarded(), tasks = new Map<string, FieldTask>(); let sends = 0
    const service = new FieldAssistantService({ assertScope: async () => {}, context: async () => '周子昂留下。', prepareModel: async () => ({ model: 'fixture', connectionId: 'fixture', complete: async instruction => { sends++; if (sends === revokeAt) f.revoke(); return { content: instruction.startsWith('复核下方') ? '{"issues":[]}' : '{"value":"周子昂留下，面对代价。"}' } } }), readTasks: async () => [...tasks.values()], writeTask: async task => { tasks.set(task.id, structuredClone(task)) } }, async () => f.policy)
    await service.start({ operationId: 'guard-fixture', target: { fieldId, workItemId: 'book-a', pageId: 'fixture', instanceId: 'fixture', editorSessionId: 'fixture', label: '字段', revision: 1, value: '旧输入' }, instruction: '完善这一项' })
    for (let i = 0; tasks.get('guard-fixture')?.status === 'running' && i < 100; i++) await new Promise(r => setTimeout(r, 2))
    assert.equal(tasks.get('guard-fixture')?.status, 'failed'); assert.equal(tasks.get('guard-fixture')?.candidate, undefined); assert.equal(sends, revokeAt)
  }
})

test('actual manager rechecks authorization after byte validation; a withdrawn book grant cannot globally disable other books', async () => {
  const pkg = officialCreativePackages().find(p => p.manifest.id === 'lanjian.official.story-planning')!
  for (const mode of ['book', 'global'] as const) {
    const version: InstalledVersion = { manifest: structuredClone(pkg.manifest), digest: 'a'.repeat(64), files: [], installedAt: 'fixture', origin: 'local', grants: [] }
    let index: PluginIndex = { format: 1, revision: 0, plugins: [{ id: pkg.manifest.id, enabled: true, current: version.digest, versions: [version] }], books: ['book-a', 'book-b'].map(id => ({ id, plugins: [pkg.manifest.id] })) }
    let release!: () => void, loaded = false
    const blocked = new Promise<void>(r => { release = r })
    const store: PluginPackageStorePort = { read: async () => structuredClone(index), write: async (next, revision) => { assert.equal(index.revision, revision); index = structuredClone(next) },
      load: async () => { loaded = true; await blocked; return new Map([['foundation.md', new TextEncoder().encode('已验证字节')]]) },
      readZip: async () => { throw Error('unused') }, publish: async () => { throw Error('unused') }, remove: async () => { throw Error('unused') } }
    const manager = new WritingPluginManager(store, async () => {})
    const pending = manager.loadAuthorized('book-a', pkg.manifest.id, version.digest)
    for (let i = 0; !loaded && i < 100; i++) await new Promise(r => setTimeout(r, 2))
    assert.equal(loaded, true)
    if (mode === 'book') await manager.setBookEnabled('book-a', pkg.manifest.id, false, index.revision)
    else await manager.setEnabled(pkg.manifest.id, false, [], index.revision)
    release(); await assert.rejects(pending, { code: 'CONFLICT' })
    if (mode === 'book') {
      assert.equal(index.plugins[0].enabled, true)
      assert.equal((await manager.loadAuthorized('book-b', pkg.manifest.id, version.digest)).version.digest, version.digest)
    } else assert.equal(index.plugins[0].enabled, false)
  }
})
