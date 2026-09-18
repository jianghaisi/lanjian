import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { BookProfile, FoundationData, ProjectSummary } from '../../../src/contracts/index'
import type { WorldMapLayoutView, WorldMapView } from '../../../src/contracts/world-map/world-map'
import { WorldMapGenerationService } from '../../../src/main/modules/world-map/application/world-map-generation-service'

function png(): Buffer {
  const value = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value)
  value.writeUInt32BE(1536, 16); value.writeUInt32BE(1024, 20)
  return value
}

test('generation is zero-write until explicit adoption, then stores and serves the content-addressed project asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-map-generation-'))
  try {
    const revision = 'a'.repeat(64)
    const summary = { id: 'novel-one', name: '雾港来客', path: root, title: '雾港来客', genre: '都市异能', updated_at: '', manuscript: { chapterCount: 0, fileCount: 0, wordCount: 0, status: 'ready' } } satisfies ProjectSummary
    const profile = { genre: '都市异能', subgenre: '校园悬疑', coreIdea: '追查校园地下的异常设施。' } as BookProfile
    const foundation = { worldView: '近未来海港城与废弃研究站。' } as FoundationData
    const sourceView: WorldMapView = { workItemId: summary.id, revision, mirrorStatus: null, document: { version: 1, markers: [{ location: '旧校舍', x: 28, y: 70 }] }, chapters: [], events: [
      { id: 'direct:event-one', source: 'direct', sourceId: 'event-one', title: '停电', time: '深夜', characters: ['林澈'], location: '旧校舍', event: '进入地下研究站。', result: '找到异常信号。', chapterId: null }
    ] }
    let layout: WorldMapLayoutView = { workItemId: summary.id, revision, mirrorStatus: null, document: sourceView.document }
    const writes: unknown[] = []
    const service = new WorldMapGenerationService(
      { currentPath: async () => root, currentSummary: async () => summary },
      { read: async () => ({ ...sourceView, document: layout.document, revision: layout.revision }) },
      { bookProfile: async () => profile, foundation: async () => foundation },
      { read: async () => layout, write: async input => { writes.push(input); layout = { workItemId: summary.id, revision: 'b'.repeat(64), mirrorStatus: 'synced', document: input.document }; return layout } },
      { generate: async (_connectionId, _model, prompt) => { assert.match(prompt, /旧校舍/); return { bytes: png(), format: 'png', width: 1536, height: 1024, connectionName: '测试图片服务' } } },
      () => Date.parse('2026-09-09T08:00:00.000Z')
    )
    const candidate = await service.generate({ operationId: '0123456789abcdef', workItemId: summary.id, expectedRevision: revision, connectionId: 'image-provider', model: 'gpt-image-1', stylePreset: 'paper-atlas' })
    await assert.rejects(access(join(root, '.webnovel')), /ENOENT/)
    assert.equal(writes.length, 0)
    assert.match(candidate.image.dataUrl, /^data:image\/png;base64,/)

    const adopted = await service.adopt({ workItemId: summary.id, expectedRevision: revision, candidateId: candidate.candidateId })
    assert.equal(writes.length, 1)
    assert.equal(adopted.document.version, 2)
    assert.ok(adopted.document.version === 2 && adopted.document.background)
    if (adopted.document.version !== 2 || !adopted.document.background) return
    const path = join(root, '.webnovel', 'assets', 'world-map', `${adopted.document.background.assetId}.png`)
    assert.deepEqual(await readFile(path), png())
    const background = await service.background()
    assert.equal(background?.assetId, adopted.document.background.assetId)
    assert.match(background?.dataUrl ?? '', /^data:image\/png;base64,/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
