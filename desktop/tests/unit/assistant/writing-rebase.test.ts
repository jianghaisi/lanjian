import assert from 'node:assert/strict'
import test from 'node:test'
import { rebaseWritingAgentText } from '../../../src/contracts/assistant/writing-rebase'
import { decodeWritingAgentArtifactApplicationArgs as decodeWritingAgentApplicationArgs } from '../../../src/contracts/ipc'

test('preserves independent author and AI edits, including new paragraphs and moved selection offsets', () => {
  const base = '第一处旧句。\n\n中段不变。\n\n第二处旧句。'
  const current = '作者新增开头。\n\n' + base + '\n\n作者新增结尾。'
  const result = rebaseWritingAgentText(base, current, base.replace('第一处旧句', '第一处新句'))
  assert.equal(result.unresolved, 0)
  assert.equal(result.content, current.replace('第一处旧句', '第一处新句'))
})

test('overlapping replacement requires an explicit decision and preserves unrelated edits either way', () => {
  const base = '开场。\n\n旧对白。\n\n收尾。'
  const current = '我的开场。\n\n我的对白。\n\n收尾。'
  const proposed = '开场。\n\nAI对白。\n\n新的收尾。'
  const preview = rebaseWritingAgentText(base, current, proposed)
  assert.equal(preview.unresolved, 1)
  const id = preview.conflicts[0].id
  assert.equal(rebaseWritingAgentText(base, current, proposed, { [id]: 'current' }).content, '我的开场。\n\n我的对白。\n\n新的收尾。')
  assert.equal(rebaseWritingAgentText(base, current, proposed, { [id]: 'candidate' }).content, '我的开场。\n\nAI对白。\n\n新的收尾。')
})

test('identical changes are not duplicated; simultaneous insertion and deletion conflicts need review', () => {
  assert.equal(rebaseWritingAgentText('旧句。', '新句。', '新句。').content, '新句。')
  assert.equal(rebaseWritingAgentText('旧句。', '新句。', '新句。').unresolved, 0)
  assert.equal(rebaseWritingAgentText('开头。', '开头。我的续写。', '开头。AI续写。').unresolved, 1)
  assert.equal(rebaseWritingAgentText('开头。旧句。收尾。', '开头。收尾。', '开头。新句。收尾。').unresolved, 1)
})

test('shared first-line formatting is not mistaken for an overlapping content rewrite', () => {
  const base = '第一处旧句。\n\n中段不变。\n\n第二处旧句。'
  const current = '　　' + base + '\n\n作者新增。'
  const candidate = '　　第一处新句。\n\n　　中段不变。\n\n　　第二处旧句。'
  const result = rebaseWritingAgentText(base, current, candidate)
  assert.equal(result.unresolved, 0)
  assert.equal(result.content, candidate + '\n\n作者新增。')
})

test('conflict decisions show one complete sentence rather than fragments of Chinese words', () => {
  const base = '第一处旧句。\n\n中段不变。'
  const current = '　　作者重新写了第一句。\n\n中段不变。\n\n作者新增。'
  const proposed = '　　第一处新句。\n\n　　中段不变。'
  const preview = rebaseWritingAgentText(base, current, proposed)
  assert.equal(preview.conflicts.length, 1)
  assert.match(preview.conflicts[0].current, /作者重新写了第一句。/)
  assert.match(preview.conflicts[0].candidate, /第一处新句。/)
  assert.equal(rebaseWritingAgentText(base, current, proposed, { 'conflict-1': 'candidate' }).content, '　　第一处新句。\n\n　　中段不变。\n\n作者新增。')
})

test('large texts use conservative conflict review, preserving both proposals without guessing', () => {
  const base = '原句。'.repeat(600)
  const current = '作者改句。' + base.slice(3)
  const proposed = base.slice(0, -3) + 'AI改句。'
  const merged = rebaseWritingAgentText(base, current, proposed)
  assert.equal(merged.content, '作者改句。' + base.slice(3, -3) + 'AI改句。')
  assert.throws(() => rebaseWritingAgentText('旧', '甲', '乙', { 'conflict-2': 'current' }), /不一致/)
})

test('rebase IPC accepts only bounded explicit decisions, never renderer-composed manuscript text', () => {
  const input = { taskId: '00000000-0000-4000-8000-000000000001', title: '标题', expectedRevision: 'a'.repeat(64), formatting: { firstLineIndent: true, paragraphSpacing: true } }
  assert.deepEqual(decodeWritingAgentApplicationArgs([{ ...input, rebase: { choices: { 'conflict-1': 'current' } } }])[0].rebase, { choices: { 'conflict-1': 'current' } })
  for (const rebase of [{ choices: {}, content: '越权正文' }, { choices: { '__proto__x': 'current' } }, { choices: { 'conflict-1': 'overwrite' } }, { choices: [] }]) {
    assert.throws(() => decodeWritingAgentApplicationArgs([{ ...input, rebase }]))
  }
})
