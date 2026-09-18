// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryContinuationActions(ports) {
  async function resumeImportManifest(recovery) {
    if (!recovery.canResume || ports.recoveryBusyId.value) return
    ports.recoveryBusyId.value = recovery.id
    try {
      const result = await ports.guard(() => ports.desktop.imports.resumeManifest(recovery.id))
      await ports.loadWorkspace()
      ports.notice(`文稿接续已恢复完成：处理 ${result.results.length} 份文件`)
    } finally {
      ports.recoveryBusyId.value = ''
    }
  }

  async function generateContinuationAnalysis() {
    if (!ports.continuationManifestId.value || ports.busy.value || ports.continuationBlockedReason.value) return
    ports.continuationAnalysis.value = await ports.guard(
      () => ports.desktop.imports.generateContinuationAnalysis(ports.continuationManifestId.value),
      '接续分析候选已经生成；确认前不会进入正式设定、大纲或人物记忆'
    )
    ports.continuationManifestId.value = ''
    ports.active.value = 'preparation'
    ports.preparationMode.value = 'continuation'
  }

  async function saveContinuationAnalysis(showNotice = true) {
    if (!ports.continuationAnalysis.value) return
    ports.continuationAnalysis.value = await ports.guard(
      () =>
        ports.desktop.imports.saveContinuationAnalysis({
          candidateId: ports.continuationAnalysis.value.id,
          sections: ports.continuationAnalysis.value.sections.map((section) => ({
            area: section.area,
            content: section.content
          })),
          rationale: ports.continuationAnalysis.value.rationale
        }),
      showNotice ? '接续分析候选已保存；正式设定和大纲没有改变' : undefined
    )
  }

  async function openContinuationProjectDefinitionAdoption() {
    if (!ports.continuationAnalysis.value || ports.busy.value) return
    try {
      await saveContinuationAnalysis(false)
      ports.continuationProjectDefinitionPreview.value = await ports.guard(() =>
        ports.desktop.imports.previewContinuationProjectDefinition(ports.continuationAnalysis.value.id)
      )
    } catch {
      ports.continuationProjectDefinitionPreview.value = null
    }
  }

  async function confirmContinuationProjectDefinitionAdoption() {
    const preview = ports.continuationProjectDefinitionPreview.value
    if (!preview || !preview.canAdopt || ports.busy.value) return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationProjectDefinition(
            ports.plainDto({
              candidateId: preview.candidateId,
              candidateFingerprint: preview.candidateFingerprint,
              currentProfileFingerprint: preview.currentProfileFingerprint
            })
          ),
        '作品定义候选已采用为核心设想；类别与篇幅设置保持不变'
      )
      ports.continuationAnalysis.value = result.candidate
      ports.bookProfile.value = result.profile
      ports.continuationProjectDefinitionPreview.value = null
    } catch {
      ports.continuationProjectDefinitionPreview.value = null
    }
  }

  async function openContinuationExistingPlotAdoption() {
    if (!ports.continuationAnalysis.value || ports.busy.value) return
    try {
      await saveContinuationAnalysis(false)
      const preview = await ports.guard(() =>
        ports.desktop.imports.previewContinuationExistingPlot(ports.continuationAnalysis.value.id)
      )
      ports.continuationExistingPlotPreview.value = preview
      ports.continuationExistingPlotDraft.value = {
        time: '',
        characters: '',
        location: '',
        event: preview.candidateEvent
      }
    } catch {
      ports.continuationExistingPlotPreview.value = null
    }
  }

  async function confirmContinuationExistingPlotAdoption() {
    const preview = ports.continuationExistingPlotPreview.value
    const event = ports.continuationExistingPlotDraft.value
    if (
      !preview ||
      !preview.canAdopt ||
      ports.busy.value ||
      !event.time.trim() ||
      !event.characters.trim() ||
      !event.location.trim() ||
      !event.event.trim()
    )
      return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationExistingPlot(
            ports.plainDto({
              candidateId: preview.candidateId,
              candidateFingerprint: preview.candidateFingerprint,
              currentTimelineFingerprint: preview.currentTimelineFingerprint,
              event
            })
          ),
        '这项已有剧情已写入正式纪事；其他候选仍未采用'
      )
      ports.continuationAnalysis.value = result.candidate
      ports.timeline.value = result.timeline.events
      ports.continuationExistingPlotPreview.value = null
      await ports.refreshWorkflow()
    } catch {
      ports.continuationExistingPlotPreview.value = null
    }
  }

  function openContinuationCharacterEditor() {
    ports.continuationCharacterDraft.value = { name: '', role: '', arcSeed: '' }
    ports.continuationCharacterPreview.value = null
    ports.continuationCharacterEditorOpen.value = true
  }

  function closeContinuationCharacterEditor() {
    ports.continuationCharacterEditorOpen.value = false
    ports.continuationCharacterPreview.value = null
  }

  async function previewContinuationCharacterImpact() {
    if (
      !ports.continuationAnalysis.value ||
      ports.busy.value ||
      !ports.continuationCharacterDraft.value.name.trim() ||
      !ports.continuationCharacterDraft.value.role.trim() ||
      !ports.continuationCharacterDraft.value.arcSeed.trim()
    )
      return
    try {
      await saveContinuationAnalysis(false)
      ports.continuationCharacterPreview.value = await ports.guard(() =>
        ports.desktop.imports.previewContinuationCharacter(
          ports.plainDto({
            candidateId: ports.continuationAnalysis.value.id,
            character: ports.continuationCharacterDraft.value
          })
        )
      )
    } catch {
      ports.continuationCharacterPreview.value = null
    }
  }

  async function confirmContinuationCharacterAdoption() {
    const preview = ports.continuationCharacterPreview.value
    if (!preview || !preview.canAdopt || ports.busy.value) return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationCharacter(
            ports.plainDto({
              candidateId: preview.candidateId,
              sectionFingerprint: preview.sectionFingerprint,
              characterFingerprint: preview.characterFingerprint,
              currentAnchorFingerprint: preview.currentAnchorFingerprint,
              character: preview.character
            })
          ),
        `人物“${preview.character.name}”已建立为稳定锚点；正文动态状态保持不变`
      )
      ports.continuationAnalysis.value = result.candidate
      ports.characterState.value = result.characters
      closeContinuationCharacterEditor()
      await ports.refreshWorkflow()
    } catch {
      ports.continuationCharacterPreview.value = null
    }
  }

  async function openContinuationWorldViewAdoption() {
    if (!ports.continuationAnalysis.value || ports.busy.value) return
    try {
      await saveContinuationAnalysis(false)
      ports.toast.value = ''
      ports.continuationWorldViewPreview.value = await ports.guard(() =>
        ports.desktop.imports.previewContinuationWorldView(ports.continuationAnalysis.value.id)
      )
    } catch {
      ports.continuationWorldViewPreview.value = null
    }
  }

  async function confirmContinuationWorldViewAdoption() {
    const preview = ports.continuationWorldViewPreview.value
    if (!preview || !preview.canAdopt || ports.busy.value) return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationWorldView(
            ports.plainDto({
              candidateId: preview.candidateId,
              candidateFingerprint: preview.candidateFingerprint,
              currentFoundationFingerprint: preview.currentFoundationFingerprint
            })
          ),
        '世界观候选已采用为本书开放描述；其他设定、大纲与正文保持不变'
      )
      ports.continuationAnalysis.value = result.candidate
      ports.foundation.value = result.foundation
      ports.continuationWorldViewPreview.value = null
      await ports.refreshWorkflow()
    } catch {
      ports.continuationWorldViewPreview.value = null
    }
  }

  async function openContinuationPowerSystemAdoption() {
    if (!ports.continuationAnalysis.value || ports.busy.value) return
    try {
      await saveContinuationAnalysis(false)
      ports.toast.value = ''
      ports.continuationPowerSystemPreview.value = await ports.guard(() =>
        ports.desktop.imports.previewContinuationPowerSystem(ports.continuationAnalysis.value.id)
      )
    } catch {
      ports.continuationPowerSystemPreview.value = null
    }
  }

  async function confirmContinuationPowerSystemAdoption() {
    const preview = ports.continuationPowerSystemPreview.value
    if (!preview || !preview.canAdopt || ports.busy.value) return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationPowerSystem(
            ports.plainDto({
              candidateId: preview.candidateId,
              candidateFingerprint: preview.candidateFingerprint,
              currentPowerSystemFingerprint: preview.currentPowerSystemFingerprint
            })
          ),
        '力量体系候选已采用为开放总述；境界表和启用状态保持不变'
      )
      ports.continuationAnalysis.value = result.candidate
      ports.powerSystem.value = result.powerSystem
      ports.continuationPowerSystemPreview.value = null
      await ports.refreshWorkflow()
    } catch {
      ports.continuationPowerSystemPreview.value = null
    }
  }

  async function openContinuationCheatSystemAdoption() {
    if (!ports.continuationAnalysis.value || ports.busy.value) return
    try {
      await saveContinuationAnalysis(false)
      ports.toast.value = ''
      ports.continuationCheatSystemPreview.value = await ports.guard(() =>
        ports.desktop.imports.previewContinuationCheatSystem(ports.continuationAnalysis.value.id)
      )
    } catch {
      ports.continuationCheatSystemPreview.value = null
    }
  }

  async function confirmContinuationCheatSystemAdoption() {
    const preview = ports.continuationCheatSystemPreview.value
    if (!preview || !preview.canAdopt || ports.busy.value) return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationCheatSystem(
            ports.plainDto({
              candidateId: preview.candidateId,
              candidateFingerprint: preview.candidateFingerprint,
              currentCheatSystemFingerprint: preview.currentCheatSystemFingerprint
            })
          ),
        '特殊优势候选已采用为开放总述；系统开关和显示模板保持不变'
      )
      ports.continuationAnalysis.value = result.candidate
      ports.cheatSystem.value = result.cheatSystem
      ports.continuationCheatSystemPreview.value = null
      await ports.refreshWorkflow()
    } catch {
      ports.continuationCheatSystemPreview.value = null
    }
  }

  async function openContinuationTotalOutlineAdoption() {
    if (!ports.continuationAnalysis.value || ports.busy.value) return
    try {
      await saveContinuationAnalysis(false)
      ports.toast.value = ''
      ports.continuationTotalOutlinePreview.value = await ports.guard(() =>
        ports.desktop.imports.previewContinuationTotalOutline(ports.continuationAnalysis.value.id)
      )
    } catch {
      ports.continuationTotalOutlinePreview.value = null
    }
  }

  async function confirmContinuationTotalOutlineAdoption() {
    const preview = ports.continuationTotalOutlinePreview.value
    if (!preview || !preview.canAdopt || ports.busy.value) return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationTotalOutline(
            ports.plainDto({
              candidateId: preview.candidateId,
              candidateFingerprint: preview.candidateFingerprint,
              currentOutlineFingerprint: preview.currentOutlineFingerprint,
              prerequisiteFingerprint: preview.prerequisiteFingerprint
            })
          ),
        '总纲候选已写入正式编辑区，仍需作者复核确认；卷纲、章纲与正文没有变化'
      )
      ports.continuationAnalysis.value = result.candidate
      ports.totalOutline.value = result.content
      ports.lastSavedTotalOutline.value = result.content
      ports.outlinePlanning.value = result.planning
      ports.continuationTotalOutlinePreview.value = null
      await ports.refreshWorkflow()
    } catch {
      ports.continuationTotalOutlinePreview.value = null
    }
  }

  async function openContinuationVolumeOutlineAdoption() {
    if (!ports.continuationAnalysis.value || !ports.continuationVolumeTarget.value || ports.busy.value) return
    try {
      await saveContinuationAnalysis(false)
      ports.toast.value = ''
      ports.continuationVolumeOutlinePreview.value = await ports.guard(() =>
        ports.desktop.imports.previewContinuationVolumeOutline(
          ports.continuationAnalysis.value.id,
          ports.continuationVolumeTarget.value
        )
      )
    } catch {
      ports.continuationVolumeOutlinePreview.value = null
    }
  }

  async function confirmContinuationVolumeOutlineAdoption() {
    const preview = ports.continuationVolumeOutlinePreview.value
    if (!preview || !preview.canAdopt || ports.busy.value) return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationVolumeOutline(
            ports.plainDto({
              candidateId: preview.candidateId,
              volume: preview.volume,
              candidateFingerprint: preview.candidateFingerprint,
              currentOutlineFingerprint: preview.currentOutlineFingerprint,
              parentTotalFingerprint: preview.parentTotalFingerprint
            })
          ),
        `第 ${preview.volume} 卷候选已写入正式卷纲，仍需作者复核确认`
      )
      ports.continuationAnalysis.value = result.candidate
      ports.outlinePlanning.value = result.planning
      if (ports.selectedVolume.value === preview.volume) {
        ports.volumeOutline.value = result.content
        ports.lastSavedVolumeOutline.value = result.content
      }
      ports.continuationVolumeOutlinePreview.value = null
      await ports.refreshWorkflow()
    } catch {
      ports.continuationVolumeOutlinePreview.value = null
    }
  }

  async function openContinuationChapterOutlineAdoption() {
    if (!ports.continuationAnalysis.value || !ports.continuationChapterTarget.value || ports.busy.value) return
    try {
      await saveContinuationAnalysis(false)
      ports.toast.value = ''
      ports.continuationChapterOutlinePreview.value = await ports.guard(() =>
        ports.desktop.imports.previewContinuationChapterOutline(
          ports.continuationAnalysis.value.id,
          ports.continuationChapterTarget.value
        )
      )
    } catch {
      ports.continuationChapterOutlinePreview.value = null
    }
  }

  async function confirmContinuationChapterOutlineAdoption() {
    const preview = ports.continuationChapterOutlinePreview.value
    if (!preview || !preview.canAdopt || ports.busy.value) return
    try {
      const result = await ports.guard(
        () =>
          ports.desktop.imports.adoptContinuationChapterOutline(
            ports.plainDto({
              candidateId: preview.candidateId,
              chapterId: preview.chapterId,
              candidateFingerprint: preview.candidateFingerprint,
              currentOutlineFingerprint: preview.currentOutlineFingerprint,
              parentTotalFingerprint: preview.parentTotalFingerprint,
              parentVolumeFingerprint: preview.parentVolumeFingerprint
            })
          ),
        `第 ${preview.chapterPosition} 章候选已写入章纲，仍需作者复核并确认本版契约`
      )
      ports.continuationAnalysis.value = result.candidate
      ports.outlinePlanning.value = result.planning
      if (ports.selectedId.value === preview.chapterId) {
        ports.chapterOutline.value = result.content
        ports.lastSavedChapterOutline.value = result.content
      }
      ports.continuationChapterOutlinePreview.value = null
      await ports.refreshWorkflow()
    } catch {
      ports.continuationChapterOutlinePreview.value = null
    }
  }

  return {
    resumeImportManifest,
    generateContinuationAnalysis,
    saveContinuationAnalysis,
    openContinuationProjectDefinitionAdoption,
    confirmContinuationProjectDefinitionAdoption,
    openContinuationExistingPlotAdoption,
    confirmContinuationExistingPlotAdoption,
    openContinuationCharacterEditor,
    closeContinuationCharacterEditor,
    previewContinuationCharacterImpact,
    confirmContinuationCharacterAdoption,
    openContinuationWorldViewAdoption,
    confirmContinuationWorldViewAdoption,
    openContinuationPowerSystemAdoption,
    confirmContinuationPowerSystemAdoption,
    openContinuationCheatSystemAdoption,
    confirmContinuationCheatSystemAdoption,
    openContinuationTotalOutlineAdoption,
    confirmContinuationTotalOutlineAdoption,
    openContinuationVolumeOutlineAdoption,
    confirmContinuationVolumeOutlineAdoption,
    openContinuationChapterOutlineAdoption,
    confirmContinuationChapterOutlineAdoption
  }
}
