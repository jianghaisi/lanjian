import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { ManuscriptFileStore, textHash, type TextFileSaveInput } from '../../../src/main/modules/manuscript/adapters/manuscript-file-store'

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-file-text-'))
  t.after(async () => {
    assert.equal(await realpath(root), root)
    assert.equal(dirname(root), await realpath(tmpdir()))
    await rm(root, { recursive: true, force: true })
  })
  const store = await ManuscriptFileStore.open(root)
  const input = (content = '第一段正文。', expectedHash: string | null = null): TextFileSaveInput => ({
    operationId: randomUUID(), documentId: 'chapter-1', kind: 'body', relativePath: '正文/第1章-开端.md',
    title: '开端', expectedHash, content
  })
  return { root, store, input }
}

test('current Markdown commits before metadata, preserves exact UTF-8 and removes only acknowledged receipts', async t => {
  const { root, store, input } = await fixture(t)
  const request = input('\ufeff第一行\r\n🪶第二行\n')
  const result = await store.save(request, async (receipt, file) => {
    assert.equal(await readFile(join(root, request.relativePath), 'utf8'), request.content)
    assert.equal(receipt.contentHash, textHash(request.content))
    assert.equal(file.content, request.content)
    const journal = await readFile(join(root, '.webnovel/recovery/text-writes', request.operationId + '.json'), 'utf8')
    assert.equal(journal.includes('第一行'), false)
  })
  assert.deepEqual(result, { fileSaved: true, metadataSaved: true, changed: true, hash: textHash(request.content) })
  assert.equal((await store.read(request.relativePath)).content, request.content)
  assert.deepEqual(await store.pending(), [])
  assert.deepEqual(await readdir(join(root, '.webnovel/recovery/text-writes')), [])
})

test('metadata failure retains new current file and durable recovery; a new instance replays the same operation', async t => {
  const { root, store, input } = await fixture(t)
  const request = input('刚写好的新稿。')
  const result = await store.save(request, async () => { throw new Error('simulated database failure') })
  assert.equal(result.fileSaved, true)
  assert.equal(result.metadataSaved, false)
  assert.equal((await store.read(request.relativePath)).content, request.content)
  const reopened = await ManuscriptFileStore.open(root)
  const pending = await reopened.pending()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].operationId, request.operationId)
  assert.equal(await readFile(join(root, '.webnovel/recovery/text-writes', request.operationId + '.md'), 'utf8'), request.content)
  let calls = 0
  const recovered = await reopened.recover(async receipt => { calls++; assert.equal(receipt.operationId, request.operationId) })
  assert.equal(calls, 1)
  assert.equal(recovered[0].metadataSaved, true)
  assert.deepEqual(await reopened.recover(async () => { throw new Error('must not replay acknowledged operation') }), [])
})

test('interruption after durable receipt but before replace is recoverable without inventing an empty original', async t => {
  const { root, store, input } = await fixture(t)
  const request = input('可恢复的输入。')
  let guards = 0
  await assert.rejects(store.save(request, async () => {}, async () => {
    if (++guards === 2) throw new Error('simulated interruption before replace')
  }), /simulated interruption/)
  await assert.rejects(store.read(request.relativePath), { code: 'NOT_FOUND' })
  const reopened = await ManuscriptFileStore.open(root)
  assert.equal((await reopened.pending()).length, 1)
  await reopened.recover(async () => {})
  assert.equal((await reopened.read(request.relativePath)).content, request.content)
})

test('stale saves and external modifications during recovery never overwrite either author version', async t => {
  const { root, store, input } = await fixture(t)
  const first = input('原稿')
  await store.save(first, async () => {})
  await assert.rejects(store.save(input('过期请求', null), async () => {}), { code: 'CONFLICT' })
  const second = input('应用新稿', textHash('原稿'))
  await store.save(second, async () => { throw new Error('metadata failed') })
  await writeFile(join(root, second.relativePath), '外部作者的新稿', 'utf8')
  await assert.rejects(store.recover(async () => {}), { code: 'CONFLICT' })
  assert.equal((await store.read(second.relativePath)).content, '外部作者的新稿')
  assert.equal(await readFile(join(root, '.webnovel/recovery/text-writes', second.operationId + '.md'), 'utf8'), '应用新稿')
  await assert.rejects(store.save(input('另一次保存', textHash('外部作者的新稿')), async () => {}), { code: 'CONFLICT' })
})

