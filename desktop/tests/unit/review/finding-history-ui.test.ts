import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import type { ConsistencyFindingHistoryEntry } from '../../../src/contracts/index'

async function render(entries: ConsistencyFindingHistoryEntry[], unsaved = false) {
  const source = await readFile(new URL('../../../src/renderer/features/review/components/FindingHistoryPanel.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  let code = compileScript(descriptor, { id: 'finding-history-test', inlineTemplate: true }).content
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
    (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
  const compiled = await transformWithEsbuild(code, 'FindingHistoryPanel.ts', { loader: 'ts' })
  const component: Vue.Component = new Function('Vue', compiled.code.replace('export default', 'return'))(Vue)
  return renderToString(Vue.createSSRApp(component, { history: { bodyVersionId: 'current-version', entries }, unsaved }))
}
const entry: ConsistencyFindingHistoryEntry = { id: 'finding-one', title: '重复段落', rationale: '同一段话出现两次。', status: 'stale', sourceBodyVersionId: 'older-version', resultingBodyVersionId: null, updatedAt: '2026-09-08T00:00:00.000Z' }

test('finding history starts collapsed, caps rendered records and offers explicit repair only for new saved prose', async () => {
  const html = await render(Array.from({ length: 25 }, (_, index) => ({ ...entry, id: `finding-${index}` })))
  assert.match(html, /<details[^>]*data-testid="finding-history"[^>]*>/)
  assert.doesNotMatch(html.match(/<details[^>]*>/)?.[0] || '', /\bopen\b/)
  assert.equal((html.match(/data-finding-id=/g) || []).length, 20)
  assert.match(html, /再显示 20 条记录/)
  assert.match(html, /我已修改，确认修复/)
  assert.doesNotMatch(html, /data-testid="confirm-finding-resolution"/)
})

test('unsaved prose disables repair; current source cannot be called repaired without a new version', async () => {
  const dirty = await render([entry], true)
  assert.match(dirty, /data-testid="preview-finding-resolution"[^>]*disabled/)
  assert.match(dirty, /请先返回书稿保存/)
  const unchanged = await render([{ ...entry, status: 'accepted', sourceBodyVersionId: 'current-version' }])
  assert.doesNotMatch(unchanged, /data-testid="preview-finding-resolution"/)
  assert.match(unchanged, /还没有新的正式正文版本/)
})

test('fixed and later-stale records retain the repair reference with different author-facing meaning', async () => {
  const fixed = await render([{ ...entry, status: 'fixed', resultingBodyVersionId: 'current-version' }])
  assert.match(fixed, /已确认修复/)
  assert.match(fixed, /修复于正文/)
  assert.doesNotMatch(fixed, /data-testid="preview-finding-resolution"/)
  const stale = await render([{ ...entry, resultingBodyVersionId: 'previous-repair' }])
  assert.match(stale, /曾确认修复于/)
  assert.match(stale, /旧修复记录不代表当前版本已经通过核对/)
})
