import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceFindingRecord } from '../../../src/main/core/ports/workspace-database'
import type { ConsistencyFinding } from '../../../src/contracts/index'
import { attachFindingRecord, semanticFindingFromRecord } from '../../../src/main/modules/library/application/workspace-service'

const finding: ConsistencyFinding = {
  code: 'DUPLICATE_PARAGRAPH',
  layer: 'literary',
  severity: 'advice',
  message: '两个段落完全重复。',
  characterId: 'chapter-style',
  characterName: '正文表达',
  fromChapter: 8,
  toChapter: 8,
  evidence: ['第 3 段', '第 7 段']
}

function record(confidence: number | null): WorkspaceFindingRecord {
  return {
    id: 'finding-1',
    runId: 'run-1',
    legacyChapterId: 8,
    bodyVersionId: 'body-version-8',
    contentHash: 'a'.repeat(64),
    ruleLayer: 'literary',
    severity: 'suggestion',
    code: 'literary.DUPLICATE_PARAGRAPH',
    title: '表达建议 · 重复段落',
    rationale: finding.message,
    evidenceJson: JSON.stringify({ excerpts: finding.evidence }),
    suggestedAction: '删除误粘贴的重复段落，或确认这是刻意复现。',
    confidence,
    status: 'accepted',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z'
  }
}

test('projects persisted finding provenance into the author-visible consistency card', () => {
  const projected = attachFindingRecord(finding, record(0.7))
  assert.equal(projected.findingId, 'finding-1')
  assert.equal(projected.findingStatus, 'accepted')
  assert.equal(projected.sourceBodyVersionId, 'body-version-8')
  assert.equal(projected.sourceContentHash, 'a'.repeat(64))
  assert.equal(projected.suggestedAction, '删除误粘贴的重复段落，或确认这是刻意复现。')
  assert.equal(projected.confidence, 0.7)
})

test('does not invent a confidence value when the checker did not provide one', () => {
  const projected = attachFindingRecord(finding, record(null))
  assert.equal(projected.confidence, undefined)
  assert.equal(projected.sourceBodyVersionId, 'body-version-8')
})

test('turns a persisted stable-character conflict into one evidence-backed semantic finding', () => {
  const semanticRecord = {
    ...record(0.75),
    ruleLayer: 'semantic' as const,
    severity: 'warning' as const,
    code: 'character.IDENTITY_CONFLICT',
    title: '人物语义 · 身份',
    rationale: '沈砚在本章出现了可能改变既有身份的声明，需要由作者确认。',
    evidenceJson: JSON.stringify({
      conflictId: 'conflict-identity',
      characterId: 'character-1',
      characterName: '沈砚',
      field: 'identity',
      anchorValue: '沈家后人',
      claimedValue: '并非沈家后人',
      anchorSourceRefs: ['人物卡-沈砚'],
      chapterPosition: 8,
      excerpt: '沈砚说：“我并非沈家后人。”'
    })
  }
  const projected = semanticFindingFromRecord(semanticRecord)
  assert.equal(projected?.code, 'IDENTITY_CONFLICT')
  assert.equal(projected?.layer, 'semantic')
  assert.equal(projected?.semanticConflictId, 'conflict-identity')
  assert.deepEqual(projected?.evidence, [
    '既有人物锚点：沈家后人',
    '正文中的新声明：并非沈家后人',
    '正文逐字证据：沈砚说：“我并非沈家后人。”',
    '锚点来源：人物卡-沈砚'
  ])
  assert.equal(projected?.confidence, 0.75)
})

test('refuses malformed semantic evidence instead of inventing a conflict card', () => {
  assert.equal(semanticFindingFromRecord({ ...record(0.75), ruleLayer: 'semantic', evidenceJson: '{}' }), null)
  assert.equal(semanticFindingFromRecord({ ...record(0.75), ruleLayer: 'semantic', evidenceJson: 'null' }), null)
  assert.equal(semanticFindingFromRecord({ ...record(0.75), ruleLayer: 'semantic', evidenceJson: '[]' }), null)
})
