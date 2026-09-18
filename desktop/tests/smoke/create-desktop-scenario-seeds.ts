import { createHash, randomUUID } from 'node:crypto'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { ResearchLibraryService } from '../../src/main/modules/library/application/research-library-service'
import { OutlinePlanningService } from '../../src/main/modules/planning/application/outline-planning-service'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'
import { CharacterStateService } from '../../src/main/modules/characters/application/character-state-service'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { AppError } from '../../src/main/core/errors/app-error'
import type { ChapterDerivativeStatus, ChapterDraftProposal } from '../../src/contracts/index'

interface Dependencies {
  projects: ProjectService
  documents: DocumentService
  characterStates: CharacterStateService
  sqliteManuscripts: SqliteManuscriptService
  workspace: WorkspaceService
  researchLibrary: ResearchLibraryService
  outlinePlanning: OutlinePlanningService
}

export function createDesktopScenarioSeeds(dependencies: Dependencies) {
  const { projects, documents, characterStates, sqliteManuscripts, workspace, researchLibrary, outlinePlanning } = dependencies
  let smokeSeedFactReview: (() => Promise<void>) | null = null
  let smokeSeedCharacterAtlas: import('./character-atlas-smoke').CharacterAtlasSmokeSeeder | null = null
  let smokeSeedWorldMap: import('./world-map-smoke').WorldMapSmokeSeeder | null = null
  let smokeSeedContextState: (() => Promise<void>) | null = null
  let smokeSeedDerivativeStale: (() => Promise<ChapterDerivativeStatus>) | null = null
  if (process.env.LANJIAN_SMOKE === '1') {
    smokeSeedContextState = async () => {
      const smokeRoot = await projects.currentPath()
      const chapter = await documents.chapter(1)
      const evidence = chapter.content.trim().slice(0, 80)
      if (!evidence) throw new AppError('CONFLICT', '烟测上下文缺少第一章正文。', { recoverable: false })
      const proposal: ChapterDraftProposal = {
        id: `smoke-context-state-${chapter.revision}`,
        chapterId: chapter.id,
        createdAt: new Date().toISOString(),
        content: chapter.content,
        contract: {
          chapterId: chapter.id,
          chapterPosition: chapter.position,
          outlineSnapshot: '烟测：已采用的第一章正文。',
          beats: [],
          forbiddenEvents: [],
          entryState: '烟测起点',
          exitState: '烟测落点',
          allowedFacts: [],
          foreshadowActions: [],
          version: { fingerprint: 'a'.repeat(64), totalFingerprint: 'b'.repeat(64), outlineHash: 'c'.repeat(64), eventIds: [], confirmedAt: new Date().toISOString() }
        },
        report: {
          passed: true,
          summary: '烟测：作者已采用第一章，人物状态可以进入后续章节上下文。',
          beats: [],
          boundary: { entryRespected: true, exitReached: true, evidence },
          foreshadowing: [],
          violations: [],
          introducedFacts: [],
          characterChanges: [
            { character: '沈砚', field: 'location', value: '临江酒馆前', evidence },
            { character: '沈砚', field: 'knowledge', value: '线索指向临江酒馆', evidence }
          ],
          characterConflicts: [{
            character: '沈砚', field: 'identity', claimedValue: '并非旧城沈家后人', evidence
          }]
        }
      }
      await characterStates.settleAcceptedProposal({
        workItemId: smokeRoot,
        chapter,
        proposal,
        sources: [{ id: 'smoke-context-source', names: ['沈砚'], location: '临江酒馆前' }]
      })
    }
    smokeSeedCharacterAtlas = async () => {
      // Called only after the native smoke validates its temporary book/profile.
      const root = await projects.currentPath()
      for (const [id, title, content, location] of [
        [1, '雨夜城门', '沈砚在雨夜城门检查脚印。林照也来到雨夜城门，提着一盏灯。', '雨夜城门'],
        [2, '临江酒馆', '沈砚进入临江酒馆，与林照在临江酒馆重新见面。', '临江酒馆']
      ] as const) {
        const previous = await documents.chapter(id)
        const chapter = await documents.updateChapter(id, { title, content, expectedRevision: previous.revision, reason: 'manual' })
        const batch = await sqliteManuscripts.recordCharacterFactCandidates(root, chapter, [
          { character: '沈砚', field: 'location', value: location, evidence: content },
          { character: '林照', field: 'location', value: location, evidence: content }
        ], randomUUID())
        if (!batch) throw new Error('character-atlas-fixture-fact-batch-missing')
        await sqliteManuscripts.decideFacts(root, { batchId: batch.id, decisions: batch.changes.map(change => ({ changeId: change.id, decision: 'APPROVED' as const })) })
      }
      return { characterName: '沈砚', secondCharacterName: '林照', firstChapterId: 1, secondChapterId: 2, firstLocation: '雨夜城门', secondLocation: '临江酒馆' }
    }
    smokeSeedWorldMap = async () => {
      if (!smokeSeedCharacterAtlas) throw new Error('world-map-fixture-not-configured')
      const fixture = await smokeSeedCharacterAtlas()
      await workspace.saveTimeline([
        { id: randomUUID(), title: '雨中足迹', time: '初夜', characters: '沈砚、林照', location: fixture.firstLocation, event: '沈砚与林照在雨夜城门发现了脚印。', result: '追查临江酒馆的线索' },
        { id: randomUUID(), title: '酒馆重逢', time: '次日清晨', characters: '沈砚、林照', location: fixture.secondLocation, event: '两人在临江酒馆重新见面。', result: '等待约定的口信' }
      ])
      const source = await researchLibrary.createSource({ title: '沙盘测试资料', excerpt: '沈砚在临江酒馆取得口信，林照约他前往钟楼。', userNotes: '仅用于隔离测试' })
      const canonical = await researchLibrary.createEventCandidate({ sourceId: source.id, time: '次日午后', characters: ['沈砚', '林照'], location: fixture.secondLocation, event: source.excerpt, result: '找到下一条线索' })
      await researchLibrary.approveEvent(canonical.id)
      await researchLibrary.createEventCandidate({ sourceId: source.id, time: '尚未决定', characters: ['沈砚'], location: '候选悬空城', event: '待定的出行，不应成为正式地图地点。' })
      const plan = await outlinePlanning.createVolume('沙盘验证卷')
      const volume = plan.volumes.find(item => item.title === '沙盘验证卷')
      if (!volume) throw new Error('world-map-fixture-volume-missing')
      await outlinePlanning.placeChapter(fixture.secondChapterId, volume.volume)
      await outlinePlanning.placeEventInChapter(canonical.id, fixture.secondChapterId)
      return { ...fixture, canonicalEventId: canonical.id }
    }
    smokeSeedFactReview = async () => {
      const smokeRoot = await projects.currentPath()
      let factChapter = await documents.chapter(1)
      if (!factChapter.content.trim()) {
        factChapter = await documents.updateChapter(1, {
          content: '沈砚在雨夜城门发现脚印，并确认线索指向临江酒馆。',
          reason: 'manual',
          expectedRevision: factChapter.revision
        })
      }
      const factQuote = factChapter.content.trim().slice(0, 80)
      await sqliteManuscripts.recordCharacterFactCandidates(smokeRoot, factChapter, [
        { character: '沈砚', field: 'location', value: '临江酒馆前', evidence: factQuote },
        { character: '沈砚', field: 'knowledge', value: '线索指向临江酒馆', evidence: factQuote }
      ], '55000000-0000-4000-8000-000000000001')
    }
    smokeSeedDerivativeStale = async () => {
      const smokeRoot = await projects.currentPath()
      const before = await documents.chapter(1)
      const source = await documents.updateChapter(1, {
        content: `${before.content}\n\n沈砚站在旧城墙下，记住了雨里那串脚印。`,
        reason: 'manual',
        expectedRevision: before.revision
      })
      if (!source.bodyVersionId) throw new AppError('CONFLICT', '烟测正文没有正式版本。', { recoverable: false })
      await sqliteManuscripts.recordCharacterFactCandidates(smokeRoot, source, [{
        character: '沈砚', field: 'location', value: '旧城墙下', evidence: '沈砚站在旧城墙下，记住了雨里那串脚印。'
      }], randomUUID())
      await sqliteManuscripts.saveApprovedChapterSummary(smokeRoot, {
        chapterId: 1,
        bodyVersionId: source.bodyVersionId,
        content: '沈砚在旧城墙下记住雨中脚印。'
      })
      await sqliteManuscripts.recordConsistencyFindings(smokeRoot, {
        legacyChapterId: 1,
        bodyVersionId: source.bodyVersionId,
        contentHash: createHash('sha256').update(source.content).digest('hex'),
        ruleLayer: 'deterministic',
        findings: [{
          code: 'character.LOCATION_JUMP', severity: 'warning', title: '人物连续性 · 地点承接',
          rationale: '旧正文的地点承接需要核对。', evidenceJson: JSON.stringify({ excerpts: ['沈砚站在旧城墙下。'] })
        }]
      })
      await documents.updateChapter(1, {
        content: `${source.content}\n\n他沿着城门转入新的街巷。`,
        reason: 'manual',
        expectedRevision: source.revision
      })
      return sqliteManuscripts.chapterDerivativeStatus(smokeRoot, 1)
    }
  }
  return { smokeSeedFactReview, smokeSeedCharacterAtlas, smokeSeedWorldMap, smokeSeedContextState, smokeSeedDerivativeStale }
}
