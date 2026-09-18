import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

// Mount the real Vue components in an isolated browser, with no author IPC or files.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'artifacts', 'ui', 'loading-terminal')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'lanjian-loaders-'))
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;--sans:"Microsoft YaHei UI",sans-serif;--serif:"Microsoft YaHei",serif}</style><div id="app"></div><script type="module">
import {createApp,h,ref} from '/node_modules/.vite/deps/vue.js';
import Boot from '/src/renderer/app/components/AppBootScreen.vue';import Archive from '/src/renderer/features/library/components/WorkspaceLoadingScreen.vue';
import '/src/renderer/assets/narrative-tokens.css';
const query=new URLSearchParams(location.search);window.events=[];
document.documentElement.dataset.theme=query.get('appTheme')||(query.has('night')?'moye':'qingzhou');
createApp({setup(){const phase=ref(query.get('phase')||'chapter');window.setLoaderPhase=value=>{phase.value=value};return()=>query.has('boot')?h(Boot,{phase:phase.value,error:query.get('error')||'',preview:query.has('preview'),theme:query.get('theme')||'impact',onSkip:()=>window.events.push('skip'),onRetry:()=>window.events.push('retry'),onComplete:()=>window.events.push('complete')}):h(Archive,{title:'星城少年们的日常录 · 很长的作品名称也能够完整阅读',phase:phase.value,slow:true,theme:query.get('theme')||'impact',sidebarWidth:248,onCancel:()=>window.events.push('cancel')})}}).mount('#app');
</script></html>`
const entry = html.match(/<script type="module">([\s\S]+)<\/script>/)[1].replace('/node_modules/.vite/deps/vue.js', 'vue')
const page = html.replace(/<script type="module">[\s\S]+<\/script>/, '<script type="module" src="/loading-entry.js"></script>')
const server = await createServer({ root, configFile: false, plugins: [vue(), { name: 'loading-smoke-page', resolveId(id) { if(id === '/loading-entry.js') return id }, load(id) { if(id === '/loading-entry.js') return entry }, configureServer(server) { server.middlewares.use((req, res, next) => { if (req.url?.startsWith('/loading-smoke')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page) } else next() }) } }], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { include: ['vue'] } })
await server.listen()
const base = server.resolvedUrls.local[0]
const child = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
const pause = ms => new Promise(r => setTimeout(r, ms))
let socket, serial = 0
const pending = new Map(), checks = [], errors = [], themePalettes = {boot:{},archive:{}}
function command(method, params = {}, sessionId) { const id = ++serial; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')) }, 15000); pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})) }) }
try {
  let endpoint
  for(let i=0;i<100;i++){ try { endpoint=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break }catch{} await pause(100) }
  assert.ok(endpoint)
  socket=new WebSocket(`ws://127.0.0.1:${endpoint[0]}${endpoint[1]}`)
  await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})})
  socket.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.text);const p=pending.get(d.id);if(!p)return;clearTimeout(p.timer);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result)})
  const {targetId}=await command('Target.createTarget',{url:'about:blank'}), {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params)=>command(method,params,sessionId)
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value}
  await call('Page.enable');await call('Runtime.enable')
  for(const [name,query,width,height] of [['archive','phase=workspace',1440,900],['boot','boot=1&phase=editor',1440,900],['archive-xuanzhi','phase=workspace&appTheme=xuanzhi',1440,900],['boot-xuanzhi','boot=1&phase=editor&appTheme=xuanzhi',1440,900],['archive-ready','phase=ready&theme=impact',1440,900],['boot-ready','boot=1&phase=ready&theme=impact',1440,900],['archive-compact','phase=chapter',760,540],['boot-error-compact','boot=1&phase=projects&error=作品索引暂时不可读',760,540],['archive-narrow','phase=chapter',480,600],['boot-preview-narrow','boot=1&phase=ready&preview=1',480,600],['boot-night','boot=1&phase=editor&night=1',1440,900],['archive-night','phase=chapter&night=1',1440,900]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
    await call('Page.navigate',{url:base+'loading-smoke?'+query})
    let mounted=false
    for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('[role=dialog]')")){mounted=true;break}await pause(100)}
    if(!mounted){
      const diagnostic=await evaluate("({url:location.href,text:document.body?.innerText?.slice(0,1200),html:document.body?.innerHTML?.slice(0,1200)})").catch(error=>({evaluationError:error.message}))
      assert.fail(name+' mounted '+JSON.stringify({errors,diagnostic}))
    }
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=dialog]')).position==='fixed'"),true,name+' actual scoped styles applied')
    const appTheme=query.includes('appTheme=xuanzhi')?'xuanzhi':query.includes('night=1')?'moye':'qingzhou'
    if(['archive','archive-xuanzhi','archive-night'].includes(name)){
      themePalettes.archive[appTheme]=await evaluate(`(()=>{const root=getComputedStyle(document.querySelector('.workspace-loading')),stage=getComputedStyle(document.querySelector('.archive-stage'));return [root.backgroundColor,root.color,stage.backgroundColor,stage.color]})()`)
      const ratios=await evaluate(`(()=>{const lum=color=>{const values=color.match(/[\\d.]+/g).slice(0,3).map(Number),a=(color.startsWith('color(')?values:values.map(v=>v/255)).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722},ratio=(text,bg)=>{const a=lum(getComputedStyle(document.querySelector(text)).color),b=lum(getComputedStyle(document.querySelector(bg)).backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};return {title:ratio('.archive-book h2','.archive-stage'),current:ratio('.archive-current > span','.workspace-loading'),pending:ratio('.archive-tree li:last-child b','.workspace-loading')}})()`)
      for(const [label,ratio] of Object.entries(ratios))assert.ok(ratio>=4.5,`${name} ${label} contrast ${ratio}`)
    }
    if(['boot','boot-xuanzhi','boot-night'].includes(name)){
      themePalettes.boot[appTheme]=await evaluate(`(()=>{const root=getComputedStyle(document.querySelector('.app-boot')),ring=getComputedStyle(document.querySelector('.terminal-orbit'),'::after');return [root.backgroundColor,root.color,ring.borderRightColor]})()`)
      const ratio=await evaluate(`(()=>{const lum=color=>{const values=color.match(/[\\d.]+/g).slice(0,3).map(Number),a=(color.startsWith('color(')?values:values.map(v=>v/255)).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722},style=getComputedStyle(document.querySelector('.app-boot')),a=lum(style.color),b=lum(style.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`)
      assert.ok(ratio>=4.5,name+' root contrast '+ratio)
    }
    const phase=query.match(/(?:^|&)phase=([^&]+)/)?.[1]
    const expectedProgress=phase==='ready'?100:phase==='workspace'||phase==='editor'?50:phase==='chapter'?67:phase==='projects'?25:0
    assert.equal(await evaluate("Number(document.querySelector('[role=dialog]').dataset.loaderProgress)"),expectedProgress,name+' lifecycle progress')
    const lineSelector=query.includes('boot=1')?'[data-testid=boot-progress-line]':'[data-testid=workspace-progress-line]'
    if(query.includes('error='))assert.equal(await evaluate(`getComputedStyle(document.querySelector('${lineSelector}')).display`),'none',name+' error stops progress line')
    else {
      assert.ok((await evaluate(`getComputedStyle(document.querySelector('${lineSelector}')).transitionProperty`)).includes('left'),name+' progress transition property')
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('${lineSelector}')).transitionTimingFunction`),'linear',name+' progress transition is linear')
    }
    if(expectedProgress>0&&expectedProgress<100&&!query.includes('error=')){
      const firstLeft=await evaluate(`document.querySelector('${lineSelector}').getBoundingClientRect().left`)
      await pause(250)
      const secondLeft=await evaluate(`document.querySelector('${lineSelector}').getBoundingClientRect().left`)
      assert.ok(firstLeft>=-2&&firstLeft<=width*expectedProgress/100+3,name+' first progress line position')
      assert.ok(secondLeft>=-2&&secondLeft<=width*expectedProgress/100+3,name+' second progress line position')
      assert.notEqual(Math.round(firstLeft),Math.round(secondLeft),name+' progress line moves within completed range')
    }
    if(name==='archive'){
      const watermark=await evaluate(`(()=>{const rect=element=>{const value=element.getBoundingClientRect();return {left:value.left,right:value.right,top:value.top,bottom:value.bottom,width:value.width,height:value.height}},progressElement=document.querySelector('.archive-progress'),layerElement=document.querySelector('[data-testid=workspace-title-watermark]'),foregroundElement=document.querySelector('.archive-tree'),progress=rect(progressElement),layer=rect(layerElement),text=rect(layerElement.querySelector('span'));return {progress,layer,text,value:layerElement.textContent,layerZ:getComputedStyle(layerElement).zIndex,foregroundZ:getComputedStyle(foregroundElement).zIndex}})()`)
      assert.equal(watermark.value,'我家美少女','archive watermark keeps five visible title characters')
      assert.ok(watermark.layer.left>=watermark.progress.left-1&&watermark.layer.right<=watermark.progress.right+1,'archive watermark stays inside progress region '+JSON.stringify(watermark))
      assert.ok(watermark.text.left>=watermark.layer.left-1&&watermark.text.right<=watermark.layer.right+1,'archive watermark text remains fully visible '+JSON.stringify(watermark))
      assert.ok(watermark.layer.top>=watermark.progress.top+watermark.progress.height*.45&&Math.abs(watermark.layer.bottom-watermark.progress.bottom)<=1,'archive watermark stays in the lower background band '+JSON.stringify(watermark))
      assert.ok(Number(watermark.layerZ)<Number(watermark.foregroundZ),'archive watermark remains behind progress modules '+JSON.stringify(watermark))
      const beforePhaseChange=await evaluate(`document.querySelector('${lineSelector}').getBoundingClientRect().left`)
      await evaluate("window.setLoaderPhase('chapter')")
      const afterPhaseChange=await evaluate(`new Promise(resolve=>queueMicrotask(()=>resolve(document.querySelector('${lineSelector}').getBoundingClientRect().left)))`)
      assert.ok(Math.abs(afterPhaseChange-beforePhaseChange)<12,'archive phase expansion preserves the painted line position within one rendered frame '+JSON.stringify({beforePhaseChange,afterPhaseChange,delta:afterPhaseChange-beforePhaseChange}))
      assert.equal(await evaluate("document.querySelector('[role=dialog]').dataset.loaderProgress"),'67','archive phase expands progress boundary')
    }
    if(name==='archive-ready'){
      assert.ok((await evaluate("getComputedStyle(document.querySelector('.archive-stage')).animationName")).includes('archive-to-sidebar'),'archive completion morph')
      await pause(1050)
      const handoff=await evaluate(`(()=>{const r=document.querySelector('.archive-stage').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,line:document.querySelector('${lineSelector}').getBoundingClientRect().left}})()`)
      assert.ok(Math.abs(handoff.left)<=2&&Math.abs(handoff.top-48)<=2,'archive handoff aligns to sidebar origin')
      assert.ok(Math.abs(handoff.width-320)<=3&&Math.abs(handoff.height-(height-72))<=3,'archive handoff matches sidebar geometry')
      assert.ok(handoff.line>=width-4,'archive completion line reaches right edge')
    }else if(phase==='ready'&&!query.includes('error=')){
      await pause(query.includes('boot=1')?3050:1050)
      assert.ok(await evaluate(`document.querySelector('${lineSelector}').getBoundingClientRect().left>=innerWidth-4`),name+' completion line reaches right edge')
    }
    if(name==='boot'){
      const orbitMotion=await evaluate(`(()=>{const orbit=document.querySelector('.terminal-orbit'),before=getComputedStyle(orbit,'::before'),after=getComputedStyle(orbit,'::after');return {beforeName:before.animationName,beforeDuration:before.animationDuration,beforeTiming:before.animationTimingFunction,afterName:after.animationName,afterDuration:after.animationDuration,afterTiming:after.animationTimingFunction}})()`)
      assert.ok(orbitMotion.beforeName.startsWith('terminal-orbit-slow'),'boot middle ring rotates '+JSON.stringify(orbitMotion))
      assert.ok(orbitMotion.afterName.startsWith('terminal-orbit-fast'),'boot inner ring rotates '+JSON.stringify(orbitMotion))
      assert.notEqual(orbitMotion.beforeDuration,orbitMotion.afterDuration,'boot rings use different angular speeds')
      assert.equal(orbitMotion.beforeTiming,'linear','boot middle ring rotation is linear')
      assert.equal(orbitMotion.afterTiming,'linear','boot inner ring rotation is linear')
    }
    const expectedFocus=query.includes('boot=1')?(query.includes('preview=1')?'app-boot-skip':query.includes('error=')?'app-boot-retry':'app-boot'):'cancel-workspace-loading'
    assert.equal(await evaluate(`document.activeElement?.dataset.testid==='${expectedFocus}'`),true,name+' initial keyboard focus')
    if(name==='boot-night'){
      const ratio=await evaluate(`(()=>{const lum=color=>{const values=color.match(/[\\d.]+/g).slice(0,3).map(Number),a=(color.startsWith('color(')?values:values.map(v=>v/255)).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722},style=getComputedStyle(document.querySelector('.app-boot')),a=lum(style.color),b=lum(style.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`)
      assert.ok(ratio>=4.5,'night boot retains readable contrast '+ratio)
    }
    if(name==='archive-night'){
      const ratios=await evaluate(`(()=>{const lum=color=>{const values=color.match(/[\\d.]+/g).slice(0,3).map(Number),a=(color.startsWith('color(')?values:values.map(v=>v/255)).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722};const ratio=(text,bg)=>{const a=lum(getComputedStyle(document.querySelector(text)).color),b=lum(getComputedStyle(document.querySelector(bg)).backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};return {book:ratio('.archive-book h2','.archive-stage'),caption:ratio('.archive-book small','.archive-stage'),current:ratio('.archive-current > span','.workspace-loading'),completed:ratio('.archive-tree li.complete b','.workspace-loading'),pending:ratio('.archive-tree li:last-child b','.workspace-loading')}})()`)
      for(const [label,ratio] of Object.entries(ratios))assert.ok(ratio>=4.5,'archive night '+label+' contrast '+ratio)
      const stageBackground=await evaluate("getComputedStyle(document.querySelector('.archive-stage')).backgroundColor.match(/[\\d.]+/g).slice(0,3).map(Number)")
      assert.ok(Math.max(...stageBackground)<80,'archive night avoids a white flash')
    }
    await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,name+' no horizontal overflow')
    // Buttons in scrollable console remain reachable; scroll to each then verify a native hit.
    const priorEvents=await evaluate('window.events.length')
    const buttons=await evaluate("[...document.querySelectorAll('button')].map(b=>b.dataset.testid)")
    for(const id of buttons){
      await evaluate(`document.querySelector('[data-testid="${id}"]').scrollIntoView({block:'nearest'})`)
      const point=await evaluate(`(()=>{const b=document.querySelector('[data-testid="${id}"]'),r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:b.contains(document.elementFromPoint(x,y))}})()`)
      assert.ok(point.hit,name+' '+id+' hit target')
      await call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1})
    }
    assert.equal(await evaluate('window.events.length'),priorEvents+buttons.length,name+' semantic click events')
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    const escapeIncrement=!query.includes('boot=1')||query.includes('preview=1')?1:0
    assert.equal(await evaluate('window.events.length'),priorEvents+buttons.length+escapeIncrement,name+' Escape behavior')
    await evaluate("document.querySelector('main')?.scrollTo(0,0);document.querySelector('.archive-body')?.scrollTo(0,0)")
    await pause(100)
    const {data}=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
    await writeFile(join(output,name+'.png'),Buffer.from(data,'base64'));checks.push(name)
  }
  for(const [mode,palettes] of Object.entries(themePalettes)){
    assert.deepEqual(Object.keys(palettes).sort(),['moye','qingzhou','xuanzhi'],mode+' covers every app theme')
    assert.equal(new Set(Object.values(palettes).map(value=>JSON.stringify(value))).size,3,mode+' palette adapts across app themes '+JSON.stringify(palettes))
  }
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  assert.equal(await evaluate("[...document.querySelectorAll('*')].every(e=>getComputedStyle(e).animationName==='none')"),true,'reduced motion disables animations')
  assert.deepEqual(errors,[])
  await writeFile(join(output,'verification.json'),JSON.stringify({passed:checks,errors},null,2))
  console.log(JSON.stringify({passed:checks.length,screenshots:output,errors}))
} finally { if(socket?.readyState===1){await command('Browser.close').catch(()=>{});socket.close()}else child.kill();await server.close() }
