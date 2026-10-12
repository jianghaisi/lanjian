import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validatePluginManifest } from '@lanjian/writing-plugin-contracts'
import type { CompositionEntry } from '../../../src/contracts/writing-plugins/contributions'
import type { PluginManagementView } from '../../../src/contracts/writing-plugins/management-contracts'
import { unavailableContributions } from '../../../src/renderer/features/writing-plugins/composition-recovery'

const digest = 'a'.repeat(64), pluginId = 'personal.writing-composition', prefix = `${pluginId}/style/`
const entry = (): CompositionEntry => ({ pluginId, digest, contributionId: 'style', params: { tone: '未应用的声音', notes: { memo: '之前的完整备注' }, enabled: false } })
async function installed(): Promise<PluginManagementView['plugins']> {
  const manifest = validatePluginManifest(JSON.parse(await readFile(new URL('../../../examples/writing-plugins/writing-composition/lanjian-plugin.json', import.meta.url), 'utf8')))
  return [{ id: pluginId, current: digest, enabled: true, bookEnabled: true, provenance: { distribution: 'local', createdByMe: false }, versions: [{ digest, manifest, grants: [], installedAt: '2026-10-01T00:00:00Z' }] }]
}

test('uninstalled contributions keep exact selection and author parameters without inventing version metadata', () => {
  const draft = [entry()], before = JSON.stringify(draft), [missing] = unavailableContributions(draft, [], {}, {})
  assert.equal(missing.reason, '插件已卸载或尚未安装')
  assert.equal(missing.label, `${pluginId} · style`); assert.equal(missing.entry.digest, digest)
  assert.deepEqual(missing.parameters.map(p => [p.name, p.text]), [['tone', '未应用的声音'], ['notes', '{\n  "memo": "之前的完整备注"\n}'], ['enabled', '关闭']])
  assert.equal(JSON.stringify(draft), before)
})

test('raw incomplete JSON and empty text take precedence over parsed values; never-parsed fields are visible', () => {
  const raw = { [`${prefix}notes`]: '{"memo":', [`${prefix}tone`]: '', [`${prefix}newField`]: '[', [`${pluginId}/style-other/private`]: '其他贡献', 'other.plugin/style/private': '其他插件' }
  const errors = { [`${prefix}notes`]: '格式有误', [`${prefix}newField`]: '数组未完成' }, before = JSON.stringify([raw, errors])
  const [missing] = unavailableContributions([entry()], [], raw, errors)
  assert.equal(missing.parameters.find(p => p.name === 'notes')!.text, '{"memo":')
  assert.equal(missing.parameters.find(p => p.name === 'notes')!.error, '格式有误')
  assert.equal(missing.parameters.find(p => p.name === 'tone')!.text, '')
  assert.equal(missing.parameters.find(p => p.name === 'newField')!.text, '[')
  assert.equal(missing.parameters.length, 4); assert.equal(JSON.stringify([raw, errors]), before)
})

test('a different digest, including the same semantic version, cannot recover a pinned contribution', async () => {
  const plugins = await installed(); plugins[0].current = 'b'.repeat(64); plugins[0].versions[0].digest = plugins[0].current
  const draft = [entry()], before = JSON.stringify([draft, plugins])
  const [missing] = unavailableContributions(draft, plugins, {}, {})
  assert.equal(missing.reason, '本书选用的版本尚未安装'); assert.equal(missing.entry.digest, digest)
  assert.equal(JSON.stringify([draft, plugins]), before)
})

test('an installed version without the selected contribution gives a distinct reason and preserves unknown fields', async () => {
  const plugins = await installed(); plugins[0].versions[0].manifest.contributions = []
  const [missing] = unavailableContributions([entry()], plugins, {}, {})
  assert.equal(missing.reason, '这个版本未提供这项写作能力')
  assert.ok(missing.label.includes(plugins[0].versions[0].manifest.name)); assert.equal(missing.parameters.length, 3)
})

test('exact version recovery works even when a different version is current; permissions and book selection remain separate', async () => {
  const plugins = await installed(), other = structuredClone(plugins[0].versions[0]); other.digest = 'b'.repeat(64)
  plugins[0].versions.push(other); plugins[0].current = other.digest; plugins[0].enabled = false; plugins[0].bookEnabled = false
  const before = JSON.stringify(plugins)
  assert.deepEqual(unavailableContributions([entry()], plugins, { [`${prefix}notes`]: '{' }, {}), [])
  assert.equal(JSON.stringify(plugins), before)
})
