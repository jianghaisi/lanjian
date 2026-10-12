import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodePublishRequest, decodeMarketRelease, decodeMarketQuery, decodeMarketPage } from '../dist/index.js'
const manifest = JSON.parse(readFileSync(new URL('../../../desktop/examples/writing-plugins/writing-composition/lanjian-plugin.json', import.meta.url), 'utf8'))
const request = () => ({ operationId: '00000000-0000-4000-8000-000000000001', manifest, digest: 'a'.repeat(64), bytes: 100, upstream: null })
const release = () => ({ ...request(), state: 'published', distribution: 'community', publisherId: 'b'.repeat(64), createdAt: '2026-09-28T00:00:00Z', failure: null, manualReview: false })
test('publish boundary rejects added manuscript, forged authority, unsafe identity and oversized bytes', () => {
  assert.deepEqual(decodePublishRequest(request()), request())
  for (const value of [{ ...request(), manuscript: 'private' }, { ...request(), official: true }, { ...request(), bytes: 10485761 }, { ...request(), digest: '../object' }, { ...request(), upstream: { pluginId: 'builtin.host', version: '1.0.0', digest: 'a'.repeat(64) } }]) assert.throws(() => decodePublishRequest(value))
})
test('release state and trust fields are strict strings with consistent failure evidence', () => {
  assert.deepEqual(decodeMarketRelease(release()), release())
  for (const patch of [{ state: ['published'] }, { distribution: ['official'] }, { manualReview: true }, { failure: 'interrupted' }, { state: 'validation-failed', failure: null }, { createdAt: 'unknown' }]) assert.throws(() => decodeMarketRelease({ ...release(), ...patch }))
  assert.equal(decodeMarketRelease({ ...release(), state: 'validation-failed', failure: 'invalid-package' }).failure, 'invalid-package')
})
test('public queries and results remain bounded and accept extensible categories', () => {
  const query = { query: '仙侠', categories: ['future.category'], tags: ['细节'], source: 'all', offset: 0, limit: 10 }
  assert.deepEqual(decodeMarketQuery(query), query)
  for (const patch of [{ limit: 11 }, { offset: -1 }, { source: ['official'] }, { categories: Array(17).fill('genre') }]) assert.throws(() => decodeMarketQuery({ ...query, ...patch }))
  assert.throws(() => decodeMarketPage({ releases: Array(11).fill(release()), nextOffset: 11 }))
  assert.deepEqual(decodeMarketPage({ releases: [release()], nextOffset: null }).releases[0], release())
})
