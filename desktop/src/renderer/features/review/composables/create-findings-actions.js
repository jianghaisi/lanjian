import { nextTick } from 'vue'
import { findingChapterPositions, findingEvidenceSearchTerms } from '../../../../contracts/review/finding-locator'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createReviewFindingsActions(ports) {
  async function openConsistencyItem(item) {
    if (item.target === 'outline') {
      const opened =
        item.id === 'volumeOutline'
          ? await ports.openVolumeOutline(ports.selectedChapterVolume.value || ports.selectedVolume.value)
          : item.id === 'chapterOutline' || item.id === 'chapterContract'
            ? await ports.selectWorkspaceLeaf('chapter-outline')
            : await ports.openTotalOutline()
      if (opened) ports.outlineInspectorOpen.value = true
      return
    }
    if (!(await ports.flushPlannedChapterSave())) return
    if (item.id === 'characterState' || item.id === 'literaryStyle') {
      ports.characterState.value = await ports.guard(() => ports.desktop.workspace.getCharacterState())
      ports.showCharacterConflicts.value = true
      return
    }
    await ports.selectActivity(item.target)
  }

  async function openWritingChecks() {
    ports.assistantOpen.value = true
    ports.assistantMode.value = 'checks'
    await nextTick()
    document.querySelector('[data-testid="consistency-next-step"]')?.scrollIntoView({ block: 'start' })
  }

  async function returnToManuscript() {
    if (!ports.current.value) {
      ports.localAppearanceDialog.value?.close()
      ports.notice('请先选择并打开一部作品，再继续写作；不会自动打开其他作品。')
      await nextTick()
      document.querySelector('.project-library [aria-label="搜索作品"]')?.focus()
      return
    }
    ports.showCharacterConflicts.value = false
    await ports.selectActivity('desk')
    await nextTick()
    ports.manuscriptEditor.value?.focus?.()
  }

  async function recheckSavedManuscript() {
    try {
      await ports.refreshWorkflow()
      ports.notice('已重新核对已保存的正文；如有未保存修改，请先保存再核对')
    } catch (error) {
      ports.notice(error?.message || '核对未完成，请稍后重试')
    }
  }

  async function continueAfterFactReview() {
    await returnToManuscript()
    ports.assistantMode.value = 'agent'
  }

  async function dismissCharacterConflict(conflictId) {
    ports.dismissingConflictId.value = conflictId
    try {
      ports.characterState.value = await ports.guard(
        () => ports.desktop.workspace.dismissCharacterConflict(conflictId),
        '已认定为误报；人物锚点没有改变'
      )
      await ports.refreshWorkflow()
    } finally {
      ports.dismissingConflictId.value = ''
    }
  }

  async function decideContinuityFinding(finding, decision, exceptionReason) {
    if (!finding.findingId || ports.decidingContinuityFindingId.value) return
    let reason
    if (decision === 'exception') {
      reason = exceptionReason?.trim()
      if (!reason) return
    }
    ports.decidingContinuityFindingId.value = finding.findingId
    try {
      await ports.guard(
        () =>
          ports.desktop.workspace.decideConsistencyFinding({
            findingId: finding.findingId,
            decision,
            ...(reason ? { reason } : {})
          }),
        decision === 'accepted'
          ? '已列入待修复；正文没有自动改动'
          : decision === 'ignored'
            ? '已标记为误报；正文没有改动'
            : decision === 'exception'
              ? '已记录为有意安排；正文没有改动'
              : '已保留为稍后处理'
      )
      await ports.refreshWorkflow()
    } finally {
      ports.decidingContinuityFindingId.value = ''
    }
  }

  async function confirmFindingResolution(input) {
    if (!ports.current.value || !ports.selectedId.value || ports.decidingContinuityFindingId.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const chapterId = ports.selectedId.value
    const isCurrent = () =>
      ports.workspaceRequests.isCurrent(request, ports.current.value) && ports.selectedId.value === chapterId
    ports.findingResolutionError.value = ''
    ports.decidingContinuityFindingId.value = input.findingId
    try {
      await ports.manuscriptEditor.value?.flush?.()
      if (!isCurrent()) return
      if (ports.saveState.value !== 'saved' || ports.chapterIsDirty()) {
        ports.findingResolutionError.value = '请先返回书稿保存最新修改，再刷新记录并确认修复。'
        return
      }
      const entry = ports.findingHistory.value?.entries.find((item) => item.id === input.findingId)
      if (
        !entry ||
        entry.updatedAt !== input.expectedUpdatedAt ||
        ports.findingHistory.value.bodyVersionId !== input.resultingBodyVersionId
      ) {
        ports.findingResolutionError.value = '记录或正文版本已变化，请刷新后重新确认。'
        return
      }
      await ports.desktop.workspace.decideConsistencyFinding(input)
      if (!isCurrent()) return
      ports.notice('已记录本条问题的修复版本；正文没有自动改动')
      await ports.refreshWorkflow()
    } catch (error) {
      if (isCurrent())
        ports.findingResolutionError.value = error?.message || '记录未能保存，请刷新后重试；正文保持原样。'
    } finally {
      if (ports.decidingContinuityFindingId.value === input.findingId) ports.decidingContinuityFindingId.value = ''
    }
  }

  async function refreshFindingHistory() {
    if (!ports.current.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const chapterId = ports.selectedId.value
    ports.findingResolutionError.value = ''
    try {
      await ports.refreshWorkflow()
    } catch (error) {
      if (ports.workspaceRequests.isCurrent(request, ports.current.value) && ports.selectedId.value === chapterId)
        ports.findingResolutionError.value = error?.message || '暂时无法读取记录，请重试。'
    }
  }

  async function locateConsistencyFinding(finding) {
    const terms = findingEvidenceSearchTerms(finding.evidence || [])
    const target = findingChapterPositions(finding)
      .map((position) => ports.chapters.value.find((chapter) => chapter.position === position))
      .filter(Boolean)
      .map((chapter) => ({
        chapter,
        content: ports.selectedId.value === chapter.id ? ports.chapterContent.value : chapter.content
      }))
      .map((candidate) => ({
        ...candidate,
        term: terms.find((term) => candidate.content.includes(term))
      }))
      .find((candidate) => candidate.term)
    if (!target?.term) return ports.notice('没有在当前正文中找到这段证据；正文可能已经修改，请重新检查本章')
    ports.showCharacterConflicts.value = false
    await ports.selectActivity('desk')
    if (ports.selectedId.value !== target.chapter.id) await ports.selectChapter(target.chapter)
    if (ports.selectedId.value !== target.chapter.id) return
    await nextTick()
    const located = await ports.manuscriptEditor.value?.locateText?.(target.term)
    ports.notice(located ? `已定位到第 ${target.chapter.position} 章正文证据` : '正文已经变化，请重新检查本章')
  }

  function locateLegacyCharacterConflict(conflict) {
    return locateConsistencyFinding({
      fromChapter: conflict.chapterPosition,
      toChapter: conflict.chapterPosition,
      evidence: [`正文逐字证据：${conflict.evidence}`]
    })
  }

  return {
    openConsistencyItem,
    openWritingChecks,
    returnToManuscript,
    recheckSavedManuscript,
    continueAfterFactReview,
    dismissCharacterConflict,
    decideContinuityFinding,
    confirmFindingResolution,
    refreshFindingHistory,
    locateConsistencyFinding,
    locateLegacyCharacterConflict
  }
}
