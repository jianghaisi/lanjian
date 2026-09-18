import assert from 'node:assert/strict'
import test from 'node:test'
import type { ShadowImportPreview, ShadowImportResult } from '../../../src/main/core/ports/workspace-database'
import { ShadowMigrationSessionService } from '../../../src/main/modules/library/application/shadow-migration-session-service'

const cleanPreview = (): ShadowImportPreview => ({
  targetRelativePath: '.webnovel/workspace.sqlite',
  sourceFingerprint: 'a'.repeat(64),
  chapterCount: 12,
  totalWords: 34_567,
  blockers: []
})

const imported: ShadowImportResult = {
  sourceFingerprint: 'a'.repeat(64),
  chapterCount: 12,
  insertedVersions: 12,
  unchangedVersions: 0,
  verified: true
}

test('issues a bounded one-time preview token and exposes no source fingerprint to renderer', async () => {
  let imports = 0
  const service = new ShadowMigrationSessionService({
    preview: async () => cleanPreview(),
    import: async (preview) => {
      imports += 1
      assert.equal(preview.sourceFingerprint, 'a'.repeat(64))
      return imported
    }
  }, async () => 'C:/books/one', () => Date.parse('2026-09-01T04:00:00.000Z'), () => '11111111-2222-4333-8444-555555555555')

  const preview = await service.preview()
  assert.equal(preview.token, '11111111-2222-4333-8444-555555555555')
  assert.equal(preview.canImport, true)
  assert.equal(preview.chapterCount, 12)
  assert.equal(preview.totalWords, 34_567)
  assert.equal(preview.expiresAt, '2026-09-01T04:15:00.000Z')
  assert.equal('sourceFingerprint' in preview, false)
  assert.equal(imports, 0)

  assert.deepEqual(await service.commit(preview.token!), {
    targetRelativePath: '.webnovel/workspace.sqlite',
    storageMode: 'shadow',
    sourceFilesChanged: false,
    chapterCount: 12,
    insertedVersions: 12,
    unchangedVersions: 0,
    verified: true
  })
  assert.equal(imports, 1)
  await assert.rejects(service.commit(preview.token!), (error: { code?: string }) => error.code === 'CONFLICT')
})

test('blocks expired and cross-work-item previews before starting an import', async () => {
  let now = Date.parse('2026-09-01T04:00:00.000Z')
  let current = 'C:/books/one'
  let sequence = 0
  let imports = 0
  const service = new ShadowMigrationSessionService({
    preview: async () => cleanPreview(),
    import: async () => { imports += 1; return imported }
  }, async () => current, () => now, () => `11111111-2222-4333-8444-${String(++sequence).padStart(12, '0')}`)

  const expired = await service.preview()
  now += 15 * 60 * 1_000
  await assert.rejects(service.commit(expired.token!), (error: { code?: string }) => error.code === 'CONFLICT')

  const switched = await service.preview()
  current = 'C:/books/two'
  await assert.rejects(service.commit(switched.token!), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(imports, 0)
})

test('returns blockers without issuing a writable token', async () => {
  const blocked = { ...cleanPreview(), chapterCount: 0, totalWords: 0, blockers: [{ code: 'INVALID_PROJECT_STATE', message: '章节顺序待核对' }] }
  const service = new ShadowMigrationSessionService({
    preview: async () => blocked,
    import: async () => { throw new Error('must not import') }
  }, async () => 'C:/books/one')

  const preview = await service.preview()
  assert.equal(preview.token, null)
  assert.equal(preview.canImport, false)
  assert.equal(preview.expiresAt, null)
  assert.deepEqual(preview.blockers, blocked.blockers)
})
