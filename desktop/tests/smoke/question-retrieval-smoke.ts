import type { BrowserWindow } from 'electron'

/** Only invoked after the smoke harness creates its own isolated SQLite book. */
export async function runQuestionRetrievalSmoke(window: BrowserWindow, modelUrl: string): Promise<{ ok: boolean; step: string }> {
  const scenario = process.env.LANJIAN_SMOKE_QUESTION_SCENARIO || 'positive'
  if (!['positive', 'selected', 'missing', 'normalized', 'model-picker'].includes(scenario)) throw new Error('unknown question smoke scenario')
  await window.webContents.executeJavaScript(`(async () => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
    const settings = await window.novelDesktop.ai.getSettings()
    await window.novelDesktop.ai.updateSettings({ baseUrl: ${JSON.stringify(modelUrl)}, apiKey: 'isolated-question-smoke-key', routingMode: 'shared', shared: { ...settings.shared, model: 'gemini-smoke-model' } })
    if (${JSON.stringify(scenario === 'model-picker')}) {
      await window.novelDesktop.ai.updateSettings({ connections: [
        { id: 'primary', name: '目录接口甲', baseUrl: ${JSON.stringify(modelUrl)} },
        { id: 'manual', name: '写作接口乙', baseUrl: ${JSON.stringify(modelUrl + '/manual/v1')}, apiKey: 'isolated-manual-smoke-key' }
      ] })
    }
    const profile = await window.novelDesktop.workspace.getBookProfile()
    await window.novelDesktop.workspace.saveBookProfile({ ...profile, autosaveEnabled: false })
    const priorQuote = ${JSON.stringify(scenario === 'normalized' ? '　　班长把ＮＯＴＥ_１２递给李远明：“明天还我。”' : '　　班长把数学笔记递给李远明：“明天还我。”')}
    await window.novelDesktop.chapters.update(1, { title: '课堂笔记', content: '甲…'.repeat(200) + priorQuote + '乙'.repeat(900) })
    await window.novelDesktop.chapters.update(2, { title: '前情问答核验', content: '　　你借我数学笔记的恩情，我还没报答。' })
    await window.novelDesktop.chapters.update(3, { title: '后文章节', content: '　　数学笔记未来变成藏宝图，隐藏口令是海盐彗星。' })
  })()`)
  await new Promise<void>((resolve, reject) => {
    const loaded = () => { clearTimeout(timeout); resolve() }
    const timeout = setTimeout(() => { window.webContents.removeListener('did-finish-load', loaded); reject(new Error('question reload timeout')) }, 15000)
    window.webContents.once('did-finish-load', loaded)
    window.webContents.reload()
  })
  await window.webContents.executeJavaScript(`(async () => {
    let step = 'open-workspace'
    const until = async predicate => {
      for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)) }
      throw new Error('question UI wait timeout: ' + step + ' / ' + (window.__questionStep || '') + ' / ' + JSON.stringify({
        page: document.querySelector('.studio')?.dataset.page,
        assistantExpanded: document.querySelector('[aria-controls="assistant-drawer"]')?.getAttribute('aria-expanded'),
        composer: Boolean(document.querySelector('[data-testid="writing-agent-input"]'))
      }))
    }
    const click = async selector => {
      window.__questionStep = selector
      await until(() => { const el = document.querySelector(selector); return el?.checkVisibility() && !el.disabled })
      document.querySelector(selector).click()
    }
    await until(() => document.querySelector('[data-activity="desk"]') || document.querySelector('.work-item-open'))
    if (!document.querySelector('[data-activity="desk"]')) {
      Array.from(document.querySelectorAll('.work-item-open')).find(e => e.getAttribute('aria-label')?.includes('烟测书稿')).click()
    }
    await click('[data-activity="desk"]')
    step = 'wait-initial-editor'
    const before = await Promise.all([1, 2, 3].map(id => window.novelDesktop.chapters.get(id)))
    await until(() => document.querySelector('[data-testid="manuscript-input"]')?.checkVisibility())
    const chapterItem = () => Array.from(document.querySelectorAll('button.chapter-tree-row')).find(e => e.checkVisibility() && e.textContent.includes('前情问答核验'))
    step = 'select-current-chapter'
    await until(() => chapterItem() && !chapterItem().disabled)
    chapterItem().click()
    step = 'render-current-chapter'
    await until(() => Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(e => e.textContent).join('\\n') === before[1].content)
    step = 'open-assistant'
    if (!document.querySelector('[data-testid="writing-agent-input"]')?.checkVisibility()) {
      await click('[aria-controls="assistant-drawer"]')
    }
    if (document.querySelector('[data-testid="assistant-mode-agent"]')) await click('[data-testid="assistant-mode-agent"]')
    await until(() => document.querySelector('[data-testid="writing-agent-input"]')?.checkVisibility())
    window.__questionBefore = before
    window.__questionUntil = until
    window.__questionClick = click
  })()`)
  if (scenario === 'model-picker') {
    const { runModelPickerSmoke } = await import('./model-picker-smoke')
    await runModelPickerSmoke(window)
  }
  if (scenario === 'selected') {
    window.focus(); window.webContents.focus()
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="manuscript-input"]').focus()`)
    for (const [keyCode, modifiers] of [['Home', ['control']], ['End', ['control', 'shift']]] as const) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [...modifiers] })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [...modifiers] })
    }
    await new Promise(resolve => setTimeout(resolve, 180))
    const selected = await window.webContents.executeJavaScript(`window.getSelection()?.toString() === window.__questionBefore[1].content && Boolean(window.getSelection()?.toString().trim())`)
    if (!selected) return { ok: false, step: 'native-question-selection-missing' }
  }
  return window.webContents.executeJavaScript(`(async () => {
    let step = 'send-question'
    const before = window.__questionBefore, until = window.__questionUntil, click = window.__questionClick
    const scenario = ${JSON.stringify(scenario)}
    const input = document.querySelector('[data-testid="writing-agent-input"]')
    input.focus()
    input.value = scenario === 'normalized' ? '前文是否出现 NOTE_12？前情问答烟测' : scenario === 'missing' ? '前文是否出现 QUARTZ_KITE？前情问答烟测' : scenario === 'selected' ? '这句有依据吗？前情问答烟测' : '前文有没有借数学笔记的情节？前情问答烟测'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    step = 'send-question'
    await click('[data-testid="run-writing-agent"]')
    await until(() => document.querySelector('.agent-answer-text') || document.querySelector('[data-testid="confirm-writing-agent-send"]') || document.querySelector('[data-testid="writing-agent-task-failed"]'))
    if (document.querySelector('[data-testid="confirm-writing-agent-send"]')) await click('[data-testid="confirm-writing-agent-send"]')
    let task
    step = 'wait-query-task'
    await until(async () => {
      task = (await window.novelDesktop.ai.listWritingAgentTasks(2)).find(t => t.message.includes('前情问答烟测'))
      return task && ['succeeded', 'failed', 'cancelled'].includes(task.status)
    })
    if (task.status !== 'succeeded' || task.skill !== 'query') return { ok: false, step: 'query-task-' + task.status }
    if (scenario === 'model-picker') {
      if (task.model !== 'private-novel-2026') return { ok: false, step: 'manual-model-lost-before-generation' }
      if (JSON.stringify(await window.novelDesktop.ai.getSettings()) !== window.__modelPickerSettings) return { ok: false, step: 'manual-model-changed-saved-routing' }
    }
    step = 'render-answer'
    await until(() => document.querySelector('.agent-answer-text')?.textContent.includes(scenario === 'missing' ? '本次检索未找到 QUARTZ_KITE 的前文依据' : '第 1 章《课堂笔记》'))
    const answer = document.querySelector('.agent-answer-text')
    answer.scrollIntoView({ block: 'center' })
    const bounds = answer.getBoundingClientRect()
    const sidebar = document.querySelector('.assistant-panel').getBoundingClientRect()
    const expectedQuote = scenario === 'normalized' ? '班长把ＮＯＴＥ_１２递给李远明' : scenario === 'missing' ? '不能据此断言它从未出现' : '班长把数学笔记递给李远明'
    if (!answer.textContent.includes(expectedQuote) || bounds.height <= 0 || bounds.top < sidebar.top || bounds.bottom > sidebar.bottom) return { ok: false, step: 'answer-or-citation-not-visible' }
    if (document.querySelector('.agent-diff-block, [data-testid^="apply-agent-candidate-"], .agent-card-options')) return { ok: false, step: 'question-created-edit-candidate' }
    const after = await Promise.all([1, 2, 3].map(id => window.novelDesktop.chapters.get(id)))
    if (after.some((chapter, i) => chapter.content !== before[i].content || chapter.bodyVersionId !== before[i].bodyVersionId)) return { ok: false, step: 'question-changed-prose' }
    if (!document.querySelector('[data-testid="writing-agent-input"]')?.checkVisibility()) return { ok: false, step: 'composer-lost' }
    return { ok: true, step: 'visible-question-' + scenario + '-no-candidate-prose-unchanged' }
  })()`)
}
