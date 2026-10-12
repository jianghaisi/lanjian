import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'
import { readPluginPackage } from '@lanjian/writing-plugin-package'
import { bundledPackagePorts } from '../../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { buildPluginDraft } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginCompositionService } from '../../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { createCreativePolicyProvider } from '../../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { withContributionSnapshot } from '../../../src/main/modules/writing-plugins/runtime/contribution-context'
import { FoundationDraftService } from '../../../src/main/modules/planning/application/foundation-draft-service'
import type { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-policy-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new PluginDraftStore(root), packages = new PluginPackageStore(root), manager = new WritingPluginManager(packages, async () => {})
  const authoring = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const source = await manager.loadAuthorized('book-a', id, digest); return { manifest: source.version.manifest, files: source.files } } }, manager)
  const ports = bundledPackagePorts(root), bundled = new BundledPluginService(ports, manager, authoring), composition = new PluginCompositionService(manager)
  const capture = createCreativePolicyProvider(() => manager.captureComposition('book-a'), async v => (await manager.loadAuthorized('book-a', v.manifest.id, v.digest)).files)
  const reference = (p: { manifest: { id: string }; digest: string }) => ({ pluginId: p.manifest.id, digest: p.digest })
  async function select(entries: Parameters<PluginCompositionService['preview']>[1]) {
    const preview = await composition.preview('book-a', entries, (await manager.list()).revision, async () => {})
    assert.deepEqual(preview.conflicts, []); await composition.apply(preview.planId)
  }
  async function personal(text: string, mode = 'replace') {
    const official = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.story-planning')!
    const copy = await bundled.derive(reference(official)), manifest = JSON.parse(copy.manifestText)
    manifest.contributions[0].mode = mode
    manifest.contributions[0].configSchema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 } }, required: ['focus'], additionalProperties: false }
    if (mode === 'disabled') delete manifest.contributions[0].asset
    const edited = await authoring.save({ id: copy.id, revision: copy.revision, manifestText: JSON.stringify(manifest), files: copy.files.map(f => f.path === 'foundation.md' ? { ...f, content: text } : f) })
    const built = await authoring.build({ id: edited.id, revision: edited.revision })
    const preview = await authoring.preview({ id: edited.id, revision: edited.revision })
    let index = await manager.install(preview.planId)
    index = await manager.setEnabled(copy.pluginId, true, [], index.revision)
    await manager.setBookEnabled('book-a', copy.pluginId, true, index.revision)
    return { pluginId: copy.pluginId, digest: built.digest, contributionId: 'foundation', params: { focus: '人物选择' } }
  }
  return { root, packages, manager, ports, bundled, capture, personal, select }
}

const workspace = {
  bookProfile: async () => ({}), foundation: async () => ({}), hasPlanningMaterials: async () => true,
  effectivePrompt: async () => '作者保存的偏好', promptContext: async () => '作者资料与正式依据',
  contextBudgetPreferences: async () => ({ structuredRepairAttempts: 0 })
} as unknown as WorkspaceService
const candidate = { worldView: '设定候选', useRealms: false, realms: [], useSystem: false, systemTemplate: '', rationale: '用于验证方法替换' }

test('real derive/build/install/book composition replaces the foundation method and records exact sources', async t => {
  const f = await fixture(t), requests: { instruction: string; context: string }[] = []
  const service = new FoundationDraftService({ complete: async (instruction, _draft, context) => { requests.push({ instruction, context: context ?? '' }); return { content: JSON.stringify(candidate) } } }, workspace, async () => [], f.capture)
  await service.generate()
  const baseline = requests[0].instruction
  const entry = await f.personal('个人方法：从{{focus}}展开，先看约束与代价。')
  await f.select([entry]); assert.deepEqual(await service.generate(), candidate)
  assert.match(requests[1].instruction, /个人方法：从人物选择展开/)
  const defaultText = officialCreativePackages().find(p => p.manifest.id === 'lanjian.official.story-planning')!.files.get('foundation.md')!.trim()
  assert.ok(baseline.includes(defaultText)); assert.ok(!requests[1].instruction.includes(defaultText))
  assert.match(requests[1].context, new RegExp(entry.digest)); assert.match(requests[1].context, new RegExp(entry.pluginId.replaceAll('.', '\\.')))
  assert.match(requests[1].instruction, /待作者采用/); assert.match(requests[1].instruction, /字段必须/)
  const otherBook = createCreativePolicyProvider(() => f.manager.captureComposition('book-b'), async () => { throw Error('other book must not load personal package') })
  assert.equal((await otherBook()).resolve('foundation')[0].pluginId, 'lanjian.official.story-planning')
})

test('running policy snapshots remain stable across composition edits; disabled/collision/revocation fail before model send', async t => {
  const f = await fixture(t), entry = await f.personal('冻结方法：{{focus}}。')
  await f.select([entry]); const frozen = await f.capture(), snapshot = await f.manager.captureComposition('book-a')
  await f.select([{ ...entry, params: { focus: '后续修改' } }])
  assert.match(frozen.resolve('foundation')[0].text, /人物选择/)
  assert.match((await withContributionSnapshot(snapshot, f.capture)).resolve('foundation')[0].text, /人物选择/)
  assert.match((await f.capture()).resolve('foundation')[0].text, /后续修改/)
  const disabled = await f.personal('停用', 'disabled'); await f.select([disabled])
  let sends = 0
  const service = new FoundationDraftService({ complete: async () => { sends++; return { content: JSON.stringify(candidate) } } }, workspace, async () => [], f.capture)
  await assert.rejects(service.generate(), { code: 'FEATURE_UNAVAILABLE' }); assert.equal(sends, 0)
  const conflicts = await new PluginCompositionService(f.manager).preview('book-a', [entry, disabled], (await f.manager.list()).revision, async () => {})
  assert.ok(conflicts.conflicts.some(c => c.code === 'exclusive'))
  await f.manager.setEnabled(disabled.pluginId, false, [], (await f.manager.list()).revision)
  await assert.rejects(service.generate(), { code: 'CONFLICT' }); assert.equal(sends, 0)
})

test('production archives validate official policies/team and reject asset tampering before installation', async t => {
  const f = await fixture(t), first = await f.ports.load(), second = await bundledPackagePorts(f.root).load()
  assert.deepEqual(first.map(p => p.digest), second.map(p => p.digest))
  const official = first.filter(p => p.manifest.id.startsWith('lanjian.official.'))
  assert.deepEqual(official.map(p => p.manifest.id).sort(), ['lanjian.official.creative-team', 'lanjian.official.creative-writing', 'lanjian.official.story-planning'])
  assert.ok(official.every(p => p.manifest.tools.length === 0))
  const planning = official.find(p => p.manifest.id.endsWith('story-planning'))!
  const zip = new JSZip()
  for (const [path, bytes] of planning.files) zip.file(path, path === 'foundation.md' ? '非法参数{{credentials}}' : bytes)
  await assert.rejects(readPluginPackage(await zip.generateAsync({ type: 'uint8array' })))
  const path = join(f.root, 'invalid.lanjian-plugin'); await writeFile(path, await zip.generateAsync({ type: 'uint8array' }))
  await assert.rejects(f.manager.preview(f.manager.chooseNativeFile(path)))
  assert.deepEqual((await f.manager.list()).plugins, [])
})
