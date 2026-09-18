import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeWorldMapImageAdoptArgs, decodeWorldMapImageCancelArgs, decodeWorldMapImageGenerateArgs, decodeWorldMapWriteArgs } from '../../../src/contracts/ipc'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response'
import type { WorldMapLayoutView, WorldMapView } from '../../../src/contracts/world-map/world-map'

const layout: WorldMapLayoutView = { workItemId: 'temporary-book', revision: 'a'.repeat(64), mirrorStatus: 'synced', document: { version: 1, markers: [{ location: '旧城门', x: 25.5, y: 45 }] } }
const view: WorldMapView = { ...layout, chapters: [{ id: 90, position: 1, title: '雨夜' }], events: [
  { id: 'direct:local-event', sourceId: 'local-event', source: 'direct', title: '城门来信', time: '初夜', characters: ['沈砚'], location: '旧城门', event: '接到来信。', result: '准备出城。', chapterId: null }
] }

test('map write IPC only accepts a bounded explicit version-bound map document', () => {
  const input = { workItemId: layout.workItemId, expectedRevision: layout.revision, document: layout.document }
  assert.deepEqual(decodeWorldMapWriteArgs([input]), [input])
  for (const args of [[], [input, 1], [{ ...input, path: 'outside' }], [{ ...input, expectedRevision: 'stale' }], [{ ...input, document: { version: 1, markers: [{ location: '旧城门', x: Infinity, y: 45 }] } }], [{ ...input, document: { version: 1, markers: [{ location: '旧城门', x: -1, y: 45 }] } }]]) {
    assert.throws(() => decodeWorldMapWriteArgs(args), { code: 'VALIDATION_ERROR' })
  }
})

test('map IPC response channels validate full aggregate and layout receipt separately', () => {
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:get-world-map', { ok: true, value: view }), view)
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:save-world-map', { ok: true, value: layout }), layout)
  assert.throws(() => unwrapValidatedIpcResponse('workspace:get-world-map', { ok: true, value: layout }))
  assert.throws(() => unwrapValidatedIpcResponse('workspace:save-world-map', { ok: true, value: view }))
  for (const value of [{ ...view, events: [{ ...view.events[0], source: 'candidate' }] }, { ...view, chapters: [...view.chapters, ...view.chapters] }, { ...view, document: { version: 1, markers: [{ location: '旧城门', x: 101, y: 45 }] } }]) {
    assert.throws(() => unwrapValidatedIpcResponse('workspace:get-world-map', { ok: true, value }))
  }
})

test('map image IPC accepts only the narrow generation, adoption and cancellation DTOs', () => {
  const generate = { operationId: '0123456789abcdef', workItemId: layout.workItemId, expectedRevision: layout.revision, connectionId: 'provider-one', model: 'gpt-image-1', stylePreset: 'paper-atlas' as const }
  const adopt = { workItemId: layout.workItemId, expectedRevision: layout.revision, candidateId: 'c'.repeat(64) }
  assert.deepEqual(decodeWorldMapImageGenerateArgs([generate]), [generate])
  assert.deepEqual(decodeWorldMapImageAdoptArgs([adopt]), [adopt])
  assert.deepEqual(decodeWorldMapImageCancelArgs([generate.operationId]), [generate.operationId])
  for (const args of [[{ ...generate, stylePreset: 'commercial-game-style' }], [{ ...generate, projectPath: 'C:/outside' }], [{ ...adopt, candidateId: 'short' }], [generate.operationId, 'extra']]) {
    assert.throws(() => args.length === 2 ? decodeWorldMapImageCancelArgs(args) : 'candidateId' in (args[0] as object) ? decodeWorldMapImageAdoptArgs(args) : decodeWorldMapImageGenerateArgs(args), { code: 'VALIDATION_ERROR' })
  }
})

test('map image IPC response decoding keeps previews and project backgrounds bounded and typed', () => {
  const candidate = {
    candidateId: 'c'.repeat(64), workItemId: layout.workItemId, expectedRevision: layout.revision, sourceFingerprint: 'd'.repeat(64),
    stylePreset: 'paper-atlas', model: 'gpt-image-1', connectionName: '图片服务',
    promptSummary: { locations: 1, events: 1, characters: 1, sentCharacters: 500 },
    image: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', format: 'png', width: 1536, height: 1024 }
  }
  const background = { workItemId: layout.workItemId, assetId: 'e'.repeat(64), dataUrl: candidate.image.dataUrl, width: 1536, height: 1024 }
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:generate-world-map-image', { ok: true, value: candidate }), candidate)
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:cancel-world-map-image', { ok: true, value: { cancelled: true } }), { cancelled: true })
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:get-world-map-background', { ok: true, value: background }), background)
  assert.throws(() => unwrapValidatedIpcResponse('workspace:get-world-map-background', { ok: true, value: { ...background, path: 'C:/outside' } }))
  assert.throws(() => unwrapValidatedIpcResponse('workspace:generate-world-map-image', { ok: true, value: { ...candidate, image: { ...candidate.image, dataUrl: 'https://outside/map.png' } } }))
})
