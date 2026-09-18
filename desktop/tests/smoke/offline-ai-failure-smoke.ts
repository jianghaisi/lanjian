import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

/** Proves an actual provider authentication failure cannot block manual writing or SQLite recovery. */
export async function runOfflineAiFailureSmoke(
  window: BrowserWindow,
  modelUrl: string,
  capturePath?: string
): Promise<SmokeResult> {
  const prose = '模型认证失败以后，作者仍然可以继续手写，并把这一段可靠地保存到本地。'
  const formattedProse = `　　${prose}`
  const message = '烟测认证失败：请只回答当前章节状态。'
  let failedAndSaved: SmokeResult
  try {
    failedAndSaved = await window.webContents.executeJavaScript(`(async () => {
    globalThis.__offlineFailureSmoke = { step: 'initialize' }
    const mark = (step) => { globalThis.__offlineFailureSmoke = { step } }
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
      const initialSettings = await window.novelDesktop.ai.getSettings()
      if (initialSettings.apiKeyConfigured) return { ok: false, step: 'model-unexpectedly-configured' }
      const contextPreferences = await window.novelDesktop.workspace.getContextBudgetPreferences()
      if (contextPreferences.alwaysConfirmBeforeSend) {
        await window.novelDesktop.workspace.saveContextBudgetPreferences({ ...contextPreferences, alwaysConfirmBeforeSend: false })
      }
      currentStep = 'configure-invalid-credential'
      await window.novelDesktop.ai.updateSettings({
        baseUrl: ${JSON.stringify(`${modelUrl}/gpt/v1`)},
        apiKey: 'intentionally-invalid-smoke-key',
        routingMode: 'shared',
        shared: { ...initialSettings.shared, model: 'gpt-4.1-mini' }
      })
      currentStep = 'open-manuscript'
      document.querySelector('[aria-label="书稿"]')?.click()
      const firstChapter = await until(() => Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent?.includes('雨夜追迹')))
      if (!firstChapter) return { ok: false, step: 'chapter-missing' }
      firstChapter.click()
      await wait(120)
      const editor = await until(() => document.querySelector('[data-testid="manuscript-input"]'))
      if (!editor) return { ok: false, step: 'editor-missing' }
      if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
      await until(() => document.querySelector('[data-testid="writing-agent-input"]'))
      document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
      document.querySelector('[data-testid="open-agent-skills"]')?.click()
      const querySkill = await until(() => Array.from(document.querySelectorAll('.agent-skill-menu button')).find(button => button.textContent?.includes('问答')))
      if (!querySkill) return { ok: false, step: 'query-skill-missing' }
      querySkill.click()
      const input = document.querySelector('[data-testid="writing-agent-input"]')
      const send = document.querySelector('[data-testid="run-writing-agent"]')
      if (!input || !send) return { ok: false, step: 'composer-missing' }
      setValue(input, ${JSON.stringify(message)})
      await wait(100)
      currentStep = 'trigger-authentication-failure'
      send.click()
      const failedCard = await until(() => document.querySelector('[data-testid="writing-agent-task-failed"]'))
      const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
      const failedTask = tasks.find(task => task.status === 'failed' && task.message === ${JSON.stringify(message)})
      if (!failedCard || !failedTask) return { ok: false, step: 'failed-task-missing', tasks }
      const failureText = failedCard.textContent || ''
      if (!failureText.includes('接口密钥无效或已经失效')) return { ok: false, step: 'authentication-message-missing', failureText }
      mark('authentication-failure-visible')
      currentStep = 'manual-write-after-failure'
      editor.focus()
      document.execCommand('selectAll')
      document.execCommand('insertText', false, ${JSON.stringify(prose)})
      mark('manual-text-inserted')
      await wait(300)
      document.querySelector('[data-testid="save-manuscript"]')?.click()
      mark('manual-save-clicked')
      const chapter = await until(async () => {
        const value = await window.novelDesktop.chapters.get(1)
        return value.content === ${JSON.stringify(formattedProse)} ? value : null
      })
      mark('manual-save-observed-' + Boolean(chapter))
      failedCard.scrollIntoView({ block: 'center' })
      await wait(120)
      const editorRect = editor.getBoundingClientRect()
      const assistantRect = document.querySelector('.assistant-panel')?.getBoundingClientRect()
      return {
        ok: Boolean(chapter)
          && Boolean(editorRect && assistantRect && editorRect.right <= assistantRect.left + 1)
          && Boolean(failedCard.querySelector('[data-testid="retry-writing-agent-task-' + failedTask.id + '"]')),
        step: 'auth-failed-manual-save',
        taskId: failedTask.id,
        errorMessage: failedTask.error?.message || '',
        chapterRevision: chapter?.revision,
        manualContent: chapter?.content || '',
        editorRight: editorRect?.right,
        assistantLeft: assistantRect?.left
      }
    } catch (error) {
      return { ok: false, step: 'offline-ai-failure-exception', currentStep, error: error?.message || String(error) }
    }
  })()`)
  } catch (error) {
    const rendererState = await window.webContents.executeJavaScript('globalThis.__offlineFailureSmoke || null').catch(() => null)
    return { ok: false, step: 'offline-ai-failure-script-rejected', rendererState, error: error instanceof Error ? error.message : String(error) }
  }
  if (!failedAndSaved.ok) return failedAndSaved
  if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())

  const reloaded = await new Promise<boolean>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('重新加载写作界面超时')), 15_000)
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timeout)
      resolve(true)
    })
    window.webContents.reload()
  }).catch(() => false)
  if (!reloaded || window.isDestroyed()) return { ok: false, step: 'renderer-reload-failed' }
  await new Promise((resolve) => setTimeout(resolve, 800))

  const recovered = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (read, attempts = 120) => {
      for (let index = 0; index < attempts; index += 1) {
        const value = await read()
        if (value) return value
        await wait(80)
      }
      return null
    }
    try {
      await until(async () => {
        const status = await window.novelDesktop.projects.status().catch(() => null)
        return status?.project?.title === '烟测书稿' ? status : null
      })
      if (!document.querySelector('[aria-label="书稿"]')) {
        const workItem = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
        workItem?.click()
        await until(() => document.querySelector('[aria-label="书稿"]'))
      }
      document.querySelector('[aria-label="书稿"]')?.click()
      let rowClicked = false
      const editor = await until(() => {
        const value = document.querySelector('[data-testid="manuscript-input"]')
        if (value) return value
        const row = document.querySelector('.chapter-tree-row[type="button"]')
        if (row && !rowClicked) { row.click(); rowClicked = true }
        return null
      })
      if (!editor) return { ok: false, step: 'reloaded-editor-missing' }
      const chapter = await window.novelDesktop.chapters.get(1)
      const settings = await window.novelDesktop.ai.getSettings()
      const editorText = Array.from(editor.querySelectorAll('.cm-line')).map(line => line.textContent || '').join('\\n')
      const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
      const failedTask = tasks.find(task => task.id === ${JSON.stringify(String(failedAndSaved.taskId || ''))})
      return {
        ok: editorText === ${JSON.stringify(formattedProse)}
          && chapter.content === ${JSON.stringify(formattedProse)}
          && chapter.storageMode === 'sqlite'
          && settings.apiKeyConfigured
          && failedTask?.status === 'failed',
        step: 'auth-failure-reloaded',
        editorText,
        chapterContent: chapter.content,
        taskStatus: failedTask?.status || '',
        errorMessage: failedTask?.error?.message || ''
      }
    } catch (error) {
      return { ok: false, step: 'offline-ai-reload-exception', error: error?.message || String(error) }
    }
  })()`).catch((error: unknown) => ({ ok: false, step: 'offline-ai-recovery-script-rejected', error: error instanceof Error ? error.message : String(error) }))
  if (!recovered?.ok) return { ...failedAndSaved, ok: false, recovered }
  const failureCardVisible = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
    for (let index = 0; index < 80 && !document.querySelector('[data-testid="assistant-mode-agent"]'); index += 1) await wait(80)
    document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
    for (let index = 0; index < 80; index += 1) {
      const card = document.querySelector('[data-testid="writing-agent-task-failed"]')
      if (card?.textContent?.includes('接口密钥无效或已经失效')) return true
      await wait(80)
    }
    return false
  })()`).catch(() => false)
  return { ...failedAndSaved, ok: failureCardVisible, recovered, failureCardVisible }
}
