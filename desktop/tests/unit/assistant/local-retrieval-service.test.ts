import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { Chapter } from '../../../src/contracts/index'
import { formatContextFactPack, LocalRetrievalService } from '../../../src/main/modules/assistant/application/local-retrieval-service'

function chapter(id: number, position: number, title: string, content: string): Chapter {
  return { id, position, title, content, word_count: content.length, summary: '' }
}

function project(id = 'book-a') {
  const path = `C:\\books\\${id}`
  return { currentSummary: async () => ({ id, path }), currentPath: async () => path }
}

for (const storage of ['files', 'sqlite'] as const) {
  const retrieval = (content: string, budget = 2400) => new LocalRetrievalService(
    project(), { chapters: async () => {
      assert.equal(storage, 'files', 'SQLite must not reread whole manuscripts')
      return [chapter(1, 1, '旧事', content)]
    } }, budget, storage === 'sqlite' ? {
      active: async () => true,
      currentDocumentChunksBefore: async () => [{ legacyChapterId: 1, chapterPosition: 1,
        chapterTitle: '旧事', bodyVersionId: 'version-a', ordinal: 0, content, tokenEstimate: 400 }]
    } : undefined
  )
  test(`${storage}: normalized matching preserves the original quoted hit after expanding punctuation`, async () => {
    const content = '甲…'.repeat(200) + '她把数学笔记借给李明。' + '乙'.repeat(900)
    const pack = await retrieval(content).build({ chapterId: 2, chapterPosition: 2, queryParts: ['数学笔记'] })
    assert.equal(pack.evidence.length, 1)
    assert.ok(content.includes(pack.evidence[0].excerpt), 'evidence must remain a verbatim source substring')
    assert.match(pack.evidence[0].excerpt, /她把数学笔记借给李明/)
  })
  test(`${storage}: tight evidence budgets retain the matched passage instead of its unrelated prefix`, async () => {
    const content = '甲'.repeat(400) + '她把数学笔记借给李明。' + '乙'.repeat(400)
    const pack = await retrieval(content, 200).build({ chapterId: 2, chapterPosition: 2, queryParts: ['数学笔记'] })
    assert.equal(pack.evidence.length, 1)
    assert.ok(pack.budget.usedCharacters <= 200)
    assert.ok(content.includes(pack.evidence[0].excerpt))
    assert.match(pack.evidence[0].excerpt, /她把数学笔记借给李明/)
  })
  test(`${storage}: composed characters and compatibility ligatures keep original offsets`, async () => {
    for (const prefix of ['e\u0301'.repeat(300), 'ﬃ'.repeat(200)]) {
      const content = prefix + '她把数学笔记借给李明。' + '乙'.repeat(900)
      const pack = await retrieval(content).build({ chapterId: 2, chapterPosition: 2, queryParts: ['数学笔记'] })
      assert.ok(content.includes(pack.evidence[0].excerpt))
      assert.match(pack.evidence[0].excerpt, /她把数学笔记借给李明/)
    }
  })
  test(`${storage}: budgeted excerpts do not split UTF-16 character pairs`, async () => {
    const content = '😀'.repeat(200) + '数学笔记已经借出。' + '😀'.repeat(400)
    for (const budget of [200, 201, 2400]) {
      const pack = await retrieval(content, budget).build({ chapterId: 2, chapterPosition: 2, queryParts: ['数学笔记'] })
      const excerpt = pack.evidence[0].excerpt
      assert.ok(content.includes(excerpt))
      assert.equal(Buffer.from(excerpt, 'utf8').toString('utf8'), excerpt)
      assert.match(excerpt, /数学笔记已经借出/)
      assert.ok(pack.budget.usedCharacters <= budget)
    }
  })
}

test('retrieves exact evidence only from saved chapters before the target chapter', async () => {
  const chapters = [
    chapter(11, 1, '雨夜追迹', '沈砚在临江酒馆后巷找到半枚铜符，红泥仍粘在铜符背面。'),
    chapter(12, 2, '回声再现', '沈砚准备核对临江酒馆与半枚铜符的关系。'),
    chapter(13, 3, '未来答案', '半枚铜符其实来自幕后主使。')
  ]
  const service = new LocalRetrievalService(project(), { chapters: async () => chapters })
  const pack = await service.build({ chapterId: 12, chapterPosition: 2, queryParts: ['临江酒馆 半枚铜符 红泥'] })

  assert.equal(pack.workItemId, 'book-a')
  assert.deepEqual(pack.evidence.map((item) => item.chapterId), [11])
  assert.match(pack.evidence[0].excerpt, /临江酒馆后巷找到半枚铜符/)
  assert.equal(pack.evidence[0].manuscriptRevision, createHash('sha256').update(chapters[0].content).digest('hex'))
  assert.doesNotMatch(JSON.stringify(pack), /幕后主使/)
})

