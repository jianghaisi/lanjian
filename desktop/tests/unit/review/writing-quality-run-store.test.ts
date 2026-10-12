import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WritingQualityRunStore } from '../../../src/main/modules/review/adapters/writing-quality-run-store'
import { createOfflineManifest } from '../../../src/main/modules/review/domain/writing-quality-fixtures'

test('contains run ids and refuses immutable replacement', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-quality-store-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(() => WritingQualityRunStore.open(root, '../escape'), /run-id/)
  const store = await WritingQualityRunStore.open(root, 'safe-run')
  const manifest = createOfflineManifest('safe-run', 30)
  await store.writeManifest(manifest)
  await assert.rejects(() => store.writeManifest(manifest), /拒绝覆盖/)
  assert.equal(JSON.parse(await readFile(join(store.runRoot, 'manifest.json'), 'utf8')).runId, 'safe-run')
})

test('fails closed on a partial JSONL tail', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-quality-ledger-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const store = await WritingQualityRunStore.open(root, 'partial-run')
  await writeFile(join(store.runRoot, 'attempts.jsonl'), '{"partial":true}', 'utf8')
  await assert.rejects(() => store.readAttemptValues(), /未完成的尾行/)
})

test('detects replacement of its run directory by a link', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-quality-swap-'))
  const outside = await mkdtemp(join(tmpdir(), 'lanjian-quality-outside-'))
  context.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]))
  const store = await WritingQualityRunStore.open(root, 'swap-run')
  await rm(store.runRoot, { recursive: true })
  try { await symlink(outside, store.runRoot, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return
    throw error
  }
  await assert.rejects(() => store.readAttemptValues(), /已被替换|超出了输出目录/)
})
