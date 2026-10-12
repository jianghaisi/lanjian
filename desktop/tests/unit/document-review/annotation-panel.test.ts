import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import { createAnnotationFormDrafts } from '../../../src/renderer/features/document-review/annotation-form-drafts'
import type { DocumentAnnotation } from '../../../src/contracts/document-review/annotations'

async function mount(save: (...args: unknown[]) => Promise<void>, drafts = createAnnotationFormDrafts()) {
  const source = await readFile(new URL('../../../src/renderer/features/document-review/AnnotationPanel.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  let code = compileScript(descriptor, { id: 'annotation-panel-test' }).content
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
    .replace(/import AnnotationRevisionPanel[^\n]+/, 'const AnnotationRevisionPanel = {};')
    .replace(/import \{ annotationFormDrafts \}[^\n]+/, 'const annotationFormDrafts = Drafts;')
  const compiled = await transformWithEsbuild(code, 'annotation-panel-test.ts', { loader: 'ts' })
  const Component = new Function('Vue', 'Drafts', compiled.code.replace('export default', 'return'))(Vue, drafts)
  Component.render = () => null
  const snapshot = Vue.shallowRef({ ref: { workItemId: 'book-A', kind: 'body', documentId: 'doc-A' } })
  const review = { snapshot, annotations: Vue.shallowRef<Array<{ id: string; status: string }>>([]), createAnnotation: save, changeAnnotation: save }
  const renderer = Vue.createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ render: () => Vue.h(Component, { review, selection: { start: 0, end: 2, text: '原文' } }) })
  const wrapper = app.mount({})
  type State = { body: string; pending: boolean; message: string; hasUnsavedOpinion: boolean; selected: string[]; editing: DocumentAnnotation | null; save: () => Promise<void>; edit: (item: DocumentAnnotation) => void; cancelEditing: () => void }
  const state = (wrapper.$.subTree.component! as Vue.ComponentInternalInstance & { setupState: State }).setupState
  return { state, snapshot, annotations: review.annotations, unmount: () => app.unmount() }
}

test('failed annotation save retains the input and exact retry operation', async t => {
  const operations: unknown[] = []
  const ctx = await mount(async (...args) => { operations.push(args[2]); throw Error('磁盘写入失败') }); t.after(ctx.unmount)
  ctx.state.body = '补充人物动机。'
  await ctx.state.save()
  assert.equal(ctx.state.body, '补充人物动机。')
  assert.equal(ctx.state.pending, false)
  assert.equal(ctx.state.message, '磁盘写入失败')
  await ctx.state.save()
  assert.equal(operations[1], operations[0])
  ctx.state.body = '补充人物动机和时间。'
  await ctx.state.save()
  assert.notEqual(operations[2], operations[0])
})

function annotation(id: string, body: string): DocumentAnnotation {
  return { id, body, revision: 3, status: 'open', document: { workItemId: 'book-A', kind: 'body', documentId: 'doc-A' },
    anchor: { start: 0, end: 2, quote: '原文', before: '', after: '', versionId: 'v1', documentHash: 'a'.repeat(64) }, createdAt: '', updatedAt: '' }
}

test('new unsaved opinions are identified until explicitly saved or cleared', async t => {
  const ctx = await mount(async () => {}); t.after(ctx.unmount)
  assert.equal(ctx.state.hasUnsavedOpinion, false)
  ctx.state.body = '尚未保存的新意见'; assert.equal(ctx.state.hasUnsavedOpinion, true)
  await ctx.state.save(); assert.equal(ctx.state.hasUnsavedOpinion, false)
  ctx.state.body = ' '; assert.equal(ctx.state.hasUnsavedOpinion, true)
  ctx.state.cancelEditing(); assert.equal(ctx.state.hasUnsavedOpinion, false)
})

test('opening an existing opinion is clean; editing or clearing its text is unsaved and survives remount', async t => {
  const drafts = createAnnotationFormDrafts(), first = await mount(async () => {}, drafts)
  first.state.edit(annotation('comment', '已保存的意见'))
  assert.equal(first.state.hasUnsavedOpinion, false)
  first.state.body = ''; assert.equal(first.state.hasUnsavedOpinion, true)
  first.unmount()
  const next = await mount(async () => {}, drafts); t.after(next.unmount)
  assert.equal(next.state.hasUnsavedOpinion, true)
  next.state.body = '已保存的意见'; assert.equal(next.state.hasUnsavedOpinion, false)
  next.state.body = '修改后的意见'; assert.equal(next.state.hasUnsavedOpinion, true)
  next.state.cancelEditing(); assert.equal(next.state.hasUnsavedOpinion, false)
})

test('unsubmitted opinions survive editor unmount/remount and remain separate across document kinds and books', async t => {
  const drafts = createAnnotationFormDrafts(), first = await mount(async () => {}, drafts)
  first.state.body = '正文未提交意见'
  first.unmount()
  const next = await mount(async () => {}, drafts); t.after(next.unmount)
  assert.equal(next.state.body, '正文未提交意见')
  const bodyDocument = next.snapshot.value
  next.snapshot.value = { ref: { workItemId: 'book-A', kind: 'chapter-outline', documentId: 'doc-A' } }
  assert.equal(next.state.body, '')
  next.state.body = '章纲未提交意见'
  next.snapshot.value = { ref: { workItemId: 'book-B', kind: 'body', documentId: 'doc-A' } }
  assert.equal(next.state.body, '')
  next.state.body = '乙书未提交意见'
  next.snapshot.value = bodyDocument
  assert.equal(next.state.body, '正文未提交意见')
  next.state.cancelEditing(); assert.equal(next.state.body, '')
})

