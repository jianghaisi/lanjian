import assert from 'node:assert/strict'
import test from 'node:test'
import { formatManuscriptParagraphs } from '../../../src/renderer/features/manuscript/services/manuscript-formatting'

test('keeps single-newline prose as separate paragraphs', () => {
  const source = '第一段。\n第二段。\n　　第三段。'
  assert.equal(
    formatManuscriptParagraphs(source),
    '　　第一段。\n\n　　第二段。\n\n　　第三段。'
  )
})

test('normalises blank lines and CRLF without merging prose', () => {
  const source = '  第一段。\r\n\r\n\t第二段。\r\n　　\r\n第三段。'
  assert.equal(
    formatManuscriptParagraphs(source),
    '　　第一段。\n\n　　第二段。\n\n　　第三段。'
  )
})

test('paragraph formatting is idempotent', () => {
  const once = formatManuscriptParagraphs('第一段。\n第二段。')
  assert.equal(formatManuscriptParagraphs(once), once)
})

test('applies optional paragraph spacing and first-line indentation', () => {
  assert.equal(
    formatManuscriptParagraphs('　　第一段。\n\n第二段。', { firstLineIndent: false, paragraphSpacing: false }),
    '第一段。\n第二段。'
  )
})
