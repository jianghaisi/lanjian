import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { checkPetAnimation, checkPetPanel, checkPetSizes } from './pet-experience-checks.mjs'
const require=createRequire(import.meta.url);require('tsx/cjs')
const {SettingsStore}=require('../src/main/platform/settings/settings-store.ts')
const {ProjectService}=require('../src/main/modules/library/application/project-service.ts')
const {defaultCompanionSettings}=require('../src/contracts/companion/companion-settings.ts')
const experience=process.argv.includes('--experience'),experienceChecks={}
const run=promisify(execFile),root=await mkdtemp(join(await realpath(tmpdir()),'lanjian-pet-system-')),profile=join(root,'profile'),output=resolve(experience?'artifacts/ui/pet-experience':'artifacts/ui/pet-system')
await mkdir(output,{recursive:true})
const projects=new ProjectService(new SettingsStore(profile,{available:()=>false,encrypt:()=>'',decrypt:()=>''}))
const work=(await projects.create({parentPath:root,title:'桌宠系统隔离验证'})).project
const manuscript=join(work.path,'正文','第1章-隔离测试.md'),body='仅验证桌宠功能，不是作者作品。'
await writeFile(manuscript,body)
const settings=defaultCompanionSettings();settings.revision=1;settings.voice={...settings.voice,mute:true,textModel:false,preload:false,proactive:false};settings.microphone.enabled=true
await writeFile(join(profile,'companion-settings.json'),JSON.stringify(settings))
const env={...process.env,LANJIAN_USER_DATA_PATH:profile};delete env.ELECTRON_RUN_AS_NODE
for(const key of Object.keys(env))if(key.startsWith('LANJIAN_SMOKE')||key.startsWith('LANJIAN_CAPTURE'))delete env[key]
let app,page,pet,stage='launch',originalCursor
const checks=[],errors=[]
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function launch(){
  app=await _electron.launch({args:[resolve('out-pet-check/main/index.js'),'--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('../..','.local/companion-voice/models/asr/test_wavs/zh.wav')}`],env,timeout:30000})
  page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
  await page.getByTestId('app-boot').waitFor({state:'detached',timeout:30000});await page.getByTestId('library-continue-writing').waitFor()
}
async function openWork(){await page.getByTestId('library-continue-writing').click();await page.getByTestId('external-companion').waitFor();await page.getByTestId('workspace-loading').waitFor({state:'detached'})}
async function findPet(){
  for(let i=0;i<100;i++){pet=app.windows().find(window=>/pet\.html/.test(window.url()));if(pet)break;await pause(100)}
  assert.ok(pet);pet.setDefaultTimeout(15000);pet.on('pageerror',error=>errors.push(error.message));await pet.getByTestId('desktop-pet-window').waitFor()
}
async function petFocus(){await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>/pet\.html/.test(w.webContents.getURL()));win.show();win.focus();win.webContents.focus()})}
async function capture(name){await pet.screenshot({path:join(output,name+'.png')})}
async function bounds(){return app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>/pet\.html/.test(w.webContents.getURL())).getBounds())}
async function nativeMouse(points){
  const physical=await app.evaluate(({screen},points)=>points.map(point=>({...screen.dipToScreenPoint(point),down:point.down,up:point.up})),points)
  const script=`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PetMouse { [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); }'; [PetMouse]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null; `+physical.map(p=>`[PetMouse]::SetCursorPos(${Math.round(p.x)},${Math.round(p.y)}) | Out-Null; Start-Sleep -Milliseconds 140; ${p.down?'[PetMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 140;':''} ${p.up?'[PetMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 140;':''}`).join(' ')
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000})
}
try{
  await launch();originalCursor=await app.evaluate(({screen})=>screen.getCursorScreenPoint());await openWork()
  assert.equal(app.windows().filter(w=>/pet\.html/.test(w.url())).length,0)
  stage='enable';await page.getByTestId('external-companion').click();await findPet()
  if(experience){stage='continuous artwork';experienceChecks.animation=await checkPetAnimation(pet,output)}
  assert.equal(await pet.evaluate(()=>typeof window.novelDesktop),'undefined');checks.push('default off, explicit enable, sandbox pet has no book API')
  await capture('idle')
  stage='care';await pet.getByTestId('pet-window-menu-toggle').click();await pet.getByTestId('pet-open-care').click()
  await pet.getByTestId('pet-use-food').waitFor();const before=await pet.evaluate(()=>window.companionCare.get())
  if(experience){experienceChecks.care=await checkPetPanel(pet,'care');await pet.locator('.care-scroll').evaluate(e=>e.scrollTop=0)}
  await pet.getByTestId('pet-use-food').click();await pet.waitForFunction(n=>window.companionCare.get().then(s=>s.inventory.food===n),before.inventory.food-1)
  await pet.getByRole('button',{name:'背包 · 小铺',exact:true}).click();await pet.getByTestId('pet-buy-food').click()
  await pet.waitForFunction(n=>window.companionCare.get().then(s=>s.coins===n),before.coins-8);await capture('inventory')
  await pet.getByRole('button',{name:'照料',exact:true}).click();await pet.getByTestId('pet-use-water').click();await pet.getByTestId('pet-use-toy').click()
  await pet.getByRole('button',{name:'领取 30 星币 · 25 经验'}).click();await capture('care')
  await pet.getByTestId('pet-sleep').click();await pet.waitForFunction(()=>window.companionCare.get().then(s=>s.sleeping));await capture('sleeping')
  await pet.getByTestId('pet-sleep').click();checks.push('real UI feed, buy, drink, play, daily claim, sleep/wake persist')
  stage='focus';await pet.getByRole('button',{name:'活动',exact:true}).click();await pet.getByTestId('pet-focus-start').click();await pet.getByRole('button',{name:'暂停',exact:true}).click()
  const focused=await pet.evaluate(()=>window.companionCare.get());assert.equal(focused.focus.status,'paused')
  await capture('activities');await pet.getByRole('button',{name:'取消',exact:true}).click();checks.push('focus start, pause, cancel without reward through UI')
  await pet.getByRole('button',{name:'关闭照料面板'}).click()
  stage='chat';await pet.getByTestId('pet-window-menu-toggle').click();await pet.getByTestId('pet-open-chat').click();await pet.getByTestId('pet-chat-input').fill('现在几点？')
  if(experience){experienceChecks.chat=await checkPetPanel(pet,'chat');experienceChecks.sizes=await checkPetSizes(pet,page,output)}
  await pet.getByTestId('pet-chat-send').click();await pet.locator('.pet-chat-reply').filter({hasText:'2026'}).waitFor();await capture('chat')
  checks.push('offline preset chat with both models disabled')
  stage='microphone';await petFocus()
  await pet.evaluate(()=>{window.petTestTracks=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await original(c);window.petTestTracks.push(...s.getTracks());return s}})
  await pet.getByTestId('pet-microphone').click();await pet.getByTestId('pet-microphone').filter({hasText:'结束录音'}).waitFor();await pause(4000);await capture('recording')
  await pet.getByTestId('pet-microphone').click();await pet.waitForFunction(()=>document.querySelector('[data-testid="pet-chat-input"]').value.length>0,null,{timeout:30000})
  assert.ok(await pet.evaluate(()=>window.petTestTracks.every(t=>t.readyState==='ended')));await capture('transcribed')
  checks.push('real Electron permission/worklet/ASR/draft pipeline with fake device playing public Chinese WAV; tracks ended')
  await pet.getByRole('button',{name:'关闭聊天',exact:true}).click()
  stage='native drag';await petFocus()
  const initial=await bounds(),center=await pet.getByTestId('pet-window-handle').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
  const start={x:initial.x+center.x,y:initial.y+center.y}
  await nativeMouse([{...start,down:true},{...start,x:start.x+2},{...start,x:start.x+2,up:true}]);assert.deepEqual(await bounds(),initial)
  await pet.evaluate(()=>{window.petMotions=[];window.desktopPet.onMotion(v=>window.petMotions.push(v))})
  await nativeMouse([{...start,down:true},{x:start.x-12,y:start.y},{x:start.x-70,y:start.y-15},{x:start.x-130,y:start.y-20},{x:start.x-130,y:start.y-20,up:true}])
  const moved=await bounds();assert.ok(moved.x<initial.x-40);assert.ok(await pet.evaluate(()=>window.petMotions.some(m=>m.velocityX<0)))
  assert.equal(await pet.locator('.desktop-pet-window.dragging').count(),0);await capture('dragged')
  checks.push('actual Windows mouse: sub-threshold click does not move; left drag follows with velocity and ends on release')
  const rightStart={x:moved.x+center.x,y:moved.y+center.y}
  await nativeMouse([{...rightStart,down:true},{x:rightStart.x+12,y:rightStart.y},{x:rightStart.x+65,y:rightStart.y},{x:rightStart.x+105,y:rightStart.y},{x:rightStart.x+105,y:rightStart.y,up:true}])
  assert.ok((await bounds()).x>moved.x+40);assert.ok(await pet.evaluate(()=>window.petMotions.some(m=>m.velocityX>0)))
  checks.push('actual right drag produces opposite tilt velocity without mirroring artwork')
  stage='click through'
  await app.evaluate(async({BrowserWindow})=>{const pet=BrowserWindow.getAllWindows().find(w=>/pet\.html/.test(w.webContents.getURL()));const probe=new BrowserWindow({...pet.getBounds(),frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await probe.loadURL('data:text/html,<title>Pet pointer probe</title><body style="margin:0;background:aliceblue;height:100vh">Isolated pointer probe</body>');await probe.webContents.executeJavaScript('window.probeClicks=0;document.addEventListener("click",()=>window.probeClicks++)');probe.showInactive()})
  const position=await bounds();await nativeMouse([{x:position.x+25,y:position.y+45,down:true},{x:position.x+25,y:position.y+45,up:true}])
  const probeClicks=()=>app.evaluate(async({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Pet pointer probe').webContents.executeJavaScript('window.probeClicks'))
  assert.ok(await probeClicks()>=1)
  await page.evaluate(async()=>{const s=await window.desktopPet.get();await window.desktopPet.command({type:'configure',preferences:{...s.preferences,clickThrough:true}})})
  const oldClicks=await probeClicks();await nativeMouse([{x:position.x+center.x,y:position.y+center.y,down:true},{x:position.x+center.x,y:position.y+center.y,up:true}]);assert.ok(await probeClicks()>oldClicks)
  await page.evaluate(()=>window.desktopPet.command({type:'locate'}));assert.equal((await page.evaluate(()=>window.desktopPet.get())).preferences.clickThrough,false)
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Pet pointer probe').destroy())
  checks.push('actual OS clicks pass through blank/full pet; main locate restores input')
  stage='minimize and settings'
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>! /pet\.html/.test(w.webContents.getURL())).minimize())
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>/pet\.html/.test(w.webContents.getURL())).isVisible()),true)
  await pet.getByTestId('pet-window-menu-toggle').click();await pet.getByRole('button',{name:'返回写作 ↗'}).click()
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>! /pet\.html/.test(w.webContents.getURL())).isMinimized()),false)
  await pet.getByRole('button',{name:'完整设置 ↗'}).click();await page.getByTestId('desktop-pet-settings').waitFor();await page.screenshot({path:join(output,'settings.png')})
  checks.push('main minimize retains pet; return-to-writing restores main; full settings opens correct section')
  stage='shared preferences';await page.evaluate(()=>window.companionSettings.update({voice:{volume:.37},reducedMotion:true}))
  await pet.waitForFunction(()=>window.companionSettings.get().then(s=>s.voice.volume===.37&&s.reducedMotion));checks.push('main and pet shared preferences synchronized')
  if(experience){await pet.waitForFunction(()=>document.querySelector('[data-testid="pet-artwork"]')?.dataset.motion==='paused');experienceChecks.reducedMotion=true;await writeFile(join(output,'experience.json'),JSON.stringify(experienceChecks,null,2))}
  stage='restart';const saved=await pet.evaluate(()=>window.companionCare.get());await app.close();app=undefined
  await launch();await openWork();await findPet();const restored=await pet.evaluate(()=>window.companionCare.get())
  assert.equal(restored.coins,saved.coins);assert.deepEqual(restored.inventory,saved.inventory);assert.equal((await pet.evaluate(()=>window.companionSettings.get())).voice.volume,.37)
  checks.push('restart preserves pet enabled, inventory, coins and shared preferences')
  assert.equal(await readFile(manuscript,'utf8'),body);assert.deepEqual(errors,[])
  const displays=await app.evaluate(({screen})=>screen.getAllDisplays().map(d=>({workArea:d.workArea,scaleFactor:d.scaleFactor})))
  await writeFile(join(output,'report.json'),JSON.stringify({passed:true,checks,errors,profile,displays,realMicrophone:false},null,2));console.log(JSON.stringify({passed:true,checks,output}))
}catch(error){await pet?.screenshot({path:join(output,'failure.png')}).catch(()=>{});await page?.screenshot({path:join(output,'failure-main.png')}).catch(()=>{});const mainText=await page?.locator('body').innerText().catch(()=>'');await writeFile(join(output,'report.json'),JSON.stringify({passed:false,stage,error:String(error),checks,errors,profile,mainText},null,2));throw error}
finally{if(app){if(originalCursor)await nativeMouse([originalCursor]).catch(()=>{});await app.close().catch(()=>{})}}
