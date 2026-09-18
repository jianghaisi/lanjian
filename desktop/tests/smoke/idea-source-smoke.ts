import type { BrowserWindow } from 'electron'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

/** Focused renderer proof for candidate -> note -> durable, visible provenance. */
export async function runIdeaSourceSmoke(window: BrowserWindow, modelUrl: string): Promise<SmokeResult> {
  return window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const setValue = (element, value) => {
      element.value = value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    let currentStep = 'initialize'
    try {
      currentStep = 'chapter-baseline'
      const beforeChapters = JSON.stringify(await window.novelDesktop.chapters.list())
      currentStep = 'model-settings'
      const settings = await window.novelDesktop.ai.getSettings()
      await window.novelDesktop.ai.updateSettings({
        baseUrl: ${JSON.stringify(modelUrl)}, apiKey: 'idea-source-smoke-key', routingMode: 'shared',
        shared: { ...settings.shared, model: 'gemini-smoke-model' }
      })
      currentStep = 'open-materials'
      document.querySelector('[aria-label="素材"]')?.click()
      for (let n = 0; n < 80 && !document.querySelector('[data-testid="new-idea"]'); n++) await wait(100)
      const create = document.querySelector('[data-testid="new-idea"]')
      if (!create) return { ok: false, step: 'idea-entry-missing' }
      create.click()
      await wait(80)
      const title = document.querySelector('[data-testid="idea-title-input"]')
      const content = document.querySelector('[data-testid="idea-content-input"]')
      const form = document.querySelector('[data-testid="idea-editor"]')
      if (!title || !content || !form) return { ok: false, step: 'idea-editor-missing' }
      setValue(title, '钟楼只记得最后一句谎话')
      setValue(content, '旧城钟楼每晚会抹去所有回声，只保留当天最后一句谎话。')
      currentStep = 'save-source-idea'
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      let source = null
      for (let n = 0; n < 80; n++) {
        source = (await window.novelDesktop.workspace.listIdeas()).find(item => item.title === '钟楼只记得最后一句谎话')
        if (source) break
        await wait(100)
      }
      if (!source) return { ok: false, step: 'source-idea-save' }
      currentStep = 'start-generation'
      let task = await window.novelDesktop.workspace.startIdeaGeneration({
        operationId: crypto.randomUUID(), ideaId: source.id, expectedUpdatedAt: source.updatedAt,
        mode: 'diverge', instruction: '提出一个保留钟楼吐槽反差的方向'
      })
      for (let n = 0; n < 160; n++) {
        task = await window.novelDesktop.workspace.ideaGeneration(task.id)
        if (task?.status === 'succeeded') break
        if (task && ['failed', 'cancelled', 'interrupted'].includes(task.status)) return { ok: false, step: 'generation-' + task.status, task }
        await wait(100)
      }
      if (task?.status !== 'succeeded' || !task.proposal?.options?.[0]) return { ok: false, step: 'generation-timeout' }
      currentStep = 'render-candidate'
      document.querySelector('[data-testid="idea-list"] button')?.click()
      for (let n = 0; n < 80 && !document.querySelector('[data-testid="idea-generation-result"] details button'); n++) await wait(100)
      const adopt = document.querySelector('[data-testid="idea-generation-result"] details button')
      if (!adopt) return { ok: false, step: 'candidate-action-missing' }
      currentStep = 'adopt-candidate'
      adopt.click()
      await wait(80)
      document.querySelector('[data-testid="idea-editor"]')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      let saved = null
      for (let n = 0; n < 80; n++) {
        saved = (await window.novelDesktop.workspace.listIdeas()).find(item => item.generationSource?.taskId === task.id)
        if (saved && document.querySelector('[data-testid="idea-origin"]')) break
        await wait(100)
      }
      if (!saved) return { ok: false, step: 'candidate-note-save' }
      currentStep = 'read-origin-task'
      const originTask = await window.novelDesktop.workspace.ideaGeneration(saved.generationSource.taskId)
      let visibleText = ''
      for (let n = 0; n < 80; n++) {
        const disclosure = document.querySelector('[data-testid="idea-origin"]')
        disclosure?.setAttribute('open', '')
        visibleText = document.querySelector('[data-testid="idea-origin-content"]')?.textContent || ''
        if (visibleText.includes(task.proposal.options[0].title) && visibleText.includes(task.proposal.options[0].content)) break
        await wait(100)
      }
      const unchanged = beforeChapters === JSON.stringify(await window.novelDesktop.chapters.list())
      return {
        ok: originTask.id === task.id && originTask.proposal.options[0].title === task.proposal.options[0].title
          && saved.generationSource.optionIndex === 0 && visibleText.includes(task.proposal.options[0].content) && unchanged,
        step: 'candidate-origin-visible', taskId: task.id, savedIdeaId: saved.id, visibleText, unchanged
      }
    } catch (error) {
      return { ok: false, step: 'idea-source-exception', currentStep, error: error?.message || JSON.stringify(error), details: error?.details || null }
    }
  })()`)
}
