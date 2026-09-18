import assert from 'node:assert/strict'
import test from 'node:test'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response'

const token = 'b0000000-0000-4000-8000-000000000001'
const preview = { token, chapterId: 162, sqliteContent: '正式章纲。', externalContent: '外部候选章纲。', expiresAt: '2026-09-12T15:00:00.000Z' }
const adoption = {
  outline: { chapterId: 162, title: '核对姓名', content: preview.externalContent, revision: 'a'.repeat(64),
    volume: 3, stage: null, hasManuscript: true, mirrorStatus: 'synced' },
  previousOutlineVersionId: 'outline-version-before', importedExternalHash: 'b'.repeat(64), mirrorPending: false
}
const unwrap = (channel: string, value: unknown) => unwrapValidatedIpcResponse(channel, { ok: true, value })

test('outline recovery validates actual preview and committed result channels', () => {
  assert.deepEqual(unwrap('chapter-outlines:preview-external-mirror', preview), preview)
  assert.deepEqual(unwrap('chapter-outlines:adopt-external-mirror', adoption), adoption)
  assert.deepEqual(unwrap('chapter-outlines:adopt-external-mirror', { ...adoption, mirrorPending: true }), { ...adoption, mirrorPending: true })
})

test('outline recovery rejects malformed preview and result DTOs before renderer use', () => {
  for (const patch of [{ token: '../book' }, { chapterId: 0 }, { externalContent: null }, { sqliteContent: 'x'.repeat(2_000_001) }, { expiresAt: 'unknown' }]) {
    assert.throws(() => unwrap('chapter-outlines:preview-external-mirror', { ...preview, ...patch }), { code: 'INTERNAL_ERROR' })
  }
  for (const patch of [{ outline: null }, { outline: { ...adoption.outline, revision: '' } }, { mirrorPending: undefined },
    { mirrorPending: 'false' }, { previousOutlineVersionId: '' }, { importedExternalHash: 'not-a-hash' }]) {
    assert.throws(() => unwrap('chapter-outlines:adopt-external-mirror', { ...adoption, ...patch }), { code: 'INTERNAL_ERROR' })
  }
})
