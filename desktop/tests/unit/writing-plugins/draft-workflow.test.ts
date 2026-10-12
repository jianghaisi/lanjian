import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { validatePluginManifest, type JsonObject, type JsonValue } from '@lanjian/writing-plugin-contracts'
import { decodeAuthorQuestionRequest } from '../../../src/contracts/assistant/author-interaction-contracts'
import { pluginDraftTemplate } from '../../../src/main/modules/writing-plugins/domain/draft-templates'
import { buildPluginContent } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { declarativeSource } from '../../../src/main/modules/writing-plugins/runtime/declarative-source'
import { executeGuest } from '../../../src/main/modules/writing-plugins/runtime/guest-engine'
import { addDraftWorkflowOption, editableDraftWorkflow, removeDraftWorkflowOption, restoreDraftWorkflowOption, updateDraftWorkflow, workflowOptionLimit, type WorkflowTextEdit } from '../../../src/renderer/features/writing-plugins/draft-workflow'

function fixture() {
  const content = pluginDraftTemplate('personal.workflow-test', 'workflow'), manifest = validatePluginManifest(JSON.parse(content.manifestText))
  const text = content.files[0]!.content, recipe = JSON.parse(text)
  return { content, manifest, text, recipe }
}
const target = { toolId: 'choose_focus', stepId: 'answer', questionId: 'focus' }

test('unfinished question/option text remains editable without being mistaken for a valid author question', () => {
  const f = fixture()
  for (const value of ['', ' \n\t ']) {
    let text = updateDraftWorkflow(f.text, f.manifest, { ...target, field: 'prompt', value })
    text = updateDraftWorkflow(text, f.manifest, { ...target, optionId: 'character', field: 'label', value })
    const questions = editableDraftWorkflow(text, f.manifest)![0]!.steps[0]!.questions!
    assert.equal(questions[0]!.prompt, value); assert.equal(questions[0]!.options[0]!.label, value)
    assert.throws(() => decodeAuthorQuestionRequest({ questions }))
    assert.equal(JSON.parse(text).tools[0].steps[0].args.question.questions[0].prompt, value)
  }
})

test('targeted edits preserve multiple tools/questions, authored identities, conditions, references and source encoding', () => {
  const f = fixture(), q = f.recipe.tools[0].steps[0].args.question.questions[0]
  q.options[0].recommended = true; q.options[0].description = '旧说明'; q.detail = '旧提示'
  f.recipe.tools[0].steps[0].args.question.questions.push({ id: 'notes', prompt: '自由说明', mode: 'text', required: false, options: [] })
  f.recipe.tools[0].steps[0].when = { equals: [true, true] }
  f.manifest.tools.push({ ...f.manifest.tools[0]!, id: 'other' })
  f.recipe.tools.push({ ...structuredClone(f.recipe.tools[0]), id: 'other' })
  const original = structuredClone(f.recipe)
  let text = '\ufeff' + JSON.stringify(f.recipe, null, 2).replaceAll('\n', '\r\n') + '\r\n'
  const edits: WorkflowTextEdit[] = [
    { ...target, field: 'prompt', value: '先完善谁的动机？' },
    { ...target, field: 'detail', value: '只讨论本章。' },
    { ...target, optionId: 'character', field: 'label', value: '主角动机' },
    { ...target, optionId: 'character', field: 'description', value: '保留人物选择。' },
    { toolId: target.toolId, field: 'result', value: '请按作者选定的方向继续。' }
  ]
  for (const edit of edits) text = updateDraftWorkflow(text, f.manifest, edit)
  const expected = structuredClone(original), expectedQ = expected.tools[0].steps[0].args.question.questions[0]
  expectedQ.prompt = edits[0]!.value; expectedQ.detail = edits[1]!.value; expectedQ.options[0].label = edits[2]!.value; expectedQ.options[0].description = edits[3]!.value
  expected.tools[0].result.text = edits[4]!.value
  assert.deepEqual(JSON.parse(text.slice(1)), expected); assert.deepEqual(f.recipe, original)
  assert.ok(text.startsWith('\ufeff')); assert.ok(text.endsWith('\r\n')); assert.ok(!/(?<!\r)\n/.test(text))
  assert.equal(editableDraftWorkflow(text, f.manifest)![0]!.steps[0]!.questions![1]!.mode, 'text')
})

