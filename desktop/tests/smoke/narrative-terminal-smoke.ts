import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { BrowserWindow } from 'electron'

/** Runs only from electron-smoke.mjs's isolated userData + temporary smoke book. */
export async function runNarrativeTerminalSmoke(window: BrowserWindow, capturePath: string) {
  const checks: string[] = []
  const captures: string[] = []
  const captureHashes = new Map<string, string>()
  const paintDiagnostics: unknown[] = []
  const originalBackgroundThrottling = window.webContents.getBackgroundThrottling()
  let isolatedWindowConfigured = false
  let stage = 'initial'
  const evaluate = (source: string) => window.webContents.executeJavaScript(source)
  const waitFor = async (expression: string, label: string) => {
    const passed = await evaluate(`(async()=>{for(let i=0;i<120;i++){if(${expression})return true;await new Promise(r=>setTimeout(r,50));}return false;})()`)
    if (!passed) throw new Error(`narrative-timeout:${label}`)
  }
  const windowState = () => ({ visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), backgroundThrottling: window.webContents.getBackgroundThrottling(), zoom: window.webContents.getZoomFactor() })
  const paint = async () => {
    // RAF pauses in hidden/occluded Electron renderers. The diagnostic deadline
    // must live in the main process, not in that same throttled renderer.
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const painted = await Promise.race([
        evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`),
        new Promise<false>(resolve => { deadline = setTimeout(() => resolve(false), 2000) })
      ])
      if (!painted) {
        let snapshotDeadline: ReturnType<typeof setTimeout> | undefined
        const documentState = await Promise.race([
          evaluate(`({visibility:document.visibilityState,hidden:document.hidden,focused:document.hasFocus(),dialog:document.querySelector('dialog[open]')?.className??null,boot:Boolean(document.querySelector('[data-testid="app-boot-skip"]')),inert:Boolean(document.querySelector('.app-frame[inert]'))})`).catch(() => null),
          new Promise<null>(resolve => { snapshotDeadline = setTimeout(() => resolve(null), 1000) })
        ])
        clearTimeout(snapshotDeadline)
        paintDiagnostics.push({ stage, ...windowState(), document: documentState })
        throw new Error('narrative-not-painted')
      }
    } finally { clearTimeout(deadline) }
  }
  const capture = async (name: string) => {
    if (name !== 'failure') await waitFor(`!document.querySelector('[data-testid="workspace-loading"]')&&!document.querySelector('[data-testid="app-boot-skip"]')`, 'capture-overlays-finished')
    // Settle short theme transitions and native compositor work only; unrelated
    // toast/cursor animations must never hold the whole screenshot workflow.
    await new Promise(resolve => setTimeout(resolve, 250))
    await paint()
    const captureDocument = await evaluate(`({visibility:document.visibilityState,focused:document.hasFocus(),dialog:document.querySelector('dialog[open]')?.className??null,inert:Boolean(document.querySelector('.app-frame[inert]'))})`)
    if (!window.isVisible() || window.isMinimized() || captureDocument.visibility !== 'visible') {
      paintDiagnostics.push({ stage, capture: name, ...windowState(), document: captureDocument })
      throw new Error('narrative-capture-window-not-visible')
    }
    const file = `narrative-${name}.png`
    let captureDeadline: ReturnType<typeof setTimeout> | undefined
    let png: Buffer
    try {
      const captured = await Promise.race([
        window.capturePage(),
        new Promise<null>(resolve => { captureDeadline = setTimeout(() => resolve(null), 5000) })
      ])
      if (!captured) {
        paintDiagnostics.push({ stage, capture: name, reason: 'capture-timeout', ...windowState(), document: captureDocument })
        throw new Error('narrative-capture-timeout')
      }
      png = captured.toPNG()
    } finally { clearTimeout(captureDeadline) }
    captureHashes.set(name, createHash('sha256').update(png).digest('hex'))
    await writeFile(join(dirname(capturePath), file), png)
    captures.push(file)
  }
  const click = async (selector: string) => {
    await waitFor(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});return target&&!target.closest('[inert]');})()`, selector)
    const point = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:'nearest',inline:'nearest'});const r=element.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,ok:r.width>0&&r.height>0&&x>0&&x<document.documentElement.clientWidth&&y>0&&y<document.documentElement.clientHeight&&element.contains(document.elementFromPoint(x,y))};})()`)
    if (!point.ok) throw new Error(`narrative-control-obscured:${selector}`)
    const zoom = window.webContents.getZoomFactor()
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    await paint()
  }
  const setValue = async (selector: string, value: string) => {
    await waitFor(`document.querySelector(${JSON.stringify(selector)})`, selector)
    await evaluate(`(()=>{const control=document.querySelector(${JSON.stringify(selector)});control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await paint()
  }
  const openAssistant = async () => {
    if (!await evaluate(`Boolean(document.querySelector('.assistant-panel'))`)) await click('.title-actions .assistant-toggle')
    await click('[data-testid="assistant-mode-agent"]')
    await waitFor(`document.querySelector('[data-testid="writing-agent-input"]')`, 'assistant-input')
  }
  const openWriting = async () => {
    await click('.activitybar [data-activity="desk"]')
    await waitFor(`document.querySelector('[data-testid="manuscript-input"]')`, 'manuscript')
    await openAssistant()
  }
  const openSettings = async () => {
    await click('.activitybar [data-activity="settings"]')
    await setValue('.settings-search input', '写作伙伴')
    await click('[data-testid="settings-nav-companion"]')
    await waitFor(`document.querySelector('[data-testid="companion-settings"]')`, 'companion-settings')
  }
  try {
    const project = await evaluate('window.novelDesktop.projects.status()')
    if (project?.project?.title !== '烟测书稿' || !process.env.LANJIAN_USER_DATA_PATH || process.env.LANJIAN_SMOKE_CREATE_PARENT !== process.env.LANJIAN_USER_DATA_PATH) {
      // Fixture title plus the driver's unique isolated profile are both mandatory.
      throw new Error('narrative-smoke-requires-isolated-fixture')
    }
    // Only this confirmed temporary smoke window gets deterministic frame timing.
    // Production windows retain their power-saving background behavior.
    window.webContents.setBackgroundThrottling(false)
    isolatedWindowConfigured = true
    window.setSize(1440, 940)
    window.webContents.setZoomFactor(1)
    // The broader smoke harness previews startup visuals before this focused path.
    // New previews are explicitly dismissible, not a fake timed cold start.
    if (await evaluate(`Boolean(document.querySelector('[data-testid="app-boot-skip"]'))`)) {
      await click('[data-testid="app-boot-skip"]')
      await waitFor(`!document.querySelector('[data-testid="app-boot-skip"]')`, 'startup-preview-closed')
    }
    await openWriting()
    stage = 'default-companion'
    await waitFor(`document.querySelector('[data-testid="companion-host"]')?.classList.contains('chibi')`, 'default-Q')
    checks.push('real assistant defaults to Q renderer')
    const fixture = Array.from({ length: 12 }, (_, index) => `　　第${index + 1}段：窗外的雨停了。她合上笔记，等待同桌继续讲述故事。这是隔离界面测试，不属于作者作品。`).join('\n\n')
    await click('[data-testid="manuscript-input"]')
    window.webContents.focus()
    await window.webContents.insertText(fixture)
    await waitFor(`document.querySelector('[data-testid="companion-host"]')?.dataset.motion==='quiet'`, 'typing-silences-companion')
    await click('[data-testid="save-manuscript"]')
    await waitFor(`(await window.novelDesktop.chapters.get(1)).content.includes(${JSON.stringify(fixture)})`, 'native-fixture-saved')
    await waitFor(`!document.querySelector('[data-testid="manuscript-save-state"].saving')`, 'native-save-ui-acknowledged')
    checks.push('native manuscript input quiets companion and fixture prose persists through normal save')
    await capture('writing')
    await click('[data-testid="companion-mode-detailed"]')
    await waitFor(`document.querySelector('[data-testid="companion-host"]')?.classList.contains('detailed')`, 'detailed-mode')
    await capture('writing-detailed')
    await click('[data-testid="companion-mode-hidden"]')
    await waitFor(`document.querySelector('[data-testid="companion-hidden"]')&&!document.querySelector('[data-testid="companion-host"]')`, 'hidden-mode')
    await click('[data-testid="companion-hidden"] button')
    await waitFor(`document.querySelector('[data-testid="companion-host"]')?.classList.contains('chibi')`, 'restore-Q')
    checks.push('detailed, hidden and restore use actual assistant controls')

    stage = 'focus'
    await click('[data-testid="manuscript-view-menu"]')
    await click('[data-testid="manuscript-focus"]')
    await waitFor(`document.querySelector('.manuscript-editor.is-focus-mode')`, 'focus-entered')
    if (!await evaluate(`Boolean(document.querySelector('.assistant-panel'))`)) {
      await click('[data-testid="manuscript-view-menu"]')
      await click('[data-testid="manuscript-focus-assistant"]')
    }
    await waitFor(`document.querySelector('[data-testid="companion-hidden"]')&&!document.querySelector('[data-testid="companion-host"]')&&document.querySelector('[data-testid="writing-agent-input"]')`, 'focus-companion-hidden-AI-retained')
    await setValue('[data-testid="writing-agent-input"]', '这段故事的节奏如何？（隔离界面测试，不发送）')
    await waitFor(`!document.querySelector('[data-testid="run-writing-agent"]').disabled`, 'focus-AI-send-available')
    await setValue('[data-testid="writing-agent-input"]', '')
    await capture('focus')
    await click('[data-testid="manuscript-view-menu"]')
    await click('[data-testid="manuscript-focus"]')
    await waitFor(`!document.querySelector('.manuscript-editor.is-focus-mode')`, 'focus-exited')
    checks.push('focus hides companion and keeps docked AI available')

    stage = 'settings-persist'
    await openSettings()
    await click('[data-testid="companion-project-specific"]')
    await setValue('[data-testid="companion-writing-select"]', 'detailed')
    await click('[data-testid="companion-setting-followPointer"]')
    await click('[data-testid="companion-setting-autoBlink"]')
    await setValue('[aria-label="动画强度"]', '0.2')
    const saved = await evaluate(`(()=>{const value=JSON.parse(localStorage.getItem('lanjian-companion-v1'));return {defaults:value.defaults,projects:Object.values(value.projects)};})()`)
    if (saved.projects.length !== 1 || saved.projects[0].writingMode !== 'detailed' || saved.projects[0].autoBlink || saved.projects[0].followPointer || 'reducedMotion' in saved.projects[0] || saved.projects[0].intensity !== .2 || saved.defaults.writingMode !== 'detailed') throw new Error('narrative-settings-not-isolated-persisted')
    await capture('settings')
    await new Promise<void>((resolve, reject) => {
      const loaded = () => { clearTimeout(timeout); resolve() }
      const timeout = setTimeout(() => { window.webContents.removeListener('did-finish-load', loaded); reject(new Error('narrative-renderer-reload-timeout')) }, 15_000)
      window.webContents.once('did-finish-load', loaded)
      window.webContents.reload()
    })
    await waitFor(`window.novelDesktop&&document.querySelector('.project-library')&&!document.querySelector('[data-testid="workspace-loading"]')`, 'reload-library-ready')
    if (await evaluate(`Boolean(document.querySelector('[data-testid="app-boot-skip"]'))`)) {
      await click('[data-testid="app-boot-skip"]')
      await waitFor(`!document.querySelector('[data-testid="app-boot-skip"]')`, 'reloaded-preview-closed')
    }
    await click('.work-item-open[aria-label*="烟测书稿"]')
    await waitFor(`document.querySelector('.activitybar')&&!document.querySelector('.app-frame[inert]')&&!document.querySelector('[data-testid="workspace-loading"]')`, 'reopened-workspace-ready')
    await openWriting()
    await waitFor(`document.querySelector('[data-testid="companion-host"]')?.classList.contains('detailed')&&document.querySelector('[data-testid="companion-host"]')?.dataset.motion==='quiet'`, 'reloaded-quiet-detailed')
    const motion = await evaluate(`(async()=>{const art=document.querySelector('[data-testid="companion-host"] .companion-art');const before=getComputedStyle(art).transform;await new Promise(r=>setTimeout(r,180));return {before,after:getComputedStyle(art).transform};})()`)
    if (motion.before !== motion.after) throw new Error('narrative-reduced-motion-is-not-static')
    if (!await evaluate(`(async()=> (await window.novelDesktop.chapters.get(1)).content.includes(${JSON.stringify(fixture)}))()`)) throw new Error('narrative-reload-lost-fixture-prose')
    checks.push('per-book controls persist across renderer reload without changing global settings')

    stage = 'responsive'
    const layouts: unknown[] = []
    for (const view of [
      { width: 1440, height: 940, zoom: 1, capture: 'writing-restored' },
      { width: 1100, height: 800, zoom: 1, capture: 'writing-compact' },
      { width: 1440, height: 940, zoom: 1.25, capture: 'writing-125-percent' },
      { width: 1440, height: 940, zoom: 1, capture: 'writing-roundtrip' }
    ]) {
      window.setSize(view.width, view.height)
      window.webContents.setZoomFactor(view.zoom)
      // On Windows, CSS metrics/RAF can advance before the compositor's zoom surface.
      // This bounded driver-only wait is not a product loading delay.
      await new Promise(resolve => setTimeout(resolve, 250))
      await paint()
      const viewportBefore = await evaluate('innerWidth')
      if (window.webContents.getZoomFactor() !== view.zoom || Math.abs(viewportBefore - window.getContentSize()[0] / view.zoom) > 3) throw new Error('narrative-zoom-before-capture-mismatch')
      const layout = await evaluate(`(()=>{const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const input=document.querySelector('[data-testid="writing-agent-input"]');const send=document.querySelector('[data-testid="run-writing-agent"]');const sr=send?.getBoundingClientRect();return {rail:rect('.activitybar'),tree:rect('.explorer'),body:rect('.workbench'),assistant:rect('.assistant-panel'),host:rect('[data-testid="companion-host"]'),input:rect('[data-testid="writing-agent-input"]'),send:rect('[data-testid="run-writing-agent"]'),sendHit:Boolean(sr&&send.contains(document.elementFromPoint(sr.x+sr.width/2,sr.y+sr.height/2))),width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,inputEnabled:Boolean(input&&!input.disabled)};})()`)
      layouts.push(layout)
      if (!layout.rail || !layout.tree || !layout.body || !layout.assistant || !layout.host || !layout.input || !layout.send) throw new Error('narrative-four-regions-missing')
      if (layout.tree.right > layout.body.left + 1 || layout.body.right > layout.assistant.left + 1 || layout.body.width < 420 || layout.assistant.right > layout.width + 1 || layout.send.bottom > layout.height || !layout.sendHit || layout.overflow || !layout.inputEnabled) throw new Error('narrative-four-region-layout:' + JSON.stringify(layout))
      await capture(view.capture)
      if (window.webContents.getZoomFactor() !== view.zoom || await evaluate('innerWidth') !== viewportBefore) throw new Error('narrative-zoom-after-capture-mismatch')
      if (view.zoom === 1.25 && captureHashes.get(view.capture) === captureHashes.get('writing-restored')) throw new Error('narrative-zoom-capture-reused-unscaled-surface')
    }
    checks.push('wide/compact/125%-zoom/wide maintains four nonoverlapping regions and a hit-testable send button')

    stage = 'library'
    await click('.activitybar [data-activity="library"]')
    await waitFor(`document.querySelector('.project-library')`, 'library')
    await waitFor(`document.querySelector('[data-testid="library-tree-chapter"]')&&!document.querySelector('.library-project-tree .tree-status[role="status"]')`, 'library-initial-tree-ready')
    await capture('library')
    const library = await evaluate(`(()=>{const host=document.querySelector('[data-testid="companion-host"]');return {detailed:host?.classList.contains('detailed'),library:host?.classList.contains('library'),expand:Boolean(document.querySelector('[data-testid="library-project-expand"]'))};})()`)
    if (!library.detailed || !library.library || !library.expand) throw new Error('narrative-library-stage-tree-missing:' + JSON.stringify(library))
    checks.push('actual library contains detailed companion stage and lazy project tree')
    stage = 'library-night-theme'
    await click('.project-library [data-activity="settings"]')
    await waitFor(`document.querySelector('.local-appearance-dialog[open]')`, 'library-appearance-dialog')
    await click('.local-appearance-dialog [data-preview-theme="moye"]')
    await waitFor(`document.documentElement.dataset.theme==='moye'&&localStorage.getItem('lanjian-theme')==='moye'`, 'night-theme-persisted')
    await click('.local-appearance-dialog [aria-label="关闭外观设置"]')
    await waitFor(`!document.querySelector('.local-appearance-dialog[open]')`, 'library-appearance-closed')
    await capture('library-night')
    const nightControls = await evaluate(`['.library-actions .secondary','.library-actions .primary','.work-item-open'].map(selector=>{const el=document.querySelector(selector),style=getComputedStyle(el);return {selector,background:style.backgroundColor,color:style.color};})`)
    checks.push('night theme is selected and saved through actual library settings')
    stage = 'library-chapter-open'
    const projectCard = '.work-item-card[data-project-title="烟测书稿"]'
    if (!await evaluate(`document.querySelector(${JSON.stringify(projectCard + ' [data-testid="library-project-expand"]')})?.getAttribute('aria-expanded')==='true'`)) await click(projectCard + ' [data-testid="library-project-expand"]')
    await waitFor(`document.querySelector(${JSON.stringify(projectCard + ' .library-project-tree')})&&!document.querySelector(${JSON.stringify(projectCard + ' .tree-status[role="status"]')})`, 'book-tree-loaded')
    if (!await evaluate(`Boolean(document.querySelector(${JSON.stringify(projectCard + ' [data-testid="library-tree-chapter"][title="待删旧章"]')}))`)) {
      const collapsed = await evaluate(`document.querySelectorAll(${JSON.stringify(projectCard + ' .tree-expand[aria-expanded="false"]')}).length`)
      for (let index = 0; index < collapsed; index++) await click(projectCard + ' .tree-expand[aria-expanded="false"]')
    }
    await click(projectCard + ' [data-testid="library-tree-chapter"][title="待删旧章"]')
    await waitFor(`document.querySelector('[data-testid="library-selection"]')?.textContent.includes('待删旧章')&&document.querySelector('.project-library')`, 'selected-chapter-dossier')
    await capture('library-selected-chapter')
    await click('[data-testid="library-selection-open"]')
    await waitFor(`!document.querySelector('.app-frame[inert]')&&document.querySelector('[data-testid="manuscript-input"]')&&document.querySelector('.manuscript-metrics')?.textContent.includes('第 2 章')`, 'library-opens-selected-chapter-2')
    const opened = await evaluate(`(()=>{const editor=document.querySelector('[data-testid="manuscript-input"]');return {content:editor?.textContent,top:editor?.closest('.cm-scroller')?.scrollTop??null};})()`)
    if (!opened.content?.includes('此章应进入模拟回收站。')) throw new Error('library-opened-wrong-chapter-content')
    await capture('writing-night-chapter-2')
    checks.push('tree selection stays in library until explicit open, then opens exact chapter 2 and its original text')
    const result = { ok: true, checks, captures, layouts, nightControls, paintDiagnostics }
    await writeFile(join(dirname(capturePath), 'narrative-verification.json'), JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    await capture('failure').catch(() => undefined)
    const result = { ok: false, stage, error: error instanceof Error ? error.message : String(error), checks, captures, paintDiagnostics }
    await writeFile(join(dirname(capturePath), 'narrative-verification.json'), JSON.stringify(result, null, 2))
    return result
  } finally {
    if (isolatedWindowConfigured && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.setBackgroundThrottling(originalBackgroundThrottling)
  }
}
