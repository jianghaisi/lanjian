import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCompositionSession, beginCompositionInput, clearCompositionFields, compositionDirty, createCompositionSessions, finishCompositionInput, loadCompositionSaved, reconcileComposition, setCompositionParam } from '../../../src/renderer/features/writing-plugins/composition-session'
import type { CompositionEntry } from '../../../src/contracts/writing-plugins/contributions'

const entry = (tone = '已保存'): CompositionEntry => ({ pluginId: 'personal.style', digest: 'a'.repeat(64), contributionId: 'style', params: { tone } })
const field = 'personal.style/style'
const scope = (id: string, path = `G:/books/${id}`) => JSON.stringify([id, path])

test('navigation reuses only the same book ID and path; input never mutates the main projection', () => {
  const sessions = createCompositionSessions().get, source = [entry()], a = sessions(scope('a'), source)
  setCompositionParam(a, entry(), 'tone', '甲书未应用', 'string')
  assert.equal(sessions(scope('a'), [entry('新投影')]), a)
  const b = sessions(scope('b'), source), copy = sessions(scope('a', 'G:/copies/a'), source)
  assert.equal(b.draft[0].params.tone, '已保存'); assert.equal(copy.draft[0].params.tone, '已保存')
  assert.equal(source[0].params.tone, '已保存'); assert.equal(compositionDirty(a), true)
  assert.equal(compositionDirty(b), false); assert.equal(compositionDirty(copy), false)
})

test('returning to a changed saved composition preserves dirty parameters until explicit reset', () => {
  const s = createCompositionSessions().get(scope('a'), [entry()])
  setCompositionParam(s, entry(), 'tone', '本地修改', 'string')
  assert.equal(reconcileComposition(s, [entry()]), false)
  assert.equal(reconcileComposition(s, [entry('外部更新')]), true)
  assert.equal(s.draft[0].params.tone, '本地修改'); assert.equal(s.savedContent, JSON.stringify([entry()]))
  loadCompositionSaved(s, [entry('外部更新')]); assert.equal(compositionDirty(s), false)
  assert.equal(s.draft[0].params.tone, '外部更新')
  assert.equal(reconcileComposition(s, [entry('后续更新')]), false)
  assert.equal(s.draft[0].params.tone, '后续更新')
})

test('invalid JSON retains raw text and last valid value through remount and saved projection changes', () => {
  const sessions = createCompositionSessions().get, s = sessions(scope('a'), [entry()])
  setCompositionParam(s, entry(), 'notes', '{"memo":"有效"}', 'object')
  setCompositionParam(s, entry(), 'notes', '{"memo":', 'object')
  const returned = sessions(scope('a'), [entry('外部更新')])
  assert.equal(reconcileComposition(returned, [entry('外部更新')]), true)
  assert.equal(returned.textDrafts[`${field}/notes`], '{"memo":')
  assert.deepEqual(returned.draft[0].params.notes, { memo: '有效' })
  assert.match(returned.invalidFields[`${field}/notes`], /格式有误/)
  clearCompositionFields(s, entry()); assert.deepEqual(s.invalidFields, {}); assert.deepEqual(s.textDrafts, {})
})

test('unmount during IME preserves actual raw text as local input and releases the composition lock', () => {
  const s = createCompositionSessions().get(scope('a'), [entry()])
  beginCompositionInput(s, entry(), 'tone', 'string', '已保存')
  s.textDrafts[`${field}/tone`] = '中文还在输入'
  assert.equal(reconcileComposition(s, [entry('外部更新')]), true)
  finishCompositionInput(s)
  assert.equal(s.composing, false); assert.equal(s.input, null)
  assert.equal(s.draft[0].params.tone, '中文还在输入'); assert.equal(compositionDirty(s), true)
  assert.equal(reconcileComposition(s, [entry('外部更新')]), true)
  beginCompositionInput(s, entry(), 'notes', 'object', '')
  s.textDrafts[`${field}/notes`] = '{"memo":'; finishCompositionInput(s)
  assert.equal(s.composing, false); assert.match(s.invalidFields[`${field}/notes`], /格式有误/)
})

