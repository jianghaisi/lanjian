import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BrowserWindow, KeyboardInputEvent } from 'electron'

export async function runQuickChapterOpenSmoke(window: BrowserWindow, capturePath: string) {
  const evaluate = (code: string) => window.webContents.executeJavaScript(code)
  const wait = async (code: string) => {
    for (let n = 0; n < 300; n++) { if (await evaluate(`Boolean(${code})`)) return; await new Promise(resolve => setTimeout(resolve, 100)) }
    throw new Error('quick-open-wait:' + code)
  }
  const key = (keyCode: string, modifiers: KeyboardInputEvent['modifiers'] = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  const click = async (selector: string) => {
    await wait(`document.querySelector(${JSON.stringify(selector)})`)
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`)
    assert.ok(p.hit, selector + '-not-hit')
    const zoom = window.webContents.getZoomFactor()
    for (const type of ['mouseDown', 'mouseUp'] as const) window.webContents.sendInputEvent({ type, x: Math.round(p.x * zoom), y: Math.round(p.y * zoom), button: 'left', clickCount: 1 })
  }
  const capture = async (name: string) => {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await writeFile(join(dirname(capturePath), name), (await window.capturePage()).toPNG())
  }
  const previousThrottle = window.webContents.getBackgroundThrottling()
  let stage = 'open'
  try {
    window.webContents.setBackgroundThrottling(false)
    window.show(); window.focus(); window.webContents.focus()
    const loaded = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()))
    window.webContents.reload()
    await loaded
    await wait(`document.querySelector('.project-library')`)
    if (await evaluate(`Boolean(document.querySelector('[data-testid="app-boot-skip"]'))`)) await click('[data-testid="app-boot-skip"]')
    await wait(`!document.querySelector('[data-testid="app-boot-skip"]')`)
    await click('.work-item-open[aria-label*="烟测书稿"]')
    await wait(`document.querySelector('.activitybar') && !document.querySelector('.app-frame[inert]') && !document.querySelector('[data-testid="workspace-loading"]')`)
    await click('.activitybar [data-activity="desk"]')
    await wait(`document.querySelector('[data-testid="manuscript-input"]')`)
    const before = await evaluate('window.novelDesktop.chapters.list()')
    assert.ok(before.length >= 2)
    await click('[data-testid="manuscript-input"]')
    key('p', ['control'])
    await wait(`document.querySelector('[data-testid="quick-chapter-open"]')?.open && document.activeElement?.id==='quick-chapter-query'`)
    key('Escape')
    await wait(`!document.querySelector('[data-testid="quick-chapter-open"]')?.open && document.activeElement?.getAttribute('data-testid')==='manuscript-input'`)
    stage = 'keyboard-search'
    await click('[data-testid="open-quick-chapter"]')
    await window.webContents.insertText('不存在的章节')
    await wait(`document.querySelector('.quick-chapter-empty')?.textContent.includes('没有匹配')`)
    key('Enter')
    assert.equal(await evaluate(`document.querySelector('[data-testid="quick-chapter-open"]').open`), true)
    key('a', ['control']); await window.webContents.insertText('第 ２ 章')
    await wait(`document.querySelectorAll('.quick-chapter-results [role="option"]').length===1`)
    await capture('quick-chapter-open.png')
    key('Enter')
    await wait(`!document.querySelector('[data-testid="quick-chapter-open"]').open && document.querySelector('[data-testid="manuscript-title-input"]')?.value==='待删旧章'`)
    stage = 'settings-and-zoom'
    await click('.activitybar [data-activity="settings"]')
    key('p', ['control'])
    await wait(`document.activeElement?.id==='quick-chapter-query'`)
    window.setSize(1100, 800); window.webContents.setZoomFactor(1.25)
    await wait(`innerWidth < 1100`)
    const bounds = await evaluate(`(()=>{const r=document.querySelector('[data-testid="quick-chapter-open"]').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`)
    assert.equal(bounds, true)
    await capture('quick-chapter-open-compact.png')
    key('ArrowDown'); key('ArrowUp'); key('Enter')
    await wait(`!document.querySelector('[data-testid="quick-chapter-open"]').open && document.querySelector('[data-testid="manuscript-title-input"]')?.value==='雨夜追迹'`)
    const after = await evaluate('window.novelDesktop.chapters.list()')
    assert.deepEqual(after.map((c: { id: number; content: string; revision: unknown }) => [c.id, c.content, c.revision]), before.map((c: { id: number; content: string; revision: unknown }) => [c.id, c.content, c.revision]))
    stage = 'failed-save-preserves-draft'
    assert.ok(process.env.LANJIAN_SMOKE_CHAPTER_SAVE_FAILURE_TEXT)
    await click('[data-testid="manuscript-input"]')
    key('End', ['control'])
    await window.webContents.insertText(process.env.LANJIAN_SMOKE_CHAPTER_SAVE_FAILURE_TEXT! + '快速打开保留草稿。')
    key('p', ['control'])
    await wait(`document.activeElement?.id==='quick-chapter-query'`)
    await window.webContents.insertText('2'); key('Enter')
    await wait(`document.querySelector('.quick-chapter-error')?.textContent.includes('未能切换')`)
    assert.equal((await evaluate('window.novelDesktop.chapters.get(1)')).content, before[0].content)
    assert.equal(await evaluate(`document.querySelector('[data-testid="manuscript-title-input"]').value`), '雨夜追迹')
    await capture('quick-chapter-open-save-protected.png')
    key('Escape')
    await wait(`!document.querySelector('[data-testid="quick-chapter-open"]').open`)
    await click('[data-testid="manuscript-input"]')
    key('a', ['control'])
    await window.webContents.insertText(before[0].content + '\n\n快速打开保存通过。')
    key('p', ['control'])
    await wait(`document.activeElement?.id==='quick-chapter-query'`)
    await window.webContents.insertText('2'); key('Enter')
    await wait(`!document.querySelector('[data-testid="quick-chapter-open"]').open && document.querySelector('[data-testid="manuscript-title-input"]')?.value==='待删旧章'`)
    assert.ok((await evaluate('window.novelDesktop.chapters.get(1)')).content.includes('快速打开保存通过。'))
    assert.equal((await evaluate('window.novelDesktop.chapters.get(2)')).content, before[1].content)
    const result = { ok: true, checks: ['native shortcut and Escape focus restoration', 'empty/fullwidth search and Enter', 'settings navigation and arrow keys', '1100 window at 125% zoom', 'read-only navigation preserves chapter bodies and revisions', 'save failure retains source chapter and visible draft; corrected draft saves before navigation'] }
    await writeFile(join(dirname(capturePath), 'quick-chapter-open-verification.json'), JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    await capture('quick-chapter-open-failure.png').catch(() => undefined)
    return { ok: false, stage, error: error instanceof Error ? error.message : String(error) }
  } finally { window.webContents.setBackgroundThrottling(previousThrottle) }
}