test('dynamic questions/results and unsupported structure remain source-owned rather than being flattened', () => {
  const f = fixture(), dynamic = structuredClone(f.recipe.tools[0].steps[0])
  dynamic.id = 'dynamic'; dynamic.args.question = { $ref: 'input.question' }
  f.recipe.tools[0].steps.push(dynamic)
  f.recipe.tools[0].result.text = { $ref: 'input.summary' }
  const text = JSON.stringify(f.recipe), view = editableDraftWorkflow(text, f.manifest)!
  assert.equal(view[0]!.steps[1]!.questions, null); assert.equal(view[0]!.result, null)
  const edited = updateDraftWorkflow(text, f.manifest, { ...target, field: 'prompt', value: '静态问题' })
  assert.deepEqual(JSON.parse(edited).tools[0].steps[1], dynamic)
  assert.deepEqual(JSON.parse(edited).tools[0].result, f.recipe.tools[0].result)
  assert.throws(() => updateDraftWorkflow(text, f.manifest, { ...target, stepId: 'dynamic', field: 'prompt', value: '不能覆盖动态模板' }))
  assert.throws(() => updateDraftWorkflow(text, f.manifest, { toolId: target.toolId, field: 'result', value: '不能覆盖引用' }))
  assert.equal(editableDraftWorkflow('{unfinished', f.manifest), null)
  const invalid = fixture(); invalid.recipe.tools[0].steps[0].args.question.questions[0].options[0].unknown = true
  assert.equal(editableDraftWorkflow(JSON.stringify(invalid.recipe), invalid.manifest)![0]!.steps[0]!.questions, null)
})

test('stale IDs, excessive input and structurally invalid questions cannot overwrite the original source', () => {
  const f = fixture()
  const edits: WorkflowTextEdit[] = [
    { ...target, toolId: 'missing', field: 'prompt', value: 'x' },
    { ...target, stepId: 'missing', field: 'detail', value: 'x' },
    { ...target, questionId: 'missing', field: 'prompt', value: 'x' },
    { ...target, optionId: 'missing', field: 'label', value: 'x' },
    { ...target, field: 'prompt', value: ' '.repeat(1001) },
    { ...target, field: 'detail', value: 'x'.repeat(2001) },
    { ...target, optionId: 'plot', field: 'label', value: 'x'.repeat(121) },
    { ...target, optionId: 'plot', field: 'description', value: 'x'.repeat(501) },
    { toolId: target.toolId, field: 'result', value: 'x'.repeat(101) }
  ]
  for (const edit of edits) assert.throws(() => updateDraftWorkflow(f.text, f.manifest, edit))
  assert.deepEqual(JSON.parse(f.text), f.recipe)
  f.recipe.tools[0].steps[0].args.question.questions[0].options[1].id = 'character'
  assert.equal(editableDraftWorkflow(JSON.stringify(f.recipe), f.manifest)![0]!.steps[0]!.questions, null)
})

test('option actions preserve surrounding workflow and encoding, make independent copies and restore exact identity and position', () => {
  const f = fixture(), q = f.recipe.tools[0].steps[0].args.question.questions[0]
  q.options[0].recommended = true; q.options[0].description = '保留说明'
  f.recipe.tools[0].steps[0].args.question.questions.push({ id: 'other', prompt: '另一问题', mode: 'multiple', required: false, options: structuredClone(q.options) })
  f.recipe.tools[0].steps[0].when = { equals: [true, true] }
  f.recipe.tools[0].steps.push({ id: 'dynamic', call: 'interaction.request', args: { question: { $ref: 'input.question' } } })
  const original = structuredClone(f.recipe)
  const text = '\ufeff' + JSON.stringify(f.recipe, null, 2).replaceAll('\n', '\r\n') + '\r\n'
  const added = addDraftWorkflowOption(text, f.manifest, target)
  const copied = addDraftWorkflowOption(added.text, f.manifest, target, 'character')
  assert.notEqual(added.id, copied.id); assert.match(added.id, /^option-[a-f0-9-]{36}$/)
  const next = JSON.parse(copied.text.slice(1)), options = next.tools[0].steps[0].args.question.questions[0].options
  assert.deepEqual(options[2], { id: added.id, label: '' })
  assert.deepEqual(options[3], { ...q.options[0], id: copied.id, label: q.options[0].label + '（副本）' })
  options.splice(2); assert.deepEqual(next, original)
  const edited = updateDraftWorkflow(copied.text, f.manifest, { ...target, optionId: copied.id, field: 'label', value: '独立副本' })
  assert.equal(editableDraftWorkflow(edited, f.manifest)![0]!.steps[0]!.questions![0]!.options[0]!.label, q.options[0].label)
  const removed = removeDraftWorkflowOption(edited, f.manifest, target, 'character')
  assert.deepEqual(removed.removed.option, q.options[0]); assert.equal(removed.removed.index, 0)
  const restored = restoreDraftWorkflowOption(removed.text, f.manifest, removed.removed)
  assert.equal(restored, edited)
  assert.ok(restored.startsWith('\ufeff')); assert.ok(restored.endsWith('\r\n')); assert.ok(!/(?<!\r)\n/.test(restored))
  assert.deepEqual(f.recipe, original)
})

