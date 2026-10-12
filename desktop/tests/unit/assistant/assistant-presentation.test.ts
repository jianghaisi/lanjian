import assert from 'node:assert/strict'
import test from 'node:test'
import { renderAssistantDocument, assistantCharacterCount, matchesAssistantHistory, copilotMessages, readAssistantReview, appendAssistantQuote, appendAssistantRequest, assistantInstructionLimit } from '../../../src/renderer/features/assistant/services/assistant-presentation'

test('long creative output remains complete, including headings, tables and its last paragraph', () => {
  const content = '# 人物动机\n\n' + '他想修复旧物，也想找回自己的记忆。\n\n'.repeat(1000) + '|人物|目标|\n|---|---|\n|阿青|寻找真相|\n\n最后一段。'
  const html = renderAssistantDocument(content)
  assert.match(html, /<h1>人物动机<\/h1>/)
  assert.match(html, /<table>/)
  assert.match(html, /最后一段。/)
  assert.equal(html.match(/他想修复旧物/g)?.length, 1000)
})
test('model HTML, remote images and executable/local URLs cannot execute, load or navigate', () => {
  const html = renderAssistantDocument('<script>alert(1)</script>\n<img src="https://evil.test/a" onerror="alert(1)">\n\n[点击](javascript:alert%281%29) [本地](file:///secret) [网站](https://example.test) ![外部图](https://evil.test/image)')
  assert.doesNotMatch(html, /<(?:script|img|iframe|a)\b/i)
  assert.doesNotMatch(html, /<[^>]*\s(?:src|href|onerror)=/i)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /外部图/)
})
test('history search keeps long results and supports multiple terms without changing stored records', () => {
  assert.ok(matchesAssistantHistory('旧物 记忆', '推敲旧物', '寻找记忆'))
  assert.ok(!matchesAssistantHistory('旧物 失踪', '推敲旧物', '寻找记忆'))
  const turns = [{role:'assistant' as const, content:'完整段落。'.repeat(3000),tools:['读取核心设想']}]
  const messages = copilotMessages(turns)
  assert.equal(messages[0]!.content, turns[0]!.content)
  assert.deepEqual(Object.keys(turns[0]!), ['role','content','tools'])
  assert.equal(assistantCharacterCount('你 好\n🌱'), 3)
})
test('send review projects the original captured request and rejects malformed data', () => {
  const value = {message:'修改动机',page:'profile',history:[{role:'user',content:'保留关系'}],fields:[{label:'核心设想',value:'雨夜旧物'}],backgrounds:['完整背景']}
  assert.deepEqual(readAssistantReview(JSON.stringify(value)), value)
  assert.equal(readAssistantReview('{'), null)
  assert.equal(readAssistantReview(JSON.stringify({...value,fields:[{label:'A',value:{}}]})), null)
})

test('quoting appends the complete selected passage without replacing an existing draft', () => {
  const draft = '我已经写好的要求。\n保留末尾空白  '
  const result = appendAssistantQuote(draft, '第一段🌱\r\n\r\n第二段。', 'assistant')
  assert.equal(result.value, draft + '\n\n> 智能助笔：\n> 第一段🌱\n> \n> 第二段。\n\n')
  assert.equal(appendAssistantQuote('', '之前的要求', 'user').value, '> 你此前的要求：\n> 之前的要求\n\n')
})

test('quoting refuses empty or over-limit input without returning truncated text', () => {
  assert.ok(appendAssistantQuote('草稿', '  \n ', 'assistant').error)
  const prefix = appendAssistantQuote('', '文', 'assistant').value!
  const available = assistantInstructionLimit - prefix.length - 2
  assert.equal(appendAssistantQuote('稿'.repeat(available), '文', 'assistant').value?.length, assistantInstructionLimit)
  assert.ok(appendAssistantQuote('稿'.repeat(available + 1), '文', 'assistant').error)
  assert.equal(appendAssistantQuote('草稿', '长'.repeat(assistantInstructionLimit), 'assistant').value, undefined)
})

test('quick requests preserve complete author drafts, whitespace and Unicode', () => {
  const request='推敲人物🌱\n保留结尾空白  ',draft='已写的想法\r\n\n  '
  assert.equal(appendAssistantRequest('',request).value,request)
  assert.equal(appendAssistantRequest(draft,request).value,draft+'\n\n'+request)
  assert.equal(appendAssistantRequest('  \n',request).value,'  \n\n\n'+request)
})

test('repeating the current request is idempotent, but substrings and earlier passages do not suppress it', () => {
  const request='推敲人物',draft='原草稿\n\n'+request
  assert.equal(appendAssistantRequest(request,request).value,request)
  assert.equal(appendAssistantRequest(draft,request).value,draft)
  assert.equal(appendAssistantRequest('不只是'+request,request).value,'不只是'+request+'\n\n'+request)
  assert.equal(appendAssistantRequest(request+'\n\n后续要求',request).value,request+'\n\n后续要求\n\n'+request)
})

test('quick requests reject blank and over-limit text without partial insertion, using the composer UTF-16 limit', () => {
  assert.equal(appendAssistantRequest('保留草稿',' \n ').value,undefined)
  const draft='稿'.repeat(assistantInstructionLimit-4)
  assert.equal(appendAssistantRequest(draft,'🌱').value?.length,assistantInstructionLimit)
  assert.equal(appendAssistantRequest(draft+'稿','🌱').value,undefined)
  assert.equal(appendAssistantRequest('','稿'.repeat(assistantInstructionLimit+1)).value,undefined)
  const full='稿'.repeat(assistantInstructionLimit)
  assert.equal(appendAssistantRequest(full,full).value,full)
})
