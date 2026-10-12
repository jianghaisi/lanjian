import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'

async function loadComponent(domTransitions = true) {
  const source = await readFile(new URL('../../../src/renderer/features/assistant/components/TaskCenterPanel.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  // Compile the actual presentation component; no app, IPC or author database is mounted.
  const compiled = compileScript(descriptor, { id: 'task-center-regression', inlineTemplate: true }).content
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
      (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
    .replace('export default', 'return')
  // The custom host tests business actions without DOM geometry; native smoke covers motion.
  const runtime = domTransitions ? Vue : { ...Vue, TransitionGroup: {
    setup(_props: unknown, { slots }: any) { return () => Vue.h('div', slots.default?.()) }
  } }
  return new Function('Vue', compiled)(runtime)
}

async function render(items: unknown[], loading = false) {
  return renderToString(Vue.createSSRApp(await loadComponent(), { items, loading }))
}

const item = {
  id: 'legacy-paused', label: '智能助笔', status: 'paused', chapterId: 17,
  detail: '旧版任务无法继续；请从当前正文重新发起。',
  actions: ['view', 'cancel'], hasContinuation: false, attempt: 1, updatedAt: '2026-09-08T00:00:00Z'
}

test('legacy pause stays visible in attention without pretending it has continued', async () => {
  const html = await render([item])
  assert.match(html, /已暂停/)
  assert.match(html, /当前正文重新发起/)
  assert.match(html, /task-center-view-legacy-paused/)
  assert.match(html, /task-center-cancel-legacy-paused/)
  assert.doesNotMatch(html, /已续接|task-center-resume-|task-center-retry-/)
})

test('only a persisted continuation removes the paused parent from attention', async () => {
  const html = await render([{ ...item, hasContinuation: true, actions: ['view'] }])
  assert.match(html, /没有需要处理的任务/)
  assert.doesNotMatch(html, /task-center-item-legacy-paused/)
})

test('modern paused tasks retain the usable continue control', async () => {
  const html = await render([{ ...item, detail: '现代暂停任务', actions: ['resume', 'view', 'cancel'] }])
  assert.match(html, /task-center-resume-legacy-paused/)
  assert.match(html, /已暂停/)
  assert.match(html, /data-running="false"/)
  assert.doesNotMatch(html, /data-running="true"/)
})

test('running feedback follows the task status and stops on failure', async () => {
  assert.match(await render([{ ...item, status: 'running' }]), /data-running="true"/)
  const failed = await render([{ ...item, status: 'failed', actions: ['retry'] }])
  assert.match(failed, /data-running="false"/)
  assert.match(failed, /未完成/)
  assert.doesNotMatch(failed, /已完成|<svg/)
})

test('refresh keeps a dedicated contrast boundary and announces its disabled loading state', async () => {
  const html = await render([], true)
  assert.match(html, /class="task-center-refresh"[^>]*disabled[^>]*aria-busy="true"[^>]*data-testid="refresh-task-center"[^>]*><span[^>]*aria-hidden="true"[^>]*>↻<\/span>读取中/)
  const idle = await render([])
  assert.match(idle, /class="task-center-refresh"[^>]*aria-busy="false"[^>]*><span[^>]*aria-hidden="true"[^>]*>↻<\/span>刷新/)
  const { descriptor } = parse(await readFile(new URL('../../../src/renderer/features/assistant/components/TaskCenterPanel.vue', import.meta.url), 'utf8'))
  assert.equal(descriptor.styles[0]?.scoped, true)
  assert.match(descriptor.styles[0].content, /\.task-center-refresh:hover:not\(:disabled\)[\s\S]*color: var\(--color-ink/)
  assert.match(descriptor.styles[0].content, /\.task-center-refresh:disabled\s*\{[^}]*opacity: 1/)
})

test('task history retains continued parents and shows acknowledged completion before filtered departure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  type Node = { text: string; props: Record<string, unknown>; children: Node[]; parent?: Node }
  const node = (text = ''): Node => ({ text, props: {}, children: [] })
  const renderer = Vue.createRenderer<Node, Node>({
    createElement: () => node(), createText: text => node(text), createComment: () => node(),
    insert: (child, parent, anchor) => {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    },
    remove: child => { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1) },
    setText: (target, text) => { target.text = text },
    setElementText: (target, text) => { target.text = text; target.children = [] },
    parentNode: target => target.parent || null,
    nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
    patchProp: (target, key, _previous, value) => { target.props[key] = value }
  })
  const events: unknown[][] = []
  const child = { ...item, id: 'child', status: 'resuming', actions: ['pause', 'view', 'cancel'], attempt: 2 }
  const parent = { ...item, id: 'parent', hasContinuation: true, actions: ['view'] }
  const root = node()
  const records = Vue.ref([child, parent])
  const component = await loadComponent(false)
  const app = renderer.createApp({ render: () => Vue.h(component, { items: records.value, onAction: (...args: unknown[]) => events.push(args) }) })
  app.mount(root)
  const flatten = (target: Node): Node[] => [target, ...target.children.flatMap(flatten)]
  const find = (id: string) => flatten(root).find(target => target.props['data-testid'] === id)
  const text = () => flatten(root).map(target => target.text).join(' ')
  const click = async (id: string) => {
    const button = find(id)
    assert.ok(button, `expected real rendered button ${id}`)
    ;(button.props.onClick as () => void)()
    await Vue.nextTick()
  }
  try {
    assert.match(text(), /恢复中/)
    assert.match(text(), /1 项等待处理/)
    assert.ok(find('task-center-item-child'))
    assert.equal(find('task-center-item-parent'), undefined)
    await click('task-filter-active')
    assert.ok(find('task-center-item-child'))
    assert.equal(find('task-center-item-parent'), undefined)
    await click('task-center-pause-child')
    await click('task-center-cancel-child')
    assert.deepEqual(events.map(event => event[1]), ['pause', 'cancel'])
    await click('task-filter-all')
    assert.ok(find('task-center-item-parent'))
    assert.match(text(), /已续接/)
    assert.equal(find('task-center-resume-parent'), undefined)
    assert.equal(find('task-center-cancel-parent'), undefined)
    assert.equal(find('task-center-retry-child'), undefined)
    assert.equal(find('task-center-resume-child'), undefined)
    await click('task-filter-attention')
    records.value = [{ ...child, status: 'succeeded', actions: ['view'] }, parent]
    await Vue.nextTick()
    assert.ok(find('task-center-item-child'), 'new completion should be readable before departure')
    assert.match(text(), /已完成/)
    assert.doesNotMatch(text(), /1 项等待处理/)
    t.mock.timers.tick(1000)
    await Vue.nextTick()
    assert.equal(find('task-center-item-child'), undefined)
    await click('task-filter-all')
    assert.ok(find('task-center-item-child'), 'completed record remains in authoritative history')
    await click('task-filter-attention')
    records.value = [{ ...child, status: 'running' }, parent]
    await Vue.nextTick()
    records.value = [{ ...child, status: 'succeeded' }, parent]
    await Vue.nextTick()
    records.value = [{ ...child, status: 'failed', actions: ['retry'] }, parent]
    await Vue.nextTick()
    t.mock.timers.tick(1000)
    await Vue.nextTick()
    assert.ok(find('task-center-retry-child'), 'an earlier completion timeout cannot retire a newer failure')
  } finally { app.unmount() }
})
