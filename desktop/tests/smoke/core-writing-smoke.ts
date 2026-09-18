import type { BrowserWindow } from 'electron'

/** Isolated UI driver: called only by the explicit desktop smoke entry. */
export async function runCoreWritingSmoke(window: BrowserWindow, modelUrl: string): Promise<unknown> {
  await window.webContents.executeJavaScript(`(async () => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
    const settings = await window.novelDesktop.ai.getSettings()
    await window.novelDesktop.ai.updateSettings({ baseUrl: ${JSON.stringify(modelUrl)}, apiKey: 'isolated-core-smoke-key', routingMode: 'shared', shared: { ...settings.shared, model: 'gemini-smoke-model' } })
  })()`)
  // Storage setup uses IPC outside the UI, so remount against the activated authority.
  await new Promise<void>((resolve, reject) => {
    const loaded = () => { clearTimeout(timeout); resolve() }
    const timeout = setTimeout(() => { window.webContents.removeListener('did-finish-load', loaded); reject(new Error('Core writing reload timed out')) }, 15_000)
    window.webContents.once('did-finish-load', loaded)
    window.webContents.reload()
  })
  const setup = await window.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    window.__coreWait = async (predicate, timeoutMs = 10000) => { const deadline = Date.now() + timeoutMs; do { if (await predicate()) return true; await wait(100) } while (Date.now() < deadline); return false }
    let opened = false
    if (!await window.__coreWait(() => {
      if (document.querySelector('[data-activity="desk"]')) return true
      const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
      if (book && !opened) { opened = true; book.click() }
      return false
    })) return { ok: false, step: 'sqlite-project-reopen' }
    document.querySelector('[data-activity="desk"]')?.click()
    if (!await window.__coreWait(() => document.querySelector('[data-testid="manuscript-input"]'))) return { ok: false, step: 'editor-open' }
    const first = Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent.includes('雨夜追迹'))
    if (first && !first.classList.contains('selected')) first.click()
    if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
    if (!await window.__coreWait(() => document.querySelector('[data-testid="writing-agent-input"]'))) return { ok: false, step: 'assistant-open' }
    window.__coreBefore = await window.novelDesktop.chapters.get(1)
    if (!window.__coreBefore.content.trim() || !window.__coreBefore.bodyVersionId) return { ok: false, step: 'nonempty-sqlite-fixture-required' }
    if (!await window.__coreWait(() => Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent).join('\\n') === window.__coreBefore.content)) return { ok: false, step: 'fixture-rendered' }
    // A mounted editor can still be inert behind the real archive loader.
    // Wait for lifecycle completion, not just a DOM node or a fixed delay.
    if (!await window.__coreWait(() => !document.querySelector('.app-frame[inert]') && !document.querySelector('[data-testid="workspace-loading"]'), 30000)) return { ok: false, step: 'workspace-not-interactive' }
    return { ok: true, step: 'ready' }
  })()`)
  if (!setup.ok) return setup
  window.focus()
  window.webContents.focus()
  const editorPoint = await window.webContents.executeJavaScript(`(() => {
    const editor = document.querySelector('[data-testid="manuscript-input"]')
    const line = editor?.querySelector('.cm-line')
    const r = (line || editor)?.getBoundingClientRect()
    if (!r) return null
    const x = r.left + Math.min(20, r.width / 2), y = r.top + r.height / 2
    return { x, y, hit: editor.contains(document.elementFromPoint(x, y)) }
  })()`)
  if (!editorPoint?.hit) return { ok: false, step: 'editor-native-hit', editorPoint }
  const zoom = window.webContents.getZoomFactor()
  window.webContents.sendInputEvent({ type:'mouseDown', x:Math.round(editorPoint.x * zoom), y:Math.round(editorPoint.y * zoom), button:'left', clickCount:1 })
  window.webContents.sendInputEvent({ type:'mouseUp', x:Math.round(editorPoint.x * zoom), y:Math.round(editorPoint.y * zoom), button:'left', clickCount:1 })
  if (!await window.webContents.executeJavaScript(`window.__coreWait(() => document.activeElement?.getAttribute('data-testid') === 'manuscript-input')`)) return { ok:false, step:'editor-native-focus' }
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['control', 'shift'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['control', 'shift'] })
  await new Promise(resolve => setTimeout(resolve, 180))
  const requestedRun = window.webContents.executeJavaScript(`(async () => {
    try {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const selection = window.getSelection()?.toString() || ''
    if (!selection.trim() || selection !== window.__coreBefore.content) return { ok: false, step: 'native-selection', selected: selection, expected: window.__coreBefore.content }
    document.querySelector('[data-testid="open-agent-skills"]')?.click()
    if (!await window.__coreWait(() => document.querySelector('.agent-skill-menu'))) return { ok: false, step: 'skill-menu' }
    const rewrite = Array.from(document.querySelectorAll('.agent-skill-menu button')).find(button => button.textContent.includes('改写'))
    if (!rewrite) return { ok: false, step: 'rewrite-action' }
    rewrite.click()
    await wait(120)
    if (!document.querySelector('.agent-selection-state.ready')) return { ok: false, step: 'selection-lost-at-skill-menu', state: document.querySelector('.agent-selection-state')?.textContent }
    const input = document.querySelector('[data-testid="writing-agent-input"]')
    input.value = '核心写作闭环烟测：改写选段，保留人物姓名。'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (!await window.__coreWait(() => { const send = document.querySelector('[data-testid="run-writing-agent"]'); return send && !send.disabled })) return { ok: false, step: 'send-ready', notice: document.querySelector('.toast')?.textContent }
    document.querySelector('[data-testid="run-writing-agent"]').click()
    if (!await window.__coreWait(() => document.querySelector('.agent-diff-block'), 30000)) return { ok: false, step: 'diff-preview', tasks: (await window.novelDesktop.ai.listWritingAgentTasks(1)).map(task => ({ id: task.id, status: task.status, skill: task.skill, error: task.error })) }
    const unchanged = (await window.novelDesktop.chapters.get(1)).content === window.__coreBefore.content
    if (!unchanged) return { ok: false, step: 'candidate-wrote-before-approval' }
    if (!await window.__coreWait(() => { const accept = document.querySelector('[data-testid^="accept-all-agent-diff-"]'); return accept && !accept.disabled })) return { ok: false, step: 'diff-ready', panel: document.querySelector('.assistant-panel')?.textContent }
    document.querySelector('[data-testid="agent-diff-bulk"] > summary')?.click()
    document.querySelector('[data-testid^="accept-all-agent-diff-"]').click()
    await window.__coreWait(() => { const apply = document.querySelector('[data-testid^="apply-agent-candidate-"]'); return apply && !apply.disabled })
    const apply = document.querySelector('[data-testid^="apply-agent-candidate-"]')
    if (!apply || apply.disabled) return { ok: false, step: 'apply-ready' }
    apply.click()
    if (!await window.__coreWait(async () => (await window.novelDesktop.chapters.get(1)).content.includes('沈砚把铜铃放入衣袋'))) return { ok: false, step: 'explicit-version-save', saved: await window.novelDesktop.chapters.get(1) }
    const saved = await window.novelDesktop.chapters.get(1)
    const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
    const task = tasks.find(item => item.message.includes('核心写作闭环烟测'))
    const revisions = await window.novelDesktop.chapters.revisions(1)
    // Public history IDs retain the timestamp-UUID format used by restoreRevision.
    const original = revisions.find(item => item.id.endsWith('-' + window.__coreBefore.bodyVersionId))
    const current = revisions.find(item => item.id.endsWith('-' + saved.bodyVersionId))
    const historyPreserved = original?.content === window.__coreBefore.content && current?.content === saved.content && current?.reason === 'ai' && current?.isCurrent === true
    const expected = '　　沈砚把铜铃放入衣袋。\\n\\n　　沈砚站在石桥边，等待桥下回应。'
    return { ok: saved.content === expected && historyPreserved && saved.bodyVersionId !== window.__coreBefore.bodyVersionId && task?.status === 'succeeded', step: 'native-selection-ai-diff-saved', historyPreserved, bodyVersionId: saved.bodyVersionId, previousBodyVersionId: window.__coreBefore.bodyVersionId, taskId: task?.id }
    } catch (error) {
      return { ok: false, step: 'rewrite-driver-exception', error: error?.stack || error?.message || String(error) }
    }
  })()`)
  const requested = await Promise.race([
    requestedRun,
    new Promise(resolve => setTimeout(() => resolve({ ok: false, step: 'core-driver-timeout', phase: 'rewrite-run-unreturned' }), 120_000))
  ])
  if (!requested.ok) return requested
  const factsRun = window.webContents.executeJavaScript(`(async () => {
    const api = window.novelDesktop
    const approvedValue = '铜铃（已收入衣袋）'
    const deferredValue = '留在桥边等候回应'
    const saved = await api.chapters.get(1)
    document.querySelector('[data-testid="assistant-mode-checks"]').click()
    if (!await window.__coreWait(() => {
      const button = document.querySelector('.fact-extraction-action button')
      return button && !button.disabled && button.textContent.includes('确认正文并提炼')
    })) return { ok: false, step: 'confirm-and-extract-ready' }
    document.querySelector('.fact-extraction-action button').click()
    if (!await window.__coreWait(() => document.querySelectorAll('[data-testid="fact-review-change"]').length === 2, 30000)) return { ok: false, step: 'extracted-fact-candidates', jobs: await api.workspace.listFactExtractionJobs(1), notice: document.querySelector('.toast')?.textContent }
    const planning = await api.chapters.getPlanning(1)
    const batch = (await api.workspace.listFactBatches(1))[0]
    // Confirmation explicitly persists the editor; bind extraction to that resulting version.
    const confirmed = await api.chapters.get(1)
    if (confirmed.content !== saved.content || planning.confirmedBodyVersionId !== confirmed.bodyVersionId || batch?.bodyVersionId !== confirmed.bodyVersionId || batch.changes.some(item => item.decisionStatus !== 'PENDING')) return { ok: false, step: 'fact-source-version', planning, batch }
    const items = Array.from(document.querySelectorAll('[data-testid="fact-review-change"]'))
    const approved = items.find(item => item.textContent.includes(approvedValue))
    const deferred = items.find(item => item.textContent.includes(deferredValue))
    if (!approved || !deferred) return { ok: false, step: 'fact-items' }
    approved.querySelector('[data-testid="fact-review-approve"]').click()
    deferred.querySelector('[data-testid="fact-review-defer"]').click()
    if ((await api.workspace.listFactBatches(1))[0].changes.some(item => item.decisionStatus !== 'PENDING')) return { ok: false, step: 'facts-written-before-submit' }
    if (!await window.__coreWait(() => { const button = document.querySelector('[data-testid="fact-review-submit"]'); return button && !button.disabled })) return { ok: false, step: 'facts-submit-ready' }
    const submit = document.querySelector('[data-testid="fact-review-submit"]')
    submit.scrollIntoView({ block: 'center' })
    submit.click()
    if (!await window.__coreWait(async () => (await api.workspace.listFactBatches(1))[0]?.status === 'PARTIALLY_APPROVED')) return { ok: false, step: 'facts-partial-approval' }
    const decided = (await api.workspace.listFactBatches(1))[0]
    if (decided.changes.filter(item => item.decisionStatus === 'APPROVED').length !== 1 || decided.changes.filter(item => item.decisionStatus === 'DEFERRED').length !== 1) return { ok: false, step: 'facts-decisions', decided }
    if ((await api.chapters.get(1)).bodyVersionId !== confirmed.bodyVersionId) return { ok: false, step: 'facts-mutated-body' }
    const beforeChapters = await api.chapters.list()
    document.querySelector('[data-testid="archive-new-chapter"]').click()
    if (!await window.__coreWait(async () => (await api.chapters.list()).length === beforeChapters.length + 1)) return { ok: false, step: 'next-chapter-created' }
    const next = (await api.chapters.list()).find(chapter => !beforeChapters.some(before => before.id === chapter.id))
    if (!next || next.content !== '') return { ok: false, step: 'next-chapter-empty' }
    if (!await window.__coreWait(() => document.querySelector('.tree-item.selected')?.textContent.includes('第' + next.position + '章'))) return { ok: false, step: 'next-chapter-selected', next }
    const pack = await api.workspace.getContextFactPack(next.id)
    const formalFacts = JSON.stringify(pack.structured.approvedFacts)
    if (!formalFacts.includes(approvedValue) || formalFacts.includes(deferredValue)) return { ok: false, step: 'next-chapter-approved-facts', pack }
    document.querySelector('[data-testid="assistant-mode-agent"]').click()
    document.querySelector('[aria-label="取消指定操作"]')?.click()
    const input = document.querySelector('[data-testid="writing-agent-input"]')
    input.value = '核心承接核验：请讨论本章可以依据的已确认人物变化，不要生成正文。'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (!await window.__coreWait(() => { const send = document.querySelector('[data-testid="run-writing-agent"]'); return send && !send.disabled })) return { ok: false, step: 'next-chapter-send-ready' }
    document.querySelector('[data-testid="run-writing-agent"]').click()
    if (!await window.__coreWait(async () => (await api.ai.listWritingAgentTasks(next.id)).some(task => task.message.includes('核心承接核验') && task.status === 'succeeded'), 30000)) return { ok: false, step: 'next-chapter-model-request', tasks: (await api.ai.listWritingAgentTasks(next.id)).map(task => ({ id: task.id, status: task.status, skill: task.skill, error: task.error })) }
    if (!await window.__coreWait(() => document.querySelector('.agent-answer-text')?.textContent.includes('已核对作者批准的随身物品'))) return { ok: false, step: 'next-chapter-answer-visible' }
    if ((await api.chapters.get(next.id)).content !== '' || (await api.chapters.get(1)).bodyVersionId !== confirmed.bodyVersionId) return { ok: false, step: 'readonly-discussion-mutated-body' }
    let hierarchyStep = 'total-status'
    try {
      const totalStatus = await api.outlines.planningStatus(next.id)
      if (totalStatus.totalReview.status === 'attention') { hierarchyStep = 'total-acknowledge'; await api.outlines.acknowledgeReview('total') }
      const acknowledged = await api.outlines.planningStatus(next.id)
      if (acknowledged.totalApproval.status !== 'confirmed') { hierarchyStep = 'total-confirm'; await api.outlines.confirmPlanning('total') }
      let hierarchy = await api.outlines.planningStatus(next.id)
      if (!hierarchy.volumes.length) { hierarchyStep = 'volume-create'; await api.outlines.createVolume('渡口回声') }
      hierarchy = await api.outlines.planningStatus(next.id)
      if (hierarchy.totalReview.status === 'attention') { hierarchyStep = 'post-volume-total-acknowledge'; await api.outlines.acknowledgeReview('total') }
      hierarchy = await api.outlines.planningStatus(next.id)
      if (hierarchy.totalApproval.status !== 'confirmed') { hierarchyStep = 'post-volume-total-confirm'; await api.outlines.confirmPlanning('total') }
      hierarchyStep = 'volume-update'
      await api.outlines.update(1, '第一卷围绕沈砚从石桥追查回声到河对岸展开；他依靠已经收入衣袋的铜铃辨认方向，最终找到渡口的新水痕。')
      hierarchy = await api.outlines.planningStatus(next.id)
      if (hierarchy.volumes[0]?.review.status === 'attention') { hierarchyStep = 'volume-acknowledge'; await api.outlines.acknowledgeReview(1) }
      hierarchy = await api.outlines.planningStatus(next.id)
      if (hierarchy.volumes[0]?.approval.status !== 'confirmed') { hierarchyStep = 'volume-confirm'; await api.outlines.confirmPlanning(1) }
      hierarchyStep = 'chapter-place'
      await api.outlines.placeChapter(next.id, 1)
      hierarchy = await api.outlines.planningStatus(next.id)
      if (hierarchy.totalReview.status === 'attention') { hierarchyStep = 'post-placement-total-acknowledge'; await api.outlines.acknowledgeReview('total') }
      hierarchy = await api.outlines.planningStatus(next.id)
      if (hierarchy.totalApproval.status !== 'confirmed') { hierarchyStep = 'post-placement-total-confirm'; await api.outlines.confirmPlanning('total') }
      hierarchy = await api.outlines.planningStatus(next.id)
      if (hierarchy.volumes[0]?.review.status === 'attention') { hierarchyStep = 'post-placement-volume-acknowledge'; await api.outlines.acknowledgeReview(1) }
      hierarchy = await api.outlines.planningStatus(next.id)
      if (hierarchy.volumes[0]?.approval.status !== 'confirmed') { hierarchyStep = 'post-placement-volume-confirm'; await api.outlines.confirmPlanning(1) }
    } catch (error) {
      return { ok: false, step: 'hierarchy-' + hierarchyStep, error: error?.message || String(error), code: error?.code || '', details: error?.details || null }
    }
    const nextOutline = [
      '进入状态：沈砚离开石桥，确认随身带着铜铃，但尚未找到回声来源',
      '1. 目标：追查回声；人物：沈砚；地点：晨雾渡口；事件：循声找到空船；结果：发现船板上的新水痕',
      '2. 目标：确认线索；人物：沈砚；地点：渡口；事件：检查水痕与铜铃反应；结果：确定回声来自河对岸',
      '退出状态：沈砚站在渡口，决定乘船前往河对岸',
      '允许扩写：晨雾环境；沈砚的动作与吐槽；不改变事实的船夫对白',
      '伏笔：推进｜铜铃接近河水时发出微弱回响',
      '禁止：提前揭示河对岸的幕后人物'
    ].join('\\n')
    await api.chapterOutlines.update(next.id, nextOutline)
    const review = await api.outlines.reviewChapter(next.id)
    if (!review.canConfirm) return { ok: false, step: 'next-outline-review', review }
    const confirmedOutline = await api.outlines.confirmChapter(next.id)
    if (confirmedOutline.chapter?.review.status !== 'confirmed') return { ok: false, step: 'next-outline-confirm', confirmedOutline }
    // Hierarchy setup above is deliberately via the public API. Re-select the
    // chapter so the renderer refreshes its chapter-card fingerprint before AI.
    const firstTree = Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent.includes('雨夜追迹'))
    firstTree?.click()
    if (!await window.__coreWait(() => document.querySelector('.tree-item.selected')?.textContent.includes('雨夜追迹'))) return { ok: false, step: 'refresh-first-chapter' }
    const nextTree = Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent.includes('第' + next.position + '章'))
    nextTree?.click()
    if (!await window.__coreWait(() => document.querySelector('.tree-item.selected')?.textContent.includes('第' + next.position + '章'))) return { ok: false, step: 'refresh-next-chapter' }
    const beforeGeneration = await api.chapters.get(next.id)
    document.querySelector('[data-testid="assistant-mode-agent"]').click()
    const input2 = document.querySelector('[data-testid="writing-agent-input"]')
    input2.value = '核心跨章续写烟测：按照已确认章纲续写本章，保留网文节奏和人物反应。'
    input2.dispatchEvent(new Event('input', { bubbles: true }))
    if (!await window.__coreWait(() => { const send = document.querySelector('[data-testid="run-writing-agent"]'); return send && !send.disabled })) return { ok: false, step: 'next-prose-send-ready' }
    document.querySelector('[data-testid="run-writing-agent"]').click()
    if (!await window.__coreWait(async () => (await api.ai.listWritingAgentTasks(next.id)).some(task => task.message.includes('核心跨章续写烟测') && task.status === 'succeeded'), 30000)) return { ok: false, step: 'next-prose-model-request', tasks: (await api.ai.listWritingAgentTasks(next.id)).map(task => ({ id: task.id, status: task.status, skill: task.skill, error: task.error })) }
    if ((await api.chapters.get(next.id)).content !== beforeGeneration.content) return { ok: false, step: 'next-prose-wrote-before-approval' }
    if (!await window.__coreWait(() => Array.from(document.querySelectorAll('[data-testid^="accept-all-agent-diff-"]')).at(-1))) return { ok: false, step: 'next-prose-candidate-visible' }
    const check = Array.from(document.querySelectorAll('[data-testid^="agent-candidate-check-"]')).at(-1)
    const retryPreparation = Array.from(document.querySelectorAll('[data-testid^="prepare-agent-candidate-retry-"]')).at(-1)
    if (!check?.classList.contains('attention') || !check.textContent.includes('需要处理') || !check.textContent.includes('最低完整度要求') || !retryPreparation) {
      return { ok: false, step: 'failed-candidate-guidance-visible', check: check?.textContent || '', hasRetryPreparation: Boolean(retryPreparation) }
    }
    retryPreparation.click()
    if (!await window.__coreWait(() => document.querySelector('[data-testid="writing-agent-input"]')?.value.includes('请修正上一份候选的检查问题'))) {
      return { ok: false, step: 'failed-candidate-retry-prepared', value: document.querySelector('[data-testid="writing-agent-input"]')?.value || '' }
    }
    if ((await api.chapters.get(next.id)).content !== beforeGeneration.content) return { ok: false, step: 'retry-preparation-mutated-body' }
    return { ok: true, step: 'next-prose-candidate-ready', batchId: decided.id, nextChapterId: next.id, confirmedBodyVersionId: confirmed.bodyVersionId }
  })()`)
  const facts = await Promise.race([
    factsRun,
    new Promise(resolve => setTimeout(() => resolve({ ok: false, step: 'core-driver-timeout', phase: 'facts-and-next-prose-run-unreturned' }), 120_000))
  ])
  if (!facts.ok) return { ...facts, rewrite: requested }
  const scheduleUiClick = async (selector: string) => {
    const token = `core-click-${Date.now()}-${Math.random()}`
    return window.webContents.executeJavaScript(`(() => { const button = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).at(-1); if (!button) return false; const token = ${JSON.stringify(token)}; const click = event => { if (event.source !== window || event.data !== token) return; window.removeEventListener('message', click); button.click() }; window.addEventListener('message', click); window.postMessage(token, '*'); return true })()`)
  }
  await window.webContents.executeJavaScript(`(() => { const button = Array.from(document.querySelectorAll('[data-testid^="accept-all-agent-diff-"]')).at(-1); if (!button) return false; const details = button.closest('details'); if (details && !details.open) details.querySelector('summary').click(); button.scrollIntoView({ block: 'center', inline: 'nearest' }); return true })()`)
  await new Promise(resolve => setTimeout(resolve, 600))
  const acceptState = await window.webContents.executeJavaScript(`(() => { const button = Array.from(document.querySelectorAll('[data-testid^="accept-all-agent-diff-"]')).at(-1); return { ok: Boolean(button && !button.disabled), disabled: button?.disabled, testId: button?.dataset.testid } })()`)
  if (!acceptState.ok) return { ok: false, step: 'next-prose-accept-target', acceptState, rewrite: requested }
  if (!await scheduleUiClick('[data-testid^="accept-all-agent-diff-"]')) return { ok: false, step: 'next-prose-accept-schedule', rewrite: requested }
  await new Promise(resolve => setTimeout(resolve, 500))
  const applyState = await window.webContents.executeJavaScript(`(() => { const button = Array.from(document.querySelectorAll('[data-testid^="apply-agent-candidate-"]')).at(-1); return { ok: Boolean(button && !button.disabled), step: button ? 'next-prose-apply-ready' : 'next-prose-apply-missing', testId: button?.dataset.testid } })()`)
  if (!applyState.ok) return { ...applyState, rewrite: requested }
  // The intentionally short smoke candidate triggers the product's author
  // override confirmation; record the affirmative test choice explicitly.
  await window.webContents.executeJavaScript(`window.confirm = () => true; true`)
  if (!await scheduleUiClick('[data-testid^="apply-agent-candidate-"]')) return { ok: false, step: 'next-prose-apply-schedule', rewrite: requested }
  await new Promise(resolve => setTimeout(resolve, 500))
  let generated: unknown = null
  for (let attempt = 0; attempt < 100; attempt += 1) {
    generated = await window.webContents.executeJavaScript(`window.novelDesktop.chapters.get(${facts.nextChapterId})`)
    if ((generated as { content?: string }).content?.includes('晨雾中的渡口')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const verified = await window.webContents.executeJavaScript(`(async () => { const generated = await window.novelDesktop.chapters.get(${facts.nextChapterId}); const revisions = await window.novelDesktop.chapters.revisions(${facts.nextChapterId}); const history = revisions.find(item => item.id.endsWith('-' + generated.bodyVersionId)); return { content: generated.content, mirrorStatus: generated.mirrorStatus, bodyVersionId: generated.bodyVersionId, historyReason: history?.reason, firstBodyVersionId: (await window.novelDesktop.chapters.get(1)).bodyVersionId } })()`)
  return { ok: verified.content === '　　沈砚摸到衣袋里的铜铃，顺着桥下回声望向晨雾中的渡口。' && verified.mirrorStatus === 'synced' && verified.historyReason === 'ai' && verified.firstBodyVersionId === facts.confirmedBodyVersionId, step: 'confirmed-body-facts-partial-approval-next-context-and-prose', batchId: facts.batchId, nextChapterId: facts.nextChapterId, approved: 1, deferred: 1, generatedBodyVersionId: verified.bodyVersionId, rewrite: requested }
}
