import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { authorAnswerProgress, decodeAuthorQuestionDraft, restoreAuthorQuestionDraft, type AuthorQuestionDraft } from '../../../src/renderer/features/assistant/services/author-question-draft'
import { emptyAssistantMemory, validateAssistantMemory, type AssistantMemory } from '../../../src/renderer/features/assistant/services/assistant-memory'
import { useAssistantMemory } from '../../../src/renderer/features/assistant/composables/use-assistant-memory'
import type { AuthorQuestionCard } from '../../../src/contracts/assistant/author-interaction-contracts'

const question: AuthorQuestionCard = { id: 'q-a', version: 1, toolCallId: 'call-a', pluginId: 'builtin.core', toolId: 'ask', questions: [
  { id: 'tone', prompt: '基调', mode: 'single', required: true, options: [{ id: 'warm', label: '温暖', recommended: true }, { id: 'dark', label: '悬疑' }] },
  { id: 'elements', prompt: '元素', mode: 'multiple', required: true, options: [{ id: 'rain', label: '雨夜' }, { id: 'memory', label: '旧物' }] },
  { id: 'note', prompt: '补充', mode: 'text', required: false, options: [] }
] }
const draft = (): AuthorQuestionDraft => ({ runId: 'run-a', questionId: question.id, questionVersion: question.version, answers: [
  { id: 'tone', chosenOptionIds: [], customText: '作者还没写完的构思\n保留每个字', skipped: false },
  { id: 'elements', chosenOptionIds: ['rain', 'memory'], customText: '', skipped: false },
  { id: 'note', chosenOptionIds: [], customText: '', skipped: false }
] })
const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }

test('partial answer drafts decode and restore without filling skipped or recommended answers', () => {
  const value = draft(), decoded = decodeAuthorQuestionDraft(value)!
  assert.deepEqual(decoded, value); decoded.answers[0].customText = '新副本'
  assert.notEqual(decoded.answers[0].customText, value.answers[0].customText)
  assert.deepEqual(restoreAuthorQuestionDraft('run-a', question, value), value.answers)
  assert.equal(value.answers[2].skipped, false); assert.deepEqual(value.answers[0].chosenOptionIds, [])
})

test('a different run, question or revision never restores old answers', () => {
  const value = draft()
  assert.equal(restoreAuthorQuestionDraft('run-b', question, value), null)
  assert.equal(restoreAuthorQuestionDraft('run-a', { ...question, id: 'q-b' }, value), null)
  assert.equal(restoreAuthorQuestionDraft('run-a', { ...question, version: 2 }, value), null)
  assert.equal(restoreAuthorQuestionDraft(undefined, question, value), null)
  assert.equal(value.answers[0].customText, draft().answers[0].customText)
})

test('incompatible cached choices are not silently reused for the current question', () => {
  for (const change of [
    (d: AuthorQuestionDraft) => { d.answers[1].chosenOptionIds = ['removed-option'] },
    (d: AuthorQuestionDraft) => { d.answers[0].chosenOptionIds = ['warm'] },
    (d: AuthorQuestionDraft) => { d.answers[2].chosenOptionIds = ['rain'] },
    (d: AuthorQuestionDraft) => { d.answers[0].skipped = true },
    (d: AuthorQuestionDraft) => { d.answers.pop() }
  ]) { const value = draft(); change(value); assert.equal(restoreAuthorQuestionDraft('run-a', question, value), null) }
})

test('progress distinguishes answered, explicitly skipped and still missing questions', () => {
  const value = draft()
  assert.deepEqual(authorAnswerProgress(question, value.answers), { answered: 2, skipped: 0, total: 3, ready: false })
  value.answers[2].skipped = true
  assert.deepEqual(authorAnswerProgress(question, value.answers), { answered: 2, skipped: 1, total: 3, ready: true })
  value.answers[0].customText = ''
  assert.equal(authorAnswerProgress(question, value.answers).ready, false)
  value.answers[0].chosenOptionIds = ['warm']; value.answers[0].customText = '还在输入'
  assert.equal(authorAnswerProgress(question, value.answers).ready, false)
})

test('old conversations with no question key load without a data migration', () => {
  const value = emptyAssistantMemory(); delete (value as Partial<AssistantMemory>).questionDraft
  assert.doesNotThrow(() => validateAssistantMemory(value)); assert.equal(decodeAuthorQuestionDraft(undefined), null)
})

test('malformed, oversized or duplicate answer drafts refuse persistence without truncation', () => {
  for (const value of [
    { ...draft(), questionVersion: 0 }, { ...draft(), approval: true },
    { ...draft(), answers: [draft().answers[0], draft().answers[0]] },
    { ...draft(), answers: [{ ...draft().answers[0], customText: '字'.repeat(12001) }] },
    { ...draft(), answers: [{ ...draft().answers[0], chosenOptionIds: ['warm', 'warm'] }] }
  ]) assert.throws(() => validateAssistantMemory({ ...emptyAssistantMemory(), questionDraft: value as AuthorQuestionDraft }), /未覆盖/)
})

