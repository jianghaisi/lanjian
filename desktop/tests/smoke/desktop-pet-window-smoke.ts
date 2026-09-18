import assert from 'node:assert/strict'
import { app, BrowserWindow, screen } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const execute = promisify(execFile)
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
/** Dedicated isolated book/profile only. Uses actual Windows cursor input to
 * prove screen-coordinate dragging and transparent hit testing, not DOM events. */
export async function runDesktopPetWindowSmoke(owner: BrowserWindow, capturePath: string) {
  assert.equal(process.env.LANJIAN_SMOKE, '1')
  assert.equal(process.platform, 'win32')
  const originalCursor = screen.getCursorScreenPoint()
  const originalBounds = owner.getBounds()
  const captures: string[] = [], checks: string[] = []
  let pet: BrowserWindow | undefined, probe: BrowserWindow | undefined, stage = 'open'
  let mouseDiagnostic = ''
  let lastClick: unknown = null
  const evaluate = (win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code)
  async function wait(win: BrowserWindow, expression: string) {
    for (let n = 0; n < 150; n++) { if (await evaluate(win, `(async()=>Boolean(await (${expression})))()`)) return; await pause(100) }
    throw new Error('desktop-pet-wait:' + expression)
  }
  async function mouse(points: { x: number; y: number; down?: boolean; up?: boolean }[]) {
    const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PetMouse { [StructLayout(LayoutKind.Sequential)] public struct POINT {public int x;public int y;} [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context); [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p); [DllImport("user32.dll",SetLastError=true)] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); }'; [PetMouse]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null; ` + points.map(point => {
      const physical = screen.dipToScreenPoint(point)
      return `$didMove=[PetMouse]::SetCursorPos(${Math.round(physical.x)},${Math.round(physical.y)}); Start-Sleep -Milliseconds 160; $p=New-Object PetMouse+POINT; [PetMouse]::GetCursorPos([ref]$p) | Out-Null; Write-Output "$didMove $($p.x) $($p.y)"; ${point.down ? '[PetMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 160;' : ''}${point.up ? '[PetMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 160;' : ''}`
    }).join(' ')
    mouseDiagnostic = (await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 12000 })).stdout
  }
  async function click(win: BrowserWindow, selector: string) {
    await wait(win, `document.querySelector(${JSON.stringify(selector)})`)
    await evaluate(win, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`)
    await wait(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();return r&&r.width>0&&r.height>0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`)
    const p = await evaluate(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`)
    assert.ok(p.hit, selector + '-obscured')
    const zoom = win.webContents.getZoomFactor()
    if (win === pet) {
      const bounds = win.getContentBounds()
      const point = { x: bounds.x + p.x * zoom, y: bounds.y + p.y * zoom }
      lastClick = { selector, bounds, outer: win.getBounds(), point, local: p, zoom }
      await mouse([{ ...point, down: true }, { ...point, up: true }])
    } else {
      win.show(); win.focus()
      for (const type of ['mouseDown', 'mouseUp'] as const) win.webContents.sendInputEvent({ type, x: Math.round(p.x * zoom), y: Math.round(p.y * zoom), button: 'left', clickCount: 1 })
    }
  }
  async function contextMenu(win: BrowserWindow, selector: string) {
    await wait(win, `document.querySelector(${JSON.stringify(selector)})`)
    const p = await evaluate(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`)
    assert.ok(p.hit, selector + '-obscured')
    const zoom = win.webContents.getZoomFactor()
    win.show(); win.focus()
    for (const type of ['mouseDown', 'mouseUp'] as const) win.webContents.sendInputEvent({ type, x: Math.round(p.x * zoom), y: Math.round(p.y * zoom), button: 'right', clickCount: 1 })
  }
  async function capture(win: BrowserWindow, name: string) {
    const path = join(dirname(capturePath), name)
    const painted = await Promise.race([evaluate(win, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))'), pause(2500).then(() => false)])
    assert.ok(painted, 'pet-frame-not-painted')
    await writeFile(path, (await win.capturePage()).toPNG()); captures.push(path)
  }
  try {
    owner.webContents.setBackgroundThrottling(false)
    owner.show(); owner.focus()
    const loaded = new Promise<void>(resolve => owner.webContents.once('did-finish-load', () => resolve()))
    owner.webContents.reload(); await loaded
    await wait(owner, `document.querySelector('.project-library')`)
    if (await evaluate(owner, `!!document.querySelector('[data-testid="app-boot-skip"]')`)) await click(owner, '[data-testid="app-boot-skip"]')
    await wait(owner, `!document.querySelector('[data-testid="app-boot-skip"]')`)
    await click(owner, '.work-item-open[aria-label*="烟测书稿"]')
    await wait(owner, `document.querySelector('[data-testid="external-companion"]')&&!document.querySelector('.app-frame[inert]')&&!document.querySelector('[data-testid="workspace-loading"]')`)
    await click(owner, '.activitybar [data-activity="desk"]')
    await wait(owner, `document.querySelector('[data-testid="manuscript-input"]')`)
    const before = await evaluate(owner, 'window.novelDesktop.chapters.list()')
    assert.equal(await evaluate(owner, '(async () => (await window.desktopPet.get()).open)()'), false, 'desktop-pet-default-off')
    await click(owner, '[data-testid="external-companion"]')
    for (let n = 0; n < 100; n++) {
      pet = BrowserWindow.getAllWindows().find(win => win !== owner && win.getTitle() === '岚笺 · 桌面伙伴')
      if (pet?.isVisible()) break
      await pause(100)
    }
    if (!pet || !pet.isVisible()) throw new Error('independent-pet-window-not-visible')
    pet.webContents.setBackgroundThrottling(false)
    await wait(pet, `document.querySelector('[data-testid="pet-window-handle"]')`)
    assert.equal(await evaluate(pet, 'typeof window.novelDesktop'), 'undefined')
    assert.equal(pet.getParentWindow(), null)
    assert.equal(await evaluate(owner, `!!document.querySelector('[data-testid="companion-pet"]')`), false)
    checks.push('real unparented pet window with restricted preload; no page overlay or directory reservation')
    stage = 'desktop-drag'
    await evaluate(pet, `(()=>{window.petSmokeEvents=[];for(const type of ['mousemove','pointermove','pointerdown','pointerup'])document.addEventListener(type,e=>{window.petSmokeEvents.push({type,x:e.screenX,y:e.screenY,cx:e.clientX,cy:e.clientY,target:e.target?.tagName,near:e.target?.closest?.('[data-testid]')?.getAttribute('data-testid')});if(window.petSmokeEvents.length>20)window.petSmokeEvents.shift()},true)})()`)
    const area = screen.getDisplayMatching(owner.getBounds()).workArea
    owner.setBounds({ x: area.x + 450, y: area.y + 20, width: 1000, height: Math.min(800, area.height - 30) })
    await pause(200)
    const p = await evaluate(pet, `(()=>{const r=document.querySelector('[data-testid="pet-window-handle"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    const initial = pet.getBounds(), zoom = pet.webContents.getZoomFactor()
    const start = { x: initial.x + p.x * zoom, y: initial.y + p.y * zoom }
    const target = { x: area.x + 12 + p.x * zoom, y: area.y + 40 + p.y * zoom }
    await mouse([{ ...start, down: true }, ...[.25, .5, .75, 1].map(t => ({ x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t })), { ...target, up: true }])
    await pause(350)
    const moved = pet.getBounds()
    assert.ok(Math.abs(moved.x - initial.x) > 20, 'OS-drag-did-not-move-window:' + JSON.stringify({ initial, moved, start, target, mouseDiagnostic, cursor: screen.getCursorScreenPoint(), events: await evaluate(pet, 'window.petSmokeEvents'), state: await evaluate(pet, 'window.desktopPet.get()') }))
    assert.ok(moved.x + moved.width <= owner.getBounds().x + 3, 'pet-not-outside-owner:' + JSON.stringify({ moved, owner: owner.getBounds(), events: await evaluate(pet, 'window.petSmokeEvents') }))
    await capture(pet, 'desktop-pet-outside.png')
    await capture(owner, 'desktop-pet-main-uncompressed.png')
    checks.push('actual Windows mouse drag moves entire pet outside main window')
    stage = 'menu-entertainment'
    await click(pet, '[data-testid="pet-window-menu-toggle"]')
    await wait(pet, `document.querySelector('[data-testid="desktop-pet-menu"]')`)
    await click(pet, '[data-testid="pet-dice"]')
    await wait(pet, `document.querySelector('[data-testid="pet-result"]')`)
    const result = await evaluate(pet, `document.querySelector('[data-testid="pet-result"]').textContent`)
    assert.match(result, /[1-6]/)
    await capture(pet, 'desktop-pet-entertainment.png')
    await click(pet, '[aria-label="关闭伙伴消息"]')
    await click(pet, '[data-testid="pet-mode-detailed"]')
    await wait(pet, `document.querySelector('.companion-host.detailed .live2d-companion[data-ready="true"] canvas')`)
    await capture(pet, 'desktop-pet-live2d.png')
    await click(pet, '[data-testid="pet-mode-chibi"]')
    await wait(pet, `document.querySelector('.companion-host.chibi')`)
    checks.push('real OS clicks operate menu, offline dice and both character renderers')
    stage = 'transparent-hit-testing'
    await click(pet, '[aria-label="关闭伙伴菜单"]')
    probe = new BrowserWindow({ ...pet.getBounds(), frame: false, thickFrame: false, resizable: false, show: false, skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await probe.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#edf0f2;min-height:100vh">Isolated pointer probe</body>'))
    await evaluate(probe, `window.smokeClicks=0;document.addEventListener('click',()=>window.smokeClicks++)`)
    probe.showInactive()
    const b = pet.getContentBounds()
    // This corner is intentionally outside all rendered interactive regions.
    assert.equal(await evaluate(pet, `Boolean(document.elementFromPoint(40,80)?.closest('[data-pet-interactive]'))`), false)
    const blank = { x: b.x + 40 * pet.webContents.getZoomFactor(), y: b.y + 80 * pet.webContents.getZoomFactor() }
    await mouse([{ ...blank, down: true }, { ...blank, up: true }])
    await wait(probe, 'window.smokeClicks===1')
    await click(pet, '[data-testid="pet-window-menu-toggle"]')
    await click(pet, '[data-testid="pet-click-through"]')
    await wait(pet, `(await window.desktopPet.get()).preferences.clickThrough`)
    const fullPoint = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    await mouse([{ ...fullPoint, down: true }, { ...fullPoint, up: true }])
    await wait(probe, 'window.smokeClicks===2')
    await contextMenu(owner, '[data-testid="external-companion"]')
    await click(owner, '[data-testid="desktop-pet-locate"]')
    await wait(pet, `!(await window.desktopPet.get()).preferences.clickThrough`)
    probe.destroy(); probe = undefined
    checks.push('actual OS clicks pass through transparent blank and full-click-through mode to an isolated underlying window; owner recovery unlocks controls')
    stage = 'minimize-and-recover'
    owner.minimize(); await pause(150)
    assert.ok(pet.isVisible(), 'owner-minimize-hid-pet')
    await click(pet, '[data-testid="pet-hide"]')
    await pause(200); assert.equal(pet.isVisible(), false)
    owner.restore(); await contextMenu(owner, '[data-testid="external-companion"]')
    await click(owner, '[data-testid="desktop-pet-locate"]')
    await pause(300); assert.ok(pet.isVisible())
    await pause(500)
    const preferences = JSON.parse(await readFile(join(app.getPath('userData'), 'desktop-pet.json'), 'utf8'))
    assert.ok(preferences.position && preferences.preferences.clickThrough === false)
    checks.push('pet remains when owner minimized; hide and explicit recovery work; position/preferences persisted')
    const after = await evaluate(owner, 'window.novelDesktop.chapters.list()')
    assert.deepEqual(after.map((chapter: any) => [chapter.id, chapter.title, chapter.content, chapter.revision]), before.map((chapter: any) => [chapter.id, chapter.title, chapter.content, chapter.revision]))
    checks.push('author fixture titles, prose and revisions unchanged')
    stage = 'library-recovery'
    await click(owner, '[aria-label="返回我的作品"]')
    await wait(owner, `document.querySelector('.project-library')&&document.querySelector('[data-testid="external-companion"]')`)
    assert.equal(await evaluate(owner, `document.querySelectorAll('[data-testid="external-companion"]').length`), 1)
    await contextMenu(owner, '[data-testid="external-companion"]')
    await click(owner, '[data-testid="desktop-pet-locate"]')
    assert.ok(pet.isVisible())
    await evaluate(pet, `window.desktopPet.command({type:'settings'})`)
    await wait(owner, `document.querySelector('.local-appearance-dialog[open] [data-testid="companion-settings"]')`)
    await click(owner, '[aria-label="关闭外观设置"]')
    await evaluate(pet, `window.desktopPet.command({type:'return-to-writing'})`)
    await wait(owner, `document.querySelector('.project-library')&&document.activeElement?.getAttribute('aria-label')==='搜索作品'`)
    checks.push('library retains one recovery entry and pet settings/return actions; no arbitrary book opens')
    const report = { ok: true, checks, captures, outsideBounds: moved }
    await writeFile(join(dirname(capturePath), 'desktop-pet-window-report.json'), JSON.stringify(report, null, 2))
    return report
  } catch (error) {
    await writeFile(join(dirname(capturePath), 'desktop-pet-owner-failure.png'), (await owner.capturePage()).toPNG())
    if (pet && !pet.isDestroyed()) await writeFile(join(dirname(capturePath), 'desktop-pet-failure.png'), (await pet.capturePage()).toPNG())
    const diagnostic = pet && !pet.isDestroyed() ? { bounds: pet.getBounds(), cursor: screen.getCursorScreenPoint(), events: await evaluate(pet, 'window.petSmokeEvents'), state: await evaluate(pet, 'window.desktopPet.get()'), probe: probe && !probe.isDestroyed() ? { bounds: probe.getContentBounds(), clicks: await evaluate(probe, 'window.smokeClicks') } : null } : null
    const report = { ok: false, stage, error: error instanceof Error ? error.message : 'unknown', checks, captures, diagnostic, lastClick }
    await writeFile(join(dirname(capturePath), 'desktop-pet-window-report.json'), JSON.stringify(report, null, 2))
    return report
  } finally {
    if (probe && !probe.isDestroyed()) probe.destroy()
    await mouse([originalCursor]).catch(() => {})
    if (!owner.isDestroyed()) { owner.restore(); owner.setBounds(originalBounds) }
  }
}
