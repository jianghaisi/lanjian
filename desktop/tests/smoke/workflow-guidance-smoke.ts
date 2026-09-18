import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

export async function runWorkflowGuidanceSmoke(window: BrowserWindow, capturePath?: string): Promise<{ ok: boolean; step: string }> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('guidance reload timeout')), 15000)
    window.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve() })
    window.webContents.reload()
  })
  const prepared = await window.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async read => { for (let i = 0; i < 150; i++) { const result = await read(); if (result) return result; await wait(80) }; return null }
    const click = async selector => { const el = await until(() => document.querySelector(selector)); if (!el) throw new Error(selector); el.click(); await wait(120); return el }
    window.__guidanceUntil = until
    window.__guidanceClick = click
    if (!document.querySelector('[aria-label="书稿"]')) {
      const open = await until(() => Array.from(document.querySelectorAll('.work-item-open')).find(el => el.getAttribute('aria-label')?.includes('烟测书稿')))
      open?.click()
    }
    await click('[aria-label="书稿"]')
    await until(() => document.querySelector('[data-testid="manuscript-input"]'))
    const before = await window.novelDesktop.chapters.get(1)
    if (!before.content.trim()) return { ok: false, step: 'fixture-empty' }
    window.__guidanceBefore = before
    await click('[data-testid="open-writing-guidance"]')
    const next = await until(() => document.querySelector('[data-testid="consistency-next-step"]'))
    if (!next?.querySelector('button') || !next.textContent.trim()) return { ok: false, step: 'next-action-missing' }
    const nextRect = next.querySelector('button').getBoundingClientRect()
    const sidebarRect = document.querySelector('[data-testid="assistant-sidebar"]').getBoundingClientRect()
    if (nextRect.top < sidebarRect.top || nextRect.bottom > sidebarRect.bottom || nextRect.width <= 0) return { ok: false, step: 'next-action-out-of-view' }
    await click('[data-consistency-id="characterState"]')
    await until(() => document.querySelector('.conflict-resolution-actions'))
    const help = document.querySelector('[data-testid="conflict-help"]')
    const locate = document.querySelector('[data-testid="locate-continuity-evidence"]')
    const decisions = document.querySelector('.conflict-resolution-actions')
    if (!help || locate?.textContent.trim() !== '去正文修改' || !decisions?.textContent.includes('原文没问题，这是误报')) return { ok: false, step: 'conflict-guidance-missing' }
    decisions.scrollIntoView({ block: 'center' })
    await wait(150)
    const rect = locate.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.bottom > innerHeight) return { ok: false, step: 'primary-action-clipped' }
    return { ok: true, step: 'conflict-actions-visible' }
  })()`)
  if (!prepared.ok) return prepared
  if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
  const result = await window.webContents.executeJavaScript(`(async () => {
    const until = window.__guidanceUntil
    const click = window.__guidanceClick
    await click('[aria-label="关闭人物冲突案卷"]')
    await click('[data-testid="open-writing-guidance"]')
    await click('[data-consistency-id="characterState"]')
    if (!await until(() => document.querySelector('[data-testid="locate-continuity-evidence"]'))) return { ok: false, step: 'close-lost-conflict' }
    await click('[data-testid="locate-continuity-evidence"]')
    const located = await until(() => !document.querySelector('.character-conflict-docket') && document.querySelector('.manuscript-find input[aria-label="查找正文"]')?.value)
    if (!located || !window.__guidanceBefore.content.includes(located)) return { ok: false, step: 'evidence-navigation-failed' }
    await click('[data-testid="open-writing-guidance"]')
    await click('[data-consistency-id="characterState"]')
    const ignored = await until(() => Array.from(document.querySelectorAll('.conflict-main-actions button')).find(el => el.textContent.trim() === '原文没问题，这是误报'))
    if (!ignored) return { ok: false, step: 'ignore-action-missing' }
    ignored.click()
    const removed = await until(() => document.querySelector('.character-conflict-empty'))
    const after = await window.novelDesktop.chapters.get(1)
    const states = await window.novelDesktop.workspace.getCharacterState()
    const pending = states.pendingConflicts.filter(item => item.status === 'pending')
    const projection = await window.novelDesktop.workspace.getChapterProjection(1)
    const currentFindings = projection.consistency?.items.find(item => item.id === 'characterState')?.findings || []
    const unresolved = currentFindings.filter(item => !item.findingStatus || ['open', 'accepted'].includes(item.findingStatus))
    if (!removed || unresolved.length || projection.consistency.items.find(item => item.id === 'characterState').status !== 'ready') return { ok: false, step: 'ignore-not-persisted-or-warning-still-shown' }
    // Reopen the fixture finding to exercise the independent intentional-plot path.
    const ignoredFinding = currentFindings.find(item => item.findingStatus === 'ignored')
    if (!ignoredFinding?.findingId) return { ok: false, step: 'ignored-finding-missing' }
    await window.novelDesktop.workspace.decideConsistencyFinding({ findingId: ignoredFinding.findingId, decision: 'accepted' })
    await click('.character-conflict-footer button:first-child')
    await click('.conflict-other-actions summary')
    await click('[data-testid="open-conflict-exception"]')
    const reasonInput = document.querySelector('[data-testid="conflict-exception-reason"]')
    const confirmException = document.querySelector('[data-testid="save-conflict-exception"]')
    if (!reasonInput || !confirmException?.disabled) return { ok: false, step: 'exception-empty-reason-not-guarded' }
    reasonInput.value = '这是角色有意隐瞒身份，后文会揭示真相。'
    reasonInput.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => !confirmException.disabled)
    confirmException.click()
    if (!await until(() => document.querySelector('.character-conflict-empty'))) return { ok: false, step: 'exception-save-failed' }
    const decidedProjection = await window.novelDesktop.workspace.getChapterProjection(1)
    const decidedItem = decidedProjection.consistency.items.find(item => item.id === 'characterState')
    const decided = decidedItem.findings.find(item => item.findingId === ignoredFinding.findingId)
    const finalChapter = await window.novelDesktop.chapters.get(1)
    return { ok: Boolean(decided?.findingStatus === 'exception' && decidedItem.status === 'ready' && after.content === window.__guidanceBefore.content && after.revision === window.__guidanceBefore.revision && finalChapter.revision === after.revision), step: 'close-reopen-locate-ignore-and-exception', manuscriptUnchanged: finalChapter.content === window.__guidanceBefore.content, pendingLegacy: pending.length, unresolved: unresolved.length, exceptionSaved: decided?.findingStatus === 'exception' }
  })()`)
  if (result.ok && capturePath) {
    const navigation = await window.webContents.executeJavaScript(`(async () => {
      const click = window.__guidanceClick
      const until = window.__guidanceUntil
      await click('.character-conflict-footer button:last-child')
      await click('[aria-label="谋篇"]')
      const guide = await until(() => document.querySelector('[data-testid="workflow-next-step"]'))
      const nextButton = guide?.querySelector(':scope > button')
      if (!nextButton || nextButton.disabled) return false
      nextButton.click()
      await new Promise(resolve => setTimeout(resolve, 200))
      await click('[aria-label="书稿"]')
      await click('[data-testid="open-writing-guidance"]')
      return Boolean(await until(() => document.querySelector('[data-testid="consistency-next-step"]')))
    })()`)
    if (!navigation) return { ok: false, step: 'preparation-next-action-missing' }
    await writeFile(capturePath.replace('workflow-conflict-guidance.png', 'workflow-next-step.png'), (await window.capturePage()).toPNG())
  }
  return result
}
