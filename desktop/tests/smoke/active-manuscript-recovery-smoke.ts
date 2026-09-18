import type { BrowserWindow } from 'electron'

type SmokeResult = {
  ok: boolean
  step: string
  [key: string]: unknown
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function press(
  window: BrowserWindow,
  keyCode: string,
  modifiers: NonNullable<Electron.InputEvent['modifiers']> = []
): Promise<void> {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  if (keyCode.toUpperCase() === 'ENTER') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  await wait(40)
}

async function reload(window: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('renderer reload timed out')), 15_000)
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timeout)
      resolve()
    })
    window.webContents.reload()
  })
}

export async function runActiveManuscriptRecoverySmoke(window: BrowserWindow): Promise<SmokeResult> {
  console.info('[active recovery smoke] configure short merge window')
  // This fixture verifies enabled guides; never depend on the product default
  // or change an author's preferences to satisfy an assertion.
  await window.webContents.executeJavaScript(`localStorage.setItem('lanjian-editor-guide-lines', 'true')`)
  const originalProfile = await window.webContents.executeJavaScript('window.novelDesktop.workspace.getBookProfile()')
  await window.webContents.executeJavaScript(`window.novelDesktop.workspace.saveBookProfile(${JSON.stringify({
    ...originalProfile,
    autosaveEnabled: true,
    autosaveDelayMs: 3_000,
    autosaveMergeWindowMs: 1_000
  })})`)
  await reload(window)
  console.info('[active recovery smoke] renderer reloaded with test autosave profile')

  const opened = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    let workItemClicked = false
    for (let attempt = 0; attempt < 120; attempt++) {
      document.querySelector('.opening-screen > button')?.click()
      const item = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
      if (item && !workItemClicked) { workItemClicked = true; item.click() }
      const desk = document.querySelector('[aria-label="书稿"]')
      if (desk) desk.click()
      const row = Array.from(document.querySelectorAll('.chapter-tree-row[type="button"]'))
        .find(button => button.querySelector('.chapter-no')?.textContent?.trim() === '第1章')
      if (row) row.click()
      if (document.querySelector('[data-testid="manuscript-input"]')) return true
      await wait(100)
    }
    return false
  })()`)
  if (!opened) return { ok: false, step: 'open-manuscript-editor' }
  console.info('[active recovery smoke] manuscript editor opened')

  await window.webContents.executeJavaScript('document.querySelector("[data-testid=manuscript-input]").focus()')
  await press(window, 'a', ['control'])
  const baselineText = '　　正文恢复烟测基线。'
  await window.webContents.insertText(baselineText)
  await press(window, 's', ['control'])
  let baseline = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
  for (let attempt = 0; attempt < 100 && baseline.content !== baselineText; attempt++) {
    await wait(50)
    baseline = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
  }
  if (baseline.content !== baselineText) return { ok: false, step: 'save-editor-baseline', baseline: baseline.content }
  await window.webContents.executeJavaScript('document.querySelector("[data-testid=manuscript-input]").focus()')
  await press(window, 'END', ['control'])
  const firstAppend = '\n\n第一段自动保存检查点。'
  const secondAppend = '继续输入三个字。'
  await window.webContents.insertText(firstAppend)

  const staged = await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = document.querySelector('[data-testid="manuscript-save-state"]')
      if (state?.classList.contains('checkpoint')) return { ok: true, label: state.textContent || '' }
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    return {
      ok: false,
      profile: await window.novelDesktop.workspace.getBookProfile(),
      chapters: await window.novelDesktop.chapters.list(),
      recoveries: await window.novelDesktop.chapters.autosaveRecoveries(),
      localDrafts: JSON.parse(localStorage.getItem('lanjian.manuscript-recovery.v1') || '{}').drafts || [],
      editor: Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent || '').join('\\n'),
      activeRow: document.querySelector('.chapter-tree-row.active')?.textContent || ''
    }
  })()`)
  if (!staged.ok) return { ok: false, step: 'first-checkpoint-not-staged', ...staged }
  console.info('[active recovery smoke] first checkpoint is staged')

  await window.webContents.executeJavaScript(`(() => {
    window.__activeRecoveryModalAppeared = Boolean(document.querySelector('[data-testid="manuscript-recovery-dialog"]'))
    window.__activeRecoveryObserver = new MutationObserver(() => {
      if (document.querySelector('[data-testid="manuscript-recovery-dialog"]')) window.__activeRecoveryModalAppeared = true
    })
    window.__activeRecoveryObserver.observe(document.body, { childList: true, subtree: true })
    document.querySelector('[data-testid="manuscript-input"]').focus()
  })()`)
  console.info('[active recovery smoke] modal observer installed')
  await press(window, 'END', ['control'])
  await window.webContents.insertText(secondAppend)
  console.info('[active recovery smoke] newer text entered while older checkpoint is staged')

  const firstCheckpointContent = baseline.content + firstAppend
  await wait(1_350)
  const finalizedWithoutInterruption = await window.webContents.executeJavaScript(`(() => {
    const active = ${JSON.stringify(baseline.content + firstAppend + secondAppend)}
    window.__activeRecoveryObserver?.disconnect()
    const editor = Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent || '').join('\\n')
    const local = (JSON.parse(localStorage.getItem('lanjian.manuscript-recovery.v1') || '{}').drafts || []).find(item => item.chapterId === 1)
    return {
      ok: editor === active
        && local?.content === active
        && !window.__activeRecoveryModalAppeared
        && !document.querySelector('[data-testid="manuscript-recovery-dialog"]'),
      editor,
      local: local?.content || '',
      modalAppeared: Boolean(window.__activeRecoveryModalAppeared)
    }
  })()`)
  const formalAfterFinalize = await window.webContents.executeJavaScript('window.novelDesktop.chapters.get(1)')
  finalizedWithoutInterruption.formal = formalAfterFinalize.content
  finalizedWithoutInterruption.ok = finalizedWithoutInterruption.ok && formalAfterFinalize.content === firstCheckpointContent
  if (!finalizedWithoutInterruption.ok) return { ok: false, step: 'active-editor-was-interrupted', ...finalizedWithoutInterruption }
  console.info('[active recovery smoke] older checkpoint finalized without modal interruption')

  await reload(window)
  console.info('[active recovery smoke] renderer reloaded with newer local snapshot retained')
  const restored = await window.webContents.executeJavaScript(`(async () => {
    const expected = ${JSON.stringify(baseline.content + firstAppend + secondAppend)}
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    let workItemClicked = false
    for (let attempt = 0; attempt < 120; attempt++) {
      document.querySelector('.opening-screen > button')?.click()
      const item = Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿'))
      if (item && !workItemClicked) { workItemClicked = true; item.click() }
      const dialog = document.querySelector('[data-testid="manuscript-recovery-dialog"]')
      const restore = dialog?.querySelector('.restore-action')
      if (restore) {
        // DOM presence and .click() alone can pass behind a blank overlay.
        // Wait for the actual dialog animation, then verify visible hit targets.
        await wait(300)
        restore.scrollIntoView({ block: 'nearest' })
        const painted = await Promise.race([
          new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
          wait(2_000).then(() => false)
        ])
        if (!painted) return { ok: false, dialogShown: true, reason: 'recovery-frame-not-painted', visibility: document.visibilityState, focused: document.hasFocus() }
        const rect = restore.getBoundingClientRect()
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        const dialogStyle = getComputedStyle(dialog)
        if (restore.disabled || rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.bottom > innerHeight
          || dialogStyle.visibility !== 'visible' || Number(dialogStyle.opacity) < 0.95
          || !target || !(target === restore || restore.contains(target))) {
          return { ok: false, dialogShown: true, reason: 'recovery-action-not-visible-or-blocked', opacity: dialogStyle.opacity, visibility: dialogStyle.visibility, buttonBounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
        }
        restore.click()
        for (let settle = 0; settle < 100; settle++) {
          const chapter = await window.novelDesktop.chapters.get(1)
          if (chapter.content === expected && !document.querySelector('[data-testid="manuscript-recovery-dialog"]')) {
            const drafts = JSON.parse(localStorage.getItem('lanjian.manuscript-recovery.v1') || '{}').drafts || []
            return { ok: !drafts.some(item => item.chapterId === 1), dialogShown: true, content: chapter.content }
          }
          await wait(50)
        }
        return { ok: false, dialogShown: true, reason: 'restore-did-not-settle' }
      }
      await wait(100)
    }
    return { ok: false, dialogShown: false, reason: 'recovery-dialog-missing' }
  })()`)
  if (!restored.ok) return { ok: false, step: 'reload-recovery', ...restored }
  console.info('[active recovery smoke] reload dialog restored the newer text')
  await window.webContents.executeJavaScript('document.querySelector("[data-testid=manuscript-input]").focus()')
  await press(window, 'END', ['control'])
  const contextTail = '\n\n' + Array.from({ length: 80 }, (_, index) => `　　第${index + 1}段用于保留光标上方的写作上下文。`).join('\n\n')
  await window.webContents.insertText(contextTail)
  await press(window, 'ENTER')
  await wait(300)
  const caretComfort = await window.webContents.executeJavaScript(`(() => {
    const content = document.querySelector('[data-testid="manuscript-input"]')
    const scroller = content?.closest('.cm-scroller')
    const lines = content ? Array.from(content.querySelectorAll('.cm-line')) : []
    const caretLine = lines.at(-1)
    if (!content || !scroller || !caretLine) return { ok: false, reason: 'caret-line-missing' }
    const viewport = scroller.getBoundingClientRect()
    const caret = caretLine.getBoundingClientRect()
    const expectedMargin = Math.min(240, Math.max(96, scroller.clientHeight * 0.28))
    const bottomClearance = viewport.bottom - caret.bottom
    const text = lines.map(line => line.textContent || '').join('\\n')
    return {
      ok: caret.top >= viewport.top
        && caret.bottom <= viewport.bottom
        && bottomClearance >= expectedMargin - 28
        && text.endsWith('\\n\\n　　')
        && !document.querySelector('[aria-label="正文字号"]')
        && !document.querySelector('[aria-label="缩小正文字号"]')
        && !document.querySelector('[aria-label="放大正文字号"]'),
      bottomClearance,
      expectedMargin,
      enterCreatedIndentedParagraph: text.endsWith('\\n\\n　　'),
      duplicateSizeControls: Boolean(document.querySelector('[aria-label="正文字号"], [aria-label="缩小正文字号"], [aria-label="放大正文字号"]'))
    }
  })()`)
  if (!caretComfort.ok) return { ok: false, step: 'comfortable-caret-and-enter', ...caretComfort }
  console.info('[active recovery smoke] Enter keeps an indented paragraph and visible context below the caret')
  const chapterStartsAtTop = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const row = (chapterNumber) => Array.from(document.querySelectorAll('.chapter-tree-row'))
      .find(button => button.querySelector('.chapter-no')?.textContent?.trim() === '第' + chapterNumber + '章')
    const second = row(2)
    if (!second) return { ok: false, reason: 'second-chapter-missing' }
    second.click()
    for (let attempt = 0; attempt < 120 && !row(2)?.classList.contains('selected'); attempt++) await wait(50)
    const first = row(1)
    if (!first || !row(2)?.classList.contains('selected')) return { ok: false, reason: 'second-chapter-not-selected' }
    first.click()
    for (let attempt = 0; attempt < 120 && !row(1)?.classList.contains('selected'); attempt++) await wait(50)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const content = document.querySelector('[data-testid="manuscript-input"]')
    const scroller = content?.closest('.cm-scroller')
    if (!content || !scroller || !row(1)?.classList.contains('selected')) return { ok: false, reason: 'first-chapter-not-selected' }
    content.focus()
    await new Promise(resolve => requestAnimationFrame(resolve))
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(content)
    const selectionInside = Boolean(selection?.anchorNode && content.contains(selection.anchorNode))
    if (selectionInside) range.setEnd(selection.anchorNode, selection.anchorOffset)
    const caretOffset = selectionInside ? range.toString().length : -1
    return {
      ok: scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop <= 1 && caretOffset === 0,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      caretOffset
    }
  })()`)
  if (!chapterStartsAtTop.ok) return { ok: false, step: 'chapter-switch-starts-at-top', ...chapterStartsAtTop }
  console.info('[active recovery smoke] switching away and back opens the chapter at its first character')
  const ruledLines = await window.webContents.executeJavaScript(`(async () => {
    const content = document.querySelector('[data-testid="manuscript-input"].cm-content')
    const focus = Array.from(document.querySelectorAll('.writing-toolbar button')).find(button => button.textContent?.trim() === '专注')
    if (!content || !focus) return { ok: false, reason: 'ruled-line-target-missing' }
    const normal = getComputedStyle(content).backgroundImage
    focus.click()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const focused = getComputedStyle(content).backgroundImage
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return {
      ok: normal !== 'none' && normal.includes('linear-gradient') && focused === normal,
      normal,
      focused
    }
  })()`)
  if (!ruledLines.ok) return { ok: false, step: 'ruled-lines-normal-and-focus', ...ruledLines }
  console.info('[active recovery smoke] ruled lines remain visible in normal and focus modes')
  const originalBounds = window.getBounds()
  window.setSize(1_100, 700)
  await wait(250)
  let compactLayout: SmokeResult
  try {
    compactLayout = await window.webContents.executeJavaScript(`(async () => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const studio = document.querySelector('.studio')
      const focusButton = Array.from(document.querySelectorAll('.writing-toolbar button')).find(button => button.textContent?.trim() === '专注')
      if (!studio || !focusButton) return { ok: false, step: 'compact-layout-target-missing' }
      if (!studio.classList.contains('writing-focus')) { focusButton.click(); await settle() }
      const helpButton = Array.from(document.querySelectorAll('.writing-toolbar button')).find(button => button.textContent?.trim() === '助笔')
      if (!document.querySelector('[data-testid="assistant-sidebar"]')) { helpButton?.click(); await settle() }
      const measure = () => {
        const workbench = document.querySelector('.workbench')?.getBoundingClientRect()
        const page = document.querySelector('.manuscript-page')?.getBoundingClientRect()
        const assistant = document.querySelector('[data-testid="assistant-sidebar"]')?.getBoundingClientRect()
        const content = document.querySelector('[data-testid="manuscript-input"].cm-content')
        if (!workbench || !page || !assistant || !content) return null
        return {
          workbench: { left: workbench.left, right: workbench.right, width: workbench.width },
          page: { left: page.left, right: page.right, width: page.width },
          assistant: { left: assistant.left, right: assistant.right, width: assistant.width },
          ruled: getComputedStyle(content).backgroundImage !== 'none',
          separated: workbench.right <= assistant.left + 1 && page.right <= workbench.right + 1 && page.left >= workbench.left - 1
        }
      }
      const focused = measure()
      focusButton.click()
      await settle()
      const normal = measure()
      return {
        ok: Boolean(focused?.separated && focused.ruled && focused.page.width >= 600 && focused.assistant.width >= 280
          && normal?.separated && normal.ruled && normal.workbench.width >= 420
          && normal.page.width >= normal.workbench.width - 32 && normal.assistant.width >= 280),
        step: 'compact-sidebar-layout',
        viewport: { width: innerWidth, height: innerHeight },
        focused,
        normal
      }
    })()`)
  } finally {
    window.setBounds(originalBounds)
    await wait(180)
  }
  if (!compactLayout.ok) return compactLayout
  console.info('[active recovery smoke] compact normal/focus layouts keep the assistant beside the manuscript')
  return {
    ok: true,
    step: 'active-snapshot-hidden-and-reload-recovered',
    activeModalAppeared: false,
    reloadDialogShown: restored.dialogShown,
    recoveredCharacters: secondAppend.length,
    caretBottomClearance: caretComfort.bottomClearance,
    duplicateSizeControls: caretComfort.duplicateSizeControls,
    chapterSwitchScrollTop: chapterStartsAtTop.scrollTop,
    chapterSwitchCaretOffset: chapterStartsAtTop.caretOffset,
    ruledLinesVisible: ruledLines.ok,
    compactLayout: compactLayout.step
  }
}
