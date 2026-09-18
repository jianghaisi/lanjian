// Opt-in observer for the isolated electron-smoke.mjs process. No app state writes.
if (process.versions.electron && process.env.LANJIAN_SMOKE === '1' && process.env.LANJIAN_SMOKE_NARRATIVE_ONLY === '1') setImmediate(() => {
  const { app, BrowserWindow } = require('electron')
  const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs')
  const { resolve, dirname } = require('node:path')
  const output = resolve(process.cwd(), 'artifacts/ui/narrative-paint-observation.jsonl')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, '')
  const write = value => appendFileSync(output, JSON.stringify({ time: Date.now(), ...value }) + '\n')
  if (!app) { write({ event: 'observer-api-unavailable' }); return }
  const observe = window => {
    let sampling = false
    let lastDocument = null
    let loadCount = 0
    const state = () => ({ visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), bounds: window.getBounds(), zoom: window.webContents.getZoomFactor(), backgroundThrottling: window.webContents.getBackgroundThrottling() })
    for (const event of ['show', 'hide', 'focus', 'blur', 'minimize', 'restore']) window.on(event, () => write({ event, ...state() }))
    window.webContents.on('did-finish-load', () => { loadCount++; write({ event: 'did-finish-load', loadCount, ...state() }) })
    const timer = setInterval(async () => {
      if (sampling || window.isDestroyed() || window.webContents.isDestroyed()) return
      sampling = true
      try {
        const document = await window.webContents.executeJavaScript(`(()=>{
          if(!window.__narrativePaintObserver){window.__narrativePaintObserver={frames:0};const tick=()=>{window.__narrativePaintObserver.frames++;requestAnimationFrame(tick)};requestAnimationFrame(tick)}
          const active=document.activeElement;const dialog=document.querySelector('dialog[open]');
          return {visibility:document.visibilityState,hidden:document.hidden,focused:document.hasFocus(),frames:window.__narrativePaintObserver.frames,
            theme:document.documentElement.dataset.theme,width:innerWidth,height:innerHeight,
            active:active?{tag:active.tagName,testId:active.dataset.testid||'',label:active.getAttribute('aria-label')||''}:null,
            dialog:dialog?.className||'',boot:Boolean(document.querySelector('[data-testid="app-boot-skip"]')),openingQuery:new URL(location.href).searchParams.get('opening'),
            library:Boolean(document.querySelector('.project-library')),inert:Boolean(document.querySelector('.app-frame[inert]'))};})()`)
        lastDocument = document
        write({ event: 'sample', loadCount, ...state(), document })
      } catch (error) { write({ event: 'sample-error', error: error?.message || String(error), ...state() }) }
      finally { sampling = false }
    }, 150)
    window.on('closed', () => { clearInterval(timer); write({ event: 'closed', lastDocument }) })
    app.on('will-quit', () => { clearInterval(timer); write({ event: 'will-quit', lastDocument }) })
  }
  app.on('browser-window-created', (_event, window) => observe(window))
  for (const window of BrowserWindow.getAllWindows()) observe(window)
})