test('rebuilds revision evidence from the current manuscript without writing an index', async () => {
  const values = [chapter(1, 1, '旧信', '林知夏把旧信收进抽屉。'), chapter(2, 2, '复查', '')]
  const service = new LocalRetrievalService(project(), { chapters: async () => values })
  const before = await service.build({ chapterId: 2, chapterPosition: 2, queryParts: ['林知夏 旧信'] })
  values[0] = chapter(1, 1, '旧信', '林知夏把旧信交给了校长。')
  const after = await service.build({ chapterId: 2, chapterPosition: 2, queryParts: ['林知夏 旧信'] })

  assert.notEqual(before.evidence[0].manuscriptRevision, after.evidence[0].manuscriptRevision)
  assert.match(after.evidence[0].excerpt, /交给了校长/)
  assert.doesNotMatch(after.evidence[0].excerpt, /收进抽屉/)
})

test('enforces the character budget and reports omitted lower-priority evidence', async () => {
  const values = [1, 2, 3].map((position) => chapter(position, position, `旧案${position}`, `林知夏在示例中学核对旧案线索。${'证据'.repeat(100)}`))
  values.push(chapter(4, 4, '当前章', ''))
  const service = new LocalRetrievalService(project(), { chapters: async () => values }, 200)
  const pack = await service.build({ chapterId: 4, chapterPosition: 4, queryParts: ['林知夏 示例中学 旧案线索'] })

  assert.ok(pack.budget.usedCharacters <= 200)
  assert.equal(pack.budget.maxCharacters, 200)
  assert.ok(pack.budget.omittedEvidenceCount >= 2)
  assert.equal(pack.evidence.length, 1)
})

test('isolates retrieval by the currently selected book and returns an empty pack without a chapter', async () => {
  let current = 'book-a'
  const byBook: Record<string, Chapter[]> = {
    'book-a': [chapter(1, 1, '甲书', '甲书独有的临江酒馆。'), chapter(2, 2, '当前章', '')],
    'book-b': [chapter(1, 1, '乙书', '乙书独有的临江酒馆。'), chapter(2, 2, '当前章', '')]
  }
  const service = new LocalRetrievalService(
    {
      currentSummary: async () => ({ id: current, path: `C:\\books\\${current}` }),
      currentPath: async () => `C:\\books\\${current}`
    },
    { chapters: async () => byBook[current] }
  )
  const first = await service.build({ chapterId: 2, chapterPosition: 2, queryParts: ['临江酒馆'] })
  current = 'book-b'
  const second = await service.build({ chapterId: 2, chapterPosition: 2, queryParts: ['临江酒馆'] })
  const empty = await service.build({ queryParts: ['临江酒馆'] })

  assert.match(first.evidence[0].excerpt, /甲书独有/)
  assert.match(second.evidence[0].excerpt, /乙书独有/)
  assert.doesNotMatch(second.evidence[0].excerpt, /甲书独有/)
  assert.equal(empty.workItemId, 'book-b')
  assert.deepEqual(empty.evidence, [])
})

test('fails closed when the selected book changes while manuscript chapters are being read', async () => {
  let current = 'book-a'
  const service = new LocalRetrievalService(
    {
      currentSummary: async () => ({ id: current, path: `C:\\books\\${current}` }),
      currentPath: async () => `C:\\books\\${current}`
    },
    {
      chapters: async () => {
        current = 'book-b'
        return [chapter(1, 1, '乙书', '乙书独有的临江酒馆。')]
      }
    }
  )

  await assert.rejects(
    service.build({ chapterId: 2, chapterPosition: 2, queryParts: ['临江酒馆'] }),
    (error: { code?: string }) => error.code === 'CONFLICT'
  )
})

test('reuses one in-memory manuscript snapshot until the disposable revision changes', async () => {
  let revision = 'revision-a'
  let chapterReads = 0
  let values = Array.from({ length: 500 }, (_, index) => chapter(index + 1, index + 1, `第${index + 1}章`, `示例中学旧事 ${index + 1}`))
  const service = new LocalRetrievalService(project(), {
    manuscriptRevision: async () => revision,
    chapters: async () => {
      chapterReads += 1
      return values
    }
  })

  const first = await service.build({ chapterId: 500, chapterPosition: 500, queryParts: ['示例中学旧事'] })
  const second = await service.build({ chapterId: 499, chapterPosition: 499, queryParts: ['示例中学旧事'] })
  assert.equal(chapterReads, 1)
  assert.ok(first.evidence.length > 0)
  assert.ok(second.evidence.every((item) => item.chapterPosition < 499))

  values = values.map((item) => item.id === 1 ? chapter(1, 1, '第一章', '示例中学旧事已经修订。') : item)
  revision = 'revision-b'
  const rebuilt = await service.build({ chapterId: 500, chapterPosition: 500, queryParts: ['示例中学旧事 已经修订'] })
  assert.equal(chapterReads, 2)
  assert.match(rebuilt.evidence.find((item) => item.chapterId === 1)?.excerpt || '', /已经修订/)
})