test('late IME completion cannot resurrect a removed or replaced contribution', () => {
  const s = createCompositionSessions().get(scope('a'), [entry()])
  beginCompositionInput(s, entry(), 'tone', 'string', '未完成')
  s.draft[0].digest = 'b'.repeat(64); finishCompositionInput(s)
  assert.equal(s.draft[0].params.tone, '已保存')
  beginCompositionInput(s, s.draft[0], 'tone', 'string', '移除中')
  s.draft = []; clearCompositionFields(s, entry()); finishCompositionInput(s)
  assert.deepEqual(s.draft, []); assert.equal(s.composing, false)
})

test('late confirmed apply releases the original book session and notifies its new owner once', async () => {
  const sessions = createCompositionSessions().get, a = sessions(scope('a'), [entry()]), b = sessions(scope('b'), [entry()])
  setCompositionParam(a, entry(), 'tone', '待应用', 'string')
  let complete!: (value: boolean) => void, calls = 0
  const api = { applyComposition: async () => { calls++; return new Promise<boolean>(resolve => { complete = resolve }) } }
  const pending = applyCompositionSession(a, api, 'fresh-plan')
  const remounted = sessions(scope('a'), [entry()])
  assert.equal(remounted.busy, true); assert.equal(b.busy, false)
  await applyCompositionSession(remounted, api, 'duplicate'); assert.equal(calls, 1)
  complete(true); await pending
  assert.equal(remounted.busy, false); assert.equal(remounted.appliedSequence, 1); assert.equal(b.appliedSequence, 0)
  // A receipt is not a fabricated saved projection. Reload main before clearing dirty.
  assert.equal(compositionDirty(remounted), true)
  assert.equal(reconcileComposition(remounted, [entry('待应用')]), false); assert.equal(compositionDirty(remounted), false)
})

test('late rejected apply preserves original input and permits retry without a success receipt', async () => {
  const sessions = createCompositionSessions().get, s = sessions(scope('a'), [entry()])
  setCompositionParam(s, entry(), 'tone', '保留修改', 'string')
  let fail!: (cause: unknown) => void
  const pending = applyCompositionSession(s, { applyComposition: () => new Promise<boolean>((_resolve, reject) => { fail = reject }) }, 'expired')
  const returned = sessions(scope('a'), [entry()]); fail({ message: '作品已切换，请重新预览。' }); await pending
  assert.equal(returned.busy, false); assert.equal(returned.appliedSequence, 0)
  assert.equal(returned.draft[0].params.tone, '保留修改'); assert.match(returned.error, /作品已切换/)
  await applyCompositionSession(returned, { applyComposition: async () => true }, 'new-plan')
  assert.equal(returned.appliedSequence, 1); assert.equal(returned.error, '')
})

test('an unconfirmed result never reports a successful apply', async () => {
  const s = createCompositionSessions().get(scope('a'), [entry()])
  await applyCompositionSession(s, { applyComposition: async () => false }, 'plan')
  assert.equal(s.appliedSequence, 0); assert.equal(s.busy, false); assert.match(s.error, /未完成/)
})

test('close cancel lists hidden book drafts, including invalid JSON, and never changes any saved or local content', () => {
  const sessions = createCompositionSessions(), a = sessions.get(scope('a'), [entry()], '甲书'), b = sessions.get(scope('b'), [entry()], '乙书')
  setCompositionParam(a, entry(), 'tone', '甲书修改', 'string')
  setCompositionParam(b, entry(), 'notes', '{"memo":', 'object')
  const before = JSON.stringify([a, b]); let asked = 0
  const result = sessions.prepareClose(message => { asked++; assert.match(message, /甲书/); assert.match(message, /乙书/); assert.match(message, /未应用/); return false }, () => assert.fail('Unexpected busy notice'))
  assert.equal(result, null); assert.equal(asked, 1); assert.equal(JSON.stringify([a, b]), before)
})

