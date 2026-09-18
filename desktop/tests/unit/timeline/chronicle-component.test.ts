import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import { timelineEventTitle } from '../../../src/renderer/features/timeline/timeline-workbench'

async function mount() {
  const source = await readFile(new URL('../../../src/renderer/features/timeline/components/ChronicleEvents.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  let code = compileScript(descriptor, { id: 'chronicle-test' }).content
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
    .replace(/import StudioIcon[^\n]+/, 'const StudioIcon = {};')
    .replace(/import \{ timelineEventTitle \}[^\n]+/, '')
  const compiled = await transformWithEsbuild(code, 'chronicle-test.ts', { loader: 'ts' })
  const Component = new Function('Vue', 'timelineEventTitle', compiled.code.replace('export default', 'return'))(Vue, timelineEventTitle)
  Component.render = () => Vue.h('div')
  const entry = { id: 'direct', title: '渡河', time: '第二日', characters: '沈砚', location: '渡口', event: '搭渡船过河', result: '抵达对岸' }
  const props = Vue.reactive({ formal: [{ ...entry, id: 'formal', characters: ['林照'] }], direct: [entry], candidates: [{ ...entry, id: 'candidate' }], selected: 'direct:direct', busy: false, issue: false, placements: [{ eventId: 'formal', chapterId: 42 }], chapters: [{ id: 42, title: '过河', position: 1 }] })
  const updates: unknown[][] = []
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ render: () => Vue.h(Component, { ...props, onUpdate: (...args: unknown[]) => updates.push(args) }) })
  const wrapper = app.mount({})
  type State = { query: string; origin: string; visible: unknown[]; rows: unknown[]; editing: boolean; selectedRow: { kind: string } | null; selectedChapter: { id: number } | null; update: (field: string, event: Event) => void }
  const state = (wrapper.$.subTree.component! as Vue.ComponentInternalInstance & { setupState: State }).setupState
  await Vue.nextTick()
  return { props, state, updates, unmount: () => app.unmount() }
}

test('chronicle filters preserve author records, keep candidates separate and never fabricate chapter bindings', async () => {
  const ctx = await mount()
  try {
    assert.equal(ctx.state.rows.length, 2)
    assert.equal(ctx.state.selectedChapter, null)
    ctx.state.query = '林照'; await Vue.nextTick()
    assert.equal(ctx.state.visible.length, 1)
    assert.equal(ctx.props.direct.length, 1)
    ctx.props.selected = 'formal:formal'; await Vue.nextTick()
    assert.deepEqual(ctx.state.selectedChapter, { id: 42, title: '过河', position: 1 })
    ctx.props.chapters = []; await Vue.nextTick()
    assert.equal(ctx.state.selectedChapter, null)
  } finally { ctx.unmount() }
})

test('chronicle field editing emits intent only, formal evidence is not editable and candidate selection is explicit', async () => {
  const ctx = await mount()
  try {
    ctx.state.update('event', { target: { value: '新经过' } } as unknown as Event)
    assert.deepEqual(ctx.updates, [['direct', 'direct', 'event', '新经过']])
    assert.equal(ctx.props.direct[0].event, '搭渡船过河')
    ctx.props.selected = 'formal:formal'; await Vue.nextTick()
    ctx.state.update('event', { target: { value: '禁止改写' } } as unknown as Event)
    assert.equal(ctx.updates.length, 1)
    ctx.props.selected = 'candidate:candidate'; await Vue.nextTick()
    assert.equal(ctx.state.editing, true)
    assert.equal(ctx.state.selectedRow?.kind, 'candidate')
    assert.equal(ctx.props.direct.length, 1)
  } finally { ctx.unmount() }
})

test('unreadable formal ledger does not hide editable author records or claim empty formal success', async () => {
  const ctx = await mount()
  try {
    ctx.props.issue = true; await Vue.nextTick()
    assert.equal(ctx.state.rows.length, 1)
    assert.equal(ctx.state.selectedRow?.kind, 'direct')
  } finally { ctx.unmount() }
})

test('Chinese composition is held until the committed text arrives', async () => {
  const ctx = await mount()
  try {
    ctx.state.update('title', { target: { value: 'wu' }, isComposing: true } as unknown as Event)
    assert.equal(ctx.updates.length, 0)
    ctx.state.update('title', { target: { value: '雾港' } } as unknown as Event)
    assert.deepEqual(ctx.updates, [['direct', 'direct', 'title', '雾港']])
  } finally { ctx.unmount() }
})
