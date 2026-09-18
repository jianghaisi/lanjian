import type { BrowserWindow } from 'electron'

type PetDriver = {
  evaluate: (source: string) => Promise<any>
  click: (selector: string) => Promise<void>
  capture: (name: string) => Promise<void>
  waitFor: (expression: string, label: string) => Promise<void>
}

/** Called only by the isolated, already-saved writing-workspace smoke.
 * No provider calls or manuscript operations; preference changes use real UI. */
export async function verifyCompanionPet(window: BrowserWindow, driver: PetDriver) {
  const { evaluate, click, capture, waitFor } = driver
  const checks: string[] = []
  const measurements: unknown[] = []
  const pet = '[data-testid="companion-pet"]'
  const handle = '[data-testid="pet-drag-handle"]'
  const host = `${pet} [data-testid="companion-host"]`
  const beforeText = await evaluate(`document.querySelector('.manuscript-editor .cm-content')?.textContent`)
  if (typeof beforeText !== 'string' || !beforeText.trim()) throw new Error('companion-pet-missing-saved-fixture')
  const originalMode = await evaluate(`['detailed','chibi','hidden'].find(m=>document.querySelector('[data-testid="external-companion"]')?.classList.contains(m))`)
  if (!originalMode) throw new Error('companion-pet-missing-recovery-control')
  let ownsDebugger = false
  const assertGeometry = async (label: string) => {
    const layout = await evaluate(`(()=>{const pet=document.querySelector('${pet}'),paper=document.querySelector('.manuscript-editor .cm-scroller'),handle=document.querySelector('${handle}');if(!pet||!paper||!handle)return null;const r=pet.getBoundingClientRect(),p=paper.getBoundingClientRect(),h=handle.getBoundingClientRect();return {label:${JSON.stringify(label)},x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,outsideAssistant:!pet.closest('.assistant-panel'),outsidePaper:r.right<=p.left+1||r.left>=p.right-1||r.bottom<=p.top+1||r.top>=p.bottom-1,visible:getComputedStyle(pet).visibility==='visible',hit:handle.contains(document.elementFromPoint(h.x+h.width/2,h.y+h.height/2))}})()`)
    measurements.push(layout)
    if (!layout || !layout.visible || !layout.hit || !layout.outsideAssistant || !layout.outsidePaper || layout.x < 0 || layout.y < 0 || layout.right > layout.viewportWidth + 1 || layout.bottom > layout.viewportHeight + 1) throw new Error('companion-pet-unsafe-placement:' + JSON.stringify(layout))
    return layout
  }
  const menu = async () => {
    if (!await evaluate(`!!document.querySelector('[data-testid="companion-pet-menu"]')`)) await click(handle)
    await waitFor(`!!document.querySelector('[data-testid="companion-pet-menu"]')`, 'pet-menu-native-open')
  }
  const assertSavedMode = async (mode: string) => {
    await waitFor(`(()=>{const saved=JSON.parse(localStorage.getItem('lanjian-companion-v1')||'null');return document.querySelector('[data-testid="external-companion"]')?.classList.contains('${mode}')&&!!saved&&[saved.defaults,...Object.values(saved.projects||{})].some(p=>p.writingMode==='${mode}')})()`, 'pet-mode-persisted-' + mode)
  }
  const selectMode = async (mode: 'detailed' | 'chibi') => {
    await menu(); await click(`[data-testid="pet-mode-${mode}"]`)
    await assertSavedMode(mode)
    await waitFor(`document.querySelector('${pet}')?.classList.contains('${mode}')`, 'pet-renderer-' + mode)
    // Selecting the already-current mode may not trigger the visibility watcher.
    if (await evaluate(`!!document.querySelector('[data-testid="companion-pet-menu"]')`)) await click(handle)
  }
  const sampleMotion = () => evaluate(`(async()=>{const e=document.querySelector('${host} .companion-art');const before=getComputedStyle(e).transform;await new Promise(r=>setTimeout(r,550));return {before,after:getComputedStyle(e).transform,motion:document.querySelector('${host}').dataset.motion}})()`)
  const paintQuietPose = async () => {
    // The motion attribute can update before Vue's reset transform reaches the
    // compositor. Observe the actual neutral pose, then cross two paint frames.
    await waitFor(`(()=>{const e=document.querySelector('${host} .companion-art');if(!e)return false;const transform=getComputedStyle(e).transform;return transform==='none'||new DOMMatrixReadOnly(transform).isIdentity})()`, 'pet-neutral-reduced-motion-pose')
    const painted = await evaluate(`new Promise(resolve=>{const deadline=setTimeout(()=>resolve(false),2500);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(deadline);resolve(true)}))})`)
    if (!painted) throw new Error('companion-pet-quiet-pose-not-painted')
  }
  try {
    if (!await evaluate(`!!document.querySelector('${pet}')`)) await click('[data-testid="external-companion"]')
    await waitFor(`!!document.querySelector('${pet}')`, 'independent-pet-mounted')
    await assertGeometry('initial')
    await selectMode('detailed')
    await assertGeometry('detailed')
    await waitFor(`document.querySelector('${pet} .pet-portrait')?.naturalWidth>0`, 'pet-detailed-image-loaded')
    await capture('companion-pet-detailed')
    await selectMode('chibi')
    const beforeMove = await assertGeometry('chibi-before-move')
    const center = await evaluate(`(()=>{const r=document.querySelector('${handle}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    const zoom = window.webContents.getZoomFactor()
    const point = (x: number, y: number) => ({ x: Math.round(x * zoom), y: Math.round(y * zoom) })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point(center.x, center.y), button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point(center.x + 8, center.y - 36), button: 'left' })
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point(center.x + 16, center.y - 72), button: 'left' })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point(center.x + 16, center.y - 72), button: 'left', clickCount: 1 })
    await waitFor(`Math.abs(document.querySelector('${pet}').getBoundingClientRect().y-${beforeMove.y})>10`, 'pet-native-drag-moved')
    const dragged = await assertGeometry('after-native-drag')
    await click(handle)
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
    await waitFor(`document.querySelector('${pet}').getBoundingClientRect().y<${dragged.y - 1}`, 'pet-native-arrow-moved')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitFor(`!document.querySelector('[data-testid="companion-pet-menu"]')`, 'pet-menu-escape')
    await assertGeometry('after-native-keyboard')
    await capture('companion-pet-chibi-moved')
    checks.push('Pet is outside AI and manuscript; detailed/Q renderers persist through real menu clicks; native drag and arrow movement remain inside the viewport and outside prose')

    await click('[data-testid="pet-minimize"]')
    await waitFor(`!document.querySelector('${pet}')&&document.querySelector('[data-testid="external-companion"]')?.getAttribute('aria-expanded')==='false'`, 'pet-minimized')
    await click('[data-testid="external-companion"]')
    await waitFor(`!!document.querySelector('${pet}')`, 'pet-topbar-restored')
    await menu(); await click('[data-testid="pet-hide"]'); await assertSavedMode('hidden')
    await waitFor(`!document.querySelector('${pet}')`, 'pet-hidden-preference')
    await click('[data-testid="external-companion"]')
    await assertSavedMode('chibi'); await assertGeometry('restored-from-hidden')
    checks.push('Minimize restores from top bar; hidden preference persists and the same top-bar control restores Q mode')

    if (window.webContents.debugger.isAttached()) throw new Error('companion-pet-debugger-already-owned')
    window.webContents.debugger.attach('1.3'); ownsDebugger = true
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    await waitFor(`document.querySelector('${host}')?.dataset.motion==='active'`, 'pet-input-quiet-period-ended')
    const active = await sampleMotion()
    if (active.motion !== 'active' || active.before === active.after) throw new Error('companion-pet-static:' + JSON.stringify(active))
    measurements.push({ kind: 'motion-active', ...active })
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await waitFor(`matchMedia('(prefers-reduced-motion: reduce)').matches&&document.querySelector('${host}')?.dataset.motion==='quiet'`, 'pet-os-reduced-motion')
    await paintQuietPose()
    const quiet = await sampleMotion()
    if (quiet.motion !== 'quiet' || quiet.before !== quiet.after) throw new Error('companion-pet-reduced-motion-still-moving:' + JSON.stringify(quiet))
    measurements.push({ kind: 'motion-reduced', ...quiet })
    await capture('companion-pet-reduced-motion')
    checks.push('Actual artwork transform changes after input quiet period; emulated OS reduced-motion stops it, without rewriting user motion preferences')
  } finally {
    if (ownsDebugger) {
      try { await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }) }
      finally { window.webContents.debugger.detach() }
    }
  }
  if (originalMode === 'detailed') await selectMode('detailed')
  else if (originalMode === 'hidden') { await menu(); await click('[data-testid="pet-hide"]'); await assertSavedMode('hidden') }
  if (await evaluate(`document.querySelector('.manuscript-editor .cm-content')?.textContent`) !== beforeText) throw new Error('companion-pet-changed-manuscript')
  return { checks, measurements }
}
