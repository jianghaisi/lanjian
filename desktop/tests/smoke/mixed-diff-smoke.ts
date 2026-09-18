import type { BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

const sourceText = '第一处旧句。\n\n中段锚点保持原样。\n\n第二处旧句。'
const expectedText = '　　第一处新句。\n\n　　中段锚点保持原样。\n\n　　第二处旧句。'

async function reload(window: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const loaded = () => { clearTimeout(timeout); resolve() }
    const timeout = setTimeout(() => {
      window.webContents.removeListener('did-finish-load', loaded)
      reject(new Error('Mixed diff renderer reload timed out'))
    }, 15_000)
    window.webContents.once('did-finish-load', loaded)
    window.webContents.reload()
  })
}

/** Focused UI proof for accepting one diff block while retaining another. */
export async function runMixedDiffSmoke(
  window: BrowserWindow,
  modelUrl: string,
  projectPath: string,
  capturePath?: string
): Promise<SmokeResult> {
  const mirrorPath = join(projectPath, '正文', '第1章-雨夜追迹.md')
  const mirrorBefore = await readFile(mirrorPath, 'utf8')
  if (mirrorBefore !== sourceText) return { ok: false, step: 'mixed-diff-seed-mismatch', mirrorBefore }

  const configured = await window.webContents.executeJavaScript(`(async () => {
    try {
      localStorage.setItem('lanjian-opening-enabled', 'false')
      sessionStorage.setItem('lanjian-opening-seen', 'true')
      const settings = await window.novelDesktop.ai.getSettings()
      await window.novelDesktop.ai.updateSettings({
        baseUrl: ${JSON.stringify(modelUrl)},
        apiKey: 'isolated-mixed-diff-key',
        routingMode: 'shared',
        shared: { ...settings.shared, model: 'gemini-smoke-model' }
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, step: 'mixed-diff-model-config', error: error?.stack || error?.message || String(error) }
    }
  })()`)
  if (!configured.ok) return configured
  await reload(window)

  const setup = await window.webContents.executeJavaScript(`(async () => {
    try {
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
    window.__mixedWait = async (predicate, timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs
      do { if (await predicate()) return true; await wait() } while (Date.now() < deadline)
      return false
    }
    let opened = false
    if (!await window.__mixedWait(() => {
      if (document.querySelector('.activitybar [data-activity="desk"]')) return true
      const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
      if (book && !opened) { opened = true; book.click() }
      return false
    })) return { ok: false, step: 'mixed-diff-project-reopen' }
    document.querySelector('.activitybar [data-activity="desk"]')?.click()
    if (!await window.__mixedWait(() => document.querySelector('[data-testid="manuscript-input"]'))) return { ok: false, step: 'mixed-diff-editor-open' }
    const first = Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent?.includes('雨夜追迹'))
    if (first && !first.classList.contains('selected')) first.click()
    if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
    document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
    if (!await window.__mixedWait(() => document.querySelector('[data-testid="writing-agent-input"]'))) return { ok: false, step: 'mixed-diff-assistant-open' }
    window.__mixedBefore = await window.novelDesktop.chapters.get(1)
    window.__mixedBeforeRevisions = await window.novelDesktop.chapters.revisions(1)
    const rendered = Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent).join('\\n')
    if (window.__mixedBefore.content !== ${JSON.stringify(sourceText)} || rendered !== ${JSON.stringify(sourceText)} || !window.__mixedBefore.bodyVersionId) {
      return { ok: false, step: 'mixed-diff-fixture-not-rendered', stored: window.__mixedBefore.content, rendered }
    }
    document.querySelector('[data-testid="manuscript-input"]')?.focus()
    return { ok: true, step: 'mixed-diff-ready', bodyVersionId: window.__mixedBefore.bodyVersionId, revisions: window.__mixedBeforeRevisions.length }
    } catch (error) {
      return { ok: false, step: 'mixed-diff-setup-exception', error: error?.stack || error?.message || String(error) }
    }
  })()`)
  if (!setup.ok) return setup

  window.focus()
  window.webContents.focus()
  await new Promise((resolve) => setTimeout(resolve, 120))
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['control', 'shift'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['control', 'shift'] })
  await new Promise((resolve) => setTimeout(resolve, 160))

  const preview = await window.webContents.executeJavaScript(`(async () => {
    try {
      const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
      const selection = window.getSelection()?.toString() || ''
      if (selection !== window.__mixedBefore.content) return { ok: false, step: 'mixed-diff-native-selection', selection, expected: window.__mixedBefore.content }
      document.querySelector('[data-testid="open-agent-skills"]')?.click()
      if (!await window.__mixedWait(() => document.querySelector('.agent-skill-menu'))) return { ok: false, step: 'mixed-diff-skill-menu' }
      const rewrite = Array.from(document.querySelectorAll('.agent-skill-menu button')).find(button => button.textContent?.includes('改写'))
      if (!rewrite) return { ok: false, step: 'mixed-diff-rewrite-action' }
      rewrite.click()
      await wait(100)
      if (!document.querySelector('.agent-selection-state.ready')) return { ok: false, step: 'mixed-diff-selection-lost' }
      const input = document.querySelector('[data-testid="writing-agent-input"]')
      input.value = '混合差异烟测：分别改写第一处和第二处，保持中段锚点逐字不变。'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      if (!await window.__mixedWait(() => {
        const send = document.querySelector('[data-testid="run-writing-agent"]')
        return send && !send.disabled
      })) return { ok: false, step: 'mixed-diff-send-disabled' }
      document.querySelector('[data-testid="run-writing-agent"]')?.click()
      if (!await window.__mixedWait(() => document.querySelectorAll('.agent-diff-block').length >= 2, 30000)) {
        return { ok: false, step: 'mixed-diff-blocks-missing', count: document.querySelectorAll('.agent-diff-block').length, tasks: await window.novelDesktop.ai.listWritingAgentTasks(1) }
      }
      const blocks = Array.from(document.querySelectorAll('.agent-diff-block'))
      if (blocks.length !== 2
        || !blocks[0].textContent?.includes('第一处旧句') || !blocks[0].textContent?.includes('第一处新句')
        || !blocks[1].textContent?.includes('第二处旧句') || !blocks[1].textContent?.includes('第二处新句')) {
        return { ok: false, step: 'mixed-diff-block-boundaries', count: blocks.length, blocks: blocks.map(block => block.textContent) }
      }
      const beforeApply = document.querySelector('[data-testid^="apply-agent-candidate-"]')
      if (!beforeApply || beforeApply.disabled || !beforeApply.textContent.includes('核对第 1 处')) return { ok: false, step: 'mixed-diff-next-action-missing' }
      if (document.querySelector('[data-testid="agent-diff-bulk"]').open) return { ok: false, step: 'mixed-diff-bulk-not-collapsed' }
      beforeApply.click()
      await wait(100)
      if (!blocks[0].contains(document.activeElement)) return { ok: false, step: 'mixed-diff-next-action-not-focused' }
      const focusRect = document.activeElement.getBoundingClientRect()
      const threadRect = document.querySelector('[data-testid="agent-thread"]').getBoundingClientRect()
      if (focusRect.top < threadRect.top || focusRect.bottom > threadRect.bottom) return { ok: false, step: 'mixed-diff-next-action-obscured' }
      const storedBeforeDecision = await window.novelDesktop.chapters.get(1)
      const revisionsBeforeDecision = await window.novelDesktop.chapters.revisions(1)
      const task = (await window.novelDesktop.ai.listWritingAgentTasks(1)).find(item => item.message.includes('混合差异烟测'))
      if (storedBeforeDecision.content !== window.__mixedBefore.content
        || storedBeforeDecision.bodyVersionId !== window.__mixedBefore.bodyVersionId
        || JSON.stringify(revisionsBeforeDecision) !== JSON.stringify(window.__mixedBeforeRevisions)
        || task?.status !== 'succeeded' || task.artifact?.status !== 'complete') {
        return {
          ok: false,
          step: 'mixed-diff-zero-write-before-decision',
          applyDisabled: beforeApply?.disabled,
          contentUnchanged: storedBeforeDecision.content === window.__mixedBefore.content,
          versionUnchanged: storedBeforeDecision.bodyVersionId === window.__mixedBefore.bodyVersionId,
          historyUnchanged: JSON.stringify(revisionsBeforeDecision) === JSON.stringify(window.__mixedBeforeRevisions),
          taskStatus: task?.status,
          artifactStatus: task?.artifact?.status
        }
      }
      const firstAccept = Array.from(blocks[0].querySelectorAll('footer button')).find(button => button.textContent?.includes('接受修改'))
      const secondKeep = Array.from(blocks[1].querySelectorAll('footer button')).find(button => button.textContent?.includes('保留原文'))
      if (!firstAccept || !secondKeep) return { ok: false, step: 'mixed-diff-per-block-actions-missing' }
      firstAccept.click()
      await wait(100)
      if (!beforeApply.textContent.includes('核对第 2 处')) return { ok: false, step: 'mixed-diff-next-index-not-updated' }
      beforeApply.click()
      await wait(100)
      if (!blocks[1].contains(document.activeElement)) return {
        ok: false, step: 'mixed-diff-second-action-not-focused',
        selectedChapter: document.querySelector('.tree-item.selected')?.textContent,
        blockConnected: blocks[1].isConnected,
        activeElement: document.activeElement?.tagName,
        activeLabel: document.activeElement?.getAttribute('aria-label'),
        documentFocused: document.hasFocus()
      }
      const secondRect = document.activeElement.getBoundingClientRect()
      if (secondRect.top < threadRect.top || secondRect.bottom > threadRect.bottom) return { ok: false, step: 'mixed-diff-second-action-obscured' }
      secondKeep.click()
      await wait(100)
      const apply = document.querySelector('[data-testid^="apply-agent-candidate-"]')
      const mixedState = blocks[0].classList.contains('accepted') && blocks[1].classList.contains('rejected')
      const bulkInactive = !document.querySelector('[data-testid^="accept-all-agent-diff-"]')?.classList.contains('active')
        && !document.querySelector('[data-testid^="reject-all-agent-diff-"]')?.classList.contains('active')
      const selectedChapter = await window.novelDesktop.chapters.get(1)
      if (selectedChapter.bodyVersionId !== storedBeforeDecision.bodyVersionId || selectedChapter.content !== storedBeforeDecision.content) return { ok: false, step: 'mixed-diff-selection-wrote-body' }
      apply.scrollIntoView({ block: 'end' })
      await wait(220)
      return {
        ok: Boolean(mixedState && bulkInactive && apply && !apply.disabled && apply.textContent?.includes('写入正文并保存') && document.querySelector('[data-testid="agent-candidate-guidance"]').textContent.includes('已选 1 处新文')),
        step: 'mixed-diff-one-accepted-one-retained',
        taskId: task.id,
        changeBlocks: blocks.length,
        mixedState,
        bulkInactive,
        applyText: apply?.textContent || '',
        bodyVersionId: storedBeforeDecision.bodyVersionId,
        revisionCount: revisionsBeforeDecision.length
      }
    } catch (error) {
      return { ok: false, step: 'mixed-diff-preview-exception', error: error?.stack || error?.message || String(error) }
    }
  })()`)
  const mirrorAfterPreview = await readFile(mirrorPath, 'utf8')
  if (!preview.ok || mirrorAfterPreview !== mirrorBefore) {
    if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
    return mirrorAfterPreview === mirrorBefore ? preview : { ok: false, step: 'mixed-diff-mirror-wrote-before-apply', preview, mirrorBefore, mirrorAfterPreview }
  }
  if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())

  if (process.env.LANJIAN_SMOKE_REBASE) return runRebaseSmoke(window, String(preview.taskId), mirrorPath, capturePath)

  const applied = await window.webContents.executeJavaScript(`(async () => {
    const apply = document.querySelector('[data-testid^="apply-agent-candidate-"]')
    if (!apply || apply.disabled) return { ok: false, step: 'mixed-diff-apply-not-ready' }
    apply.click()
    if (!await window.__mixedWait(async () => {
      const chapter = await window.novelDesktop.chapters.get(1)
      return chapter.content === ${JSON.stringify(expectedText)} && chapter.mirrorStatus === 'synced'
    }, 30000)) return { ok: false, step: 'mixed-diff-apply-save-timeout', chapter: await window.novelDesktop.chapters.get(1) }
    const chapter = await window.novelDesktop.chapters.get(1)
    const revisions = await window.novelDesktop.chapters.revisions(1)
    const original = revisions.find(item => item.id.endsWith('-' + window.__mixedBefore.bodyVersionId))
    const current = revisions.find(item => item.id.endsWith('-' + chapter.bodyVersionId))
    const task = (await window.novelDesktop.ai.listWritingAgentTasks(1)).find(item => item.id === ${JSON.stringify(String(preview.taskId))})
    return {
      ok: chapter.content === ${JSON.stringify(expectedText)}
        && chapter.bodyVersionId !== window.__mixedBefore.bodyVersionId
        && revisions.length === window.__mixedBeforeRevisions.length + 1
        && original?.content === window.__mixedBefore.content
        && current?.content === chapter.content && current?.reason === 'ai' && current?.isCurrent === true
        && task?.status === 'succeeded' && task.artifact?.status === 'applied',
      step: 'mixed-diff-applied-as-one-version',
      content: chapter.content,
      bodyVersionId: chapter.bodyVersionId,
      previousBodyVersionId: window.__mixedBefore.bodyVersionId,
      revisionCount: revisions.length,
      originalPreserved: original?.content === window.__mixedBefore.content,
      currentReason: current?.reason,
      currentIsCurrent: current?.isCurrent,
      taskStatus: task?.status,
      artifactStatus: task?.artifact?.status,
      mirrorStatus: chapter.mirrorStatus
    }
  })()`)
  if (!applied.ok) return { ...applied, preview }
  const mirrorAfterApply = await readFile(mirrorPath, 'utf8')
  if (mirrorAfterApply !== expectedText) return { ok: false, step: 'mixed-diff-mirror-mismatch', applied, mirrorAfterApply, expectedText }

  await reload(window)
  const reopened = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (predicate, attempts = 150) => {
      for (let index = 0; index < attempts; index += 1) { if (await predicate()) return true; await wait() }
      return false
    }
    let opened = false
    if (!await until(() => {
      if (document.querySelector('.activitybar [data-activity="desk"]')) return true
      const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
      if (book && !opened) { opened = true; book.click() }
      return false
    })) return { ok: false, step: 'mixed-diff-final-project-reopen' }
    document.querySelector('.activitybar [data-activity="desk"]')?.click()
    if (!await until(() => document.querySelector('[data-testid="manuscript-input"]'))) return { ok: false, step: 'mixed-diff-final-editor-open' }
    const first = Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent?.includes('雨夜追迹'))
    if (first && !first.classList.contains('selected')) first.click()
    if (!await until(() => Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent).join('\\n') === ${JSON.stringify(expectedText)})) {
      return { ok: false, step: 'mixed-diff-final-render-timeout', rendered: Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent).join('\\n') }
    }
    const chapter = await window.novelDesktop.chapters.get(1)
    const revisions = await window.novelDesktop.chapters.revisions(1)
    const task = (await window.novelDesktop.ai.listWritingAgentTasks(1)).find(item => item.id === ${JSON.stringify(String(preview.taskId))})
    if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
    document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
    await wait(180)
    return {
      ok: chapter.content === ${JSON.stringify(expectedText)}
        && chapter.bodyVersionId === ${JSON.stringify(String(applied.bodyVersionId))}
        && revisions.length === ${Number(applied.revisionCount)}
        && task?.artifact?.status === 'applied'
        && !document.querySelector('[data-testid^="apply-agent-candidate-"]'),
      step: 'mixed-diff-reopened-without-reapply',
      content: chapter.content,
      bodyVersionId: chapter.bodyVersionId,
      revisionCount: revisions.length,
      artifactStatus: task?.artifact?.status,
      applyActionVisible: Boolean(document.querySelector('[data-testid^="apply-agent-candidate-"]'))
    }
  })()`)
  if (!reopened.ok) return { ...reopened, preview, applied }
  if (capturePath) await writeFile(capturePath.replace(/\.png$/i, '-applied.png'), (await window.capturePage()).toPNG())
  return {
    ok: true,
    step: 'mixed-diff-zero-write-then-versioned-apply-and-reopen',
    changeBlocks: preview.changeBlocks,
    acceptedChanges: 1,
    retainedChanges: 1,
    previousBodyVersionId: applied.previousBodyVersionId,
    bodyVersionId: applied.bodyVersionId,
    revisionCount: applied.revisionCount,
    mirrorMatches: true,
    reopened: true
  }
}

async function runRebaseSmoke(window: BrowserWindow, taskId: string, mirrorPath: string, capturePath?: string): Promise<SmokeResult> {
  const conflict = process.env.LANJIAN_SMOKE_REBASE === 'conflict'
  const authorText = (conflict ? sourceText.replace('第一处旧句。', '作者重新写了第一句。') : sourceText) + '\n\n作者等待期间新增的段落。'
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="manuscript-input"]').focus()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
  await window.webContents.insertText(authorText)
  await new Promise(resolve => setTimeout(resolve, 150))
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control'] })
  const opened = await window.webContents.executeJavaScript(`(async () => {
    if (!await window.__mixedWait(async () => (await window.novelDesktop.chapters.get(1)).content.includes('作者等待期间新增的段落。'))) return {ok:false,step:'rebase-author-save'}
    const apply = document.querySelector('[data-testid^="apply-agent-candidate-"]')
    if (!apply || apply.disabled || !apply.textContent.includes('合并核对')) return {ok:false,step:'rebase-action',text:apply?.textContent,disabled:apply?.disabled}
    apply.click()
    if (!await window.__mixedWait(() => document.querySelector('[data-testid="writing-rebase-dialog"]')?.open)) return {ok:false,step:'rebase-dialog-open'}
    const before = await window.novelDesktop.chapters.get(1)
    document.querySelector('[aria-label="关闭合并核对"]').click()
    await new Promise(resolve => setTimeout(resolve, 100))
    if (document.querySelector('[data-testid="writing-rebase-dialog"]')) return {ok:false,step:'rebase-close'}
    if ((await window.novelDesktop.chapters.get(1)).bodyVersionId !== before.bodyVersionId) return {ok:false,step:'rebase-close-wrote'}
    apply.click()
    if (!await window.__mixedWait(() => document.querySelector('[data-testid="writing-rebase-dialog"]')?.open)) return {ok:false,step:'rebase-reopen'}
    const radios = [...document.querySelectorAll('.writing-rebase-dialog input[value="current"]')]
    if (${conflict} && !radios.length) return {ok:false,step:'rebase-conflict-not-visible'}
    if (radios.length && !document.querySelector('[data-testid="confirm-writing-rebase"]').disabled) return {ok:false,step:'rebase-undecided-enabled'}
    radios.forEach(radio => radio.click())
    await new Promise(resolve => setTimeout(resolve, 300))
    const proposed = document.querySelector('[data-testid="rebase-result"]').textContent
    const button = document.querySelector('[data-testid="confirm-writing-rebase"]')
    const rect = button.getBoundingClientRect()
    const dialogStyle = getComputedStyle(document.querySelector('[data-testid="writing-rebase-dialog"]'))
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (button.disabled || rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.left < 0
      || rect.bottom > innerHeight || rect.right > innerWidth
      || dialogStyle.visibility !== 'visible' || Number(dialogStyle.opacity) < 0.95
      || !hit || !button.contains(hit)) return {ok:false,step:'rebase-confirm-obscured',opacity:dialogStyle.opacity,hit:hit?.tagName}
    if (!proposed.includes('作者等待期间新增的段落。') || !proposed.includes('第二处旧句。')
      || !proposed.includes(${JSON.stringify(conflict ? '作者重新写了第一句。' : '第一处新句。')})) return {ok:false,step:'rebase-preview-content',proposed}
    return {ok:true,step:'rebase-preview',proposed,before:before.content,bodyVersionId:before.bodyVersionId,conflicts:radios.length}
  })()`)
  await new Promise(resolve => setTimeout(resolve, 250))
  const painted = await window.webContents.executeJavaScript(`(async () => {
    const ready = await Promise.race([
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
      new Promise(resolve => setTimeout(() => resolve(false), 2000))
    ])
    return {ok:ready,step:'rebase-preview-painted',visibility:document.visibilityState,focused:document.hasFocus()}
  })()`)
  if (capturePath) await writeFile(capturePath.replace(/\.png$/i, `-rebase-${conflict ? 'conflict' : 'independent'}.png`), (await window.capturePage()).toPNG())
  if (!opened.ok) return opened
  if (!painted.ok) return { ...painted, step: 'rebase-preview-not-painted' }
  const applied = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-testid="confirm-writing-rebase"]').click()
    if (!await window.__mixedWait(async () => (await window.novelDesktop.chapters.get(1)).content === ${JSON.stringify(opened.proposed)}, 15000)) return {ok:false,step:'rebase-save-timeout',chapter:await window.novelDesktop.chapters.get(1),text:document.body.innerText.slice(-2500)}
    const chapter = await window.novelDesktop.chapters.get(1)
    const history = await window.novelDesktop.chapters.revisions(1)
    const task = (await window.novelDesktop.ai.listWritingAgentTasks(1)).find(item => item.id === ${JSON.stringify(taskId)})
    return {ok: task.artifact?.status === 'applied' && history.some(item => item.content === ${JSON.stringify(opened.before)}) && chapter.bodyVersionId !== ${JSON.stringify(opened.bodyVersionId)},step:'rebase-saved',content:chapter.content}
  })()`)
  if (!applied.ok) return applied
  if (await readFile(mirrorPath, 'utf8') !== applied.content) return {ok:false,step:'rebase-mirror'}
  await reload(window)
  const persisted = await window.webContents.executeJavaScript(`window.novelDesktop.chapters.get(1)`)
  return {ok:persisted.content === applied.content,step:'rebase-preserves-author-edits-and-reopens',conflict,conflicts:opened.conflicts,mirrorMatches:true}
}
