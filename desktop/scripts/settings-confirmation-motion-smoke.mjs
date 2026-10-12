import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { _electron } from 'playwright'

const root=await mkdtemp(join(tmpdir(),'lanjian-settings-confirmation-'))
const output=resolve(process.env.SETTINGS_CONFIRMATION_OUTPUT||'../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-settings-confirmation-native')
await mkdir(output,{recursive:true})
const path=file=>JSON.stringify(resolve(file).replaceAll('\\','/'))
const shell=await readFile('src/renderer/app/AppShell.vue','utf8')
const shellStyles=shell.slice(shell.indexOf('<style'),shell.lastIndexOf('</style>')+'</style>'.length)
const actions=['aiConnectionDeletePreview = null','aiCredentialClearPreview = null','!busy && closeSqliteShadowMigration()','!busy && closeSqliteActivation()','!busy && closeWorkspaceRestore()','projectTrashTarget = null']
const surfaces=actions.map(action=>{const start=shell.indexOf(`<DialogTransition @escape="${action}">`);assert.ok(start>0,action);return shell.slice(start,shell.indexOf('</DialogTransition>',start)+'</DialogTransition>'.length)}).join('\n')
await writeFile(join(root,'Fixture.vue'),`<script setup>
import {ref} from 'vue';import DialogTransition from ${path('src/renderer/ui/DialogTransition.vue')};import StudioIcon from ${path('src/renderer/ui/StudioIcon.vue')};
const busy=ref(false),aiConnectionDeletePreview=ref(null),aiCredentialClearPreview=ref(null),sqliteShadowPreview=ref(null),sqliteShadowResult=ref(null),sqliteActivationPreview=ref(null),sqliteActivationResult=ref(null),workspaceRestorePreview=ref(null),projectTrashTarget=ref(null),projectTrashConfirmation=ref('');
const ai={connections:[{id:'a',name:'测试接口 A'},{id:'b',name:'测试接口 B'}]},connectionOptionLabel=c=>c.name;
const blockers=Array.from({length:32},(_,i)=>({code:'fixture-'+i,message:'校验未通过：测试副本第 '+i+' 项，请先核对来源。'}));
function open(kind){if(kind==='connection')aiConnectionDeletePreview.value={connectionId:'a',connectionName:'测试接口 A',affected:['正文','大纲'],fallbackConnectionId:'b'};if(kind==='credential')aiCredentialClearPreview.value={connectionName:'测试接口 A'};if(kind==='shadow')sqliteShadowPreview.value={chapterCount:20,totalWords:20000,canImport:false,blockers,targetRelativePath:'.webnovel/workspace.sqlite'};if(kind==='activation')sqliteActivationPreview.value={chapterCount:20,totalWords:20000,canActivate:true,blockers:[]};if(kind==='restore')workspaceRestorePreview.value={projectName:'测试作品',canRestore:false,blockers};if(kind==='trash')projectTrashTarget.value={title:'测试作品',path:'隔离测试目录'};}
function closeSqliteShadowMigration(){sqliteShadowPreview.value=null;sqliteShadowResult.value=null}function closeSqliteActivation(){sqliteActivationPreview.value=null;sqliteActivationResult.value=null}function closeWorkspaceRestore(){workspaceRestorePreview.value=null}
function record(action){window.fixture.events.push(action)}function confirmRemoveAiConnection(){record('connection')}function confirmClearAiCredential(){record('credential')}function confirmSqliteShadowMigration(){record('shadow')}function confirmSqliteActivation(){record('activation')}function confirmWorkspaceRestore(){record('restore')}function trashProject(){record('trash')}
window.fixture={events:[],set busy(v){busy.value=v},open};
</script><template><main class="redesigned-studio"><button v-for="kind in ['connection','credential','shadow','activation','restore','trash']" :id="'open-'+kind" @click="open(kind)">{{kind}}</button>${surfaces}</main></template>${shellStyles}`)
await writeFile(join(root,'entry.js'),`import {createApp} from 'vue';import Fixture from './Fixture.vue';import ${path('src/renderer/assets/desktop.css')};import ${path('src/renderer/assets/desktop-redesign.css')};import ${path('src/renderer/assets/interaction-motion.css')};createApp(Fixture).mount('#app');`)
await build({configFile:false,root,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"',__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},resolve:{alias:{vue:resolve('node_modules/vue/dist/vue.esm-bundler.js')}},build:{outDir:join(root,'bundle'),emptyOutDir:false,lib:{entry:join(root,'entry.js'),name:'ConfirmationFixture',formats:['iife'],fileName:()=> 'fixture.js',cssFileName:'fixture'}},logLevel:'error'})
await writeFile(join(root,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><link rel="stylesheet" href="bundle/fixture.css"><style>
:root{--ink:#eef0e9;--ink-2:#cdd9d1;--paper:#252e29;--surface:#252e29;--surface-raised:#252e29;--surface-muted:#1c2520;--line:#4e5d53;--jade:#85b9a4;--jade-wash:#2a3d33;--muted:#adbbb1;--cinnabar:#f8b086;--serif:serif;--sans:system-ui}html[data-test-theme=light]{--ink:#24372d;--ink-2:#3d4e43;--paper:#f4f1e9;--surface:#faf8f1;--surface-raised:#faf8f1;--surface-muted:#eeece3;--line:#c8cfc7;--jade:#376d56;--jade-wash:#e4eee7;--muted:#5f6d64;--cinnabar:#9b4830}body{background:var(--surface);color:var(--ink)}main{padding:24px}#app{height:100vh}
</style><div id="app"></div><script src="bundle/fixture.js"></script></html>`)
await writeFile(join(root,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(root,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false}});w.setMenu(null);w.loadFile(${JSON.stringify(join(root,'index.html'))});});`)
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const app=await _electron.launch({args:[join(root,'main.cjs')],env}),page=await app.firstWindow(),owner=await app.browserWindow(page),checks=[],samples={},errors=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
async function capture(name){await page.screenshot({animations:'allow'});const png=await owner.evaluate(async w=>(await w.webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'))}
async function settle(){await page.locator('.modal-backdrop').evaluate(async e=>{await Promise.allSettled(e.getAnimations({subtree:true}).map(a=>a.finished))})}
try{
  for(const kind of ['connection','credential','shadow','activation','restore','trash']){
    await page.locator('#open-'+kind).click();await settle()
    const backdrop=page.locator('.modal-backdrop'),sheet=backdrop.locator('[role$="dialog"]')
    assert.equal(await sheet.evaluate(e=>e.contains(document.activeElement)),true)
    assert.equal(await sheet.evaluate(e=>e.getAnimations().some(a=>a instanceof CSSAnimation)),false)
    await sheet.evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));assert.equal(await sheet.count(),1)
    if(['shadow','activation','restore'].includes(kind)){
      await sheet.locator('.storage-confirmation-reading').evaluate(e=>e.scrollTop=e.scrollHeight)
      assert.equal(await sheet.locator('footer button').first().evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),true)
      await page.evaluate(()=>window.fixture.busy=true);await page.keyboard.press('Escape');await backdrop.evaluate(e=>e.click());assert.equal(await sheet.count(),1)
      assert.equal(await sheet.locator('header button').isDisabled(),true);await page.evaluate(()=>window.fixture.busy=false)
    }
    if(kind==='shadow')assert.equal(await page.getByTestId('confirm-sqlite-shadow-migration').isDisabled(),true)
    if(kind==='connection')await capture('connection-confirmation')
    if(kind==='restore')assert.equal(await page.getByTestId('confirm-workspace-restore').count(),0)
    if(kind==='trash'){
      assert.equal(await page.getByTestId('confirm-trash-work-item').isDisabled(),true)
      await page.getByTestId('project-trash-name').fill('测试作品');assert.equal(await page.getByTestId('confirm-trash-work-item').isEnabled(),true)
    }
    samples[kind]=await backdrop.evaluate(async e=>{e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await new Promise(requestAnimationFrame);return{inert:e.inert,hidden:e.getAttribute('aria-hidden'),connected:e.isConnected}})
    assert.deepEqual(samples[kind],{inert:true,hidden:'true',connected:true})
    await backdrop.waitFor({state:'detached'});assert.equal(await page.locator('#open-'+kind).evaluate(e=>e===document.activeElement),true)
    checks.push(kind+'-keyboard-inert-exit-focus-and-existing-guards')
  }
  await owner.evaluate(w=>{w.setContentSize(1100,760);w.webContents.setZoomFactor(1.25)})
  await page.emulateMedia({reducedMotion:'reduce'})
  for(const theme of ['dark','light']){
    await page.evaluate(theme=>document.documentElement.dataset.testTheme=theme,theme)
    await page.locator('#open-restore').click()
    const sheet=page.getByTestId('workspace-restore-dialog')
    samples[theme]=await sheet.evaluate(e=>{const r=e.getBoundingClientRect(),b=e.querySelector('footer button'),br=b.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,bottom:r.bottom,height:innerHeight,reading:e.querySelector('.storage-confirmation-reading').clientHeight,hit:b.contains(document.elementFromPoint(br.x+br.width/2,br.y+br.height/2)),effects:e.parentElement.getAnimations({subtree:true}).length}})
    assert.ok(samples[theme].left>=0&&samples[theme].right<=samples[theme].width&&samples[theme].bottom<=samples[theme].height&&samples[theme].reading>160)
    assert.equal(samples[theme].hit,true);assert.equal(samples[theme].effects,0)
    await capture(theme+'-compact-blocked-restore');await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'})
  }
  checks.push('compact-long-blockers-fixed-actions-dark-light-reduced-motion')
  assert.deepEqual(await page.evaluate(()=>window.fixture.events),[]);assert.deepEqual(errors,[])
  await writeFile(join(output,'verification.json'),JSON.stringify({checks,samples,errors,root},null,2));console.log(JSON.stringify({checks,samples,output}))
}catch(error){await capture('failure').catch(()=>{});await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error.stack||error),checks,samples,errors,root},null,2));console.error(error);process.exitCode=1}
finally{await app.close()}
