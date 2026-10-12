import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { fixture } from './helpers.ts'
import { assertDocumentUpload } from '../src/files/document-upload.ts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'

test('browser upload reuses core preview/commit/export and cannot cross book ownership', async t => {
  const f = fixture(t), user = await f.login(), other = await f.login('456')
  const book = f.books.create(user.me.user.id, { title: '导入测试', operation: 'import_book' })
  const base = `/api/books/${book.id}/desktop`
  const post = (path: string, payload: unknown, who = user) => f.app.inject({ method: 'POST', url: `${base}/${path}`, cookies: who.cookies, headers: who.headers, payload })
  const input = { mode: 'single', files: [{ name: '灯火.txt', base64: Buffer.from('第一章 灯火\n\n渡口的灯亮了。\n\n第二章 归人\n\n天亮时他回来了。').toString('base64') }] }
  assert.equal((await post('import-files', input, other)).statusCode, 404)
  assert.equal((await post('import-files', { ...input, files: [{ ...input.files[0], name: '../escape.txt' }] })).statusCode, 400)
  const response = await post('import-files', input)
  assert.equal(response.statusCode, 200, response.body)
  assert.ok(!response.body.includes(f.root))
  const preview = response.json()
  const committed = await post('imports/commit-text', { operation: randomUUID(), args: [{ expectedWorkItemId: book.id, token: preview.token, ownership: 'owned', creationMethod: 'mixed', title: '灯火', selectedChapterIndexes: preview.chapters.map((c: any) => c.sourceIndex) }] })
  const result = unwrapValidatedIpcResponse<any>('imports:commit-text', committed.json())
  assert.equal(result.importedChapterIds.length, 2)
  const exported = await post('export-manuscript', {})
  assert.equal(exported.statusCode, 200, exported.body)
  assert.equal(exported.json().chapterCount, 2); assert.match(exported.json().content, /天亮时他回来了/)
  assert.equal(f.credits.wallet(user.me.user.id).balance, 10000)
  assert.equal(f.db.all('SELECT id FROM attempts').length, 0)
})

test('DOCX upload rejects inflated archives before document extraction', async () => {
  const zip = new JSZip(); zip.file('word/document.xml', '<document>hello</document>')
  const valid = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  assert.doesNotThrow(() => assertDocumentUpload('book.docx', valid))
  const oversized = Buffer.from(valid), central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  oversized.writeUInt32LE(32 * 1024 * 1024, central + 24)
  assert.throws(() => assertDocumentUpload('book.docx', oversized), /request-too-large/)
  assert.throws(() => assertDocumentUpload('book.docx', Buffer.from('not a zip')), /invalid-request/)
})
