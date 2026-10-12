import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fixture } from './helpers.ts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import { desktopPrivateArgs, desktopPublicValue } from '../src/writing/desktop-values.ts'

test('original desktop bootstrap, chapter save, conflict and recovery use tenant-bound real authority', async t => {
  const f = fixture(t), author = await f.login(), other = await f.login('456')
  const book = f.books.create(author.me.user.id, { title: '原版工作台', operation: 'desktop_book_1' })
  const base = `/api/books/${book.id}/desktop`
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/desktop/library/open', cookies: author.cookies, headers: author.headers, payload: { id: book.id } })).statusCode, 200)
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/desktop/library/open', cookies: other.cookies, headers: other.headers, payload: { id: book.id } })).statusCode, 404)
  const request = (channel: string, args: unknown[] = [], user = author) => f.app.inject({ method: 'POST',
    url: `${base}/${channel.replace(':','/')}`, cookies: user.cookies, headers: user.headers, payload: { args, operation: randomUUID() } })
  const invoke = async <T>(channel: string, args: unknown[] = []): Promise<T> => {
    const response = await request(channel, args)
    assert.equal(response.statusCode, 200, response.body)
    assert.ok(!response.body.includes(f.root), 'no physical root in DTO')
    return unwrapValidatedIpcResponse(channel, response.json())
  }
  const bootstrap = await invoke<any>('workspace:bootstrap')
  assert.equal(bootstrap.workItem.id, book.id); assert.equal(bootstrap.workItem.path, book.id)
  assert.equal(bootstrap.aiSettings.modelConfigured, false)
  assert.deepEqual(await invoke('assistant:recent-fields', [book.id]), [])
  assert.deepEqual(await invoke('assistant-runs:recent'), [])
  assert.equal(typeof await invoke('events:settlement-cancel'), 'boolean')
  assert.equal((await request('assistant:recent-fields', [randomUUID()])).statusCode, 404)
  const created = await invoke<any>('chapters:create')
  const saved = await invoke<any>('chapters:update', [created.id, { workItemId: book.id, workItemPath: book.id,
    title: '渡口', content: '灯还亮着。', expectedRevision: created.revision }])
  assert.equal(saved.content, '灯还亮着。')
  const conflict = await request('chapters:update', [created.id, { workItemId: book.id, workItemPath: book.id,
    title: '渡口', content: '不能覆盖', expectedRevision: created.revision }])
  assert.equal(conflict.json().ok, false); assert.equal(conflict.json().error.code, 'CONFLICT')
  assert.equal((await invoke<any>('chapters:get', [created.id])).content, '灯还亮着。')
  assert.equal((await request('workspace:bootstrap', [], other)).statusCode, 404)
  assert.equal((await request('chapters:update', [created.id, { workItemId: randomUUID(), workItemPath: book.id,
    title: '入侵', content: '不能覆盖', expectedRevision: saved.revision }])).statusCode, 404)
  assert.equal((await f.app.inject({ method: 'POST', url: `${base}/workspace/bootstrap`, cookies: author.cookies, payload: { args: [], operation: randomUUID() } })).statusCode, 403)
  assert.equal((await request('research:search', ['http://127.0.0.1'])).statusCode, 404)
  assert.equal((await request('ai:complete', ['不能绕过计费'])).statusCode, 503)
})

test('desktop path projection keeps required metadata and never rewrites prose', () => {
  const root = join(process.cwd(), 'synthetic-private-root'), book = randomUUID()
  const text = `作者写下 ${root} 作为故事中的路径。`
  assert.deepEqual(desktopPublicValue({ workItem: { id: root, path: root }, filePath: join(root, '正文', '第一章.md'), content: text }, root, book),
    { workItem: { id: book, path: book }, filePath: `${book}/正文/第一章.md`, content: text })
  assert.deepEqual(desktopPrivateArgs([{ workItemId: book, content: text }], root, book), [{ workItemId: root, content: text }])
  assert.throws(() => desktopPrivateArgs([{ workItemId: randomUUID() }], root, book))
  assert.throws(() => desktopPrivateArgs([{ filePath: 'C:\\private\\secret' }], root, book))
  assert.throws(() => desktopPublicValue({ filePath: join(root, '..', 'secret') }, root, book))
})

test('original new-book preview creates one private book with operator model defaults and rejects foreign previews', async t => {
  const f = fixture(t), author = await f.login(), other = await f.login('456')
  const invoke = async (name: string, args: unknown[] = [], user = author) => f.app.inject({ method: 'POST', url: `/api/desktop/library/model-connections/${name}`, cookies: user.cookies, headers: user.headers, payload: { args, operation: randomUUID() } })
  const preview = unwrapValidatedIpcResponse<any>('model-connections:previewCreation', (await invoke('previewCreation', [true])).json())
  const input = { token: preview.token, project: { name: '新的灯火', parentPath: '账户书库' } }
  assert.equal((await invoke('createProject', [input], other)).statusCode, 409)
  assert.equal((await invoke('createProject', [{ ...input, project: { name: '越界', parentPath: '/etc' } }])).statusCode, 400)
  const first = await invoke('createProject', [input])
  assert.equal(first.statusCode, 200, first.body)
  const created = unwrapValidatedIpcResponse<any>('model-connections:createProject', first.json())
  assert.equal(created.status, 'created'); assert.equal(created.project.title, '新的灯火')
  assert.equal(created.project.path, created.project.id)
  const again = unwrapValidatedIpcResponse<any>('model-connections:createProject', (await invoke('createProject', [input])).json())
  assert.equal(again.project.id, created.project.id)
  assert.equal(f.books.list(author.me.user.id).length, 1)
  assert.equal(f.books.list(other.me.user.id).length, 0)
  assert.ok(!first.body.includes(f.root))
})
