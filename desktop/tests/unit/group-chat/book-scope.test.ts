import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue'
import type { DesktopApi, ProjectSummary } from '../../../src/contracts'
import { groupMembers, type GroupSessionView } from '../../../src/contracts/group-chat/group-chat'
import { useGroupChat } from '../../../src/renderer/features/group-chat/composables/use-group-chat'

const book = (id: string) => ({ id, path: id, title: id } as ProjectSummary)
const view = (id: string): GroupSessionView => ({ team: { format: 1, members: structuredClone(groupMembers) }, readOnly: false, id: `group-${id}`, book: { id, title: id }, draft: `${id}草稿`, position: { top: 0, atBottom: true }, messages: [], candidates: [], members: groupMembers.map(member => ({ memberId: member.id, profile: null })), revision: 1, status: 'idle', title: id, notice: '', createdAt: '', updatedAt: '', messageCount: 0, question: null, creation: null, activeMember: null, budget: { steps: 0, calls: 0 }, queued: 0 })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const settle = async () => { await nextTick(); await new Promise(done => setImmediate(done)); await nextTick() }
function mount(t: test.TestContext, groupChat: Partial<DesktopApi['groupChat']>, initial: ProjectSummary | null) {
  const current = ref(initial), visible = ref(true)
  const renderer = createRenderer<any, any>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert: () => {}, remove: () => {}, setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null, patchProp: () => {} })
  let chat!: ReturnType<typeof useGroupChat>
  const app = renderer.createApp(defineComponent({ setup() { chat = useGroupChat({ groupChat: { saveDraft: async () => true, ...groupChat } } as DesktopApi, () => visible.value, async () => true, async () => {}, () => current.value); return () => h('div') } }))
  app.mount({}); t.after(() => app.unmount()); return { chat, current, visible }
}

test('no-book tab starts zero conversations; slow old-book response cannot replace the new book or its draft', async t => {
  const old = deferred<GroupSessionView>(), opened: string[] = [], reads: string[] = []
  const f = mount(t, { list: async () => [view('A'), view('B')], openBook: async id => { opened.push(id); return id === 'A' ? old.promise : view(id) }, get: async input => { reads.push(input.sessionId); return view(input.sessionId.slice(6)) } }, null)
  await settle(); assert.deepEqual(opened, []); assert.equal(f.chat.session.value, null)
  f.current.value = book('A'); await settle(); assert.deepEqual(opened, ['A'])
  f.current.value = book('B'); await settle(); assert.equal((f.chat.session.value as GroupSessionView | null)?.book?.id, 'B'); assert.equal(f.chat.draft.value, 'B草稿')
  old.resolve(view('A')); await settle()
  assert.equal((f.chat.session.value as GroupSessionView | null)?.book?.id, 'B'); assert.equal(f.chat.draft.value, 'B草稿'); assert.deepEqual(f.chat.sessions.value.map(s => s.book?.id), ['B'])
  f.current.value = null; await settle(); assert.equal(f.chat.session.value, null); assert.equal(f.chat.draft.value, '')
})

test('member save awaiting a refresh cannot mutate the book selected during that refresh', async t => {
  const refresh = deferred<GroupSessionView>(), mutations: unknown[] = []
  let delay = false
  const f = mount(t, { list: async () => [view('A'), view('B')], openBook: async id => view(id), get: async input => delay && input.sessionId === 'group-A' ? refresh.promise : view(input.sessionId.slice(6)), saveMember: async input => { mutations.push(input); return view('A') } }, book('A'))
  await settle(); delay = true
  const saving = f.chat.saveMember('editor', { connectionId: 'global-example', model: 'example', parameterPolicy: { version: 2, mode: 'auto' } })
  f.current.value = book('B'); await settle(); refresh.resolve(view('A')); await saving; await settle()
  assert.deepEqual(mutations, []); assert.equal(f.chat.session.value?.book?.id, 'B'); assert.equal(f.chat.draft.value, 'B草稿')
})

