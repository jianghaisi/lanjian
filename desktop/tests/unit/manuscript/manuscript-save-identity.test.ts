import assert from 'node:assert/strict'
import test from 'node:test'
import { isSameManuscriptDraft, isSameManuscriptSaveTarget } from '../../../src/contracts/manuscript/manuscript-save-identity'

test('accepts a save result only for the same work item path and chapter', () => {
  const attempt = { workItemId: 'book-a', workItemPath: 'E:\\works\\book-a', chapterId: 7 }
  assert.equal(isSameManuscriptSaveTarget(attempt, { ...attempt }), true)
  assert.equal(isSameManuscriptSaveTarget(attempt, { ...attempt, workItemId: 'book-b' }), false)
  assert.equal(isSameManuscriptSaveTarget(attempt, { ...attempt, workItemPath: 'E:\\works\\book-a-copy' }), false)
  assert.equal(isSameManuscriptSaveTarget(attempt, { ...attempt, chapterId: 8 }), false)
})

test('distinguishes an acknowledged snapshot from newer local text', () => {
  const attempt = { title: '第七章', content: '第一版草稿' }
  assert.equal(isSameManuscriptDraft(attempt, { ...attempt }), true)
  assert.equal(isSameManuscriptDraft(attempt, { ...attempt, content: '第一版草稿，新增一句。' }), false)
})
