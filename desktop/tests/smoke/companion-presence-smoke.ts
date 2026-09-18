import type { BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

async function focusCompanionWindow(window: BrowserWindow) {
  window.show(); window.focus(); window.webContents.focus()
  if(process.platform==='win32' && !await window.webContents.executeJavaScript('document.hasFocus()')) {
    if(process.env.LANJIAN_SMOKE!=='1')throw Error('companion-focus-smoke-only')
    // Focus only this synthetic test process; never weaken the foreground speech policy.
    await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(New-Object -ComObject WScript.Shell).AppActivate(${process.pid})`],{windowsHide:true,timeout:5000})
    window.focus();window.webContents.focus()
  }
  if(!await window.webContents.executeJavaScript('document.hasFocus()'))throw Error('companion-smoke-needs-native-foreground')
}

async function pressCompanion(window: BrowserWindow) {
  const point = await window.webContents.executeJavaScript(`(()=>{const e=document.querySelector('[data-testid="archive-character-talk"]'),r=e.getBoundingClientRect(),x=r.left+r.width*.5,y=Math.max(120,r.top+r.height*.38);if(!e.contains(document.elementFromPoint(x,y)))throw Error('companion-hold-hit-missed');return{x,y}})()`)
  const zoom = window.webContents.getZoomFactor()
  const x=Math.round(point.x*zoom), y=Math.round(point.y*zoom)
  await focusCompanionWindow(window)
  window.webContents.sendInputEvent({type:'mouseMove',x,y})
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y})
  return () => window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x,y})
}

export async function holdCompanion(window: BrowserWindow, duration = 3100) {
  const release = await pressCompanion(window)
  await new Promise(resolve=>setTimeout(resolve,duration))
  release()
}

/** Native input verifies tap, delayed hint and chat are separate user intents. */
export async function checkCompanionGesture(window: BrowserWindow, capture:(name:string)=>Promise<void>) {
  const evaluate=(js:string)=>window.webContents.executeJavaScript(js)
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
  const sample=()=>evaluate(`(()=>{const p=document.querySelector('[data-testid="interactive-archive-character"]');return {action:Number(p.dataset.action),responding:p.classList.contains('responding'),animation:getComputedStyle(p.querySelector('.character-live2d')).animationName,hint:!!p.querySelector('.hold-progress'),chat:!!document.querySelector('[data-testid="companion-chat-composer"]')}})()`)
  const before=await sample()
  await holdCompanion(window,250); await wait(40)
  const tapped=await sample()
  if(tapped.action!==before.action+1||!tapped.responding||!tapped.animation.includes('character-acknowledge')||tapped.chat||tapped.hint)throw Error('companion-tap-lost:'+JSON.stringify(tapped))
  await capture('companion-short-tap')
  await wait(800)
  const releasePending=await pressCompanion(window)
  await wait(700)
  if((await sample()).hint)throw Error('companion-hint-before-one-second')
  await wait(500)
  const pending=await sample()
  if(!pending.hint||pending.chat||pending.action!==tapped.action)throw Error('companion-delayed-hint-missing')
  await capture('companion-one-second-hold')
  releasePending(); await wait(2100)
  const cancelled=await sample()
  if(cancelled.hint||cancelled.chat||cancelled.action!==tapped.action)throw Error('companion-pending-release-became-tap')

  const releaseMoved=await pressCompanion(window)
  window.webContents.sendInputEvent({type:'mouseMove',x:5,y:5})
  releaseMoved(); await wait(3100)
  const moved=await sample()
  if(moved.hint||moved.chat||moved.action!==tapped.action)throw Error('companion-move-did-not-cancel')

  await evaluate(`document.querySelector('[data-testid="archive-character-talk"]').focus()`)
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'})
  await wait(180)
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'})
  await wait(50)
  const keyTap=await sample()
  if(keyTap.action!==tapped.action+1||keyTap.chat||keyTap.hint)throw Error('companion-keyboard-tap-lost')
  await wait(800)
  await focusCompanionWindow(window)
  await evaluate(`document.querySelector('[data-testid="archive-character-talk"]').focus()`)
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'})
  await wait(1200)
  if(!(await sample()).hint)throw Error('companion-keyboard-hold-hint-missing:'+JSON.stringify(await evaluate(`({focused:document.hasFocus(),active:document.activeElement?.getAttribute('data-testid')})`)))
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
  // An unrelated keyup must not act as the Return release.
  if(!(await sample()).hint)throw Error('companion-unrelated-key-released-hold')
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'})
  await wait(2100)
  const keyCancelled=await sample()
  if(keyCancelled.hint||keyCancelled.chat||keyCancelled.action!==keyTap.action)throw Error('companion-keyboard-pending-release-became-tap')

  const releaseLong=await pressCompanion(window)
  await wait(2700)
  if((await sample()).chat)throw Error('companion-chat-before-three-seconds')
  await wait(550)
  releaseLong(); await wait(50)
  const opened=await sample()
  if(!opened.chat||opened.hint||opened.action!==keyTap.action)throw Error('companion-long-hold-missing-or-duplicate-tap:'+JSON.stringify(opened))
  return {kind:'companion-tap-and-hold',nativePointer:true,nativeKeyboard:true,tapRestored:true,hintDelayed:true,pendingReleaseCancelled:true,moveCancelled:true,noDuplicateTap:true,taps:opened.action-before.action}
}

/** Real pointer hover + local TTS in the isolated library, never fixture-generated PCM. */
export async function checkCompanionPresence(window: BrowserWindow, capture: (name:string)=>Promise<void>) {
  const evaluate=(js:string)=>window.webContents.executeJavaScript(js)
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
  await focusCompanionWindow(window)
  const preparationStarted = Date.now()
  const profile = await evaluate(`window.novelDesktop.companionVoice.status()`)
  if(profile.profile !== 'gpt-sovits-v2-fp16' || !profile.installed)throw Error('presence-wrong-speech-profile')
  // Join real preparation through the public bridge, not a readiness/PCM fixture.
  if(!await evaluate(`window.novelDesktop.companionVoice.prepare('ningguang')`))throw Error('presence-prepare-failed')
  const preparationMs = Date.now()-preparationStarted
  if(window.webContents.isCurrentlyAudible())throw Error('presence-preparation-played-audio')
  await focusCompanionWindow(window)
  await wait(150)
  const before=await evaluate(`['.library-heading','.archive-hero','.all-works-toolbar','.library-character-viewport'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,r.x,r.y,r.width,r.height]})`)
  const point=await evaluate(`(()=>{const r=document.querySelector('.continue-dossier').getBoundingClientRect();return{x:r.left+r.width*.75,y:r.top+r.height*.3}})()`)
  const zoom=window.webContents.getZoomFactor()
  window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x*zoom),y:Math.round(point.y*zoom)})
  await wait(700)
  if(await evaluate(`!!document.querySelector('[data-testid="companion-notice"],[data-testid="companion-chat-composer"]')`))throw Error('presence-opened-before-dwell')
  const started=Date.now()
  let sample: {text:string;playing:boolean}|undefined
  for(let i=0;i<450;i++) {
    sample=await evaluate(`(()=>{const n=document.querySelector('[data-testid="companion-notice"]');return n?{text:n.textContent,playing:n.dataset.playing==='true'}:null})()`)
    if(sample?.playing)break
    await wait(100)
  }
  if(!sample?.playing||!sample.text.includes('要开始创作'))throw Error('presence-no-real-hover-audio:'+JSON.stringify({sample,dom:await evaluate(`({focus:document.hasFocus(),hidden:document.hidden,dialog:!!document.querySelector('dialog[open]'),hover:document.querySelector('.continue-dossier')?.matches(':hover'),prefs:localStorage.getItem('lanjian-companion-voice-v1')})`)}))
  const firstAudioMs=Date.now()-started+700
  let audible=false
  for(let i=0;i<20;i++){audible ||= window.webContents.isCurrentlyAudible();if(audible)break;await wait(100)}
  if(!audible||window.webContents.isAudioMuted())throw Error('presence-inaudible')
  if(await evaluate(`!!document.querySelector('[data-testid="companion-chat-composer"]')`))throw Error('presence-opened-full-chat')
  const after=await evaluate(`['.library-heading','.archive-hero','.all-works-toolbar','.library-character-viewport'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,r.x,r.y,r.width,r.height]})`)
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('presence-moved-layout')
  await capture('companion-proactive-hover-speaking')
  await evaluate(`document.querySelector('[data-testid="companion-notice"] button').click()`)
  await wait(2300)
  if(window.webContents.isCurrentlyAudible())throw Error('presence-audio-after-dismiss')
  window.webContents.sendInputEvent({type:'mouseMove',x:5,y:5})
  await wait(100)
  window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x*zoom),y:Math.round(point.y*zoom)})
  await wait(1600)
  if(await evaluate(`!!document.querySelector('[data-testid="companion-notice"]')`))throw Error('presence-repeated-without-cooldown')
  // Dismissal may have cancelled an active synthesis. Prepare the same real engine
  // again so tap latency is explicitly warm rather than hiding a second cold load.
  if(!await evaluate(`window.novelDesktop.companionVoice.prepare('ningguang')`))throw Error('tap-prepare-failed')
  const tapStarted = Date.now()
  await holdCompanion(window,250)
  let tapAudible = false
  for(let i=0;i<150;i++) {
    if(await evaluate(`document.querySelector('[data-testid="companion-notice"]')?.dataset.playing==='true'`) && window.webContents.isCurrentlyAudible()) { tapAudible=true;break }
    await wait(100)
  }
  const tapFirstAudioMs = Date.now()-tapStarted
  if(!tapAudible || await evaluate(`!!document.querySelector('[data-testid="companion-chat-composer"]')`))throw Error('tap-no-real-audio-or-opened-chat')
  await capture('companion-tap-speaking')
  await evaluate(`document.querySelector('[data-testid="companion-notice"] button').click()`)
  await wait(2300)
  if(window.webContents.isCurrentlyAudible())throw Error('tap-audio-after-dismiss')
  return {kind:'companion-proactive',trigger:'continue-hover',realTts:true,profile:profile.profile,preparationMs,preparationSilent:true,audible,fullChatHidden:true,unchangedModules:true,cooldown:true,firstAudioMs,text:sample.text,tapAudible,tapFirstAudioMs}
}
