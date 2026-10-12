import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import * as BookSettings from '../../../src/contracts/models/book-model-settings'
import * as Drafts from '../../../src/renderer/features/models/services/model-connections-state'
import * as QuickSetup from '../../../src/renderer/features/models/services/model-quick-setup'

const source = await readFile(new URL('../../../src/renderer/features/models/components/ModelConnectionsSettings.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'settings-feedback' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
  .replace(/import[^\n]+from ['"][^'"]+book-model-settings['"];?/g, 'const { isReferencedBookSettings } = BookSettings;')
  .replace(/import[^\n]+from ['"][^'"]+model-connections-state['"];?/g, 'const { routingDraft, compileRouting, selectModel, modelTaskLabels } = Drafts;')
  .replace(/import[^\n]+from ['"][^'"]+model-quick-setup['"];?/g, 'const { saveTestedModelDefault } = QuickSetup;')
  .replace(/import (Archive\w+|Model\w+) from [^\n]+/g, 'const $1 = {};')
const compiled = await transformWithEsbuild(script, 'ModelConnectionsSettings.ts', { loader: 'ts' })
const load = new Function('Vue', 'BookSettings', 'Drafts', 'QuickSetup', compiled.code.replace('export default', 'return'))
type State = {
  bookDraft: Drafts.RoutingDraft; defaultDraft: Drafts.RoutingDraft
  error: string; message: string; pending: boolean; dirty: boolean; defaultsOpen: boolean
  book: { token: string }; saveBook(): Promise<void>; saveDefault(): Promise<void>
}
type Scope = 'book' | 'defaults'
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
async function fixture() {
  const p = { connectionId: 'writer', model: 'writer-fixture', parameterPolicy: { version: 1 as const, mode: 'auto' as const } }
  let settings: BookSettings.ReferencedBookModelSettings = { version: 5, routingMode: 'shared', references: [{ kind: 'global', id: 'writer', globalConnectionId: 'global-fixture' }],
    shared: p, tasks: { outline: p, chapterOutline: p, prose: p, review: p } }
  const calls = { book: 0, defaults: 0, reads: 0 }, failures: { book?: unknown; defaults?: unknown; bookRead?: unknown } = {}
  const api = {
    list: async () => ({ revision: 1, connections: [{ id: 'global-fixture', name: 'Fixture', baseUrl: 'https://example.test/v1', protocol: 'openai-compatible' as const, enabled: true, credentialState: 'missing' as const, revision: 1 }] }),
    defaults: async () => ({ revision: 1, catalogRevision: 1, template: plain(settings), references: [] }),
    book: async () => { calls.reads++; if (failures.bookRead) throw failures.bookRead; return { token: 'edit-fixture', revision: 'fixture-revision', bookIdentity: 'fixture-book', settings: plain(settings) } },
    saveBook: async (input: { token: string; patch: unknown }) => {
      calls.book++; if (failures.book) throw failures.book
      const patch = input.patch as Pick<BookSettings.ReferencedBookModelSettings, 'shared' | 'tasks' | 'routingMode'>
      settings = { ...settings, routingMode: patch.routingMode, shared: plain(patch.shared), tasks: plain(patch.tasks) }
      return { settings: plain(settings), authority: 'files' as const, mirrorStatus: 'not-applicable' as const }
    },
    saveDefaults: async () => { calls.defaults++; if (failures.defaults) throw failures.defaults; return { revision: 2, catalogRevision: 1, template: plain(settings), references: [] } },
    cancelTest: async () => true, cancelPreviews: async () => true,
  }
  const component = load(Vue, BookSettings, Drafts, QuickSetup); component.render = () => null
  let instance!: Vue.ComponentInternalInstance
  const setup = component.setup
  component.setup = (props: unknown, context: unknown) => { instance = Vue.getCurrentInstance()!; return setup(props, context) }
  const renderer = Vue.createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ render: () => Vue.h(component, { api, bookAvailable: true, page: 'routing' }) })
  app.mount({})
  await new Promise<void>(resolve => setImmediate(resolve))
  const state = (instance as unknown as { setupState: State }).setupState
  assert.equal(state.pending, false); assert.equal(state.error, '')
  const draft = (scope: Scope) => scope === 'book' ? state.bookDraft : state.defaultDraft
  const save = (scope: Scope) => scope === 'book' ? state.saveBook() : state.saveDefault()
  return { state, api, calls, failures, draft, save, saved: () => plain(settings), unmount: () => app.unmount() }
}

