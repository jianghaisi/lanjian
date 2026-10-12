import { nextTick } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAppBootActions(ports) {
  function dismissOpening() {
    const wasVisible = ports.opening.value
    const wasPreview = ports.bootPreview.value
    const shouldReconcileLibrary = wasVisible && !wasPreview && ports.projectsLoaded.value
    ports.opening.value = false
    ports.bootPreview.value = false
    if (wasVisible && !wasPreview && ports.desktop?.app.platform === 'browser') {
      const requested = new URLSearchParams(location.search).get('book')
      if (requested) {
        const project = ports.projects.value.find(item => item.id === requested)
        const destination = new URL(location.href)
        destination.searchParams.delete('book')
        history.replaceState(null, '', destination.pathname + destination.search + destination.hash)
        if (project) void nextTick(() => ports.openProject(project))
        else ports.notice('未找到这部作品，请从当前账户的书库选择。')
      }
    }
    if (shouldReconcileLibrary) void ports.refreshProjects().catch(() => undefined)
    if (wasVisible)
      void nextTick(() => {
        const target = ports.openingReturnFocus?.isConnected
          ? ports.openingReturnFocus
          : document.querySelector('[data-library-view="all"], .book-library:not(:disabled)')
        ports.openingReturnFocus = null
        if (!ports.opening.value && !ports.workspaceOpening.value) target?.focus({ preventScroll: true })
      })
  }

  function replayOpening() {
    ports.openingReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ports.bootPreview.value = true
    ports.bootPhase.value = 'ready'
    ports.opening.value = true
  }

  async function initializeBoot() {
    ports.bootError.value = ''
    ports.bootPhase.value = 'projects'
    ports.loading.value = true
    try {
      await ports.refreshProjects()
      ports.bootPhase.value = 'editor'
      await nextTick()
      if (ports.desktop?.app.platform !== 'browser') await document.fonts?.ready
      // Preferences were restored during setup; the next render makes them visible.
      ports.bootPhase.value = 'session'
      await nextTick()
      ports.bootPhase.value = 'ready'
    } catch {
      ports.bootError.value = ports.desktop?.app.platform === 'browser' ? '账户书库未能读取，请重试。作品没有改动。' : '本地作品清单未能读取，请重试。原作品文件没有改动。'
      ports.notice(ports.bootError.value)
    } finally {
      ports.loading.value = false
    }
  }

  function saveAppearancePreferences(showNotice = true) {
    localStorage.setItem('lanjian-explorer-width', String(ports.explorerWidth.value))
    localStorage.setItem('lanjian-assistant-width', String(ports.assistantWidth.value))
    localStorage.setItem('lanjian-interface-font-size', String(ports.interfaceFontSize.value))
    ports.saveEditorPreferences()
    if (showNotice) ports.notice('界面偏好已保存在本机')
  }

  function resetAppearancePreferences() {
    ports.explorerWidth.value = 280
    ports.assistantWidth.value = 348
    ports.interfaceFontSize.value = 13
    ports.resetEditorPreferences()
    saveAppearancePreferences()
  }

  return { dismissOpening, replayOpening, initializeBoot, saveAppearancePreferences, resetAppearancePreferences }
}