test('does not cache a mixed manuscript snapshot when files change during the full read', async () => {
  let revisionCalls = 0
  const service = new LocalRetrievalService(project(), {
    manuscriptRevision: async () => revisionCalls++ === 0 ? 'before' : 'after',
    chapters: async () => [chapter(1, 1, '旧章', '临江酒馆的旧证据。')]
  })

  await assert.rejects(
    service.build({ chapterId: 2, chapterPosition: 2, queryParts: ['临江酒馆'] }),
    (error: { code?: string }) => error.code === 'CONFLICT'
  )
})

test('formats an approved chapter summary as bounded prior-chapter context', () => {
  const formatted = formatContextFactPack({
    version: 1,
    workItemId: 'book-a',
    chapterId: 3,
    queryTerms: [],
    structured: {
      canonicalEvents: [],
      characterSnapshots: [],
      characterAliases: [],
      approvedFacts: [],
      latestApprovedSummary: {
        chapterId: 2,
        bodyVersionId: 'body-version-1',
        content: '沈砚确认旧信来自临江酒馆，决定在下一章追查送信人。',
        createdAt: '2026-09-02T00:00:00.000Z'
      },
      recentApprovedSummaries: [{
        chapterId: 2,
        bodyVersionId: 'body-version-1',
        content: '沈砚确认旧信来自临江酒馆，决定在下一章追查送信人。',
        createdAt: '2026-09-02T00:00:00.000Z'
      }, {
        chapterId: 1,
        bodyVersionId: 'body-version-0',
        content: '沈砚在雨夜收到来信。',
        createdAt: '2026-09-01T00:00:00.000Z'
      }]
    },
    evidence: [],
    budget: { maxCharacters: 2400, usedCharacters: 0, omittedEvidenceCount: 0 }
  })

  assert.match(formatted, /作者已确认的近期章末摘要（最近 2 章；从近到远/)
  assert.match(formatted, /追查送信人/)
  assert.match(formatted, /雨夜收到来信/)
})

test('uses current SQLite document chunks instead of rereading whole manuscripts', async () => {
  let chapterReads = 0
  const service = new LocalRetrievalService(
    project(),
    { chapters: async () => { chapterReads += 1; return [] } },
    2_400,
    {
      active: async () => true,
      currentDocumentChunksBefore: async () => [{
        legacyChapterId: 1,
        chapterPosition: 1,
        chapterTitle: '雨夜来信',
        bodyVersionId: 'body-current',
        ordinal: 2,
        content: '沈砚在临江酒馆后巷发现红泥脚印。',
        tokenEstimate: 18
      }]
    }
  )

  const pack = await service.build({ chapterId: 2, chapterPosition: 2, queryParts: ['临江酒馆 红泥脚印'] })
  assert.equal(chapterReads, 0)
  assert.equal(pack.evidence.length, 1)
  assert.equal(pack.evidence[0].sourceType, 'document_chunk')
  assert.equal(pack.evidence[0].chunkOrdinal, 2)
  assert.equal(pack.evidence[0].manuscriptRevision, 'body-current')
  assert.match(formatContextFactPack(pack), /正文分块 3 · 约 18 tokens/)
})

test('asks SQLite to filter all prior chunks before applying relevance ranking', async () => {
  let receivedTerms: string[] = []
  let unfilteredReads = 0
  const service = new LocalRetrievalService(
    project(),
    { chapters: async () => { throw new Error('不应回读整本正文') } },
    2_400,
    {
      active: async () => true,
      currentDocumentChunksBefore: async () => { unfilteredReads += 1; return [] },
      searchCurrentDocumentChunksBefore: async (_root, _chapterId, terms) => {
        receivedTerms = terms
        return [{
          legacyChapterId: 1, chapterPosition: 1, chapterTitle: '很早以前的线索', bodyVersionId: 'body-old',
          ordinal: 0, content: '沈砚曾在废弃钟楼听见三声回响。', tokenEstimate: 16
        }]
      }
    }
  )

  const pack = await service.build({ chapterId: 999, chapterPosition: 999, queryParts: ['废弃钟楼 三声回响'] })
  assert.equal(unfilteredReads, 0)
  assert.ok(receivedTerms.includes('废弃钟楼'))
  assert.match(pack.evidence[0]?.excerpt || '', /废弃钟楼/)
})
