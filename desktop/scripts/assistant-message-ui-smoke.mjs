import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

// Real packaged-layout main/preload + validated IPC; only temporary books and a
// loopback fake provider. No developer driver or author model configuration.
const temporaryParent = await realpath(tmpdir())
const root = await realpath(await mkdtemp(join(temporaryParent, 'lanjian-assistant-message-ui-')))
const books = join(root, 'books'), userData = join(root, 'app')
await Promise.all([mkdir(books), mkdir(userData)])
const entry = resolve(process.argv[2] || 'out-assistant-message-ui', 'main/index.js')
const before=process.argv.includes('--before'), workbenchChecks=process.argv.includes('--workbench'), composerChecks=process.argv.includes('--composer')||workbenchChecks
const evidence=process.env.LANJIAN_ASSISTANT_EVIDENCE?resolve(process.env.LANJIAN_ASSISTANT_EVIDENCE):resolve('../.trellis/tasks/09-30-v3-workspace-archive-design/evidence',workbenchChecks?'workbench':composerChecks?'composer':'message-ui',before?'before':'after')
await mkdir(evidence,{recursive:true})
const archiveUi=process.argv.includes('--archive-ui'),acceptance=process.argv.includes('--acceptance')
const screenshotFixes=process.argv.includes('--screenshot-fixes'), geometry=[]
const seen=[],errors=[],rendererErrors=[]
const prompt1='主角是一名修复师，能听见旧物的记忆。请帮我推敲开篇：既要写出雨夜的悬疑感，也要让读者理解他为什么一定要接下这件危险的委托。先讨论，不修改正文。'
const prompt2='保留怀表的线索，但不要让主角一开始就知道失踪者是谁。'
const answer1='## 先让人物的选择带出悬念\n\n可以从一只**停在凌晨三点的怀表**开始。修复师听见的不是求救，而是一句只有母亲知道的称呼。他接下委托的原因就从“好奇”变成了“无法放下”。\n\n- **眼前目标**：找到怀表的主人，确认声音的来源。\n- **具体代价**：每修复一件旧物，他就会失去一段自己的记忆。\n- **开篇转折**：怀表恢复走动的那一刻，门外的人说出了同一句话。\n\n这样，能力、人物动机与危机能在同一场戏里出现。先写他的犹豫和选择，再解释规则，阅读会更顺。'
const answer2='可以。把身份留成悬念，先保留三个可追踪的细节：\n\n|线索|当下作用|后续回收|\n|---|---|---|\n|怀表上的划痕|暗示曾发生争执|与另一个人的伤痕对应|\n|雨声里的称呼|引出主角的私人记忆|揭开委托的真正来意|\n\n主角只认出**声音里的一种习惯**，还不能确认那个人是谁。这样既保留情感牵引，也给后文留下调查空间。'
const longAnswer='## 完整分析\n\n'+Array(35).fill(answer1).join('\n\n')+'\n\n长文完整结束。'
const failurePrompt='测试失败时保留输入。', slowPrompt='测试停止当前回复。'
let releaseFailure,releaseSlow,releaseStream
const server=createServer(async(request,response)=>{
 try{
  if(request.method==='GET'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:'plugin-smoke-model'}]}));return}
  let raw='';for await(const chunk of request)raw+=chunk
  const body=JSON.parse(raw);seen.push(body)
  const message=body.messages.filter(m=>m.role==='user').at(-1).content
  if(composerChecks&&message===failurePrompt){
    await new Promise(resolve=>{releaseFailure=resolve})
    response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:'合成接口暂时不可用，请稍后再试。',type:'invalid_request_error'}}));return
  }
  if(composerChecks&&message===slowPrompt)await new Promise(resolve=>{releaseSlow=resolve})
  if(workbenchChecks&&message==='验证真实流式回复'){
    assert.equal(body.stream,true)
    response.writeHead(200,{'Content-Type':'text/event-stream'})
    response.write('data: '+JSON.stringify({choices:[{delta:{content:'第一段已经返回。'}}]})+'\n\n')
    await new Promise(resolve=>{releaseStream=resolve})
    response.end('data: '+JSON.stringify({choices:[{delta:{content:'\n\n第二段完整结束。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return
  }
  const content=message===prompt1?answer1:message===prompt2?answer2:longAnswer
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message:{role:'assistant',content},finish_reason:'stop'}]}))
 }catch(error){errors.push(String(error));response.statusCode=500;response.end('{}')}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL'))