test('option actions enforce runtime bounds, stale targets, free-answer/dynamic fallback and undo collisions', () => {
  const f = fixture()
  assert.throws(() => removeDraftWorkflowOption(f.text, f.manifest, target, 'plot'), /至少保留 2/)
  for (const stale of [{ ...target, toolId: 'gone' }, { ...target, stepId: 'gone' }, { ...target, questionId: 'gone' }]) {
    assert.throws(() => addDraftWorkflowOption(f.text, f.manifest, stale))
  }
  assert.throws(() => addDraftWorkflowOption(f.text, f.manifest, target, 'gone'))
  let full = f.text
  for (let i = 2; i < workflowOptionLimit; i++) {
    const result = addDraftWorkflowOption(full, f.manifest, target)
    full = updateDraftWorkflow(result.text, f.manifest, { ...target, optionId: result.id, field: 'label', value: `选项 ${i}` })
  }
  const projected = editableDraftWorkflow(full, f.manifest)![0]!.steps[0]!.questions!
  assert.equal(projected[0]!.options.length, 8)
  decodeAuthorQuestionRequest({ questions: projected })
  assert.throws(() => decodeAuthorQuestionRequest({ questions: [{ ...projected[0]!, options: [...projected[0]!.options, { id: 'ninth', label: '越界' }] }] }))
  assert.throws(() => addDraftWorkflowOption(full, f.manifest, target), /最多 8/)
  assert.throws(() => addDraftWorkflowOption(full, f.manifest, target, 'plot'), /最多 8/)
  const removed = removeDraftWorkflowOption(full, f.manifest, target, 'plot')
  assert.throws(() => restoreDraftWorkflowOption(full, f.manifest, removed.removed), /最多 8/)
  const smaller = removeDraftWorkflowOption(full, f.manifest, target, projected[0]!.options[7]!.id)
  assert.throws(() => restoreDraftWorkflowOption(smaller.text, f.manifest, removed.removed), /标识已被使用/)
  assert.equal(restoreDraftWorkflowOption(removed.text, f.manifest, removed.removed), full)
  assert.throws(() => restoreDraftWorkflowOption(removed.text, f.manifest, { ...removed.removed, option: { id: 'bad', label: 'x'.repeat(121) } }))
  assert.throws(() => removeDraftWorkflowOption(full, f.manifest, target, 'gone'))
  const q = f.recipe.tools[0].steps[0].args.question.questions[0]
  q.mode = 'text'; q.options = []
  assert.throws(() => addDraftWorkflowOption(JSON.stringify(f.recipe), f.manifest, target), /自由回答/)
  f.recipe.tools[0].steps[0].args.question = { $ref: 'input.question' }
  const dynamic = JSON.stringify(f.recipe)
  assert.throws(() => addDraftWorkflowOption(dynamic, f.manifest, target))
  assert.throws(() => removeDraftWorkflowOption(dynamic, f.manifest, target, 'plot'))
  assert.throws(() => restoreDraftWorkflowOption(dynamic, f.manifest, removed.removed))
  assert.deepEqual(JSON.parse(f.text), fixture().recipe)
})

test('edited workflow builds through the production ZIP parser and asks/resumes with a newly created option', async () => {
  const f = fixture()
  let text = updateDraftWorkflow(f.text, f.manifest, { ...target, field: 'prompt', value: '先检查本章的哪一项？' })
  text = updateDraftWorkflow(text, f.manifest, { ...target, optionId: 'character', field: 'label', value: '人物动机' })
  const added = addDraftWorkflowOption(text, f.manifest, target)
  text = updateDraftWorkflow(added.text, f.manifest, { ...target, optionId: added.id, field: 'label', value: '伏笔衔接' })
  text = updateDraftWorkflow(text, f.manifest, { toolId: target.toolId, field: 'result', value: '按作者选择继续核对本章。' })
  const built = await buildPluginContent({ ...f.content, files: [{ path: 'recipe.json', content: text }] })
  const source = declarativeSource(new TextDecoder('utf-8', { fatal: true }).decode(built.pkg.files.get('recipe.json')), built.pkg.manifest)
  const wasm = new Uint8Array(await readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))).buffer
  let checkpoint: JsonValue = null, calls = 0
  const first = await executeGuest({ invocationId: 'form-question', source, toolId: 'choose_focus', input: {} }, wasm, async (method, input) => {
    calls++; assert.equal(method, 'interaction.request')
    const args = input as JsonObject, actual = decodeAuthorQuestionRequest(args.question)
    assert.equal(actual.questions[0]!.prompt, '先检查本章的哪一项？'); assert.equal(actual.questions[0]!.options[0]!.label, '人物动机')
    assert.deepEqual(actual.questions[0]!.options[2], { id: added.id, label: '伏笔衔接' })
    checkpoint = args.checkpoint!; return {}
  }, new AbortController().signal)
  assert.equal(first.ok, true); assert.equal(calls, 1)
  const answers = [{ id: 'focus', chosenOptionIds: [added.id], customText: '', skipped: false }]
  const resumed = await executeGuest({ invocationId: 'form-resume', source, toolId: 'choose_focus', input: {}, continuation: { checkpoint, answer: { answers } } }, wasm, async () => { throw new Error('Must not ask again') }, new AbortController().signal)
  assert.equal(resumed.ok, true)
  if (resumed.ok) assert.deepEqual(resumed.value, { text: '按作者选择继续核对本章。', answers })
})
