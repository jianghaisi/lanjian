import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

// Uses the isolated smoke project and real IPC/SQLite; no live provider or user book.
export async function runFactGuidanceSmoke(window: BrowserWindow, capturePath?: string): Promise<{ ok: boolean; step: string }> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('fact guidance reload timeout')), 15000)
    window.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve() })
    window.webContents.reload()
  })
  const prepared = await window.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async read => { for (let i = 0; i < 150; i++) { const result = await read(); if (result) return result; await wait(80) }; throw new Error('fact guidance condition timed out') }
    const click = async selector => {
      const el = await until(() => { const item = document.querySelector(selector); return item && !item.disabled && item.checkVisibility() ? item : null })
      el.scrollIntoView({ block: 'center' }); await wait(80)
      if (!el.getBoundingClientRect().height || el.disabled) throw new Error('action unavailable: ' + selector)
      el.click(); await wait(120); return el
    }
    window.__factUntil = until; window.__factClick = click
    if (!document.querySelector('[aria-label="书稿"]')) {
      const open = await until(() => Array.from(document.querySelectorAll('.work-item-open')).find(el => el.getAttribute('aria-label')?.includes('烟测书稿')))
      open.click()
    }
    await click('[aria-label="书稿"]')
    await until(() => document.querySelector('[data-testid="manuscript-input"]'))
    window.__factBefore = await window.novelDesktop.chapters.get(1)
    await click('[data-testid="open-writing-guidance"]')
    const panel = await until(() => document.querySelector('[data-testid="fact-review-panel"]'))
    const batchId = panel.querySelector('[data-batch-id]').dataset.batchId
    const readChange = async () => (await window.novelDesktop.workspace.listFactBatches(1)).find(batch => batch.id === batchId).changes.find(change => change.predicate === 'location')
    window.__factReadChange = readChange
    if (!panel.querySelector('[data-testid="fact-review-instructions"]') || panel.querySelector('[data-testid="fact-review-bulk"]').open || panel.querySelector('.fact-review-more').open) return { ok: false, step: 'guidance-or-progressive-disclosure' }
    await click('[data-testid="fact-review-approve"]')
    await until(() => panel.querySelector('[data-testid="fact-review-unsaved-choice"]'))
    if ((await readChange()).decisionStatus !== 'PENDING' || !panel.querySelector('[data-testid="fact-review-submit-hint"]').textContent.includes('记住 1 条')) return { ok: false, step: 'selection-prematurely-persisted-or-summary-wrong' }
    await click('.fact-review-more > summary')
    await click('[data-testid="fact-review-edit"]')
    if (!panel.querySelector('[data-testid="fact-review-submit"]').disabled) return { ok: false, step: 'unfinished-edit-can-submit' }
    await click('[data-testid="fact-review-clear"]')
    if (panel.querySelector('[data-testid="fact-review-unsaved-choice"]') || (await readChange()).decisionStatus !== 'PENDING') return { ok: false, step: 'clear-saved-or-left-selection' }
    await click('[data-testid="fact-review-continue"]')
    await until(() => document.querySelector('[data-testid="assistant-mode-agent"]')?.classList.contains('active') || !document.querySelector('[data-testid="fact-review-panel"]')?.checkVisibility())
    await click('[data-testid="open-writing-guidance"]')
    await click('[data-testid="fact-review-defer"]')
    await click('[data-testid="fact-review-submit"]')
    await until(async () => (await readChange()).decisionStatus === 'DEFERRED')
    await until(() => !panel.querySelector('[data-testid="fact-review-unsaved-choice"]'))
    if (!panel.textContent.includes('已留待稍后')) return { ok: false, step: 'saved-defer-status-missing' }
    const more = panel.querySelector('.fact-review-more')
    if (!more.open) await click('.fact-review-more > summary')
    await click('[data-testid="fact-review-edit"]')
    const input = panel.querySelector('[data-testid="fact-review-edit-input"]')
    input.value = '临江酒馆后门'; input.dispatchEvent(new Event('input', { bubbles: true }))
    await click('[data-testid="fact-review-save-edit"]')
    if ((await readChange()).decisionStatus !== 'DEFERRED') return { ok: false, step: 'edit-prematurely-persisted' }
    more.querySelector('summary').click()
    panel.scrollIntoView({ block: 'start' }); await wait(180)
    const submitRect = panel.querySelector('[data-testid="fact-review-submit"]').getBoundingClientRect()
    const sidebarRect = document.querySelector('[data-testid="assistant-sidebar"]').getBoundingClientRect()
    if (submitRect.top < sidebarRect.top || submitRect.bottom > sidebarRect.bottom || submitRect.height <= 0) return { ok: false, step: 'save-action-out-of-view' }
    await wait(2500)
    return { ok: true, step: 'selection-clear-exit-defer-edit-verified' }
  })()`)
  if (!prepared.ok) return prepared
  if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
  return window.webContents.executeJavaScript(`(async () => {
    await window.__factClick('[data-testid="fact-review-submit"]')
    await window.__factUntil(async () => (await window.__factReadChange()).decisionStatus === 'APPROVED')
    await window.__factUntil(() => document.querySelector('[data-testid="fact-review-empty"]'))
    const fact = await window.__factReadChange()
    const after = await window.novelDesktop.chapters.get(1)
    const approved = await window.novelDesktop.workspace.approvedFactsBefore(2)
    const ok = JSON.parse(fact.editedObjectJson) === '临江酒馆后门'
      && approved.some(item => JSON.parse(item.objectJson) === '临江酒馆后门')
      && after.content === window.__factBefore.content && after.revision === window.__factBefore.revision
    return { ok, step: 'fact-guidance-saved-only-on-confirm', manuscriptUnchanged: after.content === window.__factBefore.content }
  })()`)
}
