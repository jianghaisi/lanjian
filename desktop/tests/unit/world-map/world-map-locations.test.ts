import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeWorldMapDocument, type WorldMapMarker } from '../../../src/contracts/world-map/world-map'
import { copyWorldMapMarker, createWorldMapLocationIndex } from '../../../src/contracts/world-map/world-map-locations'

test('location index is exact, many-to-many and preserves unbound or ambiguous raw sources', () => {
  const markers: WorldMapMarker[] = [
    { location: '学舍', x: 30, y: 40, sourceLocations: ['学舍、桥边住处与电车'] },
    { location: '桥边居所', x: 65, y: 45, sourceLocations: ['学舍、桥边住处与电车', '桥边住处'] },
  ]
  const index = createWorldMapLocationIndex(markers)
  assert.deepEqual(index.locationsFor('学舍、桥边住处与电车'), ['学舍', '桥边居所'])
  assert.deepEqual(index.locationsFor('桥边住处'), ['桥边居所'])
  assert.deepEqual(index.locationsFor(' 学舍 '), ['学舍'])
  for (const raw of ['旧学舍遗址', '学舍或桥边住处', '桥边住处、城外', '未说明地点']) assert.deepEqual(index.locationsFor(raw), [raw])
  assert.deepEqual(index.locationsFor(' '), [])
  const result = index.locationsFor('学舍'); result.push('不得污染索引')
  assert.deepEqual(index.locationsFor('学舍'), ['学舍'])
  copyWorldMapMarker(markers[0]!).sourceLocations!.push('不得污染来源')
  assert.equal(markers[0]!.sourceLocations!.length, 1)
})

test('legacy markers and optional source bindings decode without mutating or aliasing inputs', () => {
  for (const version of [1, 2]) {
    const legacy = { version, markers: [{ location: '学舍', x: 0, y: 100 }], ...(version === 2 ? { background: null } : {}) }
    assert.deepEqual(decodeWorldMapDocument(legacy), legacy)
    const bound = { ...legacy, markers: [{ ...legacy.markers[0]!, sourceLocations: ['学舍、城外'] }] }
    const result = decodeWorldMapDocument(bound)
    assert.deepEqual(result, bound)
    result.markers[0]!.sourceLocations!.push('隔离变更')
    assert.deepEqual(bound.markers[0]!.sourceLocations, ['学舍、城外'])
  }
})

test('bindings reject malformed, duplicate, unbounded or unknown fields at the document boundary', () => {
  const marker = { location: '学舍', x: 30, y: 40 }
  for (const sourceLocations of [null, undefined, '学舍', [], [3], [''], [' 学舍'], ['学舍 '], ['学舍', '学舍'], ['字'.repeat(2001)], Array.from({ length: 257 }, (_, i) => `地点${i}`)]) {
    assert.throws(() => decodeWorldMapDocument({ version: 1, markers: [{ ...marker, sourceLocations }] }), { code: 'VALIDATION_ERROR' })
  }
  assert.throws(() => decodeWorldMapDocument({ version: 1, markers: [{ ...marker, sourceLocations: ['学舍'], autoGuess: true }] }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => decodeWorldMapDocument({ version: 1, markers: Array.from({ length: 3 }, (_, n) => ({ ...marker, location: `学舍${n}`, sourceLocations: Array.from({ length: 100 }, (_, i) => `${i}${'字'.repeat(1000)}`) })) }), { code: 'VALIDATION_ERROR' })
})