env.LANJIAN_USER_DATA_PATH = userData
env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
let app
try {
  app = await _electron.launch({ args: [entry, '--disable-gpu'], env })
  let page = await app.firstWindow()
  page.on('pageerror',error=>{rendererErrors.push(error.message);console.error('Renderer error:',error.message)})
  await page.waitForFunction(() => Boolean(window.novelDesktop?.fieldAssistant), undefined, { timeout: 20000 })
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    let stage = 'create'
    try {
    const api = window.novelDesktop
    const { project } = await api.projects.create({ parentPath: books, name: '原书A', genre: '仙侠' })
    stage = 'configure-model'
    const catalogue = await api.modelConnections.list()
    const created = await api.modelConnections.create({ expectedRevision: catalogue.revision, name: '插件隔离接口', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-plugin-key' })
    const connection = created.connections.find(item => item.name === '插件隔离接口')
    const edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'smoke', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'smoke', model: 'plugin-smoke-model', temperature: .6, topP: 1, maxTokens: 8192 } } })
    const profile = await api.workspace.getBookProfile()
    await api.workspace.saveBookProfile({ ...profile, coreIdea: '原书设想A' })
    const chapter = await api.chapters.create()
    await api.chapters.update(chapter.id, { content: '原书A的雨夜正文。', title: '雨夜' })
    return { project, chapterId: chapter.id }
    } catch (error) { throw new Error(stage + ': ' + JSON.stringify(error)) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  async function openBook(title='原书A'){
    await page.evaluate(async()=>{localStorage.setItem('lanjian-opening-enabled','false');localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'standard',bootStyle:'brief',bootPalette:'system'}));sessionStorage.setItem('lanjian-opening-seen','true');localStorage.setItem('lanjian-companion-voice-v1',JSON.stringify({voice:'ningguang',mute:true,textModel:false,preload:false}));await window.companionSettings?.update({voice:{mute:true,textModel:false,preload:false}})})
    await page.reload()
    await page.waitForFunction(()=>Boolean(window.novelDesktop),undefined,{timeout:60000})
    const owner=await app.browserWindow(page)
    await owner.evaluate(win=>{win.show();win.focus()})
    await page.waitForTimeout(1500)
    if(await page.getByTestId('app-boot-skip-models').isVisible())await page.getByTestId('app-boot-skip-models').click()
    await page.waitForFunction(()=>{const boot=document.querySelector('[data-testid="app-boot"]');return !boot||boot.getAttribute('data-boot-phase')==='ready'})
    await page.getByTestId('app-boot-enter').click()
    await owner.evaluate(win=>{win.hide();win.show();win.focus()})
    await page.getByTestId('app-boot').waitFor({state:'hidden',timeout:60000})
    if(!await page.locator('.assistant-toggle').isVisible()){
      if(archiveUi){const png=await owner.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(evidence,'library-reference.png'),Buffer.from(png,'base64'))}
      await page.locator('[data-library-view="all"]').click()
      await page.locator('.work-item-open').filter({hasText:title}).first().click()
    }
    await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
    await page.locator('.assistant-toggle').waitFor({timeout:60000}).catch(async error=>{console.error(await page.locator('body').innerText());throw error})
    if(await page.locator('.assistant-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.assistant-toggle').click()
    await page.getByTestId('field-assistant-instruction').waitFor()
  }
  await openBook()
  let owner=await app.browserWindow(page)
  await owner.evaluate(win=>win.setSize(1440,1000))
  await page.waitForTimeout(800)
  let input=page.getByTestId('field-assistant-instruction')
  async function capture(name){await page.waitForTimeout(150);const data=await owner.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(evidence,name+'.png'),Buffer.from(data,'base64'))}
  async function waitForProvider(ready){const deadline=Date.now()+30000;while(!ready()){assert.ok(Date.now()<deadline,'fake provider did not receive the request');await page.waitForTimeout(100)}}
  async function checkScreenshotFixes(label){
    if(!screenshotFixes)return
    const result=await page.getByTestId('assistant-sidebar').evaluate(panel=>{
      const scroll=panel.querySelector('[data-testid="copilot-chat-view-scroll"]'),form=panel.querySelector('.field-assistant-composer'),surface=panel.querySelector('.assistant-surface-host')
      const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}}
      const copy=panel.querySelector('.model-trigger-copy'),b=copy.querySelector('b'),small=copy.querySelector('small'),trigger=panel.querySelector('.model-catalog-trigger')
      const title=document.querySelector('.manuscript-title-row input'),index=document.querySelector('.manuscript-chapter-label'),library=document.querySelector('.book-library')
      const controls=[...panel.querySelectorAll('button,textarea,select,.assistant-chat-message'),document.querySelector('.book-tab'),title].filter(Boolean)
      return {scroll:rect(scroll),form:rect(form),surface:rect(surface),trigger:rect(trigger),modelGap:rect(small).top-rect(b).bottom,modelLineHeight:getComputedStyle(small).lineHeight,modelFont:getComputedStyle(small).fontSize,modelOverflow:trigger.scrollWidth-trigger.clientWidth,rounded:controls.filter(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)>0).map(el=>el.className),titleFont:getComputedStyle(title).fontSize,indexFont:getComputedStyle(index).fontSize,libraryText:library.innerText,libraryIcons:library.querySelectorAll('svg').length,modelIcon:!!trigger.querySelector('svg.model-trigger-chevron'),companionIcon:!!document.querySelector('.archive-pet-tools svg'),viewportHeight:innerHeight}
    })
    const chapterFonts=await page.locator('.chapter-tree-row').first().evaluate(row=>({index:getComputedStyle(row.querySelector('.chapter-no')).fontSize,title:getComputedStyle(row.querySelector('.chapter-row-title')).fontSize}))
    geometry.push({label,...result,chapterFonts})
    if(before)return
    assert.ok(Math.abs(result.scroll.top-result.surface.top)<2,JSON.stringify(result))
    assert.ok(Math.abs(result.scroll.bottom-result.form.top)<2,JSON.stringify(result))
    assert.ok(result.form.bottom<=result.surface.bottom+2&&result.form.bottom<=result.viewportHeight+1,JSON.stringify(result))
    assert.ok(result.scroll.height>80&&result.modelGap>=3.9&&parseFloat(result.modelLineHeight)>=parseFloat(result.modelFont)*1.45,JSON.stringify(result))
    assert.ok(result.modelOverflow<=1&&result.trigger.bottom<=result.form.bottom,JSON.stringify(result))
    assert.deepEqual(result.rounded,[]);assert.equal(result.titleFont,result.indexFont)
    assert.equal(chapterFonts.title,chapterFonts.index)
    assert.equal(result.libraryText,'我的作品');assert.equal(result.libraryIcons,0)
    assert.ok(result.modelIcon&&result.companionIcon)
  }
  if(composerChecks){
    assert.equal(await input.evaluate(el=>CSS.supports('field-sizing','content')),true)
    const shortHeight=await input.evaluate(el=>el.getBoundingClientRect().height)
    await input.fill('请保留下面的细节。\n'.repeat(50))
    const tallHeight=await input.evaluate(el=>el.getBoundingClientRect().height)
    assert.ok(tallHeight>shortHeight+40);assert.ok(tallHeight<=181)
    await checkScreenshotFixes('grown-composer')
    await input.fill('正在用中文写要求')
    await input.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true})
    await page.waitForTimeout(150);assert.equal(seen.length,0)
    await input.press('End');await input.press('Enter');assert.equal(await input.inputValue(),'正在用中文写要求\n')
    await input.fill('');assert.ok((await input.boundingBox()).height<tallHeight)
    assert.equal(await page.locator('.assistant-composer-meta').isVisible(),true)
  }
  let expectedMessages=0
  for(const prompt of [prompt1,prompt2]){
    expectedMessages++
    await page.getByTestId('field-assistant-instruction').fill(prompt)
    if(composerChecks&&expectedMessages===1)await input.press('Control+Enter');else await page.getByTestId('send-field-assistant').click()
    await page.waitForFunction(count=>document.querySelectorAll('.assistant-chat-message.assistant').length===count,expectedMessages,{timeout:60000})
    await page.getByTestId('send-field-assistant').waitFor()
  }
  const matrix=[]
  for(const theme of ['qingzhou','moye','xuanzhi'])for(const zoom of [1,1.25])for(const layout of ['sidebar','expanded']){
    await page.evaluate(theme=>{localStorage.setItem('lanjian-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'lanjian-theme',newValue:theme}));document.documentElement.dataset.theme=theme},theme)
    await owner.evaluate((win,z)=>win.webContents.setZoomFactor(z),zoom)
    if(await page.getByTestId('assistant-sidebar').getAttribute('data-layout')!==layout)await page.getByTestId('assistant-expand').click()
    await page.waitForTimeout(200)
    await page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop=0)
    const measure=await page.getByTestId('assistant-sidebar').evaluate(el=>{
      const user=el.querySelector('.assistant-chat-message.user'),ai=el.querySelector('.assistant-chat-message.assistant')
      const ub=user.querySelector('.assistant-message-body')||user,ab=ai.querySelector('.assistant-message-body')||ai
      const ur=user.getBoundingClientRect(),ar=ai.getBoundingClientRect(),sc=el.querySelector('[data-testid="copilot-chat-view-scroll"]')
      const up=ub.querySelector('p'),ap=ab.querySelector('.assistant-document p'),compose=el.querySelector('textarea').getBoundingClientRect()
      return {width:el.clientWidth,overflow:el.scrollWidth-el.clientWidth,userX:ur.x,aiX:ar.x,userWidth:ur.width,aiWidth:ar.width,userBackground:getComputedStyle(ub).backgroundColor,aiBackground:getComputedStyle(ab).backgroundColor,userFont:getComputedStyle(up).fontSize,aiFont:getComputedStyle(ap).fontSize,aiWeight:getComputedStyle(ap).fontWeight,lineHeight:getComputedStyle(ap).lineHeight,headFont:getComputedStyle(ab.querySelector('h2')).fontSize,scrollOverflow:sc.scrollWidth-sc.clientWidth,composerBottom:compose.bottom,viewportHeight:innerHeight,labels:[user.getAttribute('aria-label'),ai.getAttribute('aria-label')]}
    })
    if(archiveUi&&!before){
      const cards=await page.getByTestId('assistant-sidebar').evaluate(el=>{
        const user=el.querySelector('.assistant-chat-message.user'),ai=el.querySelector('.assistant-chat-message.assistant'),form=el.querySelector('.field-assistant-composer')
        return {pixel:1/devicePixelRatio,userBorder:getComputedStyle(user).borderRightWidth,aiBorder:getComputedStyle(ai).borderTopWidth,aiSurface:getComputedStyle(ai).backgroundColor,desk:getComputedStyle(el.querySelector('.assistant-surface-host')).backgroundColor,header:getComputedStyle(ai.querySelector('header')).backgroundColor,label:el.querySelector('.assistant-composer-label')?.textContent,formBorder:getComputedStyle(form).borderTopWidth,identity:user.querySelector('.assistant-speaker b')?.textContent}
      })
      assert.ok(Math.abs(parseFloat(cards.userBorder)-3)<=cards.pixel+.01);assert.ok(Math.abs(parseFloat(cards.aiBorder)-2)<=cards.pixel+.01);assert.notEqual(cards.aiSurface,cards.desk);assert.notEqual(cards.header,cards.aiSurface);assert.ok(Math.abs(parseFloat(cards.formBorder)-2)<=cards.pixel+.01);assert.equal(cards.label,'你的下一条要求');assert.equal(cards.identity,'你 · 写作要求')
      measure.cards=cards
    }
    await checkScreenshotFixes(`${theme}-${zoom}-${layout}`)
    matrix.push({theme,zoom,layout,...measure})
    if(!before){
      assert.ok(measure.userX>measure.aiX+20,JSON.stringify(measure))
      assert.ok(measure.userWidth<measure.aiWidth)
      assert.notEqual(measure.userBackground,measure.aiBackground)
      assert.equal(measure.userFont,'12.5px');assert.equal(measure.aiFont,'12.5px');assert.equal(measure.headFont,'13px')
      assert.equal(measure.aiWeight,'400');assert.ok(parseFloat(measure.lineHeight)<22)
      assert.ok(measure.overflow<=1&&measure.scrollOverflow<=1);assert.ok(measure.composerBottom<measure.viewportHeight)
      assert.deepEqual(measure.labels,['你发送的消息','智能助笔回复'])
    }
    const frame=await owner.evaluate(async win=>{const image=await win.webContents.capturePage();return {bytes:image.toPNG().toString('base64'),size:image.getSize()}})
    assert.ok(frame.size.width>1000&&frame.size.height>600)
    await writeFile(join(evidence,`${theme}-${zoom}-${layout}.png`),Buffer.from(frame.bytes,'base64'))
  }
  if(archiveUi){
    const panel=page.getByTestId('assistant-sidebar')
    if(await panel.getAttribute('data-layout')==='expanded')await page.getByTestId('assistant-expand').click()
    await panel.evaluate(el=>el.style.setProperty('width','280px','important'))
    for(const theme of ['qingzhou','moye','xuanzhi']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      await owner.evaluate(win=>win.webContents.setZoomFactor(1.25))
      await page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop=0)
      await page.waitForTimeout(150)
      await checkScreenshotFixes('narrow-'+theme)
      assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&[...el.querySelectorAll('.assistant-chat-message')].every(m=>m.scrollWidth<=m.clientWidth+1)))
      await capture('archive-narrow-'+theme)
    }
    await panel.evaluate(el=>el.style.removeProperty('width'))
  }
  if(composerChecks){
    await owner.evaluate(win=>win.webContents.setZoomFactor(1))
    await page.evaluate(()=>{document.documentElement.dataset.theme='qingzhou'})
    const draft='已有草稿：保留人物动机。'
    await input.fill(draft)
    await page.getByRole('button',{name:'引用第 2 条消息',exact:true}).click()
    assert.equal(await input.inputValue(),draft+'\n\n> 智能助笔：\n'+answer1.split('\n').map(line=>'> '+line).join('\n')+'\n\n')
    assert.equal(await input.evaluate(el=>el===document.activeElement),true)
    await input.fill('只分析这一句。')
    const selected=await page.locator('.assistant-chat-message.assistant .assistant-document p').first().evaluate(el=>{const selection=getSelection();const range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);return selection.toString()})
    await page.getByRole('button',{name:'引用第 2 条消息',exact:true}).click()
    assert.equal(await input.inputValue(),'只分析这一句。\n\n> 智能助笔：\n> '+selected+'\n\n')
    assert.equal(seen.length,2)
    await capture('quote-draft')
    const quotedDraft=await input.inputValue()
    await page.getByTestId('assistant-expand').click()
    assert.equal(await input.inputValue(),quotedDraft)
    await page.getByRole('button',{name:'关闭智能助笔侧栏'}).click()
    await page.locator('.assistant-toggle').click()
    assert.equal(await input.inputValue(),quotedDraft)
    await page.getByTestId('assistant-expand').click()
    assert.equal(await input.inputValue(),quotedDraft)
    await input.fill('稿'.repeat(9998))
    await page.getByRole('button',{name:'引用第 2 条消息',exact:true}).click()
    assert.equal(await input.inputValue(),'稿'.repeat(9998));assert.ok((await page.getByTestId('assistant-composer-status').innerText()).includes('当前输入已保留'))
    await input.fill('')
  }
  if(!before){
    // Verify the actual copy control without replacing the author's system clipboard.
    await page.evaluate(()=>{
      const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard')
      window.__fixtureRestoreClipboard=()=>{if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;delete window.__fixtureCopied;delete window.__fixtureRestoreClipboard}
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__fixtureCopied=value}}})
    })
    await page.getByRole('button',{name:'复制第 2 条消息',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.__fixtureCopied),answer1)
    await page.evaluate(()=>window.__fixtureRestoreClipboard())
    await page.getByTestId('field-assistant-instruction').fill('检查长文显示：'+prompt1.repeat(40))
    await page.getByTestId('send-field-assistant').click()
    await page.getByText('长文完整结束。',{exact:true}).waitFor({timeout:60000})
    assert.ok((await page.locator('.assistant-document').last().textContent()).endsWith('长文完整结束。\n'))
    const text=await page.locator('.assistant-chat-message.user').last().textContent();assert.ok(text.includes(prompt1.repeat(40)))
    const scroll=page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll')
    await scroll.evaluate(el=>el.scrollTop=120)
    await page.getByTestId('assistant-latest').click()
    await page.waitForFunction(()=>{const e=document.querySelector('[data-testid="field-assistant-panel"] [data-testid="copilot-chat-view-scroll"]');return e.scrollHeight-e.scrollTop-e.clientHeight<4},undefined,{timeout:5000})
    await checkScreenshotFixes('long-reply-bottom')
    if(screenshotFixes&&!before){
      assert.ok(await page.getByText('长文完整结束。',{exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),scroll=el.closest('[data-testid="copilot-chat-view-scroll"]').getBoundingClientRect();return r.top>=scroll.top&&r.bottom<=scroll.bottom}))
      await capture('long-reply-bottom')
      await scroll.evaluate(el=>el.scrollTop=0)
      await page.waitForTimeout(150)
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0)
      await capture('long-reply-top')
    }
    assert.equal(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile().then(v=>v.coreIdea)),'原书设想A')
    await page.getByTestId('field-assistant-instruction').press('Escape')
    assert.equal(await page.getByTestId('assistant-sidebar').getAttribute('data-layout'),'sidebar')
    await page.getByRole('button',{name:'关闭智能助笔侧栏'}).click()
    await page.locator('.assistant-toggle').click()
    assert.equal(await page.locator('.assistant-chat-message').count(),6)
  }
  if(composerChecks){
    await input.fill(failurePrompt);await page.getByTestId('send-field-assistant').click()
    await waitForProvider(()=>releaseFailure)
    const preserved='等待时先写好的下一条要求。'
    await input.fill(preserved)
    await page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop=0)
    assert.equal(await page.getByTestId('assistant-composer-status').isVisible(),true)
    const count=seen.length;await input.press('Control+Enter');await page.waitForTimeout(150);assert.equal(seen.length,count)
    await capture('busy-draft')
    releaseFailure()
    await page.locator('.field-assistant-composer .field-assistant-error').waitFor({timeout:30000})
    assert.equal(await input.inputValue(),preserved)
    assert.match(await page.getByTestId('assistant-recovery-guidance').innerText(), /已完成的操作会保留.*核对记录/)
    assert.equal(await page.getByRole('button',{name:'取回原要求',exact:true}).isVisible(),true)
    assert.equal(await page.getByTestId('send-field-assistant').isEnabled(),true)
    await capture('failure-draft')
    const beforeFailureRecall=seen.length, failureRecall=page.getByRole('button',{name:'取回原要求',exact:true})
    await failureRecall.focus();await failureRecall.press('Enter')
    assert.equal(seen.length,beforeFailureRecall,'recalling a failed prompt must not dispatch')
    assert.equal(await input.inputValue(),preserved+'\n\n'+failurePrompt)
    assert.equal(await input.evaluate(el=>el===document.activeElement),true)
    await capture('failure-recalled')
    await input.fill(slowPrompt);await page.getByTestId('send-field-assistant').click()
    await waitForProvider(()=>releaseSlow)
    await input.fill(preserved)
    await page.getByRole('button',{name:'停止',exact:true}).click()
    await page.getByText('本轮已停止，可以修改要求后再次发送。',{exact:true}).waitFor({timeout:30000})
    releaseSlow();await page.waitForTimeout(400)
    assert.equal(await input.inputValue(),preserved)
    assert.equal(await page.locator('.assistant-chat-message.assistant').count(),3)
    assert.equal(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile().then(v=>v.coreIdea)),'原书设想A')
    await capture('stopped-draft')
  }
  if(workbenchChecks){
    await owner.evaluate(win=>win.webContents.setZoomFactor(1))
    await owner.evaluate(win=>win.setSize(1440,1000))
    const sidebar=page.getByTestId('assistant-sidebar'),grip=page.getByRole('separator',{name:'调整智能助笔侧栏宽度'})
    const initial=(await sidebar.boundingBox()).width,box=await grip.boundingBox()
    await page.mouse.move(box.x+box.width/2,box.y+200);await page.mouse.down();await page.mouse.move(box.x-140,box.y+200,{steps:8});await page.mouse.up()
    const resized=(await sidebar.boundingBox()).width;assert.ok(resized>initial+100,{initial,resized})
    await grip.focus();await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>Number(localStorage.getItem('lanjian-assistant-width'))),280)
    await page.keyboard.press('End');assert.equal(await page.evaluate(()=>Number(localStorage.getItem('lanjian-assistant-width'))),720)
    await owner.evaluate(win=>win.setSize(1000,850));await page.waitForTimeout(150)
    assert.ok(await page.locator('.workbench').evaluate(el=>el.getBoundingClientRect().width>=410))
    assert.equal(await page.evaluate(()=>localStorage.getItem('lanjian-assistant-width')),'720')
    await capture('narrow-width-budget');await owner.evaluate(win=>win.setSize(1440,1000))
    await page.getByTestId('assistant-expand').click()
    const wideGrip=page.getByRole('separator',{name:'调整宽屏助笔宽度'}),wideBox=await wideGrip.boundingBox(),wideBefore=(await sidebar.boundingBox()).width
    await page.mouse.move(wideBox.x+5,wideBox.y+220);await page.mouse.down();await page.mouse.move(wideBox.x+185,wideBox.y+220,{steps:8});await page.mouse.up()
    assert.ok((await sidebar.boundingBox()).width<wideBefore-100)
    await wideGrip.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>localStorage.getItem('lanjian-assistant-expanded-width')),'496')
    await page.keyboard.press('End');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>localStorage.getItem('lanjian-assistant-expanded-width')),'1184')
    await capture('wide-resized')
    await page.getByTestId('assistant-expand').click()
    const beforeRecall=seen.length
    await input.fill('原草稿仍应保留。');const recall=page.getByRole('button',{name:'取回原要求',exact:true});await recall.focus();await recall.press('Enter')
    assert.equal(seen.length,beforeRecall,'recalling the prompt must not send a request')
    assert.equal(await input.inputValue(),'原草稿仍应保留。\n\n'+slowPrompt)
    const beforeHistory=await page.locator('.assistant-conversation > .assistant-chat-message .assistant-message-body').allTextContents()
    await page.getByTestId('assistant-mode-tasks').click();await page.getByRole('button').filter({hasText:prompt1}).first().click()
    await page.getByRole('button',{name:'返回当前对话',exact:true}).click()
    assert.deepEqual(await page.locator('.assistant-conversation > .assistant-chat-message .assistant-message-body').allTextContents(),beforeHistory)
    assert.equal(await input.inputValue(),'原草稿仍应保留。\n\n'+slowPrompt)
    await page.getByRole('button',{name:'查找对话',exact:true}).click();await page.getByTestId('assistant-find').fill('凌晨三点的怀表')
    await page.waitForFunction(()=>CSS.highlights.get('assistant-find')?.size>1)
    await page.getByRole('button',{name:'下一处匹配',exact:true}).click()
    assert.equal(await page.evaluate(()=>CSS.highlights.get('assistant-find-active').size),1)
    await capture('find-exact-text')
    const heading=page.getByRole('combobox',{name:'跳转回复标题'})
    await heading.selectOption({index:3});assert.ok(await page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop>100))
    await page.getByRole('button',{name:'查找对话',exact:true}).click()
    const comparison=page.locator('.assistant-reply-comparison');await comparison.locator(':scope > summary').click()
    await comparison.locator('.assistant-reply-columns .assistant-document').first().waitFor()
    assert.equal(await comparison.locator('.assistant-reply-columns .assistant-document').count(),2)
    await comparison.getByRole('combobox',{name:'第一份回复',exact:true}).selectOption('0')
    assert.equal(await comparison.locator('.assistant-document').first().textContent(),await page.locator('.assistant-chat-message.assistant .assistant-document').first().textContent())
    await capture('reply-comparison');await comparison.locator(':scope > summary').click()
    await input.fill('验证真实流式回复');await page.getByTestId('send-field-assistant').click()
    await page.locator('.assistant-streaming').getByText('第一段已经返回。',{exact:true}).waitFor({timeout:30000})
    assert.equal(await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent().then(r=>r.find(v=>v.goal==='验证真实流式回复').result)),undefined)
    await capture('streaming');releaseStream()
    await page.locator('.assistant-chat-message.assistant:not(.assistant-streaming)').getByText('第二段完整结束。',{exact:true}).waitFor({timeout:30000})
    assert.equal(await page.locator('.assistant-streaming').count(),0)
    const draft='重启后保留：下一章先写雨停，再让修复师发现表盖内侧的名字。'
    await input.fill(draft)
    await page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop=450)
    await page.waitForTimeout(400)
    const oldMessages=await page.locator('.assistant-conversation > .assistant-chat-message .assistant-message-body').allTextContents()
    await page.getByRole('button',{name:'返回我的作品',exact:true}).click()
    await page.evaluate(parentPath=>window.novelDesktop.projects.create({parentPath,name:'另一部B',genre:'悬疑'}),books)
    await openBook('另一部B');input=page.getByTestId('field-assistant-instruction')
    assert.equal(await input.inputValue(),'');assert.equal(await page.locator('.assistant-chat-message').count(),0)
    await input.fill('这是作品 B 的独立草稿。');await page.waitForTimeout(200)
    await page.getByRole('button',{name:'返回我的作品',exact:true}).click();await page.locator('[data-library-view="all"]').click();await page.locator('.work-item-open').filter({hasText:'原书A'}).first().click()
    await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
    if(await page.locator('.assistant-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.assistant-toggle').click()
    await page.waitForFunction(()=>document.querySelector('[data-testid="field-assistant-instruction"]')?.value.includes('重启后保留'))
    assert.equal(await input.inputValue(),draft);assert.deepEqual(await page.locator('.assistant-conversation > .assistant-chat-message .assistant-message-body').allTextContents(),oldMessages)
    await page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop=450);await page.waitForTimeout(400)
    {const closed=app.waitForEvent('close');await owner.evaluate(win=>win.close());await closed};app=await _electron.launch({args:[entry,'--disable-gpu'],env});page=await app.firstWindow();page.on('pageerror',e=>rendererErrors.push(e.message));owner=await app.browserWindow(page);await owner.evaluate(win=>win.setSize(1440,1000))
    await page.waitForFunction(()=>Boolean(window.novelDesktop),undefined,{timeout:30000});await openBook();input=page.getByTestId('field-assistant-instruction')
    await page.waitForFunction(()=>document.querySelector('[data-testid="field-assistant-instruction"]')?.value.includes('重启后保留'))
    assert.equal(await input.inputValue(),draft);assert.deepEqual(await page.locator('.assistant-conversation > .assistant-chat-message .assistant-message-body').allTextContents(),oldMessages)
    await page.waitForTimeout(350)
    const restoredTop=await page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop);assert.ok(Math.abs(restoredTop-450)<8,`reading position: ${restoredTop}`)
    assert.equal(await page.evaluate(()=>localStorage.getItem('lanjian-assistant-width')),'720');await page.getByTestId('assistant-expand').click();assert.ok(Math.abs((await page.getByTestId('assistant-sidebar').boundingBox()).width-1184)<2)
    await capture('restart-restored')
    console.log('PASS workbench widths, search, history, comparisons, streaming, book isolation and normal restart')
  }
  if(screenshotFixes&&!before){
    await owner.evaluate(win=>win.webContents.setZoomFactor(1))
    const model=page.locator('.field-assistant-composer .model-catalog-trigger')
    await model.click();await page.getByRole('dialog',{name:'选择模型及所属接口'}).waitFor()
    await capture('model-menu');await page.keyboard.press('Escape')
    assert.equal(await model.getAttribute('aria-expanded'),'false')
    const pet=page.getByTestId('desktop-pet-tools-toggle')
    await pet.focus();await pet.press('ArrowDown');assert.equal(await pet.getAttribute('aria-expanded'),'true')
    await page.keyboard.press('Escape');assert.equal(await pet.getAttribute('aria-expanded'),'false')
    assert.equal(await pet.evaluate(el=>document.activeElement===el),true)
    await owner.evaluate(win=>{win.setSize(1000,850);win.webContents.setZoomFactor(1.25)})
    await page.waitForTimeout(200)
    assert.equal(await page.locator('.book-library span').isVisible(),true)
    await page.locator('.book-library').click();await page.locator('.work-item-open').filter({hasText:'原书A'}).first().waitFor()
    await owner.evaluate(win=>{win.setSize(1440,1000);win.webContents.setZoomFactor(1)})
    await page.locator('.work-item-open').filter({hasText:'原书A'}).first().click()
    await page.locator('.assistant-toggle').waitFor()
    if(await page.locator('.assistant-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.assistant-toggle').click()
    await page.getByTestId('field-assistant-instruction').waitFor()
    assert.equal(await page.getByRole('textbox',{name:'章节标题',exact:true}).inputValue(),'雨夜')
    await capture('seven-fixes-workspace')
  }
  assert.deepEqual(errors,[]);assert.deepEqual(rendererErrors,[])
  await writeFile(join(evidence,'geometry.json'),JSON.stringify(geometry,null,2))
  await writeFile(join(evidence,'result.json'),JSON.stringify({ok:true,before,composerChecks,workbenchChecks,build:entry,matrix,requests:seen.length,rendererErrors},null,2))
  console.log(JSON.stringify({ok:true,before,composerChecks,layouts:matrix.length,requests:seen.length}))
  if(acceptance){
    await owner.evaluate(win=>{win.webContents.setZoomFactor(1);win.setSize(1440,1000);win.setTitle('岚笺 · 助笔档案界面验收（临时作品）')})
    await page.evaluate(()=>document.documentElement.dataset.theme='qingzhou')
    const panel=page.getByTestId('assistant-sidebar')
    if(screenshotFixes){
      if(await panel.getAttribute('data-layout')==='expanded')await page.getByTestId('assistant-expand').click()
      await owner.evaluate(win=>win.setTitle('岚笺 · 七项界面修正验收（临时作品）'))
    }else{
      if(await panel.getAttribute('data-layout')!=='expanded')await page.getByTestId('assistant-expand').click()
      await panel.evaluate(el=>el.style.setProperty('--assistant-expanded-width','900px'))
    }
    await page.getByTestId('field-assistant-instruction').fill('保留原来的犹豫和善意，再比较两种开篇写法。')
    await page.getByTestId('field-assistant-panel').getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop=0)
    await owner.evaluate(win=>{win.show();win.focus()});await page.waitForTimeout(250)
    await capture('acceptance-ready')
    const ready={status:'ready',entry,pid:app.process().pid,root,syntheticOnly:true}
    await writeFile(join(evidence,'acceptance-ready.json'),JSON.stringify(ready,null,2));console.log(JSON.stringify({acceptanceReady:true,pid:ready.pid}))
    await app.waitForEvent('close',{timeout:0});app=undefined
    await writeFile(join(evidence,'acceptance-ready.json'),JSON.stringify({...ready,status:'closed'},null,2))
  }
} catch(error){
  await writeFile(join(evidence,'geometry.json'),JSON.stringify(geometry,null,2))
  await writeFile(join(evidence,'failure.txt'),String(error))
  if(app)await app.firstWindow().then(async p=>{const w=await app.browserWindow(p);const data=await w.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(evidence,'failure.png'),Buffer.from(data,'base64'))}).catch(()=>{})
  throw error
} finally {
  releaseFailure?.();releaseSlow?.();releaseStream?.()
  if(app){const page=await app.firstWindow();const owner=await app.browserWindow(page);const closed=app.waitForEvent('close');await owner.evaluate(win=>win.close());await closed}
  await new Promise(resolve=>server.close(resolve))
  const target=await realpath(root);assert.equal(dirname(target),temporaryParent);assert.ok(basename(target).startsWith('lanjian-assistant-message-ui-'))
  await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
