import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { _electron } from 'playwright'

const root = await mkdtemp(join(tmpdir(), 'lanjian-manuscript-overlay-'))
const output = resolve(process.env.MANUSCRIPT_OVERLAY_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-manuscript-overlay-native')
await mkdir(output, { recursive: true })
const path = file => JSON.stringify(resolve(file).replaceAll('\\', '/'))
const shell = await readFile('src/renderer/app/AppShell.vue', 'utf8')
const surfaces = ['!chapterCardSaving && (chapterCardAdoption = null)', '!chapterCardSaving && (chapterCardOpen = false)', 'showCharacterConflicts = false', 'cancelChapterDelete'].map(action => {
  const start = shell.indexOf(`<DialogTransition @escape="${action}"`)
  assert.ok(start > 0, action)
  return shell.slice(start, shell.indexOf('</DialogTransition>', start) + '</DialogTransition>'.length)
}).join('\n')
// Actual shell markup and presentation, synthetic view state, no filesystem/model authority.
await writeFile(join(root, 'Fixture.vue'), `<script setup>
import {ref,nextTick} from 'vue';
import DialogTransition from ${path('src/renderer/ui/DialogTransition.vue')};
import StudioIcon from ${path('src/renderer/ui/StudioIcon.vue')};
const vAssistField={};
const chapterCardOpen=ref(false),chapterCardSaving=ref(false),chapterCardAdoption=ref(null),showCharacterConflicts=ref(false),showDeleteConfirm=ref(false),chapterDeleteTarget=ref(null),busy=ref(false);
const current=ref({id:'work-a'}),selectedId=ref(1);
const chapterPlanning={lifecycleStatus:'draft'},selectedChapterPosition=1,chapterTitle='测试章节',bookProfile={};
const chapterLifecycleLabels={draft:'草稿'},chapterLifecycleActions=[],chapterDerivativeEntries=[{id:'summary',label:'承接摘要',summary:'尚待确认',state:'stale'}];
const chapterCardDraft=ref({goal:'原有草稿',entryState:'',exitChange:'',beatsText:'',conflict:'',hook:'',charactersText:'',pointOfView:'',narrativeDistance:'',status:'draft'}),chapterSummaryDraft=ref(''),chapterSummaryStatus='尚待确认';
const chapterCardAdoptionFields=Array.from({length:8},(_,i)=>({key:'field'+i,label:'候选栏位'+i,action:'补入',current:'当前正式内容。\\n'.repeat(20),proposed:'候选尚未写入。\\n'.repeat(20)}));
const preview={option:{title:'保留悬念',rationale:'请逐项核对'},selected:Object.fromEntries(chapterCardAdoptionFields.map(f=>[f.key,true]))};
const characterContinuityFindings=[],literaryStyleFindings=[],findingHistory=null,saveState='saved',findingResolutionError='',decidingContinuityFindingId='',dismissingConflictId='';
const pendingCharacterConflicts=[{id:'synthetic',field:'identity',chapterPosition:1,name:'测试人物',claimedValue:'候选判断尚待核对',evidence:'正文证据。'.repeat(300)}],characterConflictLabels={identity:'身份'};
function record(action){window.fixture.events.push(action)}
function saveChapterCard(){record('save')}function saveChapterSummary(){record('summary')}function confirmChapterCardAdoption(){record('adopt')}function deleteChapter(){record('delete')}function dismissCharacterConflict(){record('dismiss')}function recheckSavedManuscript(){record('recheck')}
function cancelChapterDelete(){showDeleteConfirm.value=false;chapterDeleteTarget.value=null}
async function returnToManuscript(){showCharacterConflicts.value=false;await nextTick();document.querySelector('#manuscript').focus({preventScroll:true})}
function locateLegacyCharacterConflict(){returnToManuscript()}
window.fixture={events:[],set saving(v){chapterCardSaving.value=v},set scope(v){current.value={id:v.work};selectedId.value=v.chapter},openCard(){chapterCardOpen.value=true}};
</script><template><main class="redesigned-studio">
<button id="open-card" @click="chapterCardOpen=true">章卡</button><button id="open-adoption" @click="chapterCardAdoption=preview">候选</button><button id="open-conflicts" @click="showCharacterConflicts=true">冲突</button><button id="open-delete" @click="chapterDeleteTarget={id:1,position:1,title:'测试章节'};showDeleteConfirm=true">删除</button><textarea id="manuscript">原正文不变</textarea>
${surfaces}</main></template>`)
await writeFile(join(root, 'entry.js'), `import {createApp} from 'vue';import Fixture from './Fixture.vue';import ${path('src/renderer/assets/desktop.css')};import ${path('src/renderer/assets/desktop-redesign.css')};import ${path('src/renderer/assets/interaction-motion.css')};createApp(Fixture).mount('#app');`)
await build({ configFile:false, root, plugins:[vue()], define:{ 'process.env.NODE_ENV':'"production"',__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false' },resolve:{alias:{vue:resolve('node_modules/vue/dist/vue.esm-bundler.js')}},build:{outDir:join(root,'bundle'),emptyOutDir:false,lib:{entry:join(root,'entry.js'),name:'ManuscriptFixture',formats:['iife'],fileName:()=> 'fixture.js',cssFileName:'fixture'}},logLevel:'error'})
await writeFile(join(root, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><link rel="stylesheet" href="bundle/fixture.css"><style>
:root{--ink:#eef0e9;--ink-2:#cdd9d1;--paper:#252e29;--surface:#252e29;--surface-muted:#1c2520;--line:#4e5d53;--jade:#85b9a4;--jade-wash:#2a3d33;--muted:#adbbb1;--cinnabar:#f8b086;--serif:serif;--sans:system-ui}html[data-test-theme=light]{--ink:#24372d;--ink-2:#3d4e43;--paper:#f4f1e9;--surface:#faf8f1;--surface-muted:#eeece3;--line:#c8cfc7;--jade:#376d56;--jade-wash:#e4eee7;--muted:#5f6d64;--cinnabar:#9b4830}body{background:var(--surface);color:var(--ink)}main{padding:24px}#app{height:100vh}
</style><div id="app"></div><script src="bundle/fixture.js"></script></html>`)
await writeFile(join(root,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(root,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false}});w.setMenu(null);w.loadFile(${JSON.stringify(join(root,'index.html'))});});`)
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const app=await _electron.launch({args:[join(root,'main.cjs')],env})
const page=await app.firstWindow(),owner=await app.browserWindow(page),checks=[],samples={},errors=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
async function settle(selector){await page.locator(selector).evaluate(async e=>{await Promise.allSettled(e.getAnimations({subtree:true}).map(a=>a.finished))})}
async function capture(name){await page.screenshot({animations:'allow'});const png=await owner.evaluate(async w=>(await w.webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'))}
async function hit(locator){return locator.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})}
try{
  const card=page.getByTestId('chapter-card-sheet')
  await page.locator('#open-card').click();await settle('.chapter-card-backdrop')
  assert.equal(await card.getByLabel('关闭本章执行卡').evaluate(e=>e===document.activeElement),true)
  await card.locator('textarea').first().fill('尚未保存的作者草稿')
  assert.equal(await hit(page.getByTestId('save-chapter-card')),true)
  await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop=e.scrollHeight)
  assert.equal(await hit(page.getByTestId('save-chapter-card')),true)
  await page.getByTestId('save-chapter-card').focus();await page.keyboard.press('Tab')
  assert.equal(await card.getByLabel('关闭本章执行卡').evaluate(e=>e===document.activeElement),true)
  await card.evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));assert.equal(await card.count(),1)
  await page.evaluate(()=>window.fixture.saving=true);await page.keyboard.press('Escape')
  assert.equal(await card.count(),1);assert.equal(await card.getByLabel('关闭本章执行卡').isDisabled(),true)
  await page.locator('.chapter-card-backdrop').evaluate(e=>e.click());assert.equal(await card.count(),1)
  await page.evaluate(()=>window.fixture.saving=false)
  samples.returnScroll=await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop)
  assert.ok(samples.returnScroll>100)
  await capture('01-dark-card-fixed-actions')
  samples.reopen=await page.evaluate(async()=>{const root=document.querySelector('.chapter-card-backdrop');root.querySelector('header button').click();await new Promise(requestAnimationFrame);const retired={inert:root.inert,hidden:root.getAttribute('aria-hidden')};document.querySelector('#open-card').click();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const live=[...document.querySelectorAll('.chapter-card-backdrop')].filter(e=>!e.inert);return{retired,count:live.length,focused:live[0]?.contains(document.activeElement)}})
  assert.deepEqual(samples.reopen,{retired:{inert:true,hidden:'true'},count:1,focused:true})
  assert.equal(await card.locator('textarea').first().inputValue(),'尚未保存的作者草稿')
  assert.equal(await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop),samples.returnScroll)
  await page.keyboard.press('Escape');await card.waitFor({state:'detached'});assert.equal(await page.locator('#open-card').evaluate(e=>e===document.activeElement),true)
  checks.push('card-fixed-actions-draft-retention-tab-ime-busy-inert-reopen-focus')

  await page.locator('#open-card').click();await settle('.chapter-card-backdrop')
  assert.equal(await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop),samples.returnScroll)
  await page.keyboard.press('Escape');await card.waitFor({state:'detached'})
  await page.evaluate(()=>window.fixture.scope={work:'work-a',chapter:2})
  await page.locator('#open-card').click();await settle('.chapter-card-backdrop')
  assert.equal(await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop),0)
  await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop=300)
  // Identity can change while old painted content still exists; it must not save under the new book.
  await page.evaluate(()=>window.fixture.scope={work:'work-b',chapter:2})
  await page.keyboard.press('Escape');await card.waitFor({state:'detached'})
  await page.locator('#open-card').click();await settle('.chapter-card-backdrop')
  assert.equal(await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop),0)
  await page.keyboard.press('Escape');await card.waitFor({state:'detached'})
  await page.evaluate(()=>window.fixture.scope={work:'work-a',chapter:1})
  await page.locator('#open-card').click();await settle('.chapter-card-backdrop')
  assert.equal(await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop),0)
  await page.keyboard.press('Escape');await card.waitFor({state:'detached'})
  checks.push('same-chapter-reading-return-and-chapter-book-invalidation')

  await owner.evaluate(w=>{w.setContentSize(1100,760);w.webContents.setZoomFactor(1.25)})
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>document.documentElement.dataset.testTheme='light')
  await page.locator('#open-card').click()
  samples.compact=await card.evaluate(e=>{const r=e.getBoundingClientRect();return{bottom:r.bottom,height:innerHeight,left:r.left,right:r.right,width:innerWidth,reading:e.querySelector('.chapter-card-reading').clientHeight,effects:e.parentElement.getAnimations({subtree:true}).length}})
  assert.ok(samples.compact.bottom<=samples.compact.height&&samples.compact.right<=samples.compact.width&&samples.compact.reading>200)
  assert.ok(Math.abs(samples.compact.left-(samples.compact.width-samples.compact.right))<1)
  assert.equal(samples.compact.effects,0);assert.equal(await hit(page.getByTestId('save-chapter-card')),true)
  await capture('02-light-compact-card');await page.keyboard.press('Escape');await card.waitFor({state:'detached'})
  await page.locator('#open-card').click()
  samples.reducedScroll=await card.locator('.chapter-card-reading').evaluate(e=>{e.scrollTop=300;return e.scrollTop})
  await page.keyboard.press('Escape');await card.waitFor({state:'detached'})
  await page.locator('#open-card').click()
  assert.ok(Math.abs(await card.locator('.chapter-card-reading').evaluate(e=>e.scrollTop)-samples.reducedScroll)<0.5)
  await page.keyboard.press('Escape');await card.waitFor({state:'detached'})
  checks.push('compact-125-percent-theme-reduced-motion')

  await page.locator('#open-adoption').click();const adoption=page.getByTestId('chapter-card-adoption-preview')
  await adoption.locator('.chapter-card-reading').evaluate(e=>e.scrollTop=e.scrollHeight)
  assert.equal(await hit(page.getByTestId('confirm-chapter-card-adoption')),true)
  await page.evaluate(()=>window.fixture.saving=true);await page.keyboard.press('Escape')
  assert.equal(await adoption.count(),1);assert.equal(await adoption.getByLabel('关闭章卡候选核对').isDisabled(),true)
  assert.equal(await adoption.locator('input').first().isDisabled(),true)
  await page.evaluate(()=>window.fixture.saving=false);await capture('03-light-compact-adoption')
  await page.keyboard.press('Escape');await adoption.waitFor({state:'detached'})
  assert.equal(await page.locator('#open-adoption').evaluate(e=>e===document.activeElement),true)
  checks.push('long-adoption-fixed-actions-busy-selection-and-dismissal')

  await page.emulateMedia({reducedMotion:'no-preference'})
  await page.locator('#open-conflicts').click();await settle('.character-conflict-backdrop')
  await page.locator('.character-conflict-scroll').evaluate(e=>e.scrollTop=e.scrollHeight)
  samples.conflictReading=await page.locator('.character-conflict-scroll').evaluate(e=>e.scrollTop)
  assert.ok(samples.conflictReading>0)
  await page.keyboard.press('Escape');await page.locator('.character-conflict-docket').waitFor({state:'detached'})
  await page.locator('#open-conflicts').click();await settle('.character-conflict-backdrop')
  assert.equal(await page.locator('.character-conflict-scroll').evaluate(e=>e.scrollTop),samples.conflictReading)
  await page.getByTestId('locate-continuity-evidence').click();await page.locator('.character-conflict-docket').waitFor({state:'detached'})
  assert.equal(await page.locator('#manuscript').evaluate(e=>e===document.activeElement),true)
  assert.equal(await page.locator('#manuscript').inputValue(),'原正文不变')
  checks.push('conflict-return-keeps-explicit-manuscript-focus')

  await page.locator('#open-delete').click();await settle('.delete-backdrop')
  const deletion=page.getByRole('alertdialog')
  assert.equal(await deletion.getByRole('button',{name:'继续保留'}).evaluate(e=>e===document.activeElement),true)
  assert.equal(await deletion.evaluate(e=>e.getAnimations().some(a=>a instanceof CSSAnimation)),false)
  samples.deleteExit=await page.evaluate(async()=>{const root=document.querySelector('.delete-backdrop');root.querySelector('button').click();await new Promise(requestAnimationFrame);return{inert:root.inert,hidden:root.getAttribute('aria-hidden'),connected:root.isConnected}})
  assert.deepEqual(samples.deleteExit,{inert:true,hidden:'true',connected:true})
  await deletion.waitFor({state:'detached'});assert.equal(await page.locator('#open-delete').evaluate(e=>e===document.activeElement),true)
  assert.deepEqual(await page.evaluate(()=>window.fixture.events),[]);assert.deepEqual(errors,[])
  checks.push('delete-safe-initial-focus-inert-exit-no-implicit-writes')
  await writeFile(join(output,'verification.json'),JSON.stringify({checks,samples,errors,root},null,2));console.log(JSON.stringify({checks,samples,output}))
}catch(error){await capture('failure').catch(()=>{});await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,samples,errors,root},null,2));console.error(error);process.exitCode=1}
finally{await app.close()}
