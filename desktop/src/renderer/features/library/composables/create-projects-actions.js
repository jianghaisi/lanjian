import { nextTick } from 'vue'
import { shouldApplyProjectLibraryRefresh } from '../services/project-library-refresh'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryProjectsActions(ports) {
  async function refreshProjects(options = {}) {
    if (!ports.desktop) return
    const requestGeneration = ++ports.projectLibraryRefreshGeneration
    const result = await ports.desktop.projects.list()
    if (
      !shouldApplyProjectLibraryRefresh({
        requestGeneration,
        currentGeneration: ports.projectLibraryRefreshGeneration,
        loaded: ports.projectsLoaded.value,
        currentCount: ports.projects.value.length,
        nextCount: result.projects.length,
        allowRemoval: options.allowRemoval === true
      })
    )
      return
    ports.projects.value = result.projects
    ports.continueProjectId.value = result.continueProjectId ?? result.projects[0]?.id ?? null
    ports.projectsLoaded.value = true
  }

  async function chooseCreateFolder() {
    ports.createForm.value.parentPath =
      (await ports.desktop.projects.chooseDirectory()) || ports.createForm.value.parentPath
    if (ports.createForm.value.parentPath) ports.createErrors.value.parentPath = ''
  }

  async function openCreateProject() {
    ports.createModelsPreview.value = null
    ports.createTrigger.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ports.createErrors.value = { name: '', parentPath: '' }
    ports.showCreate.value = true
    await nextTick()
    ports.createNameInput.value?.focus()
  }

  async function closeCreateProject() {
    ports.showCreate.value = false
    await nextTick()
    ports.createTrigger.value?.isConnected && ports.createTrigger.value.focus()
  }

  async function createProject() {
    ports.createErrors.value = {
      name: ports.createForm.value.name.trim() ? '' : '请先填写作品名。',
      parentPath: ports.createForm.value.parentPath ? '' : '请选择作品要保存到的本地文件夹。'
    }
    if (ports.createErrors.value.name || ports.createErrors.value.parentPath) {
      await nextTick()
      if (ports.createErrors.value.name) ports.createNameInput.value?.focus()
      else document.querySelector('[data-testid="choose-create-folder"]')?.focus()
      return
    }
    if (!(await prepareWorkItemTransition())) return
    if (!ports.createModelsPreview.value) {
      ports.notice('请先核对新书模型分配，或明确选择先手写建书。')
      return
    }
    const input = ports.partialCreation.value
      ? { token: ports.createModelsPreview.value.token, operationId: ports.partialCreation.value.operationId }
      : {
          token: ports.createModelsPreview.value.token,
          project: { name: ports.createForm.value.name.trim(), parentPath: ports.createForm.value.parentPath }
        }
    const result = await ports.guard(() =>
      ports.partialCreation.value
        ? ports.desktop.modelConnections.retryCreation(ports.plainDto(input))
        : ports.desktop.modelConnections.createProject(ports.plainDto(input))
    )
    if (result.status === 'partial') {
      ports.partialCreation.value = result
      ports.notice(result.message)
      return
    }
    ports.partialCreation.value = null
    ports.notice('作品已建立')
    ports.showCreate.value = false
    await activateWorkItem(result.project)
    ports.active.value = 'profile'
    ports.newProjectGuide.value = { title: result.project.title, path: result.project.path }
    ports.createForm.value = { ...ports.createForm.value, name: '' }
  }

  async function saveBookProfileAndContinue() {
    await ports.saveBookProfile()
    ports.newProjectGuide.value = null
    await ports.selectWorkspaceLeaf('ideas')
  }

  async function importProject() {
    const path = await ports.desktop.projects.chooseDirectory()
    if (!path) return
    if (!(await prepareWorkItemTransition())) return
    const result = await ports.guard(() => ports.desktop.projects.importProject(path), '项目已导入')
    await activateWorkItem(result.project)
  }

  async function openProject(project, preferredChapterId = project.manuscript?.lastEditedChapter?.id ?? null) {
    if (ports.workspaceOpening.value) return
    if (!(await prepareWorkItemTransition())) return
    const generation = ports.beginWorkspaceOpening(project)
    try {
      await ports.guard(() => ports.desktop.projects.switch(project.path))
      if (!ports.isCurrentWorkspaceOpening(generation)) return
      ports.setWorkspaceOpeningPhase('database')
      await activateWorkItem(project, true, preferredChapterId)
      if (ports.isCurrentWorkspaceOpening(generation)) ports.setWorkspaceOpeningPhase('ready')
      if (
        ports.isCurrentWorkspaceOpening(generation) &&
        ports.workspaceOpening.value?.visible &&
        !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        const visualReady = await ports.waitForWorkspaceOpeningPhase(generation, 'ready')
        if (visualReady && ports.isCurrentWorkspaceOpening(generation)) {
          await new Promise((resolve) => window.setTimeout(resolve, ports.WORKSPACE_COMPLETION_DURATION_MS))
        }
      }
    } finally {
      ports.finishWorkspaceOpening(generation)
    }
  }

  async function openLibraryChapter(project, chapterId) {
    await openProject(project, chapterId)
    if (ports.current.value?.path !== project.path || ports.workspaceOpening.value) return
    const chapter = ports.chapters.value.find((item) => item.id === chapterId)
    if (!chapter) return ports.notice('这个章节暂时不可打开，请在作品中核对目录。')
    await ports.selectActivity('desk')
    await ports.selectChapter(chapter)
  }

  async function forgetProject(project) {
    await ports.guard(
      () => ports.desktop.projects.removeRecent(project.path),
      `《${project.title}》已从书架移除，磁盘文件没有改动`
    )
    await refreshProjects({ allowRemoval: true })
  }

  function requestTrashProject(project) {
    ports.projectTrashConfirmation.value = ''
    ports.projectTrashTarget.value = project
  }

  async function trashProject() {
    const target = ports.projectTrashTarget.value
    if (!target || ports.projectTrashConfirmation.value !== target.title) return
    if (!(await prepareWorkItemTransition())) return
    const result = await ports.guard(
      () => ports.desktop.projects.trash(target.path),
      `《${target.title}》已移入系统回收站`
    )
    ports.projectTrashTarget.value = null
    ports.projectTrashConfirmation.value = ''
    await refreshProjects({ allowRemoval: true })
    // The success sheet is also the completion signal used by keyboard users
    // and click tests. Do not expose it while the shelf still contains stale data.
    ports.recentlyTrashedProject.value = { title: result.title }
  }

  async function openSystemTrash() {
    await ports.guard(() => ports.desktop.projects.openTrash())
  }

  async function closeProject() {
    if (!(await prepareWorkItemTransition())) return
    await ports.desktop.modelConnections.leaveBook()
    ports.workspaceRequests.invalidate()
    ports.chapterSelectionGeneration += 1
    ports.workspaceRefreshGeneration += 1
    ports.clearAutosaveTimer()
    ports.clearAutosaveFinalizeTimer()
    ports.activeAutosaveCheckpoint = null
    ports.stagedRecoverySnapshot = null
    ports.current.value = null
    ports.selectedId.value = null
    ports.selectedVolume.value = null
    ports.volumeOutline.value = ''
    ports.stageOutlines.value = []
    ports.selectedStage.value = null
    ports.stageTitle.value = ''
    ports.stageOutline.value = ''
    ports.lastSavedStageTitle.value = ''
    ports.lastSavedStageOutline.value = ''
    ports.stageDraftTitle.value = ''
    ports.lastSavedChapter = { id: null, title: '', content: '', revision: null, bodyVersionId: null }
    ports.resetWorkItemTransientState()
    await refreshProjects()
  }

  async function prepareWorkItemTransition() {
    if (!(await ports.prepareOutlineLeave())) return false
    ports.invalidateOutlineRead()
    if (ports.modelSettingsDirty.value) {
      ports.notice('模型设置还有未保存的输入，请先保存或放弃修改。')
      return false
    }
    if (!ports.worldMapWorkspace.canLeave()) return false
    if (!(await ports.flushPlannedChapterSave())) return false
    await ports.cancelAutomaticPlanning(false)
    await ports.cancelPlanningChapterSkeleton(false)
    await ports.cancelPlanningChapterDetail(false)
    if (!(await ports.flushChapterSaveSafely())) return false
    await ports.flushPlanningDraftSave()
    ports.clearAutosaveTimer()
    return true
  }

  async function activateWorkItem(
    project,
    load = true,
    preferredChapterId = project.manuscript?.lastEditedChapter?.id ?? null
  ) {
    const request = ports.workspaceRequests.begin(project)
    ports.resetWorkItemTransientState()
    ports.current.value = project
    if (load) {
      try {
        await ports.loadWorkspace(request, preferredChapterId)
      } catch (error) {
        if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
        ports.chapters.value = []
        ports.selectedId.value = null
        ports.workspaceLoadError.value = error?.message || '作品数据暂时无法读取'
        ports.migrationPreview.value = await ports.desktop.projects.migrationPreview().catch(() => null)
        ports.notice('检测到书稿结构需要核对；正文没有被当作空书处理')
      }
    }
    if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    // The workspace is already usable at this point. Updating the shelf's
    // recency/word-count projection must not keep the author on a blank opening
    // state, and refreshProjects only changes the library projection.
    void refreshProjects().catch(() => undefined)
  }

  return {
    refreshProjects,
    chooseCreateFolder,
    openCreateProject,
    closeCreateProject,
    createProject,
    saveBookProfileAndContinue,
    importProject,
    openProject,
    openLibraryChapter,
    forgetProject,
    requestTrashProject,
    trashProject,
    openSystemTrash,
    closeProject,
    prepareWorkItemTransition,
    activateWorkItem
  }
}
