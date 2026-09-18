import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { BrowserWindow, KeyboardInputEvent } from 'electron'
import type { Chapter, OutlinePlanningStatus, OutlineVolume } from '../../src/contracts/index'

/** Native UI acceptance, only for the existing formal temp smoke book. A
 * missing planning volume is prepared through its real API after isolation;
 * tested text saves use CodeMirror and buttons, never outline-update APIs. */
export async function runOutlineStorageFeedbackSmoke(window: BrowserWindow, capturePath: string) {
  const output = join(dirname(capturePath), 'outline-storage-feedback')
  const checks: string[] = [], screenshots: string[] = [], layouts: unknown[] = []
  const original = { throttle: window.webContents.getBackgroundThrottling(), zoom: window.webContents.getZoomFactor(), bounds: window.getBounds() }
  const evaluate = (source: string) => window.webContents.executeJavaScript(source)
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`
  const footer = '.outline-statusbar'
  const save = '[data-testid="save-outline-document"]'
  const totalEditor = '.cm-content[aria-label="全局总纲正文"]'
  const volumeEditor = '.cm-content[aria-label="当前卷纲正文"]'
  let stage = 'isolation', isolated = false
  const waitFor = async (expression: string, label: string) => {
    for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100) }
    throw new Error(`outline-storage-timeout:${label}`)
  }
  const paint = async () => {
    assert.ok(isolated, 'outline-storage-unverified-window')
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    if (!window.isFocused()) window.focus()
    await waitFor(`document.visibilityState==='visible'`, 'visible-frame')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      assert.ok(await Promise.race([evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))'), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500) })]), 'outline-storage-frame-timeout')
    } finally { clearTimeout(timer) }
  }
  const key = (keyCode: string, modifiers: KeyboardInputEvent['modifiers'] = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  const click = async (selector: string) => {
    await waitFor(query(selector), selector)
    await evaluate(`${query(selector)}.scrollIntoView({block:'nearest',inline:'nearest'})`)
    await paint()
    // A long CodeMirror document can be taller than its scroll viewport; aim
    // inside the genuinely visible content, not its off-screen document center.
    const point = await evaluate(`(()=>{const e=${query(selector)},r=e.getBoundingClientRect(),clip=e.matches('.cm-content')?e.closest('.cm-scroller').getBoundingClientRect():r,left=Math.max(0,r.left,clip.left),right=Math.min(innerWidth,r.right,clip.right),top=Math.max(0,r.top,clip.top),bottom=Math.min(innerHeight,r.bottom,clip.bottom),x=(left+right)/2,y=(top+bottom)/2;return{x,y,hit:right>left&&bottom>top&&x>0&&y>0&&x<innerWidth&&y<innerHeight&&!e.disabled&&!e.closest('[inert]')&&e.contains(document.elementFromPoint(x,y))}})()`)
    assert.ok(point.hit, `outline-storage-obscured:${selector}:${JSON.stringify(point)}`)
    const zoom = window.webContents.getZoomFactor()
    for (const type of ['mouseDown', 'mouseUp'] as const) window.webContents.sendInputEvent({ type, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    await paint()
  }
  const capture = async (name: string) => {
    await delay(200); await paint()
    const file = `${name}.png`
    await writeFile(join(output, file), (await window.capturePage()).toPNG())
    screenshots.push(file)
  }
  const assertSyncedVisible = async (label: string) => {
    await waitFor(`${query(footer)}?.textContent.includes('已存入 SQLite · Markdown 已同步')&&!${query(footer)}?.textContent.includes('有改动待保存')`, label)
    const metrics = await evaluate(`(()=>{const e=${query(footer)},r=e.getBoundingClientRect(),s=getComputedStyle(e),button=${query(save)},b=button.getBoundingClientRect();return{text:e.textContent,top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:s.display!=='none'&&s.visibility!=='hidden',viewport:{width:innerWidth,height:innerHeight},saveHit:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),activeSettings:!!document.querySelector('.activitybar [data-activity="settings"].selected')}})()`)
    layouts.push({ label, ...metrics })
    assert.ok(metrics.visible && metrics.height > 0 && metrics.width > 0 && metrics.top >= 0 && metrics.bottom <= metrics.viewport.height + 1, `outline-storage-status-not-visible:${JSON.stringify(metrics)}`)
    assert.ok(metrics.saveHit, 'outline-storage-save-obscured')
    assert.equal(metrics.activeSettings, false, 'outline-storage-should-not-require-settings')
    assert.ok(!metrics.text.includes('已保存为 Markdown'), 'outline-storage-mislabels-formal-data')
  }
  const enterWorkspace = async (reload = true) => {
    if (reload) {
      const loaded = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()))
      window.webContents.reload(); await loaded
    }
    await waitFor(`document.querySelector('.project-library')||document.querySelector('.activitybar')`, 'renderer-mounted')
    if (await evaluate(`!!document.querySelector('[data-testid="app-boot-skip"]')`)) await click('[data-testid="app-boot-skip"]')
    await waitFor(`!document.querySelector('[data-testid="app-boot"]')&&!document.querySelector('[data-testid="app-boot-skip"]')&&!document.querySelector('[data-testid="workspace-loading"]')&&!document.querySelector('.app-frame[inert]')`, 'boot-settled')
    if (await evaluate(`!!document.querySelector('.project-library')`)) {
      await waitFor(`(()=>{const e=document.querySelector('[data-testid="library-continue-writing"]');if(!e||e.disabled||e.closest('[inert]'))return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`, 'library-ready')
      await click('[data-testid="library-continue-writing"]')
    }
    await waitFor(`document.querySelector('.activitybar')&&!document.querySelector('[data-testid="workspace-loading"]')&&!document.querySelector('.app-frame[inert]')`, 'workspace-ready')
    await click('.activitybar [data-activity="outline"]')
    await waitFor(`document.querySelector('.outline-editor')`, 'outline-opened')
    await click('.outline-tree-search + button.tree-item')
    await waitFor(query(totalEditor), 'total-editor-opened')
  }
  const openVolume = async (volume: number) => {
    const volumeNode = `.outline-volume-node:has(.outline-volume-toggle[aria-label$="第 ${volume} 卷"])`
    await waitFor(query(volumeNode), `existing-volume-${volume}`)
    if (await evaluate(`${query(`${volumeNode} .outline-volume-toggle`)}.getAttribute('aria-expanded')!=='true'`)) await click(`${volumeNode} .outline-volume-toggle`)
    await click(`${volumeNode} .outline-volume-outline`)
    await waitFor(query(volumeEditor), 'volume-editor-opened')
  }
  const readOutline = async (volume: OutlineVolume): Promise<string> => (await evaluate(`window.novelDesktop.outlines.get(${JSON.stringify(volume)})`)).content
  const prose = (chapters: Chapter[]) => chapters.map(({ id, title, content, revision, bodyVersionId }) => ({ id, title, content, revision, bodyVersionId }))
  const editAndSave = async (volume: OutlineVolume, editor: string, originalText: string, addition: string) => {
    await click(editor)
    await waitFor(`document.activeElement===${query(editor)}`, 'real-codemirror-focus')
    key('End', ['control']); await paint()
    await window.webContents.insertText(addition); await paint()
    await waitFor(`${query(footer)}?.textContent.includes('有改动待保存')`, 'native-outline-dirty')
    assert.equal(await readOutline(volume), originalText, 'outline-storage-native-edit-saved-without-request')
    await click(save)
    await assertSyncedVisible(`saved-${volume}`)
    assert.equal(await readOutline(volume), originalText + addition, `outline-storage-${volume}-saved-content-mismatch`)
    assert.ok((await evaluate(`${query(editor)}.textContent`)).includes(addition.trim()), 'outline-storage-editor-did-not-retain-saved-text')
  }
  try {
    const profilePath = process.env.LANJIAN_USER_DATA_PATH
    assert.ok(process.env.LANJIAN_SMOKE === '1' && profilePath && profilePath === process.env.LANJIAN_SMOKE_CREATE_PARENT, 'outline-storage-requires-isolated-smoke')
    const inside = (root: string, target: string) => { const part = relative(root, target); return !!part && !part.startsWith('..') && !isAbsolute(part) }
    const temp = await realpath(tmpdir()), profile = await realpath(profilePath!)
    assert.ok(inside(temp, profile), 'outline-storage-profile-outside-temp')
    const status = await evaluate('window.novelDesktop.projects.status()')
    assert.equal(status?.project?.title, '烟测书稿')
    assert.ok(inside(profile, await realpath(resolve(status.project.path))), 'outline-storage-book-outside-profile')
    const storage = await evaluate('window.novelDesktop.projects.sqliteStorageStatus()')
    assert.equal(storage.outlineStorageMode, 'sqlite', 'outline-storage-fixture-must-be-formal')
    assert.equal(storage.outlinePendingMirrors + storage.outlineConflictMirrors + storage.outlineFailedMirrors, 0, 'outline-storage-fixture-mirrors-not-synced')
    isolated = true
    await mkdir(output, { recursive: true })
    window.webContents.setBackgroundThrottling(false); window.webContents.setZoomFactor(1); window.setContentSize(1440, 900)
    const before: Chapter[] = await evaluate('window.novelDesktop.chapters.list()')
    assert.ok(before.length > 0, 'outline-storage-fixture-needs-existing-prose')
    stage = 'prepare-planning-volume-fixture'
    const planningBefore: OutlinePlanningStatus = await evaluate('window.novelDesktop.outlines.planningStatus()')
    let volume = planningBefore.volumes[0]?.volume
    if (volume === undefined) {
      const planned: OutlinePlanningStatus = await evaluate(`window.novelDesktop.outlines.createVolume('存储验收卷')`)
      const created = planned.volumes.filter(item => item.title === '存储验收卷' && !planningBefore.volumes.some(previous => previous.volume === item.volume))
      assert.equal(created.length, 1, 'outline-storage-fixture-volume-identity-ambiguous')
      volume = created[0]!.volume
    }
    assert.ok(Number.isSafeInteger(volume) && volume > 0, 'outline-storage-fixture-volume-id-invalid')
    const planningAfter: OutlinePlanningStatus = await evaluate('window.novelDesktop.outlines.planningStatus()')
    assert.ok(planningAfter.volumes.some(item => item.volume === volume), 'outline-storage-fixture-volume-not-persisted')
    assert.deepEqual(prose(await evaluate('window.novelDesktop.chapters.list()')), prose(before), 'outline-storage-fixture-preparation-mutated-prose')
    layouts.push({ kind: 'fixture-planning-volume', before: planningBefore.volumes.map(item => ({ volume: item.volume, title: item.title })), after: planningAfter.volumes.map(item => ({ volume: item.volume, title: item.title })), testedVolume: volume, rendererReloaded: false })
    checks.push(`fixture registration only after temp isolation: planning volume ${volume} exists via real planning API; measured outline edits still use native Save; manuscript fingerprint unchanged`)
    const totalBefore = await readOutline('total'), volumeBefore = await readOutline(volume)
    const totalAddition = '\n\n【原生存储验收】总纲保存到正式数据后，同步可读 Markdown。'
    const volumeAddition = '\n\n【原生存储验收】本卷保存与总纲独立，正文内容保持不变。'
    stage = 'open-without-settings'
    // Keep the renderer's pre-migration cache for the first entry. Reloading
    // here would conceal the stale file-mode label this acceptance guards.
    await enterWorkspace(false); await assertSyncedVisible('initial-open-without-settings-or-reload'); await capture('outline-initial-sqlite')
    checks.push('isolated formal temp book; existing renderer direct outline entry shows SQLite and synced Markdown without settings or reload')
    stage = 'native-total-save'
    await editAndSave('total', totalEditor, totalBefore, totalAddition); await capture('outline-total-saved')
    checks.push('real CodeMirror total-outline append stays unsaved until native Save; exact get readback and on-page SQLite mirror status agree')
    stage = 'native-volume-save'
    await openVolume(volume); await assertSyncedVisible('volume-open')
    await editAndSave(volume, volumeEditor, volumeBefore, volumeAddition); await capture('outline-volume-saved')
    checks.push(`actual planning volume ${volume} native append/save; independent content receipt and visible storage feedback`)
    stage = 'reload-and-verify'
    await enterWorkspace(); await assertSyncedVisible('total-after-reload')
    assert.equal(await readOutline('total'), totalBefore + totalAddition)
    assert.ok((await evaluate(`${query(totalEditor)}.textContent`)).includes(totalAddition.trim()))
    await openVolume(volume); await assertSyncedVisible('volume-after-reload')
    assert.equal(await readOutline(volume), volumeBefore + volumeAddition)
    assert.ok((await evaluate(`${query(volumeEditor)}.textContent`)).includes(volumeAddition.trim()))
    assert.deepEqual(prose(await evaluate('window.novelDesktop.chapters.list()')), prose(before), 'outline-storage-mutated-manuscript')
    await capture('outline-reloaded-volume')
    checks.push('renderer reload/reopen retains both saved outlines and status; all chapter prose, titles, revisions and body versions unchanged')
    const result = { ok: true, checks, screenshots, layouts }
    await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2)); return result
  } catch (error) {
    if (isolated) await capture('failure').catch(() => undefined)
    const result = { ok: false, stage, error: error instanceof Error ? error.message : String(error), checks, screenshots, layouts }
    if (isolated) await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2))
    return result
  } finally {
    if (isolated) { window.webContents.setZoomFactor(original.zoom); window.setBounds(original.bounds); window.webContents.setBackgroundThrottling(original.throttle) }
  }
}
