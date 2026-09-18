import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

/** Focused renderer proof for persisted pause -> traceable child resume. */
export async function runWritingTaskPauseSmoke(window: BrowserWindow, modelUrl: string): Promise<SmokeResult> {
  const result: SmokeResult = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const setValue = (element, value) => {
      element.value = value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    let currentStep = 'initialize'
    try {
      currentStep = 'model-settings'
      const settings = await window.novelDesktop.ai.getSettings()
      await window.novelDesktop.ai.updateSettings({
        baseUrl: ${JSON.stringify(modelUrl)}, apiKey: 'task-pause-smoke-key', routingMode: 'shared',
        shared: { ...settings.shared, model: 'gemini-smoke-model' }
      })
      currentStep = 'open-manuscript'
      document.querySelector('[data-activity="desk"]')?.click()
      for (let n = 0; n < 100 && !document.querySelector('[data-testid="manuscript-input"]'); n++) await wait(100)
      const assistantToggle = document.querySelector('.assistant-toggle')
      if (assistantToggle?.getAttribute('aria-expanded') === 'false') assistantToggle.click()
      for (let n = 0; n < 100 && !document.querySelector('[data-testid="writing-agent-input"]'); n++) await wait(100)
      document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
      const input = document.querySelector('[data-testid="writing-agent-input"]')
      const send = document.querySelector('[data-testid="run-writing-agent"]')
      if (!input || !send) return { ok: false, step: 'composer-missing' }
      const beforeBody = await window.novelDesktop.chapters.get(1)
      setValue(input, '烟测停止这个任务：当前章节是什么？')
      await wait(80)
      if (send.disabled) return { ok: false, step: 'send-disabled' }
      currentStep = 'start-task'
      send.click()
      for (let n = 0; n < 100 && !document.querySelector('[data-testid="pause-writing-agent-task"]'); n++) await wait(60)
      const pause = document.querySelector('[data-testid="pause-writing-agent-task"]')
      const stop = document.querySelector('[data-testid="cancel-writing-agent-task"]')
      if (!pause || !stop) return { ok: false, step: 'running-controls-missing' }
      for (let n = 0; n < 250; n++) {
        if (document.querySelector('[data-testid="writing-agent-stream-preview"]')?.textContent?.includes('停止前已经生成')) break
        await wait(60)
      }
      if (!document.querySelector('[data-testid="writing-agent-stream-preview"]')?.textContent?.includes('停止前已经生成')) {
        const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
        return { ok: false, step: 'partial-not-visible', states: tasks.map(task => ({ status: task.status, partialCharacters: task.partial?.content?.length || 0, model: task.model, errorCode: task.error?.code })) }
      }
      currentStep = 'pause-task'
      pause.click()
      for (let n = 0; n < 100 && !document.querySelector('[data-testid="writing-agent-task-paused"]'); n++) await wait(60)
      const pausedCard = document.querySelector('[data-testid="writing-agent-task-paused"]')
      if (!pausedCard?.textContent?.includes('已暂停')) return { ok: false, step: 'paused-card-missing', text: pausedCard?.textContent || '' }
      const beforeResume = await window.novelDesktop.ai.listWritingAgentTasks(1)
      const parent = beforeResume.find(task => task.status === 'paused')
      if (!parent?.partial?.content?.includes('停止前已经生成')) return { ok: false, step: 'pause-not-persisted', tasks: beforeResume }
      currentStep = 'open-task-center'
      document.querySelector('[data-testid="assistant-mode-tasks"]')?.click()
      for (let n = 0; n < 100 && !document.querySelector('[data-testid="task-center-resume-' + parent.id + '"]'); n++) await wait(60)
      const resume = document.querySelector('[data-testid="task-center-resume-' + parent.id + '"]')
      const parentTaskCard = document.querySelector('[data-testid="task-center-item-' + parent.id + '"]')
      if (!resume || !parentTaskCard?.textContent?.includes('已暂停')) return { ok: false, step: 'task-center-paused-missing', text: parentTaskCard?.textContent || '' }
      currentStep = 'resume-task'
      resume.click()
      for (let n = 0; n < 160; n++) {
        const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
        const child = tasks.find(task => task.parentTaskRunId === parent.id && task.attempt === parent.attempt + 1)
        if (child?.status === 'succeeded') {
          document.querySelector('[data-testid="task-filter-all"]')?.click()
          for (let settle = 0; settle < 50 && !document.querySelector('[data-testid="task-center-item-' + child.id + '"]')?.textContent?.includes('已完成'); settle++) await wait(60)
          const completedCard = document.querySelector('[data-testid="task-center-item-' + child.id + '"]')
          const duplicateResume = document.querySelector('[data-testid="task-center-resume-' + parent.id + '"]')
          const continuedParent = document.querySelector('[data-testid="task-center-item-' + parent.id + '"]')
          const continuedLabelVisible = Boolean(continuedParent?.textContent?.includes('已续接'))
          const afterBody = await window.novelDesktop.chapters.get(1)
          const manuscriptUnchanged = beforeBody.content === afterBody.content && beforeBody.revision === afterBody.revision
          return {
            ok: child.artifact?.status === 'complete' && completedCard?.textContent?.includes('已完成') && !duplicateResume && continuedLabelVisible && manuscriptUnchanged,
            step: 'pause-resume-complete', parentStatus: parent.status, parentPartial: parent.partial.content.length,
            childStatus: child.status, childAttempt: child.attempt, childHasParent: Boolean(child.parentTaskRunId),
            taskCenterCompletedVisible: Boolean(completedCard), duplicateResumeVisible: Boolean(duplicateResume), continuedLabelVisible, manuscriptUnchanged
          }
        }
        if (child && ['failed', 'cancelled', 'interrupted'].includes(child.status)) return { ok: false, step: 'resume-' + child.status, child }
        await wait(100)
      }
      return { ok: false, step: 'resume-timeout' }
    } catch (error) {
      return { ok: false, step: 'task-pause-exception', currentStep, error: error?.message || JSON.stringify(error), details: error?.details || null }
    }
  })()`)
  if (!result.ok) return result
  await verifyTaskFilters(window)
  return { ...result, filtersKeyboardAndCompact: true }
}

/** Read-only filter interactions in the existing isolated pause/resume book. */
async function verifyTaskFilters(window: BrowserWindow): Promise<void> {
  const js = (source: string) => window.webContents.executeJavaScript(source)
  const wait = () => new Promise(resolve => setTimeout(resolve, 200))
  const key = (keyCode: string) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    // Electron does not synthesize the OS character event from keyDown.
    // Native button Enter activation needs that event; Space activates on keyUp.
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  }
  window.focus(); window.webContents.focus()
  await js(`document.querySelector('[data-testid="task-filter-attention"]').focus()`)
  key('Enter')
  await wait()
  key('Tab')
  await wait()
  key('Space')
  await wait()
  const active = await js(`(() => {
    const button = document.querySelector('[data-testid="task-filter-active"]')
    return { focused: button === document.activeElement, selected: button.getAttribute('aria-pressed'),
      selectedCount: document.querySelectorAll('.task-center-filters [aria-pressed="true"]').length,
      empty: !document.querySelector('.task-center-list') && Boolean(document.querySelector('.task-center-empty')),
      outlineStyle: getComputedStyle(button).outlineStyle, outlinePixels: parseFloat(getComputedStyle(button).outlineWidth) * devicePixelRatio,
      focusedTestId: document.activeElement?.getAttribute('data-testid') }
  })()`)
  if (!active.focused || active.selected !== 'true' || active.selectedCount !== 1 || !active.empty
    || active.outlineStyle !== 'solid' || active.outlinePixels < 2) {
    throw new Error('task filter keyboard selection, focus or empty state failed: ' + JSON.stringify(active))
  }
  key('Tab'); await wait(); key('Enter')
  await wait()
  const all = await js(`document.activeElement?.getAttribute('data-testid') === 'task-filter-all'
    && document.activeElement.getAttribute('aria-pressed') === 'true'
    && document.querySelectorAll('.task-center-filters [aria-pressed="true"]').length === 1
    && Boolean(document.querySelector('.task-card.is-succeeded'))`)
  if (!all) throw new Error('task filter keyboard return to full history failed')
  const bounds = window.getBounds()
  const zoom = window.webContents.getZoomFactor()
  try {
    for (const compact of [false, true]) {
      if (compact) { window.setSize(1100, 800); window.webContents.setZoomFactor(1.25) }
      await wait()
      const geometry = await js(`(() => {
        const nav = document.querySelector('.task-center-filters'), parent = nav.getBoundingClientRect()
        return Array.from(nav.querySelectorAll('button')).every(button => {
          const r = button.getBoundingClientRect(), s = getComputedStyle(button)
          return button.checkVisibility() && r.width >= 72 && r.height >= 32
            && r.left >= parent.left - 1 && r.right <= parent.right + 1
            && r.bottom <= innerHeight && button.scrollWidth <= button.clientWidth
            && s.appearance === 'none' && s.borderTopStyle === 'solid' && parseFloat(s.fontSize) >= 12
            && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === button
        })
      })()`)
      if (!geometry) throw new Error('task filter style or compact hit targets failed')
      await writeFile(join(process.cwd(), 'artifacts', 'ui', `task-center-filters-${compact ? 'compact' : 'normal'}.png`), (await window.capturePage()).toPNG())
    }
  } finally {
    window.setBounds(bounds)
    window.webContents.setZoomFactor(zoom)
  }
}
