import { nextTick } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryOpeningActions(ports) {
  function beginWorkspaceOpening(project) {
    const generation = ++ports.workspaceOpeningGeneration
    stopWorkspaceOpeningPhasePlayback()
    if (ports.workspaceOpeningSlowTimer) window.clearTimeout(ports.workspaceOpeningSlowTimer)
    ports.workspaceOpening.value = {
      generation,
      path: project.path,
      title: project.title,
      phase: 'switch',
      targetPhase: 'switch',
      slow: false,
      visible: true
    }
    ports.workspaceOpeningSlowTimer = window.setTimeout(() => {
      if (ports.workspaceOpening.value?.generation === generation) ports.workspaceOpening.value.slow = true
    }, 4000)
    return generation
  }

  function isCurrentWorkspaceOpening(generation) {
    return ports.workspaceOpening.value?.generation === generation
  }

  function workspaceOpeningPhaseIndex(phase) {
    return Math.max(0, ports.WORKSPACE_PHASE_SEQUENCE.indexOf(phase))
  }

  function settleWorkspaceOpeningPhaseWaiters() {
    const opening = ports.workspaceOpening.value
    ports.workspaceOpeningPhaseWaiters = ports.workspaceOpeningPhaseWaiters.filter((waiter) => {
      if (!opening || opening.generation !== waiter.generation) {
        waiter.resolve(false)
        return false
      }
      if (workspaceOpeningPhaseIndex(opening.phase) >= workspaceOpeningPhaseIndex(waiter.phase)) {
        waiter.resolve(true)
        return false
      }
      return true
    })
  }

  function stopWorkspaceOpeningPhasePlayback() {
    if (ports.workspaceOpeningPhaseTimer) window.clearTimeout(ports.workspaceOpeningPhaseTimer)
    if (ports.workspaceOpeningPhaseFrame) window.cancelAnimationFrame(ports.workspaceOpeningPhaseFrame)
    ports.workspaceOpeningPhaseTimer = 0
    ports.workspaceOpeningPhaseFrame = 0
    for (const waiter of ports.workspaceOpeningPhaseWaiters.splice(0)) waiter.resolve(false)
  }

  function scheduleWorkspaceOpeningPhaseAdvance() {
    // Do not start the dwell clock until the newly selected phase has actually
    // reached a browser paint. This prevents a busy renderer from collapsing
    // phases 03 and 04 into the same visible frame.
    ports.workspaceOpeningPhaseFrame = window.requestAnimationFrame(() => {
      ports.workspaceOpeningPhaseFrame = window.requestAnimationFrame(() => {
        ports.workspaceOpeningPhaseFrame = 0
        ports.workspaceOpeningPhaseTimer = window.setTimeout(() => {
          ports.workspaceOpeningPhaseTimer = 0
          advanceWorkspaceOpeningPhase()
        }, ports.WORKSPACE_PHASE_DWELL_MS)
      })
    })
  }

  function advanceWorkspaceOpeningPhase() {
    const opening = ports.workspaceOpening.value
    if (!opening) return settleWorkspaceOpeningPhaseWaiters()
    const currentIndex = workspaceOpeningPhaseIndex(opening.phase)
    const targetIndex = workspaceOpeningPhaseIndex(opening.targetPhase)
    if (targetIndex <= currentIndex) return settleWorkspaceOpeningPhaseWaiters()
    opening.phase = ports.WORKSPACE_PHASE_SEQUENCE[currentIndex + 1]
    settleWorkspaceOpeningPhaseWaiters()
    scheduleWorkspaceOpeningPhaseAdvance()
  }

  function setWorkspaceOpeningPhase(phase) {
    const opening = ports.workspaceOpening.value
    if (!opening) return
    opening.targetPhase = phase
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (
      !opening.visible ||
      reducedMotion ||
      workspaceOpeningPhaseIndex(phase) < workspaceOpeningPhaseIndex(opening.phase)
    ) {
      if (ports.workspaceOpeningPhaseTimer) window.clearTimeout(ports.workspaceOpeningPhaseTimer)
      if (ports.workspaceOpeningPhaseFrame) window.cancelAnimationFrame(ports.workspaceOpeningPhaseFrame)
      ports.workspaceOpeningPhaseTimer = 0
      ports.workspaceOpeningPhaseFrame = 0
      opening.phase = phase
      settleWorkspaceOpeningPhaseWaiters()
      return
    }
    if (!ports.workspaceOpeningPhaseTimer && !ports.workspaceOpeningPhaseFrame) advanceWorkspaceOpeningPhase()
  }

  function waitForWorkspaceOpeningPhase(generation, phase) {
    if (!isCurrentWorkspaceOpening(generation)) return Promise.resolve(false)
    if (workspaceOpeningPhaseIndex(ports.workspaceOpening.value.phase) >= workspaceOpeningPhaseIndex(phase))
      return Promise.resolve(true)
    return new Promise((resolve) => ports.workspaceOpeningPhaseWaiters.push({ generation, phase, resolve }))
  }

  function finishWorkspaceOpening(generation) {
    if (!isCurrentWorkspaceOpening(generation)) return
    stopWorkspaceOpeningPhasePlayback()
    if (ports.workspaceOpeningSlowTimer) window.clearTimeout(ports.workspaceOpeningSlowTimer)
    ports.workspaceOpeningSlowTimer = 0
    ports.workspaceOpening.value = null
  }

  function cancelWorkspaceOpening() {
    ports.workspaceOpeningGeneration += 1
    stopWorkspaceOpeningPhasePlayback()
    if (ports.workspaceOpeningSlowTimer) window.clearTimeout(ports.workspaceOpeningSlowTimer)
    ports.workspaceOpeningSlowTimer = 0
    ports.workspaceOpening.value = null
    ports.workspaceRequests.invalidate()
    ports.chapterSelectionGeneration += 1
    ports.workspaceRefreshGeneration += 1
    ports.clearAutosaveTimer()
    ports.clearAutosaveFinalizeTimer()
    ports.current.value = null
    ports.selectedId.value = null
    ports.resetWorkItemTransientState()
    void ports.refreshProjects().catch(() => undefined)
    void nextTick(() => document.querySelector('[data-library-view="all"]')?.focus({ preventScroll: true }))
  }

  return {
    beginWorkspaceOpening,
    isCurrentWorkspaceOpening,
    workspaceOpeningPhaseIndex,
    settleWorkspaceOpeningPhaseWaiters,
    stopWorkspaceOpeningPhasePlayback,
    scheduleWorkspaceOpeningPhaseAdvance,
    advanceWorkspaceOpeningPhase,
    setWorkspaceOpeningPhase,
    waitForWorkspaceOpeningPhase,
    finishWorkspaceOpening,
    cancelWorkspaceOpening
  }
}
