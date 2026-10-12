import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalJson, decodeAttemptEvent, decodeJudgmentRecord, decodeManifest, narrativeCharacterCount, reduceAttemptEvents,
  sealAttemptEvent, sha256
} from '../../../src/main/modules/review/domain/writing-quality-protocol'
import { createOfflineManifest, freezeSlotInput, syntheticNarrative } from '../../../src/main/modules/review/domain/writing-quality-fixtures'

test('uses canonical Unicode counting and deterministic protocol fixtures', () => {
  assert.equal(narrativeCharacterCount(' e\u0301\n中。 '), 3)
  assert.equal(canonicalJson({ z: 1, a: { d: 2, c: 1 } }), '{"a":{"c":1,"d":2},"z":1}')
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }))
  assert.throws(() => canonicalJson({ value: Number.NaN }), /数据无效/)
  assert.throws(() => canonicalJson({ value: undefined }), /数据无效/)

  const manifest = decodeManifest(createOfflineManifest('protocol-test', 17))
  assert.equal(manifest.slots.length, 9)
  assert.equal(new Set(manifest.slots.map(slot => `${slot.storyId}:${slot.arm}`)).size, 9)
  for (const slot of manifest.slots) {
    assert.equal(narrativeCharacterCount(syntheticNarrative(freezeSlotInput(manifest, slot))), 1950)
  }
})

test('strictly validates event hashes, unique ids and state transitions', () => {
  const manifest = createOfflineManifest('event-test', 18)
  const slot = manifest.slots[0]!
  const input = freezeSlotInput(manifest, slot)
  const reserved = sealAttemptEvent({
    version: 1, runId: manifest.runId, eventId: 'event-reserved', attemptId: 'attempt-1', sequence: 1,
    previousEventHash: null, ...slot, attempt: 1, status: 'reserved', inputHash: input.inputHash,
    outputId: null, outputHash: null, narrativeCharacters: null, usage: null, reservedCostCny: 0.01,
    actualCostCny: null, startedAt: '2026-09-20T00:00:00.000Z', finishedAt: null, errorCode: null, synthetic: true
  })
  assert.equal(decodeAttemptEvent(reserved).status, 'reserved')
  assert.equal(reduceAttemptEvents([reserved], manifest).danglingReservations.length, 1)
  assert.throws(() => decodeAttemptEvent({ ...reserved, eventHash: '0'.repeat(64) }), /event hash/)
  assert.throws(() => decodeAttemptEvent({ ...reserved, extra: true }), /keys/)

  const { eventHash: _reservedHash, ...unsealedReserved } = reserved
  const duplicate = sealAttemptEvent({ ...unsealedReserved, sequence: 2, previousEventHash: reserved.eventHash })
  assert.throws(() => reduceAttemptEvents([reserved, duplicate], manifest), /duplicate event id/)
  const reservedAgain = sealAttemptEvent({
    ...unsealedReserved, eventId: 'event-reserved-again', sequence: 2, previousEventHash: reserved.eventHash
  })
  assert.throws(() => reduceAttemptEvents([reserved, reservedAgain], manifest), /attempt transition/)
})

test('rejects manifest drift and unknown fields', () => {
  const manifest = createOfflineManifest('manifest-test', 19)
  assert.throws(() => decodeManifest({ ...manifest, unexpected: true }), /keys/)
  assert.throws(() => decodeManifest({ ...manifest, slots: manifest.slots.slice(0, 8) }), /slots/)
})

test('keeps tie, abstention and missing judgments representable without inventing scores', () => {
  const unsigned = {
    version: 1 as const, runId: 'judgment-run', judgmentId: 'judgment-1', packetId: 'xuanhuan-pair-1',
    choice: 'tie' as const, confidence: null, note: null, createdAt: '2026-09-20T00:00:00.000Z', rubricHash: '1'.repeat(64)
  }
  assert.equal(decodeJudgmentRecord({ ...unsigned, recordHash: sha256(unsigned) }).choice, 'tie')
  assert.throws(() => decodeJudgmentRecord({ ...unsigned, choice: 'winner', recordHash: sha256(unsigned) }), /choice|hash/)
})
