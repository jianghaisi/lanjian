import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validatePluginManifest } from '@lanjian/writing-plugin-contracts'
import type { CompositionEntry } from '../../../src/contracts/writing-plugins/contributions'
import type { PluginManagementView } from '../../../src/contracts/writing-plugins/management-contracts'
import { describeCompositionEntry, reviewComposition } from '../../../src/renderer/features/writing-plugins/composition-review'

const digest = 'a'.repeat(64), pluginId = 'personal.writing-composition'
const entry = (contributionId = 'style', params: CompositionEntry['params'] = { tone: '已保存声音' }): CompositionEntry => ({ pluginId, digest, contributionId, params })
async function installed(): Promise<PluginManagementView['plugins']> {
  const manifest = validatePluginManifest(JSON.parse(await readFile(new URL('../../../examples/writing-plugins/writing-composition/lanjian-plugin.json', import.meta.url), 'utf8')))
  return [{ id: pluginId, current: digest, enabled: true, bookEnabled: true, provenance: { distribution: 'local', createdByMe: false }, versions: [{ digest, manifest, grants: [], installedAt: '2026-10-01T00:00:00Z' }] }]
}

test('review follows proposed order then removed items; it never edits the saved or proposed snapshots', async () => {
  const saved = [entry(), entry('workflow', { voice: '旧口吻' })], proposed = [entry('reference', {}), entry('style', { tone: '新声音' })], plugins = await installed()
  const before = JSON.stringify([saved, proposed, plugins]), review = reviewComposition(saved, proposed, plugins)
  assert.deepEqual(review.counts, { added: 1, removed: 1, changed: 1, unchanged: 0 })
  assert.deepEqual(review.rows.map(r => [r.key, r.status]), [[`${pluginId}/reference`, 'added'], [`${pluginId}/style`, 'changed'], [`${pluginId}/workflow`, 'removed']])
  assert.equal(review.rows[1].parameters[0].before, '已保存声音'); assert.equal(review.rows[1].parameters[0].after, '新声音')
  assert.equal(review.rows[2].parameters[0].after, undefined); assert.equal(review.orderChanged, false)
  assert.equal(JSON.stringify([saved, proposed, plugins]), before)
})

test('object key order is ignored recursively; array order and primitive type changes remain visible', () => {
  const a = entry('style', { data: { a: [{ x: 1, y: true }], b: null } }), b = entry('style', { data: { b: null, a: [{ y: true, x: 1 }] } })
  assert.equal(reviewComposition([a], [b], []).counts.unchanged, 1)
  for (const [before, after] of [[['a', 'b'], ['b', 'a']], [0, '0'], [false, 'false'], [null, 'null']]) {
    const review = reviewComposition([entry('style', { value: before })], [entry('style', { value: after })], [])
    assert.equal(review.counts.changed, 1); assert.equal(review.rows[0].parameters[0].changed, true)
  }
})

test('unset, empty text, zero and false remain distinct and removed parameters are explicit', () => {
  const saved = entry('style', { removed: '旧值', empty: '', zero: 0, off: false }), proposed = entry('style', { added: '', empty: '', zero: 0, off: false })
  const rows = reviewComposition([saved], [proposed], []).rows[0].parameters
  assert.deepEqual(rows.find(p => p.name === 'removed'), { name: 'removed', label: 'removed', before: '旧值', after: undefined, changed: true })
  assert.equal(rows.find(p => p.name === 'added')!.before, undefined); assert.equal(rows.find(p => p.name === 'added')!.after, '')
  assert.deepEqual(rows.filter(p => !p.changed).map(p => p.after), ['', '0', '关闭'])
})

test('exact package digests drive version changes, even for equal semantic versions and a different current package', async () => {
  const plugins = await installed(), other = structuredClone(plugins[0].versions[0]); other.digest = 'b'.repeat(64)
  other.manifest.name = '不同包'; plugins[0].versions.push(other); plugins[0].current = other.digest
  const proposed = { ...entry(), digest: other.digest }, [row] = reviewComposition([entry()], [proposed], plugins).rows
  assert.equal(row.status, 'changed'); assert.equal(row.versionChanged, true)
  assert.match(row.before!.label, /^写作组合示例 1.0.0/); assert.match(row.after!.label, /^不同包 1.0.0/)
  assert.equal(row.before!.entry.digest, digest); assert.equal(row.parameters[0].changed, false)
})

test('missing original metadata falls back to identity without borrowing current-version descriptions', async () => {
  const plugins = await installed(); plugins[0].versions[0].digest = 'b'.repeat(64); plugins[0].current = 'b'.repeat(64)
  const [row] = reviewComposition([entry()], [], plugins).rows
  assert.equal(row.before!.label, `${pluginId} 版本不可用 · style`); assert.deepEqual(row.before!.stages, [])
  assert.equal(row.parameters[0].label, 'tone'); assert.equal(row.before!.entry.digest, digest)
})

test('relative order changes are explicit; insertions and removals alone do not report a reorder', () => {
  const a = entry('style'), b = entry('workflow'), c = entry('reference')
  assert.equal(reviewComposition([a, b], [c, a, b], []).orderChanged, false)
  assert.equal(reviewComposition([a, b, c], [b, c], []).orderChanged, false)
  const reordered = reviewComposition([a, b], [b, a], [])
  assert.equal(reordered.orderChanged, true); assert.equal(reordered.counts.unchanged, 2)
  assert.deepEqual(reordered.rows.map(r => r.key), [`${pluginId}/workflow`, `${pluginId}/style`])
})

test('empty preview explains all removals; empty-to-empty has no fabricated changes', () => {
  const cleared = reviewComposition([entry(), entry('workflow')], [], [])
  assert.equal(cleared.counts.removed, 2); assert.equal(cleared.rows.every(r => !r.after && r.before), true)
  assert.deepEqual(reviewComposition([], [], []), { rows: [], counts: { added: 0, removed: 0, changed: 0, unchanged: 0 }, orderChanged: false })
})

test('saved-entry presentation retains existing labels, values and structured formatting', async () => {
  const view = describeCompositionEntry(entry('style', { tone: '克制', notes: { memo: '原文' }, flag: false }), await installed())
  assert.match(view.label, /写作组合示例 1.0.0 · 叙事声音/)
  assert.deepEqual(view.parameters.map(p => [p.label, p.text, p.structured]), [['叙事声音', '克制', false], ['notes', '{\n  "memo": "原文"\n}', true], ['flag', '关闭', false]])
})
