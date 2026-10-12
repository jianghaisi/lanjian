// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAppLayoutActions(ports) {
  function noteExplorerScroll() {
    ports.explorerScrolling.value = true
    if (ports.explorerScrollEndTimer) window.clearTimeout(ports.explorerScrollEndTimer)
    ports.explorerScrollEndTimer = window.setTimeout(() => {
      ports.explorerScrolling.value = false
      ports.explorerScrollEndTimer = null
    }, 720)
  }

  function beginExplorerResize(event) {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = document.querySelector('.explorer')?.getBoundingClientRect().width || ports.explorerWidth.value
    const preferenceScale = 1440 / window.innerWidth
    const move = (moveEvent) => {
      ports.explorerWidth.value = Math.min(
        420,
        Math.max(200, (startWidth + moveEvent.clientX - startX) * preferenceScale)
      )
    }
    const stop = () => {
      ports.removeExplorerResizeListeners?.()
      ports.saveAppearancePreferences(false)
    }
    document.body.classList.add('is-resizing-explorer')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    ports.removeExplorerResizeListeners = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.classList.remove('is-resizing-explorer')
      ports.removeExplorerResizeListeners = null
    }
  }

  function resizeExplorerByKeyboard(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') ports.explorerWidth.value = 200
    else if (event.key === 'End') ports.explorerWidth.value = 420
    else
      ports.explorerWidth.value = Math.min(
        420,
        Math.max(200, ports.explorerWidth.value + (event.key === 'ArrowRight' ? 16 : -16))
      )
    ports.saveAppearancePreferences(false)
  }

  function beginAssistantResize(event) {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth =
      document.querySelector('.assistant-panel')?.getBoundingClientRect().width || ports.assistantWidth.value
    const move = (moveEvent) => {
      ports.assistantWidth.value = Math.min(
        720,
        Math.max(280, startWidth + startX - moveEvent.clientX)
      )
    }
    const stop = () => {
      ports.removeAssistantResizeListeners?.()
      ports.saveAppearancePreferences(false)
    }
    document.body.classList.add('is-resizing-assistant')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
    window.addEventListener('blur', stop, { once: true })
    ports.removeAssistantResizeListeners = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      document.body.classList.remove('is-resizing-assistant')
      ports.removeAssistantResizeListeners = null
    }
  }

  function resizeAssistantByKeyboard(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') ports.assistantWidth.value = 280
    else if (event.key === 'End') ports.assistantWidth.value = 720
    else
      ports.assistantWidth.value = Math.min(
        720,
        Math.max(280, ports.assistantWidth.value + (event.key === 'ArrowLeft' ? 16 : -16))
      )
    ports.saveAppearancePreferences(false)
  }

  return {
    noteExplorerScroll,
    beginExplorerResize,
    resizeExplorerByKeyboard,
    beginAssistantResize,
    resizeAssistantByKeyboard
  }
}
