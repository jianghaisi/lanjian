// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createReviewTrialActions(ports) {
  async function loadRealTrialReport() {
    ports.realTrialIssue.value = ''
    try {
      ports.realTrialReport.value = await ports.desktop.projects.realTrialReport()
      loadRealTrialConclusionDraft()
    } catch (error) {
      ports.realTrialReport.value = null
      ports.realTrialIssue.value = error?.message || '暂时无法读取真实试跑记录'
    }
    const preferred =
      ports.realTrialAvailableChapters.value.find((item) => item.id === ports.selectedId.value)?.id ??
      ports.realTrialAvailableChapters.value[0]?.id ??
      null
    if (
      !ports.realTrialChapterId.value ||
      !ports.realTrialAvailableChapters.value.some((item) => item.id === ports.realTrialChapterId.value)
    )
      ports.realTrialChapterId.value = preferred
    loadRealTrialDraft()
  }

  function loadRealTrialConclusionDraft() {
    const conclusion = ports.realTrialReport.value?.conclusion
    ports.realTrialConclusionDraft.value = conclusion
      ? {
          decision: conclusion.decision,
          highPriorityProblems: conclusion.highPriorityProblems,
          mediumPriorityProblems: conclusion.mediumPriorityProblems,
          lowPriorityProblems: conclusion.lowPriorityProblems,
          rationale: conclusion.rationale,
          nextScope: conclusion.nextScope
        }
      : ports.realTrialConclusionDefaults()
  }

  function loadRealTrialDraft() {
    const record = ports.realTrialReport.value?.chapters.find(
      (item) => item.legacyChapterId === ports.realTrialChapterId.value
    )
    ports.realTrialDraft.value = record
      ? {
          planningMinutes: record.planningMinutes,
          writingMinutes: record.writingMinutes,
          aiEditingMinutes: record.aiEditingMinutes,
          factReviewMinutes: record.factReviewMinutes,
          diffAcceptedBlocks: record.diffAcceptedBlocks,
          diffRejectedBlocks: record.diffRejectedBlocks,
          misappliedChanges: record.misappliedChanges,
          falsePositiveFindings: record.falsePositiveFindings,
          usefulFindings: record.usefulFindings,
          modelCost: record.modelCost ?? '',
          satisfaction: record.satisfaction,
          continueNextChapter: record.continueNextChapter,
          bypassedFeatures: record.bypassedFeatures,
          notes: record.notes
        }
      : ports.realTrialDraftDefaults()
  }

  async function saveRealTrialChapter() {
    const chapter = ports.realTrialSelectedChapter.value
    if (!chapter?.bodyVersionId) return ports.notice('请先选择一章已经保存到 SQLite 的正文')
    const report = await ports.guard(
      () =>
        ports.desktop.projects.saveRealTrialChapter({
          legacyChapterId: chapter.id,
          bodyVersionId: chapter.bodyVersionId,
          planningMinutes: Number(ports.realTrialDraft.value.planningMinutes),
          writingMinutes: Number(ports.realTrialDraft.value.writingMinutes),
          aiEditingMinutes: Number(ports.realTrialDraft.value.aiEditingMinutes),
          factReviewMinutes: Number(ports.realTrialDraft.value.factReviewMinutes),
          diffAcceptedBlocks: Number(ports.realTrialDraft.value.diffAcceptedBlocks),
          diffRejectedBlocks: Number(ports.realTrialDraft.value.diffRejectedBlocks),
          misappliedChanges: Number(ports.realTrialDraft.value.misappliedChanges),
          falsePositiveFindings: Number(ports.realTrialDraft.value.falsePositiveFindings),
          usefulFindings: Number(ports.realTrialDraft.value.usefulFindings),
          modelCost: ports.realTrialDraft.value.modelCost === '' ? null : Number(ports.realTrialDraft.value.modelCost),
          satisfaction: Number(ports.realTrialDraft.value.satisfaction),
          continueNextChapter: Boolean(ports.realTrialDraft.value.continueNextChapter),
          bypassedFeatures: ports.realTrialDraft.value.bypassedFeatures,
          notes: ports.realTrialDraft.value.notes
        }),
      `第 ${chapter.position} 章试跑记录已保存`
    )
    if (report) ports.realTrialReport.value = report
  }

  async function saveRealTrialConclusion() {
    if ((ports.realTrialReport.value?.summary.chapterCount ?? 0) < 20)
      return ports.notice('完成至少 20 章真实记录后再形成结论')
    const report = await ports.guard(
      () =>
        ports.desktop.projects.saveRealTrialConclusion({
          decision: ports.realTrialConclusionDraft.value.decision,
          highPriorityProblems: ports.realTrialConclusionDraft.value.highPriorityProblems,
          mediumPriorityProblems: ports.realTrialConclusionDraft.value.mediumPriorityProblems,
          lowPriorityProblems: ports.realTrialConclusionDraft.value.lowPriorityProblems,
          rationale: ports.realTrialConclusionDraft.value.rationale,
          nextScope: ports.realTrialConclusionDraft.value.nextScope
        }),
      '真实试跑结论已保存'
    )
    if (report) {
      ports.realTrialReport.value = report
      loadRealTrialConclusionDraft()
    }
  }

  function trialPercent(value) {
    return value === null || value === undefined ? '尚无数据' : `${Math.round(value * 100)}%`
  }

  return {
    loadRealTrialReport,
    loadRealTrialConclusionDraft,
    loadRealTrialDraft,
    saveRealTrialChapter,
    saveRealTrialConclusion,
    trialPercent
  }
}
