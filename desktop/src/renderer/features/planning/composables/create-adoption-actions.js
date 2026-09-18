// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createPlanningAdoptionActions(ports) {
  function applyPlanningAdoption(adoption) {
    ports.suppressNextPlanningDraftSave = true
    ports.planningDraft.value.adoption = adoption
  }

  async function openPlanningCharacterSeedAdoption() {
    if (!ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      await ports.flushPlanningDraftSave()
      ports.planningCharacterSeedPreview.value = await ports.desktop.planning.previewCharacterSeedAdoption(
        ports.planningDraft.value.id
      )
    } catch (error) {
      ports.notice(error?.message || '人物锚点影响预览未能打开')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function confirmPlanningCharacterSeedAdoption() {
    const preview = ports.planningCharacterSeedPreview.value
    if (!preview || !ports.planningDraft.value || ports.planningAdoptionBusy.value || preview.conflicts.length) return
    ports.planningAdoptionBusy.value = true
    try {
      const result = await ports.desktop.planning.adoptCharacterSeeds(
        ports.plainDto({
          proposalId: preview.proposalId,
          candidateFingerprint: preview.candidateFingerprint,
          currentFingerprint: preview.currentFingerprint
        })
      )
      applyPlanningAdoption(result.proposal.adoption)
      ports.planningDraftSaveState.value = 'saved'
      ports.characterState.value = result.characters
      ports.planningCharacterSeedPreview.value = null
      await ports.refreshWorkflow()
      ports.notice('人物种子已建立为本书稳定锚点；后续正文仍会按章节更新人物动态状态')
    } catch (error) {
      ports.planningCharacterSeedPreview.value = null
      ports.notice(error?.message || '人物种子未能采用，请重新预览')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function openPlanningWorldSeedAdoption() {
    if (!ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      await ports.flushPlanningDraftSave()
      ports.planningWorldSeedPreview.value = await ports.desktop.planning.previewWorldSeedAdoption(
        ports.planningDraft.value.id
      )
    } catch (error) {
      ports.notice(error?.message || '世界种子影响预览未能打开')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function confirmPlanningWorldSeedAdoption() {
    const preview = ports.planningWorldSeedPreview.value
    if (!preview || !ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      const result = await ports.desktop.planning.adoptWorldSeed(
        ports.plainDto({
          proposalId: preview.proposalId,
          candidateFingerprint: preview.candidateFingerprint,
          currentFingerprint: preview.currentFingerprint
        })
      )
      applyPlanningAdoption(result.proposal.adoption)
      ports.planningDraftSaveState.value = 'saved'
      ports.foundation.value = result.foundation
      ports.planningWorldSeedPreview.value = null
      await ports.refreshWorkflow()
      ports.notice('世界种子已采用为本书世界观；作者札记与体系开关均已保留')
    } catch (error) {
      ports.planningWorldSeedPreview.value = null
      ports.notice(error?.message || '世界种子未能采用，请重新预览')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function openPlanningPowerSystemAdoption() {
    if (!ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      await ports.flushPlanningDraftSave()
      ports.planningPowerSystemPreview.value = await ports.desktop.planning.previewPowerSystemAdoption(
        ports.planningDraft.value.id
      )
    } catch (error) {
      ports.notice(error?.message || '力量体系影响预览未能打开')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function confirmPlanningPowerSystemAdoption() {
    const preview = ports.planningPowerSystemPreview.value
    if (!preview || !ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      const result = await ports.desktop.planning.adoptPowerSystem(
        ports.plainDto({
          proposalId: preview.proposalId,
          candidateFingerprint: preview.candidateFingerprint,
          currentFingerprint: preview.currentFingerprint
        })
      )
      applyPlanningAdoption(result.proposal.adoption)
      ports.planningDraftSaveState.value = 'saved'
      ports.powerSystem.value = result.powerSystem
      ports.planningPowerSystemPreview.value = null
      ports.notice('力量体系候选已采用为本书总述；境界表和启用开关均未改变')
    } catch (error) {
      ports.planningPowerSystemPreview.value = null
      ports.notice(error?.message || '力量体系候选未能采用，请重新预览')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function openPlanningCheatSystemAdoption() {
    if (!ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      await ports.flushPlanningDraftSave()
      ports.planningCheatSystemPreview.value = await ports.desktop.planning.previewCheatSystemAdoption(
        ports.planningDraft.value.id
      )
    } catch (error) {
      ports.notice(error?.message || '金手指或特殊优势影响预览未能打开')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function confirmPlanningCheatSystemAdoption() {
    const preview = ports.planningCheatSystemPreview.value
    if (!preview || !ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      const result = await ports.desktop.planning.adoptCheatSystem(
        ports.plainDto({
          proposalId: preview.proposalId,
          candidateFingerprint: preview.candidateFingerprint,
          currentFingerprint: preview.currentFingerprint
        })
      )
      applyPlanningAdoption(result.proposal.adoption)
      ports.planningDraftSaveState.value = 'saved'
      ports.cheatSystem.value = result.cheatSystem
      ports.planningCheatSystemPreview.value = null
      ports.notice('金手指或特殊优势候选已采用为本书总述；系统开关和显示模板均未改变')
    } catch (error) {
      ports.planningCheatSystemPreview.value = null
      ports.notice(error?.message || '金手指或特殊优势候选未能采用，请重新预览')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function openPlanningVolumeOutlineAdoption(order) {
    if (!ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      await ports.flushPlanningDraftSave()
      ports.planningVolumeOutlinePreview.value = await ports.desktop.planning.previewVolumeOutlineAdoption(
        ports.planningDraft.value.id,
        order
      )
    } catch (error) {
      ports.notice(error?.message || '卷纲影响预览未能打开')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function confirmPlanningVolumeOutlineAdoption() {
    const preview = ports.planningVolumeOutlinePreview.value
    if (!preview || !ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      const result = await ports.desktop.planning.adoptVolumeOutline(
        ports.plainDto({
          proposalId: preview.proposalId,
          order: preview.order,
          parentFingerprint: preview.parentFingerprint,
          candidateFingerprint: preview.candidateFingerprint,
          currentFingerprint: preview.currentFingerprint
        })
      )
      applyPlanningAdoption(result.proposal.adoption)
      ports.planningDraftSaveState.value = 'saved'
      ports.outlinePlanning.value = result.planning
      ports.planningVolumeOutlinePreview.value = null
      await ports.refreshWorkflow()
      ports.notice(`第 ${preview.order} 卷候选卷纲已采用；请在大纲页复核并正式确认本卷`)
    } catch (error) {
      ports.planningVolumeOutlinePreview.value = null
      ports.notice(error?.message || '候选卷纲未能采用，请重新预览')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function openVolumeOutlineReview(order) {
    if (await ports.openVolumeOutline(order)) ports.outlineInspectorOpen.value = true
  }

  async function openPlanningVolumeStructure() {
    if (!ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      await ports.flushPlanningDraftSave()
      ports.planningVolumeStructurePreview.value = await ports.desktop.planning.previewVolumeStructure(
        ports.planningDraft.value.id
      )
    } catch (error) {
      ports.notice(error?.message || '篇卷目录影响预览未能打开')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function confirmPlanningVolumeStructure() {
    const preview = ports.planningVolumeStructurePreview.value
    if (!preview || !ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      const result = await ports.desktop.planning.initializeVolumeStructure(
        ports.plainDto({
          proposalId: preview.proposalId,
          candidateFingerprint: preview.candidateFingerprint,
          currentFingerprint: preview.currentFingerprint,
          totalFingerprint: preview.totalFingerprint
        })
      )
      applyPlanningAdoption(result.proposal.adoption)
      ports.planningDraftSaveState.value = 'saved'
      ports.outlinePlanning.value = result.planning
      ports.planningVolumeStructurePreview.value = null
      await ports.refreshWorkflow()
      ports.notice('篇卷目录已经建立；卷纲正文仍是候选，请到大纲页复核并重新确认总纲')
    } catch (error) {
      ports.planningVolumeStructurePreview.value = null
      ports.notice(error?.message || '篇卷目录未能初始化，请重新预览')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function openTotalOutlineReview() {
    if (await ports.openTotalOutline()) ports.outlineInspectorOpen.value = true
  }

  async function openPlanningTotalAdoption() {
    if (!ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      await ports.flushPlanningDraftSave()
      ports.planningAdoptionPreview.value = await ports.desktop.planning.previewTotalAdoption(
        ports.planningDraft.value.id
      )
    } catch (error) {
      ports.notice(error?.message || '总纲影响预览未能打开')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function confirmPlanningTotalAdoption() {
    const preview = ports.planningAdoptionPreview.value
    if (!preview || !ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      const result = await ports.desktop.planning.adoptTotal(
        ports.plainDto({
          proposalId: preview.proposalId,
          candidateFingerprint: preview.candidateFingerprint,
          currentFingerprint: preview.currentFingerprint
        })
      )
      applyPlanningAdoption(result.proposal.adoption)
      ports.planningDraftSaveState.value = 'saved'
      ports.totalOutline.value = (await ports.desktop.outlines.get('total')).content
      ports.lastSavedTotalOutline.value = ports.totalOutline.value
      ports.outlinePlanning.value = result.planning
      ports.planningAdoptionPreview.value = null
      await ports.refreshWorkflow()
      ports.notice('总纲候选已采用为正式总纲；仍需在大纲页核对并确认后，才能进入卷纲与章纲')
    } catch (error) {
      ports.planningAdoptionPreview.value = null
      ports.notice(error?.message || '总纲候选未能采用，请重新预览')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  return {
    applyPlanningAdoption,
    openPlanningCharacterSeedAdoption,
    confirmPlanningCharacterSeedAdoption,
    openPlanningWorldSeedAdoption,
    confirmPlanningWorldSeedAdoption,
    openPlanningPowerSystemAdoption,
    confirmPlanningPowerSystemAdoption,
    openPlanningCheatSystemAdoption,
    confirmPlanningCheatSystemAdoption,
    openPlanningVolumeOutlineAdoption,
    confirmPlanningVolumeOutlineAdoption,
    openVolumeOutlineReview,
    openPlanningVolumeStructure,
    confirmPlanningVolumeStructure,
    openTotalOutlineReview,
    openPlanningTotalAdoption,
    confirmPlanningTotalAdoption
  }
}