test('scope becomes stale immediately before replacement; receipt and recovery bytes survive', async t => {
  const { store, input } = await fixture(t)
  const request = input('不能写入已切走的作品')
  let checks = 0
  await assert.rejects(store.save(request, async () => {}, async () => {
    if (++checks === 3) throw new Error('book switched')
  }), /book switched/)
  await assert.rejects(store.read(request.relativePath), { code: 'NOT_FOUND' })
  assert.equal((await store.pending()).length, 1)
})

test('identical content is a no-op on text; metadata may still change independently', async t => {
  const { root, store, input } = await fixture(t)
  await store.save(input('不变'), async () => {})
  const before = await readdir(join(root, '.webnovel/recovery/text-writes'))
  let called = false
  const result = await store.save(input('不变', textHash('不变')), async () => { called = true })
  assert.equal(called, true)
  assert.equal(result.changed, false)
  assert.deepEqual(await readdir(join(root, '.webnovel/recovery/text-writes')), before)
})

test('immutable history deduplicates by content hash and reports corruption without overwriting', async t => {
  const { root, store } = await fixture(t)
  const a = await store.snapshot('旧版本')
  assert.deepEqual(await store.snapshot('旧版本'), a)
  const b = await store.snapshot('新版本')
  assert.notEqual(a.hash, b.hash)
  assert.equal((await store.readSnapshot(a.hash)).content, '旧版本')
  await writeFile(join(root, a.relativePath), '被外部改坏的历史')
  await assert.rejects(store.readSnapshot(a.hash), { code: 'DATABASE_INTEGRITY_FAILED' })
  await assert.rejects(store.snapshot('旧版本'), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.equal(await readFile(join(root, a.relativePath), 'utf8'), '被外部改坏的历史')
})

test('read-only open, missing manuscripts and empty text are distinct', async t => {
  const { root, store, input } = await fixture(t)
  await assert.rejects(store.read('正文/缺失.md'), { code: 'NOT_FOUND' })
  assert.deepEqual(await store.pending(), [])
  assert.deepEqual(await readdir(root), [])
  await store.save(input(''), async () => {})
  assert.equal((await store.read('正文/第1章-开端.md')).content, '')
})

test('rejects traversal, type mismatch, invalid UTF-8 and corrupted receipt without writes', async t => {
  const { root, store, input } = await fixture(t)
  for (const path of ['正文/../../escape.md', '正文/../大纲/a.md', 'C:/escape.md', '正文/a.md:stream', '正文\\a.md', '正文/sub /a.md']) {
    await assert.rejects(store.save({ ...input(), relativePath: path }, async () => {}))
  }
  await assert.rejects(store.save({ ...input(), kind: 'outline' }, async () => {}))
  await assert.rejects(store.save(input('\ud800'), async () => {}))
  assert.deepEqual(await readdir(root), [])
  await mkdir(join(root, '正文'))
  await writeFile(join(root, '正文/坏文件.md'), Buffer.from([0xff]))
  await assert.rejects(store.read('正文/坏文件.md'), { code: 'DATABASE_INTEGRITY_FAILED' })
  await mkdir(join(root, '.webnovel/recovery/text-writes'), { recursive: true })
  await writeFile(join(root, '.webnovel/recovery/text-writes', randomUUID() + '.json'), '{}')
  await assert.rejects(store.pending(), { code: 'DATABASE_INTEGRITY_FAILED' })
})

test('a manuscript junction cannot redirect writes outside the book', async t => {
  const { root, store, input } = await fixture(t)
  const outside = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-file-outside-'))
  t.after(async () => {
    assert.equal(await realpath(outside), outside)
    assert.equal(dirname(outside), await realpath(tmpdir()))
    await rm(outside, { recursive: true, force: true })
  })
  await symlink(outside, join(root, '正文'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(store.save(input(), async () => {}), { code: 'PATH_ESCAPE' })
  assert.deepEqual(await readdir(outside), [])
})