test('explicit new discussion waits for the original draft commit and retains both discussions', async t => {
  const saved = deferred<boolean>(), order: string[] = [], fresh = { ...view('A'), id: 'fresh-A', draft: '' }
  let hold = false
  const f = mount(t, { list: async () => [view('A')], openBook: async () => view('A'), get: async () => view('A'),
    saveDraft: async input => { if (!hold) return true; order.push(`save:${input.draft}`); return saved.promise },
    createForBook: async id => { order.push(`create:${id}`); return fresh } }, book('A'))
  await settle(); hold = true; f.chat.draft.value = '未发送的输入'; f.chat.target.value = 'world'
  const creating = f.chat.create(); await settle()
  assert.deepEqual(order, ['save:未发送的输入']); assert.equal(f.chat.session.value?.id, 'group-A')
  saved.resolve(true); await creating; await settle()
  assert.deepEqual(order, ['save:未发送的输入', 'create:A']); assert.equal(f.chat.session.value?.id, 'fresh-A')
  assert.equal(f.chat.target.value, ''); assert.deepEqual(f.chat.sessions.value.map(s => s.id), ['fresh-A', 'group-A'])
  hold = false; await f.chat.select('group-A'); assert.equal(f.chat.draft.value, '未发送的输入')
})

test('failed original draft commit keeps the input and does not create a new discussion', async t => {
  let fail = false, creations = 0
  const f = mount(t, { list: async () => [view('A')], openBook: async () => view('A'), get: async () => view('A'),
    saveDraft: async () => { if (fail) throw Error('实际保存失败'); return true },
    createForBook: async () => { creations++; return view('A') } }, book('A'))
  await settle(); fail = true; f.chat.draft.value = '仍应保留的输入'; await f.chat.create()
  assert.equal(creations, 0); assert.equal(f.chat.session.value?.id, 'group-A'); assert.equal(f.chat.draft.value, '仍应保留的输入')
  assert.match(f.chat.error.value, /草稿暂未保存/); assert.equal(f.chat.loading.value, false)
})

test('late new discussion response cannot enter a different book or clear its draft', async t => {
  const late = deferred<GroupSessionView>(), creations: string[] = []
  const f = mount(t, { list: async () => [view('A'), view('B')], openBook: async id => view(id), get: async input => view(input.sessionId.slice(6)),
    createForBook: async id => { creations.push(id); return late.promise } }, book('A'))
  await settle(); const creating = f.chat.create(); await settle()
  f.current.value = book('B'); await settle(); f.chat.draft.value = 'B当前输入'
  late.resolve({ ...view('A'), id: 'fresh-A' }); await creating; await settle()
  assert.deepEqual(creations, ['A']); assert.equal(f.chat.session.value?.id, 'group-B'); assert.equal(f.chat.draft.value, 'B当前输入')
  assert.deepEqual(f.chat.sessions.value.map(s => s.book?.id), ['B'])
})

test('send settles its draft before refreshing and suspends autosave through the versioned submission', async t => {
  const saving = deferred<boolean>(), refresh = deferred<GroupSessionView>(), order: string[] = []
  let running = false
  const f = mount(t, { list: async () => [view('A')], openBook: async () => view('A'),
    get: async () => { if (!running) return view('A'); order.push('refresh'); return refresh.promise },
    saveDraft: async input => { if (!running) return true; order.push(`draft:${input.draft}`); return saving.promise },
    send: async input => { order.push(`send:${input.expectedRevision}`); return { ...view('A'), revision: 3 } } }, book('A'))
  await settle(); running = true; f.chat.draft.value = '权限核对'; const sending = f.chat.send(); await settle()
  assert.deepEqual(order, ['draft:权限核对'])
  saving.resolve(true); await settle(); assert.deepEqual(order, ['draft:权限核对', 'refresh'])
  f.chat.savePosition({ top: 12, atBottom: false }); await new Promise(resolve => setTimeout(resolve, 450))
  assert.deepEqual(order, ['draft:权限核对', 'refresh'], 'No background draft commit may invalidate the refreshed submission revision')
  refresh.resolve({ ...view('A'), revision: 2 }); await sending
  assert.deepEqual(order, ['draft:权限核对', 'refresh', 'send:2']); assert.equal(f.chat.draft.value, '')
})
