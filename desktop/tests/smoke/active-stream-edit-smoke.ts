import type { BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

const sourceText = '第一处旧句。\n\n中段锚点保持原样。\n\n第二处旧句。'
const authorAddition = '作者等待期间新增的段落。'

async function reload(window: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const loaded = () => { clearTimeout(timeout); resolve() }
    const timeout = setTimeout(() => {
      window.webContents.removeListener('did-finish-load', loaded)
      reject(new Error('Active stream edit renderer reload timed out'))
    }, 15_000)
    window.webContents.once('did-finish-load', loaded)
    window.webContents.reload()
  })
}

/** Proves native manuscript editing remains safe while the model stream is still active. */
export async function runActiveStreamEditSmoke(
  window: BrowserWindow,
  modelUrl: string,
  projectPath: string,
  capturePath?: string
): Promise<SmokeResult> {
  const mirrorPath = join(projectPath, '正文', '第1章-雨夜追迹.md')
  if (await readFile(mirrorPath, 'utf8') !== sourceText) return { ok: false, step: 'active-stream-seed-mismatch' }

  const configured = await window.webContents.executeJavaScript(`(async () => {
    try {
      localStorage.setItem('lanjian-opening-enabled', 'false')
      sessionStorage.setItem('lanjian-opening-seen', 'true')
      const settings = await window.novelDesktop.ai.getSettings()
      await window.novelDesktop.ai.updateSettings({
        baseUrl: ${JSON.stringify(modelUrl)},
        apiKey: 'isolated-active-stream-key',
        routingMode: 'shared',
        shared: { ...settings.shared, model: 'gemini-smoke-model' }
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, step: 'active-stream-model-config', error: error?.stack || error?.message || String(error) }
    }
  })()`)
  if (!configured.ok) return configured
  console.info('[active stream smoke] model configured')
  await reload(window)
  console.info('[active stream smoke] renderer reloaded')

  const setup = await window.webContents.executeJavaScript(`(async () => {
    try {
      const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
      window.__activeStreamWait = async (predicate, timeoutMs = 15000) => {
        const deadline = Date.now() + timeoutMs
        do { if (await predicate()) return true; await wait() } while (Date.now() < deadline)
        return false
      }
      let opened = false
      if (!await window.__activeStreamWait(() => {
        if (document.querySelector('.activitybar [data-activity="desk"]')) return true
        const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
        if (book && !opened) { opened = true; book.click() }
        return false
      })) return { ok: false, step: 'active-stream-project-reopen' }
      document.querySelector('.activitybar [data-activity="desk"]')?.click()
      if (!await window.__activeStreamWait(() => document.querySelector('[data-testid="manuscript-input"]'))) return { ok: false, step: 'active-stream-editor-open' }
      const first = Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent?.includes('雨夜追迹'))
      if (first && !first.classList.contains('selected')) first.click()
      if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
      document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
      if (!await window.__activeStreamWait(() => document.querySelector('[data-testid="writing-agent-input"]'))) return { ok: false, step: 'active-stream-assistant-open' }
      window.__activeStreamBefore = await window.novelDesktop.chapters.get(1)
      window.__activeStreamRevisions = await window.novelDesktop.chapters.revisions(1)
      const rendered = Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent).join('\\n')
      if (window.__activeStreamBefore.content !== ${JSON.stringify(sourceText)} || rendered !== ${JSON.stringify(sourceText)}) {
        return { ok: false, step: 'active-stream-fixture-not-rendered', stored: window.__activeStreamBefore.content, rendered }
      }
      document.querySelector('[data-testid="manuscript-input"]')?.focus()
      return { ok: true }
    } catch (error) {
      return { ok: false, step: 'active-stream-setup-exception', error: error?.stack || error?.message || String(error) }
    }
  })()`)
  if (!setup.ok) return setup
  console.info('[active stream smoke] editor and assistant ready')

  window.focus()
  window.webContents.focus()
  await new Promise(resolve => setTimeout(resolve, 120))
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['shift'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['shift'] })

  const streaming = await window.webContents.executeJavaScript(`(async () => {
    const selection = window.getSelection()?.toString() || ''
    if (selection !== '第一处旧句。') return { ok: false, step: 'active-stream-native-selection', selection }
    document.querySelector('[data-testid="open-agent-skills"]')?.click()
    if (!await window.__activeStreamWait(() => document.querySelector('.agent-skill-menu'))) return { ok: false, step: 'active-stream-skill-menu' }
    const rewrite = Array.from(document.querySelectorAll('.agent-skill-menu button')).find(button => button.textContent?.includes('改写'))
    if (!rewrite) return { ok: false, step: 'active-stream-rewrite-action' }
    rewrite.click()
    const input = document.querySelector('[data-testid="writing-agent-input"]')
    input.value = '边写边等烟测：只改写第一句。'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (!await window.__activeStreamWait(() => {
      const send = document.querySelector('[data-testid="run-writing-agent"]')
      return send && !send.disabled
    })) return { ok: false, step: 'active-stream-send-disabled' }
    document.querySelector('[data-testid="run-writing-agent"]')?.click()
    if (!await window.__activeStreamWait(async () => {
      const task = (await window.novelDesktop.ai.listWritingAgentTasks(1)).find(item => item.message.includes('边写边等烟测'))
      return task?.status === 'streaming' && document.querySelector('[data-testid="writing-agent-stream-preview"]')?.textContent?.includes('第一处新句。')
    }, 15000)) return { ok: false, step: 'active-stream-preview-missing', tasks: await window.novelDesktop.ai.listWritingAgentTasks(1) }
    return { ok: true, step: 'active-stream-model-still-running' }
  })()`)
  if (!streaming.ok) return streaming
  console.info('[active stream smoke] model stream active')

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="manuscript-input"]')?.focus()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['control'] })
  await window.webContents.insertText(`\n\n${authorAddition}`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control'] })
  console.info('[active stream smoke] native author edit submitted')

  const merged = await window.webContents.executeJavaScript(`(async () => {
    try {
    if (!await window.__activeStreamWait(async () => {
      const chapter = await window.novelDesktop.chapters.get(1)
      const task = (await window.novelDesktop.ai.listWritingAgentTasks(1)).find(item => item.message.includes('边写边等烟测'))
      return chapter.content.includes(${JSON.stringify(authorAddition)}) && task?.status === 'streaming'
    })) return { ok: false, step: 'active-stream-author-edit-not-saved-while-streaming', chapter: await window.novelDesktop.chapters.get(1), tasks: await window.novelDesktop.ai.listWritingAgentTasks(1) }
    const authorVersion = await window.novelDesktop.chapters.get(1)
    if (!await window.__activeStreamWait(() => document.querySelectorAll('.agent-diff-block').length === 1, 30000)) {
      return { ok: false, step: 'active-stream-candidate-missing', tasks: await window.novelDesktop.ai.listWritingAgentTasks(1) }
    }
    const block = document.querySelector('.agent-diff-block')
    if (!block.textContent.includes('第一处旧句') || !block.textContent.includes('第一处新句')) return { ok: false, step: 'active-stream-diff-content', text: block.textContent }
    const accept = Array.from(block.querySelectorAll('footer button')).find(button => button.textContent?.includes('接受修改'))
    if (!accept) return { ok: false, step: 'active-stream-accept-missing' }
    accept.click()
    await new Promise(resolve => setTimeout(resolve, 120))
    const apply = document.querySelector('[data-testid^="apply-agent-candidate-"]')
    if (!apply || apply.disabled || !apply.textContent.includes('合并核对')) return { ok: false, step: 'active-stream-rebase-action', text: apply?.textContent, disabled: apply?.disabled }
    apply.click()
    const rebaseTrace = []
    const rebaseDeadline = Date.now() + 15000
    let rebaseOpened = false
    while (Date.now() < rebaseDeadline) {
      const dialog = document.querySelector('[data-testid="writing-rebase-dialog"]')
      const state = {
        elapsedMs: 15000 - (rebaseDeadline - Date.now()),
        dialogExists: Boolean(dialog),
        dialogOpen: Boolean(dialog?.open),
        assistantOpen: Boolean(document.querySelector('.assistant-panel')),
        applyConnected: Boolean(apply.isConnected),
        applyText: document.querySelector('[data-testid^="apply-agent-candidate-"]')?.textContent || '',
        saveState: document.querySelector('[data-testid="manuscript-save-state"]')?.textContent || '',
        notices: Array.from(document.querySelectorAll('[role="status"], .toast, .notice')).map(item => item.textContent).filter(Boolean).slice(-8)
      }
      const prior = rebaseTrace[rebaseTrace.length - 1]
      if (!prior || JSON.stringify({ ...prior, elapsedMs: 0 }) !== JSON.stringify({ ...state, elapsedMs: 0 })) rebaseTrace.push(state)
      if (dialog?.open) { rebaseOpened = true; break }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!rebaseOpened) return {
      ok: false,
      step: 'active-stream-rebase-dialog',
      applyText: document.querySelector('[data-testid^="apply-agent-candidate-"]')?.textContent,
      notices: Array.from(document.querySelectorAll('[role="status"], .toast, .notice')).map(item => item.textContent).filter(Boolean).slice(-8),
      rebaseTrace,
      taskStatus: (await window.novelDesktop.ai.listWritingAgentTasks(1)).find(item => item.message.includes('边写边等烟测'))?.status,
      chapterContent: (await window.novelDesktop.chapters.get(1)).content
    }
    if (document.querySelectorAll('.writing-rebase-dialog input[value="current"]').length) return { ok: false, step: 'active-stream-unexpected-conflict' }
    const proposed = document.querySelector('[data-testid="rebase-result"]')?.textContent || ''
    if (!proposed.includes('第一处新句。') || !proposed.includes('中段锚点保持原样。') || !proposed.includes('第二处旧句。') || !proposed.includes(${JSON.stringify(authorAddition)})) {
      return { ok: false, step: 'active-stream-rebase-preview-content', proposed }
    }
    document.querySelector('[data-testid="confirm-writing-rebase"]')?.click()
    if (!await window.__activeStreamWait(async () => {
      const chapter = await window.novelDesktop.chapters.get(1)
      return chapter.content.includes('第一处新句。') && chapter.content.includes(${JSON.stringify(authorAddition)})
    }, 15000)) return { ok: false, step: 'active-stream-merge-save-timeout', chapter: await window.novelDesktop.chapters.get(1) }
    const chapter = await window.novelDesktop.chapters.get(1)
    const revisions = await window.novelDesktop.chapters.revisions(1)
    const task = (await window.novelDesktop.ai.listWritingAgentTasks(1)).find(item => item.message.includes('边写边等烟测'))
    return {
      ok: chapter.bodyVersionId !== authorVersion.bodyVersionId
        && revisions.some(item => item.content === authorVersion.content)
        && task?.artifact?.status === 'applied',
      step: 'active-stream-edit-rebased',
      content: chapter.content,
      authorVersionPreserved: revisions.some(item => item.content === authorVersion.content),
      artifactStatus: task?.artifact?.status,
      revisionCount: revisions.length
    }
    } catch (error) {
      return { ok: false, step: 'active-stream-browser-exception', error: error?.message || String(error), stack: error?.stack || '' }
    }
  })()`)
  if (!merged.ok) {
    if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
    return merged
  }
  console.info('[active stream smoke] candidate merged')
  if (await readFile(mirrorPath, 'utf8') !== merged.content) return { ok: false, step: 'active-stream-mirror-mismatch', merged }

  await reload(window)
  console.info('[active stream smoke] merged manuscript reload started')
  const reopened = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
    for (let index = 0; index < 150 && !document.querySelector('.activitybar [data-activity="desk"]'); index += 1) {
      const book = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
      book?.click(); await wait()
    }
    document.querySelector('.activitybar [data-activity="desk"]')?.click()
    for (let index = 0; index < 150 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait()
    const first = Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent?.includes('雨夜追迹'))
    if (first && !first.classList.contains('selected')) first.click()
    for (let index = 0; index < 150; index += 1) {
      const rendered = Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent).join('\\n')
      if (rendered.includes('第一处新句。') && rendered.includes(${JSON.stringify(authorAddition)})) return { ok: true, rendered }
      await wait()
    }
    return { ok: false, step: 'active-stream-reopen-timeout' }
  })()`)
  if (!reopened.ok) return reopened
  console.info('[active stream smoke] merged manuscript reopened')
  if (capturePath) await writeFile(capturePath.replace(/\.png$/i, '-active-stream-edit.png'), (await window.capturePage()).toPNG())
  return { ok: true, step: 'active-stream-native-edit-merged-and-reopened', revisionCount: merged.revisionCount, mirrorMatches: true }
}