function storageFixture(records = new Map<string, AssistantMemory>()) {
  const scope = effectScope(), text = ref(''), turns = ref<AssistantMemory['turns']>([])
  let fail = false, beforeRead = async (_book: string) => {}
  const writes: Array<{ book: string; key: string }> = []
  const memory = scope.run(() => useAssistantMemory(text, turns, {
    async read(book) { await beforeRead(book); return validateAssistantMemory(structuredClone(records.get(book) ?? emptyAssistantMemory())) },
    async write(book, key, value) {
      if (fail && key === 'questionDraft') throw new Error('quota')
      writes.push({ book, key }); records.set(book, { ...(records.get(book) ?? emptyAssistantMemory()), [key]: structuredClone(value) })
    }
  }))!
  const reset = () => { text.value = ''; turns.value = [] }
  return { records, scope, memory, text, writes, open: (book: string) => memory.open(book, reset), fail: (value: boolean) => { fail = value }, read: (fn: typeof beforeRead) => { beforeRead = fn } }
}

test('partial answers survive book switching and a fresh memory instance without submitting', async t => {
  const f = storageFixture(); t.after(() => f.scope.stop()); await f.open('book-A')
  f.text.value = '另一个聊天草稿'; f.memory.questionDraft.value = draft()
  await f.open('book-B'); assert.equal(f.memory.questionDraft.value, null)
  f.memory.questionDraft.value = { ...draft(), runId: 'run-b' }
  f.memory.questionDraft.value.answers[2].skipped = true
  await f.open('book-A'); assert.deepEqual(f.memory.questionDraft.value, draft()); assert.equal(f.text.value, '另一个聊天草稿')
  await settle(); f.scope.stop()
  const reopened = storageFixture(f.records); t.after(() => reopened.scope.stop()); await reopened.open('book-A')
  assert.deepEqual(reopened.memory.questionDraft.value, draft()); assert.equal(reopened.text.value, '另一个聊天草稿')
  await reopened.open('book-B'); assert.equal(reopened.memory.questionDraft.value?.answers[2].skipped, true)
})

test('answer save failure retains the draft across books and retry writes the newest text', async t => {
  const f = storageFixture(); t.after(() => f.scope.stop()); await f.open('book-A'); f.fail(true)
  f.memory.questionDraft.value = draft(); await settle(); assert.match(f.memory.saveError.value, /未完成/)
  await f.open('book-B'); await f.open('book-A'); assert.deepEqual(f.memory.questionDraft.value, draft())
  f.memory.questionDraft.value!.answers[0].customText = '失败后又写下的新想法'; await settle()
  f.text.value = '聊天保存成功也不能隐藏回答保存失败'; await settle(); assert.ok(f.memory.saveError.value)
  f.fail(false); f.memory.retry(); await settle()
  assert.equal(f.records.get('book-A')?.questionDraft?.answers[0].customText, '失败后又写下的新想法'); assert.equal(f.memory.saveError.value, '')
})

test('late old-book draft reads cannot overwrite a new book', async t => {
  const f = storageFixture(new Map([['book-A', { ...emptyAssistantMemory(), questionDraft: draft() }]])); t.after(() => f.scope.stop())
  let release!: () => void; f.read(async book => { if (book === 'book-A') await new Promise<void>(resolve => { release = resolve }) })
  const old = f.open('book-A'); await nextTick(); await f.open('book-B')
  const next = { ...draft(), runId: 'run-b' }; f.memory.questionDraft.value = next
  release(); await old; assert.deepEqual(f.memory.questionDraft.value, next)
})

test('corrupt saved answers are not overwritten, even after retry or a book round trip', async t => {
  const original = { ...emptyAssistantMemory(), questionDraft: { ...draft(), questionVersion: 0 } }
  const f = storageFixture(new Map([['book-A', original]])); t.after(() => f.scope.stop()); await f.open('book-A')
  assert.equal(f.memory.canRetry.value, false); assert.match(f.memory.saveError.value, /未覆盖/)
  f.memory.questionDraft.value = draft(); await f.open('book-B'); await f.open('book-A'); f.memory.retry(); await settle()
  assert.deepEqual(f.records.get('book-A'), original); assert.deepEqual(f.memory.questionDraft.value, draft())
  assert.equal(f.writes.filter(write => write.book === 'book-A').length, 0)
})

test('rapid answer edits and a clear are serialized so old writes cannot restore submitted text', async t => {
  const f = storageFixture(); t.after(() => f.scope.stop()); await f.open('book-A')
  f.memory.questionDraft.value = draft(); f.memory.questionDraft.value.answers[0].customText = '最新回答'
  f.memory.questionDraft.value = null; await settle()
  assert.equal(f.records.get('book-A')?.questionDraft, null)
})
