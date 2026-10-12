import assert from 'node:assert/strict'
import test from 'node:test'
import { createReviewBlocks, prepareBlockChange } from '../../../src/contracts/document-review/revisions'
const hash = 'a'.repeat(64)
test('a candidate yields separate immutable changes and accepting one preserves other originals', () => {
  const content = '旧开端。' + '两人沿着河边走。'.repeat(20) + '旧结尾。'
  const blocks = createReviewBlocks('real-session', { content, versionId: 'v1', hash }, content.replace('旧开端', '新开端').replace('旧结尾', '新结尾'))
  assert.equal(blocks.length, 2)
  const first = prepareBlockChange(content, blocks[0]!, hash)
  assert.ok(first.content.startsWith('新开端。'))
  assert.ok(first.content.endsWith('旧结尾。'))
  const second = prepareBlockChange(first.content, blocks[1]!)
  assert.ok(second.content.endsWith('新结尾。'))
  assert.ok(blocks.every(block => block.status === 'pending'))
})
test('deletion and insertion have actionable anchors; a decided or changed block cannot silently apply', () => {
  const deletion = createReviewBlocks('delete', { content: '删去。留下。', versionId: 'v1', hash }, '留下。')[0]!
  assert.equal(deletion.replacement, '')
  assert.equal(prepareBlockChange('删去。留下。', deletion, hash).content, '留下。')
  assert.throws(() => prepareBlockChange('已经手改。留下。', deletion))
  assert.throws(() => prepareBlockChange('删去。留下。', { ...deletion, status: 'rejected' }, hash))
  const insertion = createReviewBlocks('insert', { content: '', versionId: 'v1', hash }, '新增。')[0]!
  assert.equal(prepareBlockChange('', insertion, hash).content, '新增。')
})