test('close confirmation is attempt-local and keeps drafts if another feature fails to save', () => {
  const sessions = createCompositionSessions(), s = sessions.get(scope('a'), [entry()], '甲书')
  setCompositionParam(s, entry(), 'tone', '未应用', 'string')
  const before = JSON.stringify(s); let asked = 0
  const mayClose = sessions.prepareClose(() => { asked++; return true }, () => assert.fail('Unexpected notice'))!
  assert.equal(mayClose(), true); assert.equal(JSON.stringify(s), before)
  // Simulate an outline save preventing this close. A new attempt must ask again.
  assert.equal(sessions.prepareClose(() => { asked++; return false }, () => {}) , null)
  assert.equal(asked, 2); assert.equal(JSON.stringify(s), before)
})

test('IME and in-flight preview/apply block close without offering to discard', async () => {
  const sessions = createCompositionSessions(), s = sessions.get(scope('a'), [entry()]); const notices: string[] = []
  const confirm = () => { assert.fail('In-flight input or persistence must not be discarded'); return true }
  beginCompositionInput(s, entry(), 'tone', 'string', '已保存')
  assert.equal(sessions.prepareClose(confirm, message => notices.push(message)), null); assert.match(notices.pop()!, /正在输入/)
  finishCompositionInput(s); s.busy = true
  assert.equal(sessions.prepareClose(confirm, message => notices.push(message)), null); assert.match(notices.pop()!, /预览或应用/)
  s.busy = false
  let complete!: (value: boolean) => void
  const pending = applyCompositionSession(s, { applyComposition: () => new Promise<boolean>(resolve => { complete = resolve }) }, 'plan')
  assert.equal(sessions.prepareClose(confirm, message => notices.push(message)), null)
  complete(false); await pending
  assert.equal(sessions.prepareClose(confirm, () => {})!(), true)
})

test('a close permit is revoked by new input, a new dirty book, composing or a pending operation during other flushes', () => {
  const sessions = createCompositionSessions(), a = sessions.get(scope('a'), [entry()])
  const prepare = () => sessions.prepareClose(() => true, () => {})!
  const cleanPermit = prepare(); setCompositionParam(a, entry(), 'tone', '等待期间修改', 'string'); assert.equal(cleanPermit(), false)
  const textPermit = prepare(); a.textDrafts[`${field}/tone`] = '新的原文'; assert.equal(textPermit(), false)
  const otherBookPermit = prepare(), b = sessions.get(scope('b'), [entry()])
  assert.equal(otherBookPermit(), true); setCompositionParam(b, entry(), 'tone', '新书修改', 'string'); assert.equal(otherBookPermit(), false)
  const composingPermit = prepare(); beginCompositionInput(a, entry(), 'tone', 'string', '输入中'); assert.equal(composingPermit(), false); finishCompositionInput(a)
  const busyPermit = prepare(); a.busy = true; assert.equal(busyPermit(), false); a.busy = false
  const savedPermit = prepare(); loadCompositionSaved(a, [entry('已应用')]); loadCompositionSaved(b, [entry()]); assert.equal(savedPermit(), true)
})

test('clean sessions close without a prompt; explicit discard or authoritative apply releases the guard', () => {
  const sessions = createCompositionSessions(), s = sessions.get(scope('a'), [entry()])
  const noPrompt = () => { assert.fail('Clean sessions should not ask to discard'); return false }
  assert.equal(sessions.prepareClose(noPrompt, () => {})!(), true)
  setCompositionParam(s, entry(), 'tone', '修改', 'string')
  loadCompositionSaved(s, [entry()]); assert.equal(sessions.prepareClose(noPrompt, () => {})!(), true)
  setCompositionParam(s, entry(), 'tone', '应用后的声音', 'string')
  reconcileComposition(s, [entry('应用后的声音')]); assert.equal(sessions.prepareClose(noPrompt, () => {})!(), true)
})