test('an edited comment keeps its exact revision and opinion when the editor is recreated', async t => {
  const drafts = createAnnotationFormDrafts(), first = await mount(async () => {}, drafts)
  first.state.edit(annotation('comment-1', '原意见')); first.state.body = '更明确的意见'
  first.unmount()
  const submitted: unknown[][] = []
  const next = await mount(async (...args) => { submitted.push(args) }, drafts); t.after(next.unmount)
  assert.equal(next.state.editing?.id, 'comment-1'); assert.equal(next.state.editing?.revision, 3)
  assert.equal(next.state.body, '更明确的意见')
  await next.state.save()
  assert.equal(submitted[0]?.[0], 'update')
  assert.equal((submitted[0]?.[1] as DocumentAnnotation).revision, 3)
  assert.equal(submitted[0]?.[3], '更明确的意见')
  assert.equal(next.state.body, '')
})

test('a pending save remains locked after remount and its acknowledgement clears only the submitted opinion', async t => {
  const drafts = createAnnotationFormDrafts()
  let release!: () => void
  const first = await mount(() => new Promise<void>(resolve => { release = resolve }), drafts)
  first.state.body = '提交中的意见'; const saving = first.state.save(); first.unmount()
  const next = await mount(async () => { assert.fail('must not submit twice') }, drafts); t.after(next.unmount)
  assert.equal(next.state.pending, true)
  next.state.cancelEditing(); next.state.body = '不能覆盖提交中的输入'
  assert.equal(next.state.body, '提交中的意见')
  await next.state.save()
  release(); await saving
  assert.equal(next.state.pending, false); assert.equal(next.state.body, '')
})

test('a failed save arriving after unmount retains the opinion and exact retry operation', async t => {
  const drafts = createAnnotationFormDrafts(), operations: unknown[] = []
  let reject!: (error: Error) => void
  const first = await mount((...args) => { operations.push(args[2]); return new Promise<void>((_resolve, fail) => { reject = fail }) }, drafts)
  first.state.body = '不得丢失的意见'; const saving = first.state.save(); first.unmount()
  const next = await mount(async (...args) => { operations.push(args[2]) }, drafts); t.after(next.unmount)
  reject(new Error('写入未确认')); await saving
  assert.equal(next.state.body, '不得丢失的意见'); assert.equal(next.state.message, '写入未确认')
  await next.state.save()
  assert.equal(operations[0], operations[1])
})

test('opening another comment cannot silently overwrite an unsubmitted opinion', async t => {
  const ctx = await mount(async () => {}); t.after(ctx.unmount)
  ctx.state.body = '正在填写的新意见'
  ctx.state.edit(annotation('other', '其他批注'))
  assert.equal(ctx.state.body, '正在填写的新意见'); assert.equal(Boolean(ctx.state.editing), false)
  assert.match(ctx.state.message, /尚未保存/)
  ctx.state.cancelEditing(); ctx.state.edit(annotation('other', '其他批注'))
  ctx.state.body = '还在修改其他批注'
  ctx.state.edit(annotation('other', '其他批注'))
  assert.equal(ctx.state.body, '还在修改其他批注')
  ctx.state.edit(annotation('third', '第三条意见'))
  assert.equal(ctx.state.editing?.id, 'other'); assert.equal(ctx.state.body, '还在修改其他批注')
})

test('an old acknowledgement cannot clear a newer opinion for the same document', () => {
  const drafts = createAnnotationFormDrafts()
  drafts.set('document', '上一条意见', null)
  const previous = drafts.begin('document')!
  drafts.finish('document', previous.operation)
  drafts.set('document', '新的意见', null)
  drafts.finish('document', previous.operation)
  assert.equal(drafts.get('document')?.body, '新的意见')
})

test('annotation input follows its document and a late save cannot erase the next document input', async t => {
  let release!: () => void
  const ctx = await mount(() => new Promise<void>(resolve => { release = resolve })); t.after(ctx.unmount)
  const first = ctx.snapshot.value
  ctx.state.body = '甲稿意见'; ctx.state.selected = ['A']
  const saving = ctx.state.save()
  ctx.snapshot.value = { ref: { workItemId: 'book-B', kind: 'body', documentId: 'doc-B' } }
  assert.equal(ctx.state.body, ''); assert.deepEqual(ctx.state.selected, [])
  ctx.state.body = '乙稿尚未提交的意见'
  release(); await saving
  assert.equal(ctx.state.body, '乙稿尚未提交的意见'); assert.equal(ctx.state.message, '')
  ctx.snapshot.value = first
  assert.equal(ctx.state.body, '') // A was acknowledged; no duplicate draft.
  ctx.snapshot.value = { ref: { workItemId: 'book-B', kind: 'body', documentId: 'doc-B' } }
  assert.equal(ctx.state.body, '乙稿尚未提交的意见')
})

test('refresh retains selected open comments but removes resolved and deleted comments from generation selection', async t => {
  const ctx = await mount(async () => {}); t.after(ctx.unmount)
  ctx.state.selected = ['older', 'resolved', 'deleted']
  ctx.annotations.value = [{ id: 'new', status: 'open' }, { id: 'resolved', status: 'resolved' }, { id: 'deleted', status: 'deleted' }, { id: 'older', status: 'open' }]
  await Vue.nextTick()
  assert.deepEqual(ctx.state.selected, ['older'])
})
