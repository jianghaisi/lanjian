import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

/** Focused renderer proof for failed-task removal without manuscript deletion. */
export async function runWritingTaskDismissSmoke(
  window: BrowserWindow,
  modelUrl: string,
  capturePath?: string
): Promise<SmokeResult> {
  const prepared = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (read, attempts = 120) => {
      for (let index = 0; index < attempts; index += 1) {
        const value = await read()
        if (value) return value
        await wait(80)
      }
      return null
    }
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
        baseUrl: ${JSON.stringify(modelUrl)}, apiKey: 'task-dismiss-smoke-key', routingMode: 'shared',
        shared: { ...settings.shared, model: 'gemini-smoke-model' }
      })
      currentStep = 'open-manuscript'
      document.querySelector('[aria-label="书稿"]')?.click()
      const editor = await until(() => document.querySelector('[data-testid="manuscript-input"]'))
      if (!editor) return { ok: false, step: 'manuscript-missing' }
      document.querySelector('[aria-label="打开智能助笔侧栏"]')?.click()
      await until(() => document.querySelector('[data-testid="writing-agent-input"]'))
      document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
      const input = document.querySelector('[data-testid="writing-agent-input"]')
      const send = document.querySelector('[data-testid="run-writing-agent"]')
      if (!input || !send) return { ok: false, step: 'composer-missing' }
      setValue(input, '烟测删除失败记录：请只回答当前章节状态。')
      await wait(80)
      currentStep = 'create-failed-task'
      send.click()
      const failedCard = await until(() => document.querySelector('[data-testid="writing-agent-task-failed"]'))
      if (!failedCard) return { ok: false, step: 'failed-card-missing', tasks: await window.novelDesktop.ai.listWritingAgentTasks(1) }
      const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
      const failed = tasks.find(task => task.status === 'failed' && task.message.includes('烟测删除失败记录'))
      const remove = failed && failedCard.querySelector('[data-testid="dismiss-writing-agent-task-' + failed.id + '"]')
      const retry = failed && failedCard.querySelector('[data-testid="retry-writing-agent-task-' + failed.id + '"]')
      const visiblyInsidePanel = (element) => {
        if (!element) return false
        const rect = element.getBoundingClientRect()
        const panelRect = document.querySelector('[data-testid="writing-agent"]')?.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
          && Boolean(panelRect && rect.left >= panelRect.left && rect.right <= panelRect.right && rect.top >= panelRect.top && rect.bottom <= panelRect.bottom)
      }
      if (!failed || !remove || !retry) return { ok: false, step: 'failed-actions-missing', text: failedCard.textContent || '' }
      if (!visiblyInsidePanel(remove) || !visiblyInsidePanel(retry)) return { ok: false, step: 'failed-actions-not-visible', text: failedCard.textContent || '', removeRect: remove.getBoundingClientRect().toJSON(), retryRect: retry.getBoundingClientRect().toJSON() }
      if (remove.textContent?.trim() !== '删除记录' || retry.textContent?.trim() !== '重试') return { ok: false, step: 'failed-action-labels-wrong', text: failedCard.textContent || '' }
      failedCard.scrollIntoView({ block: 'center' })
      await wait(120)
      return { ok: true, step: 'failed-task-ready', failedId: failed.id, deleteVisible: true, retryVisible: true }
    } catch (error) {
      return { ok: false, step: 'task-dismiss-exception', currentStep, error: error?.message || JSON.stringify(error), details: error?.details || null }
    }
  })()`)
  if (!prepared.ok) return prepared
  if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
  const dismissed = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const failedId = ${JSON.stringify(String(prepared.failedId || ''))}
    const before = await window.novelDesktop.chapters.get(1)
    document.querySelector('[data-testid="dismiss-writing-agent-task-' + failedId + '"]')?.click()
    for (let index = 0; index < 100 && document.querySelector('[data-testid="writing-agent-task-failed"]'); index += 1) await wait(80)
    const removedFromAssistant = !document.querySelector('[data-testid="writing-agent-task-failed"]')
    const recent = await window.novelDesktop.ai.listWritingAgentTasks(1)
    const retainedAudit = await window.novelDesktop.ai.writingAgentTask(failedId)
    document.querySelector('[data-testid="assistant-mode-tasks"]')?.click()
    await wait(250)
    const removedFromTaskCenter = !document.querySelector('[data-testid="task-center-item-' + failedId + '"]')
    const after = await window.novelDesktop.chapters.get(1)
    return {
      ok: removedFromAssistant && !recent.some(task => task.id === failedId) && retainedAudit.status === 'failed'
        && removedFromTaskCenter && after.content === before.content && after.revision === before.revision,
      step: 'failed-task-dismissed-without-manuscript-change',
      removedFromAssistant,
      removedFromTaskCenter,
      auditStatus: retainedAudit.status,
      manuscriptUnchanged: after.content === before.content && after.revision === before.revision
    }
  })()`)
  return { ...prepared, ...dismissed, deleteVisible: true, retryVisible: true }
}