for (const scope of ['book', 'defaults'] as const) {
  test(`${scope}: correcting its draft clears only its old validation warning, without saving or clearing dirty state`, async t => {
    const f = await fixture(); t.after(f.unmount)
    const draft = f.draft(scope), before = f.saved()
    draft.profiles.shared.parameterPolicy = { version: 1, mode: 'custom', overrides: { topP: 1.2 } }
    await f.save(scope)
    assert.match(f.state.error, /采样范围/); const error = f.state.error
    f.state.defaultsOpen = !f.state.defaultsOpen
    f.draft(scope === 'book' ? 'defaults' : 'book').profiles.shared.model = 'another-fixture'
    await Vue.nextTick(); assert.equal(f.state.error, error, 'unrelated scope/view edits must retain the error')
    draft.profiles.shared = plain(draft.profiles.shared)
    await Vue.nextTick(); assert.equal(f.state.error, error, 'equal values do not invalidate failure evidence')
    draft.profiles.shared.parameterPolicy = { version: 1, mode: 'custom', overrides: { topP: .8 } }
    await Vue.nextTick()
    assert.equal(f.state.error, ''); assert.equal(f.state.message, '')
    assert.equal(f.state.dirty, true); assert.equal(f.calls.book + f.calls.defaults, 0)
    assert.deepEqual(f.saved(), before)
  })

  test(`${scope}: native unfinished input becomes a scoped validation warning and can be repaired`, async t => {
    const f = await fixture(); t.after(f.unmount)
    f.draft(scope).profiles.shared.parameterInputErrors = { maxTokens: true }
    await f.save(scope); assert.match(f.state.error, /完整数字/)
    delete f.draft(scope).profiles.shared.parameterInputErrors
    f.draft(scope).profiles.shared.parameterPolicy = { version: 1, mode: 'custom', overrides: { maxTokens: 2048 } }
    await Vue.nextTick(); assert.equal(f.state.error, '')
    assert.equal(f.calls.book + f.calls.defaults, 0)
  })

  test(`${scope}: main parameter failure clears on later model intent, without automatic resubmission`, async t => {
    const f = await fixture(); t.after(f.unmount)
    f.failures[scope] = { code: 'VALIDATION_ERROR', message: '最大输出超过型号上限。', recoverable: true }
    await f.save(scope); assert.match(f.state.error, /型号上限/)
    const count = f.calls[scope]
    f.draft(scope).profiles.shared = Drafts.selectModel(f.draft(scope).profiles.shared, 'writer-repaired')
    await Vue.nextTick(); assert.equal(f.state.error, ''); assert.equal(f.calls[scope], count)
    assert.equal(f.state.dirty, true)
  })

  for (const code of ['STORAGE_ERROR', 'CONFLICT', 'INTERNAL_ERROR']) {
    test(`${scope}: editing parameters does not dismiss ${code}`, async t => {
      const f = await fixture(); t.after(f.unmount)
      f.failures[scope] = { code, message: '需要重试或重新读取的错误。', recoverable: true }
      await f.save(scope); assert.equal(f.state.error, '需要重试或重新读取的错误。')
      f.draft(scope).profiles.shared.parameterPolicy = { version: 1, mode: 'custom', overrides: { maxTokens: 2048 } }
      await Vue.nextTick(); assert.equal(f.state.error, '需要重试或重新读取的错误。')
      assert.equal(f.calls[scope], 1)
    })
  }
}

test('a late validation error does not describe a draft replaced while save was pending', async t => {
  const f = await fixture(); t.after(f.unmount)
  let reject!: (cause: unknown) => void
  f.api.saveBook = () => new Promise<Awaited<ReturnType<typeof f.api.saveBook>>>((_, no) => { reject = no })
  const save = f.state.saveBook(); assert.equal(f.state.pending, true)
  f.state.bookDraft.profiles.shared.model = 'new-draft'; await Vue.nextTick()
  reject({ code: 'VALIDATION_ERROR', message: '旧草稿无效。', recoverable: true }); await save
  assert.equal(f.state.error, ''); assert.equal(f.state.pending, false); assert.equal(f.state.dirty, true)
})

test('editing after a confirmed save cannot dismiss failed follow-up reading or fabricate saved state', async t => {
  const f = await fixture(); t.after(f.unmount)
  f.failures.bookRead = new Error('synthetic read failure')
  f.state.bookDraft.profiles.shared.parameterPolicy = { version: 1, mode: 'custom', overrides: { maxTokens: 2048 } }
  await f.state.saveBook()
  assert.match(f.state.message, /已保存到本书文件/); assert.match(f.state.error, /保存已经成功.*读取失败/)
  const error = f.state.error
  f.state.bookDraft.profiles.shared.parameterPolicy = { version: 1, mode: 'custom', overrides: { maxTokens: 3072 } }
  await Vue.nextTick(); assert.equal(f.state.error, error); assert.equal(f.state.book.token, '')
  assert.equal(f.state.dirty, true); assert.equal(f.calls.book, 1)
  assert.deepEqual(f.saved().shared.parameterPolicy, { version: 1, mode: 'custom', overrides: { maxTokens: 2048 } })
})

test('an unknown failure and a newer storage failure with the same message remain recoverable errors', async t => {
  const f = await fixture(); t.after(f.unmount)
  f.failures.book = { code: 'VALIDATION_ERROR', message: '相同的提示文字。' }
  await f.state.saveBook()
  f.state.bookDraft.profiles.shared.model = 'first-change'; await Vue.nextTick(); assert.equal(f.state.error, '')
  f.failures.book = { code: 'STORAGE_ERROR', message: '相同的提示文字。' }
  await f.state.saveBook()
  f.state.bookDraft.profiles.shared.model = 'second-change'; await Vue.nextTick()
  assert.equal(f.state.error, '相同的提示文字。')
  f.failures.book = new Error('未知失败，需要重试。')
  await f.state.saveBook()
  f.state.bookDraft.profiles.shared.model = 'third-change'; await Vue.nextTick()
  assert.equal(f.state.error, '未知失败，需要重试。'); assert.equal(f.calls.book, 3)
})

test('unmount discards a pending validation reply instead of reviving the manager error', async () => {
  const f = await fixture()
  let reject!: (cause: unknown) => void
  f.api.saveBook = () => new Promise<Awaited<ReturnType<typeof f.api.saveBook>>>((_, no) => { reject = no })
  const pending = f.state.saveBook()
  f.unmount(); reject({ code: 'VALIDATION_ERROR', message: '已离开的页面。' }); await pending
  assert.equal(f.state.error, '')
})
