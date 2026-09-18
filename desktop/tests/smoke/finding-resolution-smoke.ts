import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Chapter, ConsistencyFindingHistory } from '../../src/contracts/index'

/** Real controls + formal persistence, restricted to electron-smoke.mjs's temporary book. */
export async function runFindingResolutionSmoke(window: BrowserWindow, capturePath: string) {
  const checks: string[] = []
  const captures: string[] = []
  let stage = 'fixture'
  const evaluate = (source: string) => window.webContents.executeJavaScript(source)
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const deadline = async <T>(operation: Promise<T>, label: string, ms = 2000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })]) }
    finally { clearTimeout(timer) }
  }
  const wait = async (expression: string, label: string) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await evaluate(`(async()=>Boolean(${expression}))()`)) return
      await pause(50)
    }
    throw new Error(`finding-timeout:${label}`)
  }
  const paint = () => deadline(evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'), 'finding-not-painted')
  const click = async (selector: string) => {
    await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&!e.closest('[inert]')})()`, selector)
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,ok:r.width>0&&r.height>0&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&e.contains(document.elementFromPoint(x,y))}})()`)
    assert.ok(point.ok, `finding-control-obscured:${selector}`)
    // DOM/hit testing uses CSS px; Electron native input expects window DIP.
    const zoom = window.webContents.getZoomFactor()
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    await paint()
  }
  const capture = async (name: string) => {
    await pause(250)
    await paint()
    assert.ok(window.isVisible() && !window.isMinimized(), 'finding-capture-window-hidden')
    assert.equal(await evaluate('document.visibilityState'), 'visible')
    const file = `finding-resolution-${name}.png`
    const picture = await deadline(window.capturePage(), 'finding-capture-timeout', 5000)
    await writeFile(join(dirname(capturePath), file), picture.toPNG())
    captures.push(file)
  }
  const history = (): Promise<ConsistencyFindingHistory> => evaluate('(async()=> (await window.novelDesktop.workspace.getChapterProjection(1)).findingHistory)()')
  const chapter = (): Promise<Chapter> => evaluate('window.novelDesktop.chapters.get(1)')
  const reloadAndOpen = async () => {
    const loaded = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()))
    window.webContents.reload()
    await deadline(loaded, 'finding-reload-timeout', 15000)
    await wait(`document.querySelector('.project-library')`, 'library-after-reload')
    if (await evaluate(`Boolean(document.querySelector('[data-testid="app-boot-skip"]'))`)) await click('[data-testid="app-boot-skip"]')
    await wait(`!document.querySelector('[data-testid="app-boot-skip"]')`, 'boot-closed')
    await click('.work-item-open[aria-label*="烟测书稿"]')
    await wait(`document.querySelector('.activitybar')&&!document.querySelector('.app-frame[inert]')&&!document.querySelector('[data-testid="workspace-loading"]')`, 'workspace-ready')
    await click('.activitybar [data-activity="desk"]')
    await wait(`document.querySelector('[data-testid="manuscript-input"]')`, 'editor-ready')
  }
  const openHistory = async () => {
    await click('[data-testid="open-writing-guidance"]')
    await click('[data-consistency-id="characterState"]')
    await wait(`document.querySelector('[data-testid="finding-history"]')`, 'history-mounted')
    assert.equal(await evaluate(`document.querySelector('[data-testid="finding-history"]').open`), false, 'history must start collapsed')
    await click('[data-testid="finding-history"] > summary')
  }
  const originalThrottling = window.webContents.getBackgroundThrottling()
  let configured = false
  try {
    const project = await evaluate('window.novelDesktop.projects.status()')
    assert.equal(project?.project?.title, '烟测书稿')
    assert.ok(process.env.LANJIAN_USER_DATA_PATH && process.env.LANJIAN_SMOKE_CREATE_PARENT === process.env.LANJIAN_USER_DATA_PATH, 'temporary smoke profile required')
    window.webContents.setBackgroundThrottling(false)
    configured = true
    window.setSize(1440, 940)
    window.webContents.setZoomFactor(1)
    const repeated = '　　雨水顺着旧城墙往下淌，沈砚停在没有灯火的门洞里。'
    const duplicate = `${repeated}\n\n　　他听见远处有人敲了三下木鱼。\n\n${repeated}`
    const original = await chapter()
    await evaluate(`window.novelDesktop.chapters.update(1,${JSON.stringify({ content: duplicate, expectedRevision: original.revision })})`)
    const sourceHistory = await history()
    const finding = sourceHistory.entries.find(entry => entry.title.includes('重复段落'))
    assert.ok(finding, 'formal duplicate-paragraph finding required')
    assert.equal(finding.status, 'open')
    assert.equal(finding.sourceBodyVersionId, sourceHistory.bodyVersionId)
    checks.push('temporary formal manuscript creates a persisted duplicate-paragraph finding')

    stage = 'native-revision'
    await reloadAndOpen()
    await click('[data-testid="manuscript-input"]')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
    const corrected = `${repeated}\n\n　　他循着木鱼声走到街口，敲门人递来一封没有署名的信。\n\n　　檐下的灯亮了，守门人让出半步，示意他先进屋避雨。`
    await window.webContents.insertText(corrected)
    await click('[data-testid="save-manuscript"]')
    await wait(`(await window.novelDesktop.chapters.get(1)).content===${JSON.stringify(corrected)}`, 'exact-revision-saved')
    const saved = await chapter()
    const staleHistory = await history()
    const stale = staleHistory.entries.find(entry => entry.id === finding.id)
    assert.ok(stale)
    assert.equal(stale.status, 'stale')
    assert.notEqual(staleHistory.bodyVersionId, finding.sourceBodyVersionId)
    assert.equal(staleHistory.bodyVersionId, saved.bodyVersionId)
    checks.push('native revision and Save create a new body version while preserving the old stale finding')

    stage = 'cancel-confirmation'
    await openHistory()
    const card = `[data-finding-id="${finding.id}"]`
    await click(card + ' [data-testid="preview-finding-resolution"]')
    await wait(`document.querySelector('[data-testid="finding-resolution-preview"]')`, 'resolution-preview')
    await capture('preview')
    await click(card + ' .resolution-preview button[type="button"]')
    await wait(`!document.querySelector('[data-testid="finding-resolution-preview"]')`, 'preview-cancelled')
    assert.deepEqual((await history()).entries.find(entry => entry.id === finding.id), stale)
    assert.equal((await chapter()).content, corrected)
    assert.equal((await chapter()).bodyVersionId, saved.bodyVersionId)
    checks.push('real Cancel performs no finding decision and leaves exact prose and version unchanged')

    stage = 'compact-125-confirmation'
    window.setSize(1100, 800)
    window.webContents.setZoomFactor(1.25)
    await pause(250)
    await paint()
    assert.equal(window.webContents.getZoomFactor(), 1.25)
    await click(card + ' [data-testid="preview-finding-resolution"]')
    await capture('compact-125-preview')
    await click(card + ' [data-testid="confirm-finding-resolution"]')
    await wait(`document.querySelector(${JSON.stringify(card + ' header .resolved')})?.textContent.includes('已确认修复')`, 'visible-fixed-status')
    await wait(`document.querySelector('.toast')?.textContent.includes('已记录本条问题的修复版本')`, 'success-notice')
    const notice = await evaluate(`(()=>{const e=document.querySelector('.toast'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {visible:s.visibility==='visible'&&Number(s.opacity)>0&&r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight,text:e.textContent}})()`)
    assert.ok(notice.visible, 'post-save success must be on screen')
    await evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center',behavior:'instant'})`)
    await capture('compact-125-fixed')
    const fixedHistory = await history()
    const fixed = fixedHistory.entries.find(entry => entry.id === finding.id)
    assert.ok(fixed)
    assert.equal(fixed.status, 'fixed')
    assert.equal(fixed.sourceBodyVersionId, finding.sourceBodyVersionId)
    assert.equal(fixed.resultingBodyVersionId, saved.bodyVersionId)
    assert.equal((await chapter()).content, corrected)
    assert.equal((await chapter()).bodyVersionId, saved.bodyVersionId)
    checks.push('hit-testable 125% compact confirmation records fixed/current-version and shows success without rewriting prose')

    stage = 'reload-fixed-record'
    window.setSize(1440, 940)
    window.webContents.setZoomFactor(1)
    await reloadAndOpen()
    await openHistory()
    await wait(`document.querySelector(${JSON.stringify(card + ' header .resolved')})`, 'reloaded-fixed-record')
    await wait(`document.querySelector('.character-conflict-empty')?.textContent.includes('处理结果已保留在本章记录中')`, 'resolved-empty-state-explains-success')
    assert.deepEqual((await history()).entries.find(entry => entry.id === finding.id), fixed)
    assert.equal((await chapter()).content, corrected)
    assert.equal((await chapter()).bodyVersionId, saved.bodyVersionId)
    await evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center',behavior:'instant'})`)
    await capture('reopened-fixed')
    checks.push('reload and real project reopen restore the same fixed record, source/result versions and exact prose')
    const result = { ok: true, checks, captures, findingId: finding.id, sourceBodyVersionId: finding.sourceBodyVersionId, resultingBodyVersionId: saved.bodyVersionId }
    await writeFile(join(dirname(capturePath), 'finding-resolution-verification.json'), JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    await capture('failure').catch(() => undefined)
    const result = { ok: false, stage, error: error instanceof Error ? error.message : String(error), checks, captures, window: { visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), zoom: window.webContents.getZoomFactor() } }
    await writeFile(join(dirname(capturePath), 'finding-resolution-verification.json'), JSON.stringify(result, null, 2))
    return result
  } finally {
    if (configured && !window.isDestroyed()) window.webContents.setBackgroundThrottling(originalThrottling)
  }
}
