import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

// Real packaged-layout main/preload + validated IPC; only temporary books and a
// loopback fake provider. No developer driver or author model configuration.
const gemini = process.argv.includes('--gemini')
const recovery = process.argv.includes('--recovery')
const answerDraft = process.argv.includes('--answer-draft')
const answerTranscript = process.argv.includes('--answer-transcript')
const reading = process.argv.includes('--reading')
const candidateScope = process.argv.includes('--candidate-scope')
const receiptRecovery = process.argv.includes('--receipt-recovery')
const taskHistory = process.argv.includes('--task-history')
const taskUi = process.argv.includes('--task-ui')
const taskReading = process.argv.includes('--task-reading')
const comparisonReading = process.argv.includes('--comparison-reading')
const messageActions = process.argv.includes('--message-actions')
const composeDraft = process.argv.includes('--compose-draft')
const chatPosition = process.argv.includes('--chat-position')
const focusFlow = process.argv.includes('--focus-flow')
const reviewNavigation = process.argv.includes('--review-navigation')
const reviewFreshness = process.argv.includes('--review-freshness')
const acceptance = process.argv.includes('--acceptance')
const replyComparison = process.argv.includes('--reply-comparison') || comparisonReading
let activeFindBeforeReply = ''
let firstAnswerText = ''
const nativeReplies = new Set(), nativeRequests = []
const temporaryParent = await realpath(tmpdir())
const root = await realpath(await mkdtemp(join(temporaryParent, 'lanjian-author-interaction-smoke-')))
const books = join(root, 'books'), userData = join(root, 'app')
await Promise.all([mkdir(books), mkdir(userData)])
const entry = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-assistant-integration', 'main/index.js')
const evidence=resolve(process.env.LANJIAN_ASSISTANT_EVIDENCE || '../.trellis/tasks/09-30-v3-workspace-archive-design/evidence/assistant-integration')
await mkdir(evidence,{recursive:true})
const longCandidate=Array.from({length:20},(_,i)=>`第${i+1}个情节：修复师在雨夜听见旧物的记忆，却发现自己曾经参与那场无人提起的告别。他需要辨别记忆的主人，并在保护朋友与寻找真相之间做出选择。`).join('\n\n')
let longAnswer='# 人物与事件的连贯性\n\n'+Array.from({length:32},(_,i)=>`## 第 ${i+1} 处推敲\n\n修复师的行动需要从具体的欲望开始。他想找回旧物的主人，却在旧物中听见自己的声音。先让他付出一点代价，再让记忆改变他对朋友的判断，悬念就会与人物选择相互推动。\n\n- 当前动机：寻找真相。\n- 后续影响：朋友开始隐瞒线索。`).join('\n\n')+'\n\n|人物|目标|代价|\n|---|---|---|\n|修复师|寻找真相|失去信任|\n\n长文完整结束。'
if(reading)longAnswer+='\n\n这是**跨格式**匹配。\n\n分段边界甲\n\n分段边界乙\n\nİ😀标记之后 OFFSET 仍能准确查找。\n\n字面量 [a.*] 不表示正则表达式。\n\n'+ '密'.repeat(1100)
let releaseDelayed
const seen = [], errors = [], rendererErrors=[]
let answered
const question = {questions:[
  {id:'tone',prompt:'你希望故事如何展开？',mode:'single',required:true,options:[{id:'warm',label:'温暖的相遇',description:'从小人物的善意开始。',recommended:true},{id:'dark',label:'雨夜的悬疑',description:'从一件不合常理的旧物开始。'}]},
  {id:'elements',prompt:'保留哪些元素？',mode:'multiple',required:true,options:[{id:'rain',label:'雨夜'},{id:'memory',label:'旧物记忆'}]},
  {id:'note',prompt:'还有什么想补充的？',mode:'text',required:false,options:[]}
]}
const server=createServer(async(request,response)=>{
  try{
    if(request.method==='GET'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:'plugin-smoke-model'}]}));return}
    let raw='';for await(const chunk of request)raw+=chunk
    const wire=JSON.parse(raw)
    if(gemini){
      assert.match(request.url,/^\/v1\/models\/plugin-smoke-model:(?:streamGenerateContent\?alt=sse|generateContent)$/)
      assert.equal(request.headers['x-goog-api-key'],'synthetic-plugin-key')
      assert.equal(wire.messages,undefined)
      nativeRequests.push(wire)
    }
    const jsonReply=message=>{
      if(!gemini){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));return}
      const parts=[...(message.content?[{text:message.content}]:[]),...(message.tool_calls??[]).map(call=>({functionCall:{id:call.id,name:call.function.name,args:JSON.parse(call.function.arguments)},thoughtSignature:Buffer.from(call.id).toString('base64')})),{text:'',thoughtSignature:'c2lnbmVkLXRhaWw='}]
      if(message.tool_calls)nativeReplies.add(JSON.stringify(parts))
      if(request.url.includes(':streamGenerateContent')){
        response.setHeader('Content-Type','text/event-stream')
        response.end(`data: ${JSON.stringify({candidates:[{content:{role:'model',parts}}]})}\n\ndata: ${JSON.stringify({candidates:[{finishReason:'STOP'}]})}\n\n`)
      }else{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({candidates:[{content:{role:'model',parts},finishReason:'STOP'}]}))}
    }
    const body=gemini?{
      tools:wire.tools?.[0].functionDeclarations.map(f=>({function:{name:f.name,parameters:f.parametersJsonSchema}})),
      messages:wire.contents.flatMap(c=>{
        if(c.role==='model'){
          const calls=c.parts.filter(p=>p.functionCall)
          if(calls.length)assert.ok(nativeReplies.has(JSON.stringify(c.parts)),'Replay must retain all original signed parts after tool dispatch/restart')
          return [{role:'assistant',content:c.parts.map(p=>p.text??'').join(''),...(calls.length?{tool_calls:calls.map(p=>({id:p.functionCall.id,type:'function',function:{name:p.functionCall.name,arguments:JSON.stringify(p.functionCall.args)}}))}:{})}]
        }
        const results=c.parts.filter(p=>p.functionResponse)
        if(results.length)return results.map(p=>{
          const f=p.functionResponse,call=wire.contents.flatMap(v=>v.parts).find(v=>v.functionCall?.id===f.id)?.functionCall
          assert.ok(call);assert.equal(f.name,call.name)
          return {role:'tool',tool_call_id:f.id,content:JSON.stringify(f.response)}
        })
        return [{role:'user',content:c.parts.map(p=>p.text??'').join('')}]
      })
    }:wire
    seen.push(body)
    if(!body.tools)return jsonReply({role:'assistant',content:JSON.stringify({value:longCandidate})})
    const declared = new Set(body.messages.flatMap(message => message.tool_calls ?? []).map(call => call.id))
    assert.ok(body.messages.filter(message => message.role === 'tool').every(message => declared.has(message.tool_call_id)), 'Each tool result needs its original provider declaration')
    const results=body.messages.filter(m=>m.role==='tool')
    const user=body.messages.filter(m=>m.role==='user').at(-1).content
    if(user==='LONG')return jsonReply({role:'assistant',content:longAnswer})
    if(user==='DELAY'){await new Promise(resolve=>{releaseDelayed=resolve});return jsonReply({role:'assistant',content:'新的结果已到达，继续保留你的阅读位置。'})}
    if(['FIELD','FIELD_EDIT','FIELD_SCOPE'].includes(user)){
      if(answerTranscript&&user==='FIELD')assert.ok(body.messages.some(message=>message.role==='user'&&message.content===firstAnswerText),'The next independent request carries the real confirmed answers')
      const tool=(name,args)=>jsonReply({role:'assistant',content:null,tool_calls:[{id:'call-'+body.messages.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]})
      const values=results.map(item=>JSON.parse(item.content))
      if(values.some(item=>item.decision))return jsonReply({role:'assistant',content:'字段候选已由作者处理，原任务接续完成。'})
      const afterNavigation=values.slice(values.findLastIndex(item=>item.navigated)+1)
      const fields=afterNavigation.find(item=>item.fields)?.fields
      if(!fields)return tool('list_editable_fields',{query:'核心设想'})
      if(!afterNavigation.some(item=>item.label==='核心设想'&&item.context))return tool('read_field',{targetId:fields[0].targetId})
      return tool('edit_field',{targetId:fields[0].targetId,instruction:'改成旧物记忆'})
    }
    const name=body.tools.find(t=>t.function.name.includes('_ask_author_')).function.name
    const message=results.length?{role:'assistant',content:'已根据作者的真实回答继续原来的故事目标。'}:{role:'assistant',content:null,tool_calls:[{id:'author-question-call',type:'function',function:{name,arguments:JSON.stringify(question)}}]}
    if(results.length)answered=JSON.parse(results.at(-1).content)
    jsonReply(message)
  }catch(error){errors.push(error);response.statusCode=500;response.end('{}')}
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
  const state = await page.evaluate(async ({ books, baseUrl, protocol }) => {
    let stage = 'create'
    try {
    const api = window.novelDesktop
    const { project } = await api.projects.create({ parentPath: books, name: '原书A', genre: '仙侠' })
    stage = 'configure-model'
    const catalogue = await api.modelConnections.list()
    const created = await api.modelConnections.create({ expectedRevision: catalogue.revision, name: '插件隔离接口', baseUrl, protocol, apiKey: 'synthetic-plugin-key' })
    const connection = created.connections.find(item => item.name === '插件隔离接口')
    const edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'smoke', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'smoke', model: 'plugin-smoke-model', temperature: .6, topP: 1, maxTokens: 8192 } } })
    const profile = await api.workspace.getBookProfile()
    await api.workspace.saveBookProfile({ ...profile, coreIdea: '原书设想A' })
    const chapter = await api.chapters.create()
    await api.chapters.update(chapter.id, { content: '原书A的雨夜正文。', title: '雨夜' })
    return { project, chapterId: chapter.id }
    } catch (error) { throw new Error(stage + ': ' + JSON.stringify(error)) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: gemini?'gemini-native':'openai-compatible' })
  async function openBook(title='原书A'){
    await page.evaluate(async()=>{localStorage.setItem('lanjian-opening-enabled','false');localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'standard',bootStyle:'brief',bootPalette:'system'}));sessionStorage.setItem('lanjian-opening-seen','true');localStorage.setItem('lanjian-companion-voice-v1',JSON.stringify({voice:'ningguang',mute:true,textModel:false,preload:false}));await window.companionSettings?.update({voice:{mute:true,textModel:false,preload:false}})})
    await page.reload()
    await page.waitForFunction(()=>Boolean(window.novelDesktop),undefined,{timeout:60000})
    await page.waitForTimeout(1500)
    if(await page.getByTestId('app-boot-skip-models').isVisible())await page.getByTestId('app-boot-skip-models').click()
    await page.waitForFunction(()=>{const boot=document.querySelector('[data-testid="app-boot"]');return !boot||boot.getAttribute('data-boot-phase')==='ready'})
    await page.getByTestId('app-boot-enter').click()
    const owner=await app.browserWindow(page)
    await owner.evaluate(win=>{win.hide();win.show();win.focus()})
    await page.getByTestId('app-boot').waitFor({state:'hidden',timeout:60000})
    if(!await page.locator('.assistant-toggle').isVisible()){
      await page.locator('[data-library-view="all"]').click()
      await page.locator('.work-item-open').filter({hasText:title}).first().click()
    }
    await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
    await page.locator('.assistant-toggle').waitFor({timeout:60000}).catch(async error=>{console.error(await page.locator('body').innerText());throw error})
    await page.locator('.assistant-toggle').click()
    await page.getByTestId('field-assistant-instruction').waitFor()
  }
  await openBook()
  const window=await app.browserWindow(page)
  await window.evaluate(win=>win.setSize(1440,1000))
  const shot=async name=>{
    const capture=await window.evaluate(async win=>{const image=await win.webContents.capturePage();return {png:image.toPNG().toString('base64'),size:image.getSize()}})
    assert.ok(capture.size.width>900&&capture.size.height>600)
    await writeFile(join(evidence,name+'.png'),Buffer.from(capture.png,'base64'))
  }
  const sendMessage=async()=>{
    const button=page.getByTestId('send-field-assistant'),updates=(await button.innerText())==='更新核对'
    await button.click()
    if(updates){await page.waitForFunction(()=>{const button=document.querySelector('[data-testid="send-field-assistant"]');return button?.textContent==='确认发送'&&!button.disabled});await button.click()}
  }
  const bounds=()=>page.getByTestId('assistant-sidebar').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}))
  const readConversationValue=(key,bookId)=>page.evaluate(async({key,bookId})=>{
    const scope=bookId??(await window.novelDesktop.fieldAssistant.runs.recent())[0]?.workItemId
    if(!scope)throw new Error('Conversation fixture needs an explicit book before its first run')
    return new Promise((resolve,reject)=>{
      const open=indexedDB.open('lanjian-assistant-reading',1)
      open.onerror=()=>reject(open.error)
      open.onsuccess=()=>{
        const db=open.result,tx=db.transaction('conversation','readonly'),request=tx.objectStore('conversation').get([scope,key])
        tx.oncomplete=()=>{db.close();resolve(request.result??null)}
        tx.onerror=()=>{db.close();reject(tx.error)}
      }
    })
  },{key,bookId})
  const readAnswerDraft=()=>readConversationValue('questionDraft')
  const confirmedAnswers=async()=>(await readConversationValue('turns')??[]).filter(turn=>turn.answerSubmissionId)
  const waitConfirmedAnswers=async count=>{
    const deadline=Date.now()+10000
    while((await confirmedAnswers()).length!==count){assert.ok(Date.now()<deadline,'Confirmed answers were not persisted');await page.waitForTimeout(100)}
    return confirmedAnswers()
  }
  const waitAnswerSaved=()=>page.getByTestId('author-answer-save-status').getByText('回答已保留在本机',{exact:true}).waitFor()
  const revealPending=async (label, keyboard=false)=>{
    const requests=seen.length
    await page.getByTestId('copilot-chat-view-scroll').evaluate(el=>el.scrollTop=0)
    const jump=page.getByTestId('assistant-reveal-pending')
    assert.ok((await jump.innerText()).includes(label))
    if(keyboard){await jump.focus();await jump.press('Enter')}else await jump.click()
    await page.waitForTimeout(150)
    assert.ok(await page.getByTestId('assistant-pending-content').evaluate(el=>{
      const pane=document.querySelector('[data-testid="copilot-chat-view-scroll"]').getBoundingClientRect()
      const box=el.getBoundingClientRect()
      return document.activeElement===el&&box.top>=pane.top-1&&box.top<pane.bottom-30
    }),'The fixed action must focus and reveal the actual pending card')
    assert.equal(seen.length,requests,'Locating pending content cannot execute it')
  }
  await page.getByTestId('assistant-expand').click()
  assert.equal(await page.getByTestId('assistant-sidebar').getAttribute('data-layout'),'expanded')
  assert.ok((await bounds()).width>850)
  await shot('expanded-empty')
  await page.getByTestId('assistant-expand').click()
  await shot('sidebar-empty')
  if(focusFlow){
    const findButton=page.getByRole('button',{name:'查找对话',exact:true}),find=page.getByTestId('assistant-find'),input=page.getByTestId('field-assistant-instruction')
    const draft='人物的犹豫🌱\n保留这段追问与选区。',requests=seen.length
    await findButton.click();await find.press('Escape')
    assert.ok(await findButton.evaluate(el=>document.activeElement===el),'Closing search returns to its actual reading-toolbar launcher')
    await input.fill(draft);await input.evaluate(el=>{el.focus();el.setSelectionRange(2,8,'backward')})
    await input.press('Control+f');await find.fill('人物');await find.press('Escape')
    assert.deepEqual(await input.evaluate(el=>({focused:document.activeElement===el,start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection,value:el.value})),{focused:true,start:2,end:8,direction:'backward',value:draft})
    await page.evaluate(()=>{
      document.querySelector('.assistant-reading-tools button').click()
      const tab=document.querySelector('[data-testid="assistant-mode-tasks"]');tab.focus();tab.click()
    })
    await page.waitForTimeout(100)
    assert.ok(await page.getByTestId('assistant-mode-tasks').evaluate(el=>document.activeElement===el),'Pending find focus must not steal the new tab')
    await page.getByTestId('assistant-mode-agent').click()
    await page.evaluate(()=>{
      document.querySelector('[aria-label="关闭对话查找"]').click()
      const field=document.querySelector('[placeholder="填写章节标题"]');field.focus();field.setSelectionRange(0,2)
    })
    await page.waitForTimeout(100)
    assert.ok(await page.locator('[placeholder="填写章节标题"]').evaluate(el=>document.activeElement===el&&el.selectionStart===0&&el.selectionEnd===2),'Pending close must not steal a newer author focus/selection')
    await page.evaluate(()=>{
      document.querySelector('.assistant-reading-tools button').click()
      document.querySelector('[aria-label="关闭智能助笔侧栏"]').click()
      document.querySelector('[placeholder="填写章节标题"]').focus()
    })
    await page.getByTestId('assistant-sidebar').waitFor({state:'hidden'})
    assert.ok(await page.locator('[placeholder="填写章节标题"]').evaluate(el=>document.activeElement===el))
    await page.locator('.assistant-toggle').click()
    await page.getByRole('button',{name:'关闭对话查找',exact:true}).click()
    assert.equal(await input.inputValue(),draft);assert.equal(seen.length,requests)
    await page.evaluate(()=>{const button=document.querySelector('.assistant-starters button');button.focus();button.click();document.querySelector('[placeholder="填写章节标题"]').focus()})
    await page.getByTestId('assistant-compose-notice').waitFor()
    assert.ok(await page.locator('[placeholder="填写章节标题"]').evaluate(el=>document.activeElement===el),'Quick fill cannot steal a newer field focus while memory settles')
    assert.ok((await input.inputValue()).startsWith(draft+'\n\n'))
    await input.fill('');console.log('PASS find returns launcher or original composer selection; pending open/close respects tab, drawer and newer field focus')
  }
  if(composeDraft){
    const input=page.getByTestId('field-assistant-instruction'),starters=page.locator('.assistant-starters button'),notice=page.getByTestId('assistant-compose-notice')
    const first='帮我完善核心设想，重点检查主角目标、核心冲突和故事悬念。我的想法是：',second='帮我完善人物设定，重点补足动机、关系与成长变化。要讨论的人物是：'
    const draft='我正在整理的想法🌱\n不要丢掉人物的犹豫。\n保留末尾空格  ',requests=seen.length
    await input.fill(draft);await starters.nth(0).click();await notice.waitFor()
    assert.equal(await input.inputValue(),draft+'\n\n'+first)
    assert.equal(await notice.innerText(),'已追加到当前输入，原草稿已保留。')
    assert.ok(await input.evaluate(el=>el===document.activeElement&&el.selectionStart===el.value.length&&el.selectionEnd===el.value.length))
    await page.getByText('会话已保留在本机',{exact:true}).waitFor()
    assert.equal(await readConversationValue('draft',state.project.id),draft+'\n\n'+first,'The existing draft store receives the complete combined text')
    await starters.nth(0).click();assert.equal(await input.inputValue(),draft+'\n\n'+first)
    assert.equal(await notice.innerText(),'这条要求已在输入框中，可继续修改。')
    await starters.nth(1).click();assert.equal(await input.inputValue(),draft+'\n\n'+first+'\n\n'+second)
    await input.fill('稿'.repeat(9998));await starters.nth(0).click()
    assert.equal(await input.inputValue(),'稿'.repeat(9998))
    assert.ok((await page.getByTestId('assistant-composer-status').innerText()).includes('当前草稿已保留'))
    assert.equal(await notice.count(),0,'Capacity failure cannot retain an earlier insertion-success notice')
    await input.fill('');await starters.nth(1).focus();await starters.nth(1).press('Enter')
    assert.equal(await input.inputValue(),second);assert.equal(await notice.innerText(),'已填入输入框，可修改后发送。')
    await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',ctrlKey:true,isComposing:true})
    assert.equal(seen.length,requests,'Filling a quick request, including IME confirmation, cannot send it')
    await input.fill(draft)
    await page.evaluate(()=>{const buttons=document.querySelectorAll('.assistant-starters button');buttons[0].click();buttons[1].click()})
    await notice.waitFor();assert.equal(await input.inputValue(),draft+'\n\n'+second,'The later same-tick fill supersedes an older pending fill')
    await input.fill(draft)
    await page.evaluate(()=>{document.querySelector('.assistant-starters button').click();document.querySelector('button[aria-label="关闭智能助笔侧栏"]').click()})
    await page.getByTestId('assistant-sidebar').waitFor({state:'hidden',timeout:3000})
    await page.waitForTimeout(100)
    assert.equal(await page.getByTestId('assistant-sidebar').isVisible(),false,'A pending fill cannot reopen the closed panel')
    assert.equal(await input.inputValue(),draft)
    await page.locator('.assistant-toggle').click()
    await page.evaluate(()=>{document.querySelector('.assistant-starters button').click();const tab=document.querySelector('[data-testid="assistant-mode-tasks"]');tab.focus();tab.click()})
    await page.waitForTimeout(100)
    assert.ok(await page.getByTestId('assistant-mode-tasks').evaluate(el=>el===document.activeElement&&el.getAttribute('aria-pressed')==='true'),'Pending fill cannot leave the newly selected tab or steal focus')
    assert.equal(await input.inputValue(),draft)
    await page.getByTestId('assistant-mode-agent').click()
    const panel=page.getByTestId('assistant-sidebar'),metrics=[]
    await panel.evaluate(el=>{el.style.setProperty('width','280px','important');el.style.setProperty('min-width','280px','important')})
    for(const theme of ['qingzhou','moye','xuanzhi'])for(const zoom of [1,1.25]){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
      await input.fill(draft);await starters.nth(0).click()
      const geometry=await page.locator('.field-assistant-composer').evaluate(el=>{
        const notice=el.querySelector('[data-testid="assistant-compose-notice"]'),input=el.querySelector('textarea'),r=notice.getBoundingClientRect(),pane=el.getBoundingClientRect()
        return {width:el.clientWidth,scroll:el.scrollWidth,noticeFont:getComputedStyle(notice).fontSize,inputFont:getComputedStyle(input).fontSize,inside:r.left>=pane.left&&r.right<=pane.right&&r.bottom<=pane.bottom,visible:notice.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}
      })
      assert.ok(geometry.scroll<=geometry.width+1&&geometry.inside&&geometry.visible);assert.equal(geometry.noticeFont,'11px');assert.equal(geometry.inputFont,'13px')
      metrics.push({theme,zoom,...geometry});await shot('compose-draft-'+theme+'-'+zoom)
    }
    await panel.evaluate(el=>{el.style.removeProperty('width');el.style.removeProperty('min-width')})
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    await page.evaluate(()=>document.documentElement.dataset.theme='qingzhou')
    assert.equal(seen.length,requests);assert.equal(await page.locator('.assistant-chat-message').count(),0)
    await writeFile(join(evidence,'compose-draft-metrics.json'),JSON.stringify(metrics,null,2))
    await input.fill('');assert.equal(await notice.count(),0)
    console.log('PASS quick fill preserves/stores draft, no duplicate or overflow, keyboard/IME, late close/tab/selection guards and compact themed feedback without model requests')
  }
  console.log('Fixture ready; checking question UI')
  await page.getByTestId('field-assistant-instruction').fill('INTERACT')
  await sendMessage()
  await page.getByTestId('author-question-card').waitFor({timeout:60000})
  if(reviewNavigation){
    const jump=page.getByTestId('assistant-reveal-pending'),pending=page.getByTestId('assistant-pending-content')
    await jump.focus();await jump.press('Enter')
    assert.ok(await pending.evaluate(el=>document.activeElement===el),'Keyboard entry reveals the actual question')
    await jump.evaluate(button=>{button.focus();button.click();const field=document.querySelector('[placeholder="填写章节标题"]');field.focus();field.setSelectionRange(0,2)})
    await page.waitForTimeout(100)
    assert.ok(await page.locator('[placeholder="填写章节标题"]').evaluate(el=>document.activeElement===el&&el.selectionStart===0&&el.selectionEnd===2),"Pending navigation cannot steal the author's newer field focus")
    await jump.evaluate(button=>{button.focus();button.click();const tab=document.querySelector('[data-testid="assistant-mode-tasks"]');tab.focus();tab.click()})
    await page.waitForTimeout(100)
    assert.ok(await page.getByTestId('assistant-mode-tasks').evaluate(el=>document.activeElement===el),'Pending navigation cannot focus a hidden mode')
    await page.getByTestId('assistant-mode-agent').click()
    assert.equal(seen.length,1,'Reading a question cannot submit it')
    console.log('PASS pending navigation, keyboard and newer field/tab focus ownership')
  }
  const submit=page.getByTestId('submit-author-answer')
  assert.equal(await submit.isDisabled(),true,'Recommended options must not count as answers')
  await page.getByLabel('温暖的相遇').check()
  await page.getByLabel('你希望故事如何展开？：自由回答').fill('主角先帮助陌生人，再发现旧物的秘密。')
  assert.equal(await page.getByLabel('温暖的相遇').isChecked(),false)
  await page.getByLabel('雨夜',{exact:true}).check()
  await page.getByLabel('旧物记忆',{exact:true}).check()
  const note=page.getByLabel('还有什么想补充的？：自由回答')
  await note.fill('保留人物的犹豫与善意。')
  await note.dispatchEvent('compositionstart')
  await note.press('Control+Enter')
  assert.equal(seen.length,1,'Chinese composition cannot submit')
  await note.dispatchEvent('compositionend')
  if(answerDraft){
    await waitAnswerSaved()
    assert.equal((await readAnswerDraft()).answers.find(a=>a.id==='note').customText,'保留人物的犹豫与善意。')
    await page.evaluate(()=>{
      const put=IDBObjectStore.prototype.put
      window.__answerDraftOriginalPut=put
      IDBObjectStore.prototype.put=function(value,key){
        if(Array.isArray(key)&&key[1]==='questionDraft')throw new DOMException('合成保存失败','QuotaExceededError')
        return put.call(this,value,key)
      }
    })
    await note.fill('保存失败后继续写下的人物动机。')
    await page.getByTestId('author-answer-save-status').getByText('回答尚未保存',{exact:true}).waitFor()
    assert.equal(await note.inputValue(),'保存失败后继续写下的人物动机。')
    assert.equal((await readAnswerDraft()).answers.find(a=>a.id==='note').customText,'保留人物的犹豫与善意。')
    await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__answerDraftOriginalPut;delete window.__answerDraftOriginalPut})
    await page.getByRole('button',{name:'重试保存',exact:true}).click();await waitAnswerSaved()
    assert.equal((await readAnswerDraft()).answers.find(a=>a.id==='note').customText,'保存失败后继续写下的人物动机。')
    await note.fill('保留人物的犹豫与善意。');await waitAnswerSaved()
    assert.ok((await page.getByTestId('author-question-progress').innerText()).includes('已答 3 / 3 题'))
    assert.equal(seen.length,1,'Draft saves cannot answer or call the model')
    console.log('PASS answer draft storage, write failure and retry without submission')
  }
  await page.getByRole('button',{name:'暂不回答',exact:true}).click()
  await page.locator('.assistant-toggle').click()
  assert.equal(await note.inputValue(),'保留人物的犹豫与善意。')
  await mkdir(resolve(process.env.LANJIAN_ASSISTANT_EVIDENCE || '../.trellis/tasks/09-30-v3-workspace-archive-design/evidence/assistant-integration'),{recursive:true})
  for(const theme of ['qingzhou','moye','xuanzhi']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
    await page.getByTestId('author-question-card').locator('header').scrollIntoViewIfNeeded()
    await page.screenshot({path:join(evidence,'question-'+theme+'.png')})
    const geometry=await page.getByTestId('author-question-card').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,buttons:[...el.querySelectorAll('button')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))}))
    assert.ok(geometry.width>200&&geometry.scroll<=geometry.width+1)
    assert.ok(geometry.buttons.every(b=>b.w>20&&b.h>20))
  }
  const nativeWindow=await app.browserWindow(page)
  await nativeWindow.evaluate(win=>win.webContents.setZoomFactor(1.25))
  await page.getByTestId('author-question-card').locator('header').scrollIntoViewIfNeeded()
  const zoomFrame=await nativeWindow.evaluate(async win=>{const shot=await win.webContents.capturePage();return {bytes:shot.toPNG().toString('base64'),size:shot.getSize()}})
  assert.ok(zoomFrame.size.width>1000&&zoomFrame.size.height>600)
  await writeFile(join(evidence,'question-zoom-125.png'),Buffer.from(zoomFrame.bytes,'base64'))
  assert.ok(await page.getByTestId('author-question-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await nativeWindow.evaluate(win=>win.webContents.setZoomFactor(1))
  if(focusFlow){
    await submit.evaluate(button=>{button.focus();button.click();const field=document.querySelector('[placeholder="填写章节标题"]');field.focus();field.setSelectionRange(0,2)})
  }else await submit.click()
  await page.locator('.assistant-conversation').getByText('已根据作者的真实回答继续原来的故事目标。',{exact:true}).last().waitFor({timeout:60000}).catch(async error=>{console.error('UI:',await page.locator('.field-assistant-error').allTextContents());console.error('Runs:',await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent()));throw error})
  assert.deepEqual(answered.answers.map(a=>a.id),['tone','elements','note'])
  assert.deepEqual(answered.answers[0].chosenOptionIds,[])
  assert.deepEqual(answered.answers[1].chosenOptionIds,['rain','memory'])
  const firstRuns=await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent())
  assert.equal(firstRuns[0].status,'completed');assert.equal(firstRuns[0].step,2)
  if(answerDraft)assert.equal(await readAnswerDraft(),null,'Accepted answers clear only the local pending draft')
  assert.equal(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile().then(p=>p.coreIdea)),'原书设想A')
  if(focusFlow)assert.ok(await page.locator('[placeholder="填写章节标题"]').evaluate(el=>document.activeElement===el&&el.selectionStart===0&&el.selectionEnd===2),'Answer completion respects the author who has moved to the book field')
  else assert.equal(await page.getByTestId('field-assistant-instruction').evaluate(el=>el===document.activeElement),true,'Answer completion restores composer focus')
  if(answerTranscript){
    firstAnswerText='回答助笔的问题\n\n1. 你希望故事如何展开？\n回答：\n主角先帮助陌生人，再发现旧物的秘密。\n\n2. 保留哪些元素？\n选择：雨夜；旧物记忆\n\n3. 还有什么想补充的？\n回答：\n保留人物的犹豫与善意。'
    const records=await waitConfirmedAnswers(1),turn=page.locator('[data-answer-submission]')
    assert.equal(records[0].content,firstAnswerText);assert.equal(records[0].runId,firstRuns[0].id)
    assert.equal(await turn.getAttribute('data-speaker'),'user')
    assert.equal(await turn.locator('.assistant-message-body').innerText(),firstAnswerText)
    assert.equal(await turn.getByRole('button',{name:'编辑后再发',exact:true}).count(),0)
    assert.equal(await turn.getByRole('button',{name:/复制第/}).count(),1)
    assert.equal(await turn.locator('.assistant-message-body p').evaluate(el=>getComputedStyle(el).fontSize),'12.5px')
    await page.getByTestId('field-assistant-instruction').fill('接着讨论：')
    await turn.getByRole('button',{name:/引用第/}).click()
    assert.ok((await page.getByTestId('field-assistant-instruction').inputValue()).startsWith('接着讨论：'))
    assert.ok((await page.getByTestId('field-assistant-instruction').inputValue()).includes('> 选择：雨夜；旧物记忆'))
    await page.getByTestId('field-assistant-instruction').fill('')
    await turn.scrollIntoViewIfNeeded()
    assert.ok(await turn.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
    await shot('confirmed-answer-transcript')
    console.log('PASS confirmed answer text, persisted receipt, quote and compact user display')
  }
  console.log('PASS question UI, themes, zoom and original-call answer')
  await page.getByTestId('field-assistant-instruction').fill('FIELD')
  await sendMessage()
  await page.getByTestId('apply-field-candidate').waitFor({timeout:90000}).catch(async error=>{console.error('FIELD UI:',await page.locator('.field-assistant').innerText());console.error('FIELD runs:',await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent()));console.error('MODEL calls:',seen.map(b=>b.tools?b.messages.filter(m=>m.role==='tool').map(m=>m.content):'field'));throw error})
  assert.equal((await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent().then(r=>r.find(v=>v.goal==='FIELD')))).status,'waiting-adoption')
  assert.equal(await page.getByTestId('field-candidate-after').innerText(),longCandidate)
  if(recovery){await revealPending('查看修改候选');await shot('pending-candidate')}
  assert.ok(await page.locator('.assistant-diff-added').count()>0);assert.ok(await page.locator('.assistant-diff-removed').count()>0)
  await page.getByRole('button',{name:/下一处变化/}).click()
  assert.equal(await page.getByTestId('field-candidate-after').evaluate(el=>getComputedStyle(el).maxHeight),'none')
  await page.getByTestId('assistant-expand').click()
  await page.getByTestId('field-assistant-candidate').scrollIntoViewIfNeeded()
  const comparison=await page.locator('.field-candidate-comparison').evaluate(el=>[...el.children].map(child=>child.getBoundingClientRect().x))
  assert.ok(comparison[1]>comparison[0]+200)
  await page.getByTestId('field-assistant-candidate').locator('header').scrollIntoViewIfNeeded()
  await shot('wide-candidate')
  if(receiptRecovery)await app.evaluate(({ipcMain})=>{
    const channel='assistant:acknowledge-field'
    globalThis.__receiptHandler=ipcMain._invokeHandlers.get(channel)
    globalThis.__receiptCounts={applied:0,undone:0}
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel,async(...args)=>{
      const action=args[1].action,count=++globalThis.__receiptCounts[action]
      const failed={ok:false,error:{code:'STORAGE_ERROR',message:`合成测试：${action} 确认暂时中断（${count}）`,recoverable:true}}
      if(action==='undone'&&count===1)return failed
      const result=await globalThis.__receiptHandler(...args)
      if(action==='applied'&&count<=2){
        if(!result.ok)return result
        globalThis.__receiptApplied=result.value
        return failed
      }
      return result
    })
  })
  const beforeFieldConfirmation=seen.length
  await page.getByTestId('apply-field-candidate').click()
  if(receiptRecovery){
    const retry=page.getByTestId('retry-field-receipt')
    await page.getByText('合成测试：applied 确认暂时中断（1）',{exact:true}).waitFor()
    await page.waitForFunction(value=>document.querySelector('.profile-premise textarea')?.value===value,longCandidate)
    assert.equal(await page.getByTestId('apply-field-candidate').count(),0)
    assert.equal(await page.getByTestId('undo-field-candidate').isDisabled(),true)
    assert.ok(await page.locator('.field-assistant-composer').evaluate(el=>{
      const send=el.querySelector('[data-testid="send-field-assistant"]')
      return send?send.disabled:[...el.querySelectorAll('footer button')].some(button=>button.textContent==='停止'&&button.getClientRects().length)
    }),'An unconfirmed receipt offers no enabled send action, including when the retained run is still running')
    const pendingInput=page.getByTestId('field-assistant-instruction'),pendingDraft=await pendingInput.inputValue()
    await pendingInput.fill('待确认期间写下的下一条要求。');await pendingInput.press('Control+Enter');await page.waitForTimeout(150)
    assert.equal(await pendingInput.inputValue(),'待确认期间写下的下一条要求。');assert.equal(seen.length,beforeFieldConfirmation,'Keyboard send cannot execute while confirmation is pending')
    await pendingInput.fill(pendingDraft)
    const applied=await app.evaluate(()=>globalThis.__receiptApplied)
    assert.equal(applied.status,'applied')
    assert.match(await page.getByTestId('assistant-reveal-pending').innerText(),/查看待确认操作/);await page.getByTestId('assistant-reveal-pending').click()
    assert.equal(await retry.evaluate(el=>el===document.activeElement),true)
    await page.screenshot({path:join(evidence,'receipt-apply-pending.png')})
    await retry.click()
    await page.getByText('合成测试：applied 确认暂时中断（2）',{exact:true}).waitFor()
    assert.equal((await app.evaluate(()=>globalThis.__receiptApplied)).appliedAt,applied.appliedAt,'Repeated confirmation must retain the original receipt timestamp')
    assert.equal(await page.locator('.profile-premise textarea').inputValue(),longCandidate)
    assert.equal(seen.length,beforeFieldConfirmation,'Unconfirmed adoption cannot advance or regenerate')
    await retry.click();await retry.waitFor({state:'hidden'})
  }
  await page.getByText('字段候选已由作者处理，原任务接续完成。',{exact:true}).waitFor({timeout:60000})
  assert.equal(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile().then(p=>p.coreIdea)),'原书设想A')
  if(candidateScope){
    const target=page.locator('.profile-premise textarea'),undo=page.getByTestId('undo-field-candidate')
    await target.dispatchEvent('compositionstart')
    assert.equal(await undo.isDisabled(),true)
    await page.getByText('正在输入，结束输入后再撤销本次回填。',{exact:true}).waitFor()
    await target.dispatchEvent('compositionend')
    await page.waitForFunction(()=>!document.querySelector('[data-testid="undo-field-candidate"]').disabled)
  }
  await page.getByTestId('undo-field-candidate').click()
  if(receiptRecovery){
    const retry=page.getByTestId('retry-field-receipt')
    await page.getByText('合成测试：undone 确认暂时中断（1）',{exact:true}).waitFor()
    assert.equal(await page.locator('.profile-premise textarea').inputValue(),'原书设想A')
    const taskId=await app.evaluate(()=>globalThis.__receiptApplied.operationId)
    const before=await page.evaluate(id=>window.novelDesktop.fieldAssistant.task(id),taskId)
    assert.equal(before.candidate.status,'applied','Synthetic pre-commit failure must leave the old main receipt')
    const authorText='撤销后继续手写的情节，重试确认不能覆盖。'
    await page.locator('.profile-premise textarea').fill(authorText)
    assert.match(await page.getByTestId('assistant-reveal-pending').innerText(),/查看待确认操作/);await page.getByTestId('assistant-reveal-pending').click()
    await page.screenshot({path:join(evidence,'receipt-undo-pending.png')})
    await retry.click();await retry.waitFor({state:'hidden'})
    assert.equal(await page.locator('.profile-premise textarea').inputValue(),authorText)
    const after=await page.evaluate(id=>window.novelDesktop.fieldAssistant.task(id),taskId)
    assert.equal(after.candidate.status,'undone')
    assert.equal(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile().then(p=>p.coreIdea)),'原书设想A')
    assert.deepEqual(await app.evaluate(()=>globalThis.__receiptCounts),{applied:3,undone:2})
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('assistant:acknowledge-field');ipcMain.handle('assistant:acknowledge-field',globalThis.__receiptHandler);delete globalThis.__receiptHandler;delete globalThis.__receiptCounts;delete globalThis.__receiptApplied})
    await page.locator('.profile-premise textarea').fill('原书设想A')
    console.log('PASS lost apply receipt, repeated idempotent confirmation, failed undo receipt and preservation of later typing')
  }
  assert.equal(await page.locator('.profile-premise textarea').inputValue(),'原书设想A')
  console.log('PASS cross-page field adoption and undo')
  await page.getByTestId('field-assistant-instruction').fill('LONG')
  await sendMessage()
  await page.getByText('长文完整结束。',{exact:true}).waitFor({timeout:60000})
  assert.equal(await page.locator('.assistant-document h2').count(),32)
  assert.equal(await page.locator('.assistant-document table').count(),1)
  assert.equal(await page.locator('.assistant-document').last().locator('p').first().evaluate(el=>getComputedStyle(el).fontSize),'12.5px')
  if(reviewNavigation){
    const input=page.getByTestId('field-assistant-instruction'),review=page.getByTestId('assistant-send-review'),jump=page.getByTestId('assistant-reveal-review'),panel=page.getByTestId('assistant-sidebar'),scroll=page.getByTestId('copilot-chat-view-scroll')
    const draft='请核对背景🌱\n保持人物犹豫，暂不发送。',requests=seen.length,original=await input.inputValue()
    await page.waitForTimeout(300)
    const transcript=await readConversationValue('turns'),formal=await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile())
    const outer=()=>panel.evaluate(el=>{const positions=[];for(let node=el;node;node=node.parentElement)positions.push([node.tagName,node.scrollTop,node.scrollLeft]);return positions})
    await input.fill(draft);await input.evaluate(el=>el.setSelectionRange(2,7,'backward'))
    const budget=page.getByTestId('assistant-context-budget')
    if(!await budget.evaluate(el=>el.open))await budget.locator(':scope > summary').click()
    const beforeOuter=await outer()
    await page.getByRole('button',{name:'查看本次发送内容',exact:true}).click()
    await review.waitFor()
    await page.waitForTimeout(150)
    assert.ok(await review.evaluate(el=>document.activeElement===el),'Preparing a review must reveal and focus the actual review')
    assert.ok((await review.innerText()).includes(draft))
    assert.deepEqual(await outer(),beforeOuter,'Review reveal only scrolls the conversation pane')
    const returned=review.getByRole('button',{name:'返回输入 ↓',exact:true})
    await returned.click()
    assert.ok(await input.evaluate(el=>document.activeElement===el&&el.selectionStart===2&&el.selectionEnd===7&&el.selectionDirection==='backward'),"Return preserves the author's original input selection")
    if(await budget.evaluate(el=>el.open))await budget.locator(':scope > summary').click()
    await scroll.evaluate(el=>el.scrollTop=0)
    await jump.focus();await jump.press('Enter')
    assert.ok(await review.evaluate(el=>document.activeElement===el))
    await review.locator('details').filter({has:page.locator('summary').filter({hasText:'近期对话'})}).locator(':scope > summary').click()
    const metrics=[]
    for(const theme of ['qingzhou','moye','xuanzhi']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      for(const zoom of [1,1.25]){
        await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
        await scroll.evaluate(el=>{const review=el.querySelector('[data-testid="assistant-send-review"]');el.scrollTop+=review.getBoundingClientRect().top-el.getBoundingClientRect().top+800})
        await page.waitForTimeout(120)
        const detail=await review.evaluate(el=>{const pane=el.closest('[data-testid="copilot-chat-view-scroll"]').getBoundingClientRect(),header=el.querySelector('header').getBoundingClientRect(),button=el.querySelector('header button'),box=button.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return {headerHeight:header.height,visible:box.top>=pane.top&&box.bottom<pane.bottom,hit:hit===button||button.contains(hit),buttonWidth:box.width,buttonHeight:box.height,buttonFont:getComputedStyle(button).fontSize,buttonWhitespace:getComputedStyle(button).whiteSpace,width:el.clientWidth,scrollWidth:el.scrollWidth,font:getComputedStyle(el).fontSize}})
        assert.ok(detail.visible&&detail.hit,'Review return stays reachable while reading long context');assert.ok(detail.scrollWidth<=detail.width+1);assert.equal(detail.font,'13px');assert.equal(detail.buttonFont,'11px');assert.equal(detail.buttonWhitespace,'nowrap');assert.ok(detail.buttonWidth>65&&detail.buttonHeight<30,'Text action must not inherit the global square icon-button dimensions')
        metrics.push({theme,zoom,...detail});await shot('review-navigation-'+theme+'-'+zoom)
      }
    }
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    await page.evaluate(()=>document.documentElement.dataset.theme='qingzhou')
    const layout=await panel.getAttribute('data-layout')
    if(layout==='expanded')await page.getByTestId('assistant-expand').click()
    await panel.evaluate(el=>el.style.setProperty('width','280px','important'))
    await window.evaluate(win=>win.webContents.setZoomFactor(1.25))
    await jump.click();await page.waitForTimeout(150)
    assert.ok(await review.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.querySelector('header').getBoundingClientRect().height<90&&el.querySelector('header button').getBoundingClientRect().width>65&&el.querySelector('header button').getBoundingClientRect().height<30))
    await shot('review-navigation-narrow-1.25')
    await returned.click();assert.equal(await input.inputValue(),draft)
    await panel.evaluate(el=>el.style.removeProperty('width'))
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    if(layout==='expanded')await page.getByTestId('assistant-expand').click()
    await jump.evaluate(button=>{button.focus();button.click();const field=document.querySelector('.profile-premise textarea');field.focus();field.setSelectionRange(1,3)})
    await page.waitForTimeout(100)
    assert.ok(await page.locator('.profile-premise textarea').evaluate(el=>document.activeElement===el&&el.selectionStart===1&&el.selectionEnd===3),'Review jump respects a newer field focus')
    await jump.evaluate(button=>{button.focus();button.click();const tab=document.querySelector('[data-testid="assistant-mode-tasks"]');tab.focus();tab.click()})
    await page.waitForTimeout(100)
    assert.ok(await page.getByTestId('assistant-mode-tasks').evaluate(el=>document.activeElement===el))
    await page.getByTestId('assistant-mode-agent').click()
    const newer=draft+'\n补充一条需要核对的要求。'
    await input.fill(newer)
    if(!await budget.evaluate(el=>el.open))await budget.locator(':scope > summary').click()
    await page.getByRole('button',{name:'查看本次发送内容',exact:true}).evaluate(button=>{button.focus();button.click();const field=document.querySelector('.profile-premise textarea');field.focus();field.setSelectionRange(1,3)})
    await review.getByText(newer,{exact:true}).waitFor()
    await page.waitForTimeout(100)
    assert.ok(await page.locator('.profile-premise textarea').evaluate(el=>document.activeElement===el&&el.selectionStart===1&&el.selectionEnd===3),'A prepared preview arriving later cannot steal a newer author focus')
    if(await budget.evaluate(el=>el.open))await budget.locator(':scope > summary').click()
    assert.deepEqual(await readConversationValue('turns'),transcript);assert.deepEqual(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile()),formal);assert.equal(seen.length,requests)
    await input.fill(original)
    await writeFile(join(evidence,'review-navigation-metrics.json'),JSON.stringify(metrics,null,2))
    console.log('PASS review preparation/re-entry, sticky return, original selection, three themes/zoom/narrow, stale navigation and unchanged formal data/transcript/requests')
  }
  if(reviewFreshness){
    const input=page.getByTestId('field-assistant-instruction'),review=page.getByTestId('assistant-send-review'),send=page.getByTestId('send-field-assistant'),budget=page.getByTestId('assistant-context-budget')
    const draft=await input.inputValue(),requests=seen.length,transcript=await readConversationValue('turns')
    if(!await budget.evaluate(el=>el.open))await budget.locator(':scope > summary').click()
    await app.evaluate(({ipcMain})=>{
      const channel='assistant:preview-field';globalThis.__reviewOriginal=ipcMain._invokeHandlers.get(channel);globalThis.__reviewCalls=0
      ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>{
        globalThis.__reviewCalls++;const result=await globalThis.__reviewOriginal(...args)
        if(args[1].instruction==='核对顺序A')await new Promise(resolve=>{globalThis.__reviewRelease=resolve})
        return result
      })
    })
    try{
      await input.fill('核对顺序A');await page.getByRole('button',{name:'查看本次发送内容',exact:true}).click()
      const deadline=Date.now()+15000
      while(!await app.evaluate(()=>Boolean(globalThis.__reviewRelease))){assert.ok(Date.now()<deadline,'Preview IPC was not held');await page.waitForTimeout(50)}
      assert.equal(await send.isDisabled(),true);assert.equal(await send.innerText(),'准备核对…')
      const previewButton=page.getByRole('button',{name:'查看本次发送内容',exact:true}),calls=await app.evaluate(()=>globalThis.__reviewCalls)
      assert.ok(await previewButton.evaluate(el=>document.activeElement===el),'Preparing keeps the initiating control focused')
      await previewButton.evaluate(el=>el.click());await send.evaluate(el=>el.click());await page.waitForTimeout(100)
      assert.equal(await app.evaluate(()=>globalThis.__reviewCalls),calls);assert.equal(seen.length,requests,'Pending controls cannot duplicate preparation or send')
      await input.fill('核对顺序B');await page.getByRole('button',{name:'查看本次发送内容',exact:true}).click()
      await review.getByText('核对顺序B',{exact:true}).waitFor();assert.equal(await send.innerText(),'确认发送')
      const latest=await review.innerText();await app.evaluate(()=>globalThis.__reviewRelease());await page.waitForTimeout(150)
      assert.equal(await review.innerText(),latest,'Late preview A cannot overwrite B')
      await input.fill('这是更新后的完整要求🌱，先核对，不要发送。')
      assert.equal(await send.innerText(),'更新核对');await review.getByText('内容已变化，请更新核对',{exact:true}).waitFor()
      await shot('review-stale')
      await send.click();await review.getByText('这是更新后的完整要求🌱，先核对，不要发送。',{exact:true}).waitFor()
      await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-testid=assistant-send-review]'))
      assert.equal(await send.innerText(),'确认发送');assert.equal(seen.length,requests,'Updating a stale review cannot call the model')
      const field=page.locator('.profile-premise textarea'),before=await field.inputValue()
      await field.fill(before+'临时核对标记');assert.equal(await send.innerText(),'更新核对')
      await send.click();await review.getByText(before+'临时核对标记',{exact:true}).waitFor()
      assert.equal(await send.innerText(),'确认发送');await field.fill(before)
      assert.equal(await send.innerText(),'更新核对');assert.equal(seen.length,requests);assert.deepEqual(await readConversationValue('turns'),transcript)
      await shot('review-freshness')
    }finally{
      await app.evaluate(({ipcMain})=>{globalThis.__reviewRelease?.();ipcMain.removeHandler('assistant:preview-field');ipcMain.handle('assistant:preview-field',globalThis.__reviewOriginal);delete globalThis.__reviewOriginal;delete globalThis.__reviewRelease;delete globalThis.__reviewCalls})
    }
    if(await budget.evaluate(el=>el.open))await budget.locator(':scope > summary').click()
    await input.fill(draft)
    console.log('PASS real delayed preview order, preparing/stale/current UI, draft/field changes and update without model requests')
  }
  if(reading){
    const panel=page.getByTestId('assistant-sidebar'),input=page.getByTestId('assistant-find'),status=page.locator('#assistant-find-status')
    const initialLayout=await panel.getAttribute('data-layout')
    const painted=()=>page.evaluate(()=>({all:[...CSS.highlights.get('assistant-find')??[]].map(range=>range.toString()),active:[...CSS.highlights.get('assistant-find-active')??[]].map(range=>range.toString())}))
    const search=async(text,count)=>{
      await input.fill(text)
      await page.waitForFunction(count=>(CSS.highlights.get('assistant-find')?.size??0)===count&&document.querySelector('#assistant-find-status')?.textContent!=='查找中…',count)
      await page.waitForTimeout(130)
    }
    await page.getByRole('button',{name:'查找对话',exact:true}).click()
    assert.ok(await input.evaluate(el=>el===document.activeElement),'Opening search must focus its input')
    await input.fill('修复师');await page.waitForFunction(()=>(CSS.highlights.get('assistant-find')?.size??0)>3)
    const count=(await painted()).all.length
    await page.getByRole('button',{name:'上一处匹配',exact:true}).click()
    assert.equal(await status.innerText(),`${count} / ${count}`)
    await input.press('Enter');assert.equal(await status.innerText(),`1 / ${count}`)
    await input.press('Shift+Enter');assert.equal(await status.innerText(),`${count} / ${count}`)
    for(const keys of [{isComposing:true},{keyCode:229}]){
      assert.equal(await input.evaluate((el,keys)=>{const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...keys});el.dispatchEvent(event);return event.defaultPrevented},keys),false)
      assert.equal(await status.innerText(),`${count} / ${count}`,'IME confirmation cannot navigate')
    }
    await search('不存在的情节词',0);assert.equal(await status.innerText(),'没有匹配')
    assert.equal(await page.getByRole('button',{name:'下一处匹配',exact:true}).isDisabled(),true)
    await search('offset',1);await input.press('Enter');assert.deepEqual((await painted()).active,['OFFSET'])
    await search('[a.*]',1);await input.press('Enter');assert.deepEqual((await painted()).active,['[a.*]'])
    await search('跨格式匹配',1);await input.press('Enter');assert.deepEqual((await painted()).active,['跨格式匹配'])
    await search('分段边界甲分段边界乙',0);assert.equal(await status.innerText(),'没有匹配')
    await search('密',1000);await page.getByText('仅显示前 1000 处，请输入更具体的关键词。',{exact:true}).waitFor()
    assert.ok(await page.locator('.assistant-find-bar').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
    await search('跨格式匹配',1);await input.press('Enter')
    const headingLabels=await page.getByLabel('跳转回复标题').locator('option').allTextContents()
    assert.ok(headingLabels.some(text=>text.startsWith('回复 3 · 人物与事件')),'Directory numbers count AI replies only')
    await page.screenshot({path:join(evidence,'reading-find-inline.png')})
    const oldBody=await page.locator('.assistant-chat-message.assistant .assistant-message-body').last().innerText()
    assert.ok(oldBody.includes('İ😀标记之后 OFFSET'))
    if(await panel.getAttribute('data-layout')!=='expanded')await page.getByTestId('assistant-expand').click()
    await input.press('Escape');await input.waitFor({state:'hidden'})
    assert.equal(await panel.getAttribute('data-layout'),'expanded','Escape exits find before changing layout')
    assert.ok(await page.getByRole('button',{name:'查找对话',exact:true}).evaluate(el=>el===document.activeElement),'Toolbar-started find returns to the toolbar')
    assert.equal((await painted()).all.length,0,'Hidden search cannot leave stale highlights')
    await page.getByTestId('field-assistant-instruction').press('Escape')
    assert.equal(await panel.getAttribute('data-layout'),'sidebar')
    const sidebarResize=page.getByRole('separator',{name:'调整智能助笔侧栏宽度',exact:true})
    const previousWidth=Number(await sidebarResize.getAttribute('aria-valuenow'))
    await sidebarResize.press('Home');await window.evaluate(win=>win.webContents.setZoomFactor(1.25))
    await page.getByRole('button',{name:'查找对话',exact:true}).click();await search('密',1000)
    assert.equal(await status.innerText(),'前 1000 处')
    const geometry=await page.locator('.assistant-find-controls').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,input:el.querySelector('input').getBoundingClientRect().width,buttons:[...el.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}),rect:el.getBoundingClientRect().toJSON()}))
    assert.ok(geometry.scroll<=geometry.width+1&&geometry.input>=40)
    assert.ok(geometry.buttons.every(button=>button.left>=geometry.rect.left-1&&button.right<=geometry.rect.right+1&&button.bottom<=geometry.rect.bottom+1))
    await page.screenshot({path:join(evidence,'reading-find-narrow-125.png')})
    await page.getByRole('button',{name:'关闭对话查找',exact:true}).click()
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    // Return the isolated profile to at least its prior width through the same keyboard control.
    for(let i=0;i<40&&Number(await sidebarResize.getAttribute('aria-valuenow'))<previousWidth;i++)await sidebarResize.press('ArrowLeft')
    if(initialLayout==='expanded')await page.getByTestId('assistant-expand').click()
    await page.getByTestId('field-assistant-instruction').fill('查找时保留的追问')
    await page.getByTestId('field-assistant-instruction').press('Control+f')
    assert.ok(await input.evaluate(el=>el===document.activeElement))
    assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),'查找时保留的追问')
    await input.fill('修复师');await page.getByRole('button',{name:'下一处匹配',exact:true}).click()
    await input.press('Enter');activeFindBeforeReply=await status.innerText()
    assert.ok(activeFindBeforeReply.startsWith('2 / '))
    console.log('PASS literal ranges, Unicode offsets, first-previous wrap, IME, directory and find focus lifecycle')
  }
  const replyPanel=page.getByTestId('assistant-reply-comparison')
  const replySelect=side=>replyPanel.getByRole('combobox',{name:side===0?'第一份回复':'第二份回复',exact:true})
  const openReplies=async()=>{
    const button=page.getByTestId('assistant-open-comparison')
    await page.evaluate(()=>{
      window.__comparisonNavigationEvents=[]
      window.__comparisonNavigationListener=event=>window.__comparisonNavigationEvents.push({type:event.type,key:event.key,target:event.target?.outerHTML?.slice(0,350),active:document.activeElement?.outerHTML?.slice(0,350),focused:document.hasFocus()})
      for(const type of ['keydown','keyup','click','focusin'])document.addEventListener(type,window.__comparisonNavigationListener,true)
    })
    try{
    await button.focus();await button.press('Enter')
    await page.waitForFunction(()=>{
      const root=document.querySelector('[data-testid="assistant-reply-comparison"]'),pane=root?.closest('[data-testid="copilot-chat-view-scroll"]')
      return root?.open&&document.activeElement===root.querySelector(':scope > summary')&&root.getBoundingClientRect().top>=pane.getBoundingClientRect().top-1&&root.getBoundingClientRect().top<pane.getBoundingClientRect().bottom
    })
    }catch(error){
      await writeFile(join(evidence,'comparison-navigation-failure.json'),JSON.stringify(await page.evaluate(()=>{
        const root=document.querySelector('[data-testid="assistant-reply-comparison"]'),pane=root?.closest('[data-testid="copilot-chat-view-scroll"]')
        return {events:window.__comparisonNavigationEvents,focused:document.hasFocus(),active:document.activeElement?.outerHTML,open:root?.open,root:root?.getBoundingClientRect().toJSON(),pane:pane?.getBoundingClientRect().toJSON(),top:pane?.scrollTop,tab:document.querySelector('[data-testid="assistant-mode-agent"]')?.getAttribute('aria-pressed')}
      }),null,2));throw error
    }finally{
      await page.evaluate(()=>{for(const type of ['keydown','keyup','click','focusin'])document.removeEventListener(type,window.__comparisonNavigationListener,true);delete window.__comparisonNavigationListener;delete window.__comparisonNavigationEvents})
    }
  }
  if(replyComparison){
    const requests=seen.length,draft=await page.getByTestId('field-assistant-instruction').inputValue(),turns=await readConversationValue('turns')
    await openReplies()
    assert.deepEqual(await Promise.all([replySelect(0).inputValue(),replySelect(1).inputValue()]),['1','2'],'First opening chooses the latest two complete replies')
    await replySelect(0).selectOption('0');await replySelect(1).selectOption('2')
    assert.equal(await replySelect(0).locator('option[value="2"]').isDisabled(),true)
    assert.equal(await replySelect(1).locator('option[value="0"]').isDisabled(),true)
    const sources=replyPanel.locator('.assistant-reply-source')
    await sources.nth(0).locator('summary').click();await sources.nth(1).locator('summary').click()
    assert.deepEqual(await sources.locator('p').allTextContents(),['INTERACT','LONG'])
    assert.equal(await replyPanel.locator('.assistant-reply-columns > section').nth(1).locator('.assistant-document h2').count(),32)
    assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),draft)
    assert.deepEqual(await readConversationValue('turns'),turns)
    assert.equal(seen.length,requests)
  }
  const scroll=page.getByTestId('copilot-chat-view-scroll')
  const messageActionMetrics=[]
  const readMessageActions=async name=>{
    const message=page.locator('.assistant-chat-message.assistant').nth(2)
    await message.locator('.assistant-document h2').nth(18).evaluate(el=>{
      const pane=el.closest('[data-testid="copilot-chat-view-scroll"]'),header=el.closest('article').querySelector('.assistant-message-reading-header')
      pane.scrollTop+=el.getBoundingClientRect().top-pane.getBoundingClientRect().top-header.getBoundingClientRect().height-12
    })
    const geometry=await message.evaluate(el=>{
      const pane=el.closest('[data-testid="copilot-chat-view-scroll"]').getBoundingClientRect(),header=el.querySelector('.assistant-message-reading-header'),rect=header.getBoundingClientRect()
      return {top:rect.top-pane.top,height:rect.height,width:header.clientWidth,scroll:header.scrollWidth,articleTop:el.getBoundingClientRect().top-pane.top,font:getComputedStyle(el.querySelector('.assistant-document p')).fontSize,buttons:[...header.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect();return {font:getComputedStyle(button).fontSize,height:r.height,hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),inside:r.left>=rect.left&&r.right<=rect.right}})}
    })
    assert.ok(Math.abs(geometry.top)<2&&geometry.height<=55&&geometry.scroll<=geometry.width+1&&geometry.articleTop<-500,'Message actions stay compact and pinned well inside a long reply')
    assert.equal(geometry.font,'12.5px');assert.equal(geometry.buttons.length,2)
    assert.ok(geometry.buttons.every(b=>b.font==='11px'&&b.height>=24&&b.hit&&b.inside),'Both actions remain readable and hittable')
    messageActionMetrics.push({name,...geometry});await shot('message-actions-'+name)
  }
  await scroll.evaluate(el=>el.scrollTop=0)
  await page.getByTestId('assistant-latest').waitFor()
  const countBefore=seen.length
  if(recovery)await app.evaluate(({ipcMain})=>{
    const channel='assistant-runs:status'
    globalThis.__recoveryStatusHandler=ipcMain._invokeHandlers.get(channel)
    if(!globalThis.__recoveryStatusHandler)throw new Error('Status handler was not registered')
    globalThis.__recoveryReadFails=true
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel,(...args)=>globalThis.__recoveryReadFails
      ?{ok:false,error:{code:'STORAGE_ERROR',message:'合成测试：进度读取暂时失败',recoverable:true}}
      :globalThis.__recoveryStatusHandler(...args))
  })
  await page.getByTestId('field-assistant-instruction').fill('DELAY')
  await sendMessage()
  if(recovery){
    const refresh=page.getByTestId('assistant-refresh-status')
    await refresh.waitFor({timeout:10000})
    // Background run setup can outlast the first status poll. Establish the
    // original provider request before measuring whether a read duplicates it.
    for(let i=0;i<200&&!releaseDelayed;i++)await page.waitForTimeout(100)
    assert.ok(releaseDelayed,'The original delayed provider request must arrive')
    await page.getByTestId('field-assistant-instruction').fill('等待期间准备的下一条要求')
    await refresh.click()
    await page.waitForFunction(()=>!document.querySelector('[data-testid="assistant-refresh-status"]')?.disabled)
    assert.equal(seen.length,countBefore+1,'Failed status reads cannot resend the model request')
    await window.evaluate(win=>win.webContents.setZoomFactor(1.25))
    assert.ok(await refresh.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight}))
    await shot('status-read-failure-125')
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    await app.evaluate(()=>{globalThis.__recoveryReadFails=false})
    await refresh.click();await refresh.waitFor({state:'hidden'})
    assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),'等待期间准备的下一条要求')
    assert.equal(seen.length,countBefore+1,'Successful status recovery cannot resend the model request')
    await app.evaluate(({ipcMain})=>{
      ipcMain.removeHandler('assistant-runs:status');ipcMain.handle('assistant-runs:status',globalThis.__recoveryStatusHandler)
      delete globalThis.__recoveryStatusHandler;delete globalThis.__recoveryReadFails
    })
    console.log('PASS read failure, repeated read, retained draft and original running task')
  }
  await page.waitForTimeout(250)
  await scroll.evaluate(el=>el.scrollTop=250)
  await page.waitForTimeout(250)
  const before=await scroll.evaluate(el=>el.scrollTop)
  for(let i=0;i<100&&!releaseDelayed;i++)await page.waitForTimeout(100)
  assert.ok(releaseDelayed);releaseDelayed()
  await page.waitForFunction(()=>document.querySelector('.assistant-conversation')?.textContent.includes('新的结果已到达'))
  await page.waitForTimeout(400)
  assert.ok(Math.abs((await scroll.evaluate(el=>el.scrollTop))-before)<4,'Arriving output must not steal reading position')
  if(replyComparison){
    assert.deepEqual(await Promise.all([replySelect(0).inputValue(),replySelect(1).inputValue()]),['0','2'],'New output preserves the manually selected pair')
    assert.equal(await replySelect(0).locator('option').count(),4)
    await replyPanel.locator(':scope > summary').click()
    // Closing via the footer explicitly visits it; restore the earlier fixture
    // position before exercising the original "latest reply" navigation.
    await scroll.evaluate((el,top)=>el.scrollTop=top,before)
  }
  if(reading){assert.equal(await page.locator('#assistant-find-status').innerText(),activeFindBeforeReply,'A new reply must preserve the active match');assert.equal((await page.evaluate(()=>[...CSS.highlights.get('assistant-find-active')??[]].map(range=>range.toString())))[0],'修复师');await page.getByRole('button',{name:'关闭对话查找',exact:true}).click();const records=await readConversationValue('turns');assert.equal(records.find(turn=>turn.role==='assistant'&&turn.content.startsWith('# 人物与事件')).content,longAnswer)}
  await page.getByTestId('assistant-latest').click()
  await page.waitForFunction(()=>{const el=document.querySelector('[data-testid="copilot-chat-view-scroll"]');return el&&el.scrollHeight-el.scrollTop-el.clientHeight<4},undefined,{timeout:5000})
  for(const theme of ['qingzhou','moye','xuanzhi']){
    await page.evaluate(theme=>{localStorage.setItem('lanjian-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'lanjian-theme',newValue:theme}));document.documentElement.dataset.theme=theme},theme)
    for(const zoom of [1,1.25]){
      await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
      await page.waitForTimeout(400)
      await scroll.evaluate(el=>{const heading=el.querySelector('.assistant-document h1');if(heading)el.scrollTop+=heading.getBoundingClientRect().top-el.getBoundingClientRect().top-12})
      const b=await bounds();assert.ok(b.scroll<=b.client+1)
      assert.ok(await page.getByTestId('field-assistant-instruction').evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<innerHeight&&r.height>=60}))
      await shot('long-'+theme+'-'+zoom)
    }
  }
  await window.evaluate(win=>win.webContents.setZoomFactor(1))
  if(replyComparison){
    const panel=page.getByTestId('assistant-sidebar'),initialLayout=await panel.getAttribute('data-layout'),metrics=[]
    const requests=seen.length,turns=await readConversationValue('turns'),draft=await page.getByTestId('field-assistant-instruction').inputValue()
    const readingMetrics=[]
    const readComparison=async(narrow,name)=>{
      const second=replyPanel.locator('[data-comparison-side="1"]')
      await second.locator('.assistant-document h2').nth(18).evaluate(el=>{
        const pane=el.closest('[data-testid="copilot-chat-view-scroll"]'),header=el.closest('[data-comparison-side]').querySelector('.assistant-reply-reading-header')
        pane.scrollTop+=el.getBoundingClientRect().top-pane.getBoundingClientRect().top-header.getBoundingClientRect().height-8
      })
      await page.waitForTimeout(100)
      const geometry=await replyPanel.evaluate((el,narrow)=>{
        const pane=el.closest('[data-testid="copilot-chat-view-scroll"]').getBoundingClientRect()
        return [...el.querySelectorAll('.assistant-reply-reading-header')].filter((_,i)=>!narrow||i===1).map(header=>{
          const rect=header.getBoundingClientRect(),button=header.querySelector('button'),select=header.querySelector('select')
          const hits=[button,select].every(control=>{const r=control.getBoundingClientRect();return control.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})
          return {top:rect.top-pane.top,height:rect.height,width:rect.width,scroll:header.scrollWidth,hits}
        })
      },narrow)
      assert.ok(geometry.every(v=>Math.abs(v.top)<2&&v.height<=90&&v.scroll<=v.width+1&&v.hits),'Reading controls remain compact, pinned and hittable in the middle of the complete reply')
      readingMetrics.push({name,narrow,geometry});await shot('comparison-reading-'+name)
      const original=second.getByRole('button',{name:'定位第二份原回复',exact:true})
      await original.focus();await original.press('Enter')
      const message=page.locator('.assistant-chat-message.assistant').nth(2)
      assert.ok(await message.evaluate(el=>{const pane=el.closest('[data-testid="copilot-chat-view-scroll"]').getBoundingClientRect(),r=el.getBoundingClientRect();return document.activeElement===el&&r.top>=pane.top&&r.top<pane.top+16}),'Original reply navigation focuses the actual matching conversation message')
      assert.equal(await message.locator('.assistant-document h2').count(),32)
      if(messageActions)await readMessageActions(name)
      await openReplies()
      assert.deepEqual(await Promise.all([replySelect(0).inputValue(),replySelect(1).inputValue()]),['0','2'])
      // A new selection made midway through a long reply must show its own start.
      await second.locator('.assistant-document h2').nth(18).evaluate(el=>{const pane=el.closest('[data-testid="copilot-chat-view-scroll"]');pane.scrollTop+=el.getBoundingClientRect().top-pane.getBoundingClientRect().top-90})
      await replySelect(1).selectOption('1')
      await page.waitForFunction(()=>{
        const section=document.querySelector('[data-comparison-side="1"]'),select=section?.querySelector('select'),pane=section?.closest('[data-testid="copilot-chat-view-scroll"]')?.getBoundingClientRect(),body=section?.querySelector('.assistant-document')?.getBoundingClientRect()
        return select?.value==='1'&&document.activeElement===select&&body.top>=pane.top&&body.top<pane.bottom
      })
      assert.ok((await second.locator('.assistant-document').innerText()).includes('字段候选已由作者处理'))
      await replySelect(1).selectOption('2');await openReplies()
    }
    if(initialLayout!=='expanded')await page.getByTestId('assistant-expand').click()
    for(const theme of ['qingzhou','moye','xuanzhi']){
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
      for(const zoom of [1,1.25]){
        await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
        await openReplies();await page.waitForTimeout(150)
        assert.deepEqual(await Promise.all([replySelect(0).inputValue(),replySelect(1).inputValue()]),['0','2'])
        const geometry=await replyPanel.evaluate(el=>{const columns=[...el.querySelectorAll('.assistant-reply-columns > section')].map(v=>v.getBoundingClientRect().toJSON()),select=el.querySelector('select');return {width:el.clientWidth,scroll:el.scrollWidth,columns,font:getComputedStyle(el.querySelector('.assistant-document p')).fontSize,selectFont:getComputedStyle(select).fontSize,selectHeight:select.getBoundingClientRect().height}})
        assert.ok(geometry.scroll<=geometry.width+1)
        assert.equal(geometry.font,'12.5px')
        assert.equal(geometry.selectFont,'11px');assert.equal(geometry.selectHeight,26)
        assert.ok(geometry.columns[1].x>geometry.columns[0].x+200,'Wide replies should sit beside one another')
        assert.equal(await replyPanel.locator('.assistant-document h2').count(),32)
        assert.ok((await replyPanel.innerText()).includes('长文完整结束。'))
        metrics.push({theme,zoom,...geometry});await shot('reply-comparison-'+theme+'-'+zoom)
        if(comparisonReading)await readComparison(false,theme+'-'+zoom)
      }
    }
    await page.getByTestId('assistant-expand').click()
    await panel.evaluate(el=>{el.style.setProperty('width','280px','important');el.style.setProperty('min-width','280px','important')})
    for(const zoom of [1,1.25]){
      await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
      await openReplies()
      const geometry=await replyPanel.evaluate(el=>{const columns=[...el.querySelectorAll('.assistant-reply-columns > section')].map(v=>v.getBoundingClientRect().toJSON());return {width:el.clientWidth,scroll:el.scrollWidth,columns}})
      assert.ok(geometry.scroll<=geometry.width+1)
      assert.ok(geometry.columns[1].y>=geometry.columns[0].bottom,'Narrow replies stack without cropping')
      assert.ok(await page.locator('.assistant-reading-tools').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
      await shot('reply-comparison-narrow-'+zoom)
      if(comparisonReading)await readComparison(true,'narrow-'+zoom)
    }
    await panel.evaluate(el=>{el.style.removeProperty('width');el.style.removeProperty('min-width')})
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    if(initialLayout==='expanded')await page.getByTestId('assistant-expand').click()
    if(comparisonReading){
      await replySelect(1).evaluate(el=>{
        el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}))
        const tab=document.querySelector('[data-testid="assistant-mode-tasks"]');tab.focus();tab.click()
      })
      await page.waitForTimeout(100)
      assert.ok(await page.getByTestId('assistant-mode-tasks').evaluate(el=>document.activeElement===el),'A selection awaiting render cannot steal focus from the new tab')
      await page.getByTestId('assistant-mode-agent').click();await openReplies();await replySelect(1).selectOption('2');await openReplies()
      await writeFile(join(evidence,'comparison-reading-metrics.json'),JSON.stringify(readingMetrics,null,2))
      console.log('PASS sticky comparison controls/hit targets, original message identity and focus, selection-start navigation, narrow layout and stale tab focus guard')
    }
    await replyPanel.locator(':scope > summary').click()
    assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),draft)
    assert.deepEqual(await readConversationValue('turns'),turns)
    assert.equal(seen.length,requests,'Comparison is local reading, never a model request')
    await writeFile(join(evidence,'reply-comparison-metrics.json'),JSON.stringify(metrics,null,2))
    console.log('PASS comparison keyboard entry/focus, original requests, stable distinct pairs, full Markdown, three themes, narrow stacking and unchanged draft/transcript')
  }
  if(messageActions){
    const message=page.locator('.assistant-chat-message.assistant').nth(2),composer=page.getByTestId('field-assistant-instruction')
    const copy=message.getByRole('button',{name:/^复制第/}),quote=message.getByRole('button',{name:/^引用第/})
    const draft=await composer.inputValue(),turns=await readConversationValue('turns'),requests=seen.length
    const expectedQuote=(draft,text)=>draft+'\n\n> 智能助笔：\n'+text.split('\n').map(line=>'> '+line).join('\n')+'\n\n'
    await app.evaluate(async({clipboard,ClipboardItem})=>{globalThis.__messageClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))))})
    try{
      await readMessageActions('interaction')
      const selected=await message.locator('.assistant-document h2').nth(18).evaluate(el=>{
        const text=el.nextElementSibling.firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,18)
        const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString()
      })
      const before=await scroll.evaluate(el=>el.scrollTop)
      await copy.click();await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message-reading-header button')].some(el=>el.textContent==='已复制'))
      assert.equal((await app.evaluate(({clipboard})=>clipboard.readText())).replace(/\r\n/g,'\n'),longAnswer,'Pinned action copies the full original Markdown through the real desktop clipboard')
      assert.equal(await page.evaluate(()=>getSelection().toString()),selected,'Copy preserves the original excerpt selection')
      assert.ok(Math.abs((await scroll.evaluate(el=>el.scrollTop))-before)<2,'Copy does not scroll away from the reading position')
      await composer.fill('保留我的追问')
      // Selecting the composer clears the DOM selection; select the excerpt again before pointerdown.
      await message.locator('.assistant-document h2').nth(18).evaluate(el=>{const range=document.createRange();range.setStart(el.nextElementSibling.firstChild,0);range.setEnd(el.nextElementSibling.firstChild,18);getSelection().removeAllRanges();getSelection().addRange(range)})
      await quote.click()
      assert.equal(await composer.inputValue(),expectedQuote('保留我的追问',selected))
      assert.ok(await composer.evaluate(el=>el===document.activeElement))
      await composer.fill('引用整份')
      await page.evaluate(()=>getSelection().removeAllRanges())
      await quote.focus();await quote.press('Enter')
      assert.equal(await composer.inputValue(),expectedQuote('引用整份',longAnswer),'Keyboard quote retains the complete original Markdown')
      await composer.fill('稿'.repeat(9998));await quote.click()
      assert.equal(await composer.inputValue(),'稿'.repeat(9998))
      assert.ok((await page.getByTestId('assistant-composer-status').innerText()).includes('当前输入已保留'))
      await composer.fill(draft)
      await page.evaluate(()=>{
        window.__messageOriginalWrite=navigator.clipboard.writeText;window.__messageOriginalExec=document.execCommand
        navigator.clipboard.writeText=async()=>{throw new Error('synthetic clipboard failure')};document.execCommand=()=>false
      })
      await copy.click();await page.getByText('复制未完成，可以直接选择文字复制。',{exact:true}).waitFor()
      assert.equal(await copy.innerText(),'复制','A failed repeat copy cannot retain the previous success label')
      await page.evaluate(()=>{navigator.clipboard.writeText=window.__messageOriginalWrite;document.execCommand=window.__messageOriginalExec;delete window.__messageOriginalWrite;delete window.__messageOriginalExec})
      await copy.click();await page.getByText('复制未完成，可以直接选择文字复制。',{exact:true}).waitFor({state:'hidden'})
      assert.equal((await app.evaluate(({clipboard})=>clipboard.readText())).replace(/\r\n/g,'\n'),longAnswer)
      const directory=page.getByRole('combobox',{name:'跳转回复标题',exact:true})
      const value=await directory.locator('option').filter({hasText:'第 19 处推敲'}).getAttribute('value')
      await directory.selectOption(value)
      assert.ok(await message.locator('.assistant-document h2').nth(18).evaluate(el=>{const header=el.closest('article').querySelector('.assistant-message-reading-header').getBoundingClientRect(),r=el.getBoundingClientRect();return r.top>=header.bottom+10&&r.top<=header.bottom+14}),'Heading navigation leaves the actual pinned header clear')
      await page.getByRole('button',{name:'查找对话',exact:true}).click()
      await page.getByTestId('assistant-find').fill('第 19 处推敲');await page.getByRole('button',{name:'下一处匹配',exact:true}).click()
      assert.ok(await page.evaluate(()=>{const range=[...CSS.highlights.get('assistant-find-active')][0],header=range.startContainer.parentElement.closest('article').querySelector('.assistant-message-reading-header').getBoundingClientRect(),r=range.getBoundingClientRect();return r.top>=header.bottom+10&&r.top<=header.bottom+14}),'Search navigation leaves the actual pinned header clear')
      await page.getByRole('button',{name:'关闭对话查找',exact:true}).click()
      assert.equal(await composer.inputValue(),draft);assert.deepEqual(await readConversationValue('turns'),turns);assert.equal(seen.length,requests)
      await writeFile(join(evidence,'message-actions-metrics.json'),JSON.stringify(messageActionMetrics,null,2))
      console.log('PASS pinned message actions, real full-Markdown copy and retry, excerpt/whole quote, retained draft/capacity, heading/find clearance, themes/zoom and unchanged transcript/requests')
    }finally{
      await app.evaluate(async({clipboard})=>{const items=globalThis.__messageClipboard;if(items.length)await clipboard.write(items);else clipboard.clear();delete globalThis.__messageClipboard})
      await page.evaluate(()=>{if(window.__messageOriginalWrite)navigator.clipboard.writeText=window.__messageOriginalWrite;if(window.__messageOriginalExec)document.execCommand=window.__messageOriginalExec;delete window.__messageOriginalWrite;delete window.__messageOriginalExec;getSelection().removeAllRanges()})
      await composer.fill(draft)
    }
  }
  if(composeDraft){
    const input=page.getByTestId('field-assistant-instruction'),draft=await input.inputValue(),requests=seen.length
    const edit=page.locator('.assistant-chat-message.user').first().getByRole('button',{name:'编辑后再发',exact:true})
    await input.fill('后续追问');await edit.click();await page.getByTestId('assistant-compose-notice').waitFor()
    assert.equal(await input.inputValue(),'后续追问\n\nINTERACT')
    await edit.click();assert.equal(await input.inputValue(),'后续追问\n\nINTERACT')
    assert.equal(seen.length,requests);await input.fill(draft)
  }
  if(focusFlow){
    const input=page.getByTestId('field-assistant-instruction'),draft=await input.inputValue(),requests=seen.length,turns=await readConversationValue('turns')
    const quote=page.locator('.assistant-chat-message.assistant').first().getByRole('button',{name:/^引用第/})
    await quote.evaluate(button=>{button.focus();button.click();const field=document.querySelector('.profile-premise textarea');field.focus();field.setSelectionRange(1,3)})
    await page.waitForTimeout(100)
    assert.ok(await page.locator('.profile-premise textarea').evaluate(el=>document.activeElement===el&&el.selectionStart===1&&el.selectionEnd===3),'Quote keeps the author\'s newer field focus')
    assert.ok((await input.inputValue()).includes('> 智能助笔：'));await input.fill(draft)
    await quote.evaluate(button=>{
      button.focus();button.click()
      // Vue first writes the quoted draft to the textarea. Move the author's
      // caret after that DOM flush but before the queued nextTick focus resumes.
      queueMicrotask(()=>{
        const input=document.querySelector('[data-testid="field-assistant-instruction"]');input.focus();input.setSelectionRange(1,3)
        window.__quoteCaretRequested={start:input.selectionStart,end:input.selectionEnd,length:input.value.length}
      })
    })
    await page.waitForTimeout(100)
    const requestedCaret=await page.evaluate(()=>window.__quoteCaretRequested)
    assert.ok(requestedCaret.length>3&&requestedCaret.start===1&&requestedCaret.end===3,'The author selection must refer to the rendered quoted draft')
    assert.ok(await input.evaluate(el=>document.activeElement===el&&el.selectionStart===1&&el.selectionEnd===3),'A late quote focus cannot reset a caret the author has already moved')
    await page.evaluate(()=>delete window.__quoteCaretRequested)
    await input.fill(draft)
    await quote.evaluate(button=>{button.focus();button.click();const tab=document.querySelector('[data-testid="assistant-mode-tasks"]');tab.focus();tab.click()})
    await page.waitForTimeout(100)
    assert.ok(await page.getByTestId('assistant-mode-tasks').evaluate(el=>document.activeElement===el),'A pending quote cannot focus a hidden composer')
    await page.getByTestId('assistant-mode-agent').click();await input.fill(draft)
    assert.deepEqual(await readConversationValue('turns'),turns);assert.equal(seen.length,requests)
    await shot('focus-flow-reading');console.log('PASS quote respects newer field/caret/tab intent; original draft and persisted conversation preserved')
  }
  if(chatPosition){
    const input=page.getByTestId('field-assistant-instruction'),draft=await input.inputValue(),turns=await readConversationValue('turns'),requests=seen.length
    const panel=page.getByTestId('assistant-sidebar'),initialLayout=await panel.getAttribute('data-layout'),metrics=[]
    for(const [theme,zoom,layout] of [['qingzhou',1,'expanded'],['moye',1,'expanded'],['xuanzhi',1,'expanded'],['qingzhou',1.25,'sidebar'],['moye',1.25,'sidebar'],['xuanzhi',1.25,'sidebar']]){
      if(await panel.getAttribute('data-layout')!==layout)await page.getByTestId('assistant-expand').click()
      if(layout==='sidebar')await panel.evaluate(el=>{el.style.setProperty('width','280px','important');el.style.setProperty('min-width','280px','important')})
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
      await page.waitForTimeout(300)
      // Closing wide mode intentionally returns to the sidebar; exact offset
      // comparisons use unchanged layout so they cannot hide a reflow difference.
      for(const leave of layout==='expanded'?['tasks']:['tasks','close']){
        // Settle a different saved position first, then leave in the same event turn
        // as the final scroll sample (before the old 120ms debounce can fire).
        await scroll.evaluate(el=>{el.scrollTop=300;el.dispatchEvent(new Event('scroll'))})
        await page.waitForTimeout(200)
        const top=await scroll.evaluate((el,leave)=>{
          el.scrollTop=Math.round((el.scrollHeight-el.clientHeight)*0.43);el.dispatchEvent(new Event('scroll'))
          const top=el.scrollTop
          document.querySelector(leave==='tasks'?'[data-testid="assistant-mode-tasks"]':'[aria-label="关闭智能助笔侧栏"]').click()
          return top
        },leave)
        if(leave==='close'){
          await page.getByTestId('assistant-sidebar').waitFor({state:'hidden'});await page.locator('.assistant-toggle').click()
        }else await page.getByTestId('assistant-mode-agent').click()
        await page.waitForTimeout(300)
        const actual=await scroll.evaluate(el=>el.scrollTop),saved=await readConversationValue('position')
        metrics.push({theme,zoom,layout,leave,top,actual,saved})
        await writeFile(join(evidence,'chat-position-metrics.json'),JSON.stringify(metrics,null,2))
        assert.ok(Math.abs(actual-top)<2,`Immediate ${leave} must retain the last reading position: ${top} -> ${actual}`)
        assert.ok(Math.abs(saved.top-top)<2&&!saved.atBottom,'The persisted position must match the latest visible sample')
      }
      assert.ok(await scroll.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
      assert.equal(await page.locator('.assistant-chat-message.assistant .assistant-document p').first().evaluate(el=>getComputedStyle(el).fontSize),'12.5px')
      await shot(`chat-position-${theme}-${zoom}`)
    }
    await page.getByTestId('assistant-mode-tasks').click()
    const manualTop=await page.evaluate(async()=>{
      document.querySelector('[data-testid="assistant-mode-agent"]').click()
      await new Promise(resolve=>requestAnimationFrame(resolve))
      const pane=document.querySelector('[data-testid="copilot-chat-view-scroll"]')
      pane.dispatchEvent(new WheelEvent('wheel',{deltaY:120}));pane.scrollTop=1234;pane.dispatchEvent(new Event('scroll'))
      return pane.scrollTop
    })
    await page.waitForTimeout(300)
    assert.ok(Math.abs((await scroll.evaluate(el=>el.scrollTop))-manualTop)<2,'An author scroll during reopen takes priority over queued restoration')
    await panel.evaluate(el=>{el.style.removeProperty('width');el.style.removeProperty('min-width')})
    if(initialLayout==='expanded')await page.getByTestId('assistant-expand').click()
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    await page.evaluate(()=>document.documentElement.dataset.theme='qingzhou')
    await page.waitForTimeout(300)
    const bottomGeometry=()=>scroll.evaluate(el=>({top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight,gap:el.scrollHeight-el.scrollTop-el.clientHeight}))
    await page.getByTestId('assistant-latest').click()
    await page.waitForFunction(()=>{const el=document.querySelector('[data-testid="copilot-chat-view-scroll"]');return el&&el.scrollHeight-el.scrollTop-el.clientHeight<4},undefined,{timeout:5000})
    const bottomBefore={geometry:await bottomGeometry(),saved:await readConversationValue('position')}
    await page.getByTestId('assistant-mode-tasks').click();await page.getByTestId('assistant-mode-agent').click();await page.waitForTimeout(300)
    await writeFile(join(evidence,'chat-position-bottom.json'),JSON.stringify({before:bottomBefore,after:{geometry:await bottomGeometry(),saved:await readConversationValue('position')}},null,2))
    assert.ok(await scroll.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<48),'Returning from tasks retains bottom following')
    assert.equal(await input.inputValue(),draft);assert.deepEqual(await readConversationValue('turns'),turns);assert.equal(seen.length,requests)
    console.log('PASS immediate close/tab reading position, IndexedDB, theme/zoom, bottom following, unchanged draft/transcript/requests')
  }
  await page.getByTestId('assistant-expand').click()
  await page.getByTestId('assistant-mode-tasks').click()
  await page.getByLabel('搜索助笔任务').fill('LONG')
  const record=page.locator('.field-task-history button').filter({hasText:'LONG'})
  await record.waitFor();await record.click()
  await page.locator('.assistant-history-preview').getByText('长文完整结束。',{exact:true}).waitFor()
  await page.getByTestId('assistant-history-back').click();await record.click()
  await page.locator('.assistant-history-preview').getByText('长文完整结束。',{exact:true}).waitFor()
  assert.equal(seen.length,countBefore+1,'Reading history must not call the model')
  assert.equal(await page.getByTestId('field-assistant-candidate').count(),0,'Another task cannot keep a stale candidate')
  console.log('PASS Copilot scroll, full Markdown, wide comparison, themes/zoom and repeat history')
  if(taskHistory){
    const beforeReads=seen.length
    await page.getByRole('button',{name:'返回当前对话',exact:true}).click()
    const draft='读取任务记录时，保留我正在整理的追问。'
    await page.getByTestId('field-assistant-instruction').fill(draft)
    const transcript=await page.locator('.assistant-chat-message').allTextContents()
    await page.getByTestId('assistant-mode-tasks').click();await page.getByLabel('搜索助笔任务').fill('')
    const runList=page.getByTestId('assistant-run-history'),fieldList=page.getByTestId('assistant-field-history')
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid="assistant-run-history"],[data-testid="assistant-field-history"]')].every(el=>el.getAttribute('aria-busy')==='false'))
    const runCount=await runList.locator(':scope > button').count(),fieldCount=await fieldList.locator(':scope > button').count()
    assert.ok(runCount>0&&fieldCount>0)
    await app.evaluate(({ipcMain})=>{
      globalThis.__historyHandlers={};globalThis.__historyFailures={'assistant:recent-fields':true,'assistant-runs:recent':true,'assistant-runs:status':false}
      for(const channel of Object.keys(globalThis.__historyFailures)){
        const original=ipcMain._invokeHandlers.get(channel);globalThis.__historyHandlers[channel]=original
        ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>globalThis.__historyFailures[channel]?{ok:false,error:{code:'STORAGE_ERROR',message:'合成测试：任务读取失败',recoverable:true}}:original(...args))
      }
    })
    await runList.getByRole('button',{name:'刷新创作任务',exact:true}).click()
    await fieldList.getByRole('button',{name:'刷新修改记录',exact:true}).click()
    await runList.getByRole('alert').waitFor();await fieldList.getByRole('alert').waitFor()
    assert.equal(await runList.locator(':scope > button').count(),runCount)
    assert.equal(await fieldList.locator(':scope > button').count(),fieldCount)
    assert.ok((await runList.getByRole('alert').innerText()).includes('保留上次读取的记录'))
    await runList.getByRole('button',{name:'重试读取创作任务',exact:true}).click();await runList.getByRole('alert').waitFor()
    await runList.getByRole('button',{name:'重试读取创作任务',exact:true}).scrollIntoViewIfNeeded()
    await page.screenshot({path:join(evidence,'task-history-read-failure.png')})
    await window.evaluate(win=>win.webContents.setZoomFactor(1.25))
    await runList.getByRole('button',{name:'重试读取创作任务',exact:true}).scrollIntoViewIfNeeded()
    for(const list of [runList,fieldList])assert.ok(await list.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
    const retryGeometry=await runList.getByRole('button',{name:'重试读取创作任务',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}})
    assert.ok(retryGeometry.width>90&&retryGeometry.height<44&&retryGeometry.scrollWidth<=retryGeometry.clientWidth+1,'List action must be a readable text button, not an icon-size box')
    await shot('task-history-read-failure-125')
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    await app.evaluate(()=>globalThis.__historyFailures['assistant:recent-fields']=false)
    await fieldList.getByRole('button',{name:'重试读取修改记录',exact:true}).click();await fieldList.getByRole('alert').waitFor({state:'hidden'})
    assert.equal(await runList.getByRole('alert').count(),1,'Each list owns its own read failure')
    await app.evaluate(()=>{globalThis.__historyFailures['assistant-runs:recent']=false;globalThis.__historyFailures['assistant-runs:status']=true})
    await runList.getByRole('button',{name:'重试读取创作任务',exact:true}).click();await runList.getByRole('alert').waitFor({state:'hidden'})
    await page.getByLabel('搜索助笔任务').fill('LONG');await record.click()
    const preview=page.getByTestId('assistant-history-preview')
    await preview.getByRole('alert').waitFor()
    assert.ok((await preview.innerText()).includes('长文完整结束。'),'A failed detail refresh keeps the full stored answer')
    await preview.getByRole('button',{name:'重试读取这条任务',exact:true}).click();await preview.getByRole('alert').waitFor()
    await preview.getByRole('button',{name:'重试读取这条任务',exact:true}).scrollIntoViewIfNeeded()
    const returnGeometry=await preview.getByRole('button',{name:'返回当前对话',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height}})
    assert.ok(returnGeometry.width>70&&returnGeometry.height<44,'Preview return action must not wrap into a vertical icon button')
    await page.screenshot({path:join(evidence,'task-history-detail-failure.png')})
    await app.evaluate(()=>globalThis.__historyFailures['assistant-runs:status']=false)
    await preview.getByRole('button',{name:'重试读取这条任务',exact:true}).click();await preview.getByRole('alert').waitFor({state:'hidden'})
    assert.ok((await preview.innerText()).includes('长文完整结束。'))
    await app.evaluate(({ipcMain})=>{for(const [channel,handler] of Object.entries(globalThis.__historyHandlers)){ipcMain.removeHandler(channel);ipcMain.handle(channel,handler)}delete globalThis.__historyHandlers;delete globalThis.__historyFailures})
    assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),draft)
    assert.deepEqual(await page.locator('.assistant-chat-message').allTextContents(),transcript)
    assert.equal(seen.length,beforeReads,'Read recovery never generates, resumes, or resends a task')
    console.log('PASS independent history list errors, preserved records, repeated detail retry, unchanged draft/transcript and zero model requests')
  }
  if(taskUi){
    const beforeReads=seen.length,preview=page.getByTestId('assistant-history-preview'),index=page.getByTestId('assistant-history-index')
    const back=page.getByTestId('assistant-history-back'),search=page.getByLabel('搜索助笔任务'),panel=page.getByTestId('assistant-sidebar')
    await back.click()
    assert.equal(await search.inputValue(),'LONG')
    assert.equal(await record.evaluate(el=>el===document.activeElement),true,'Return restores the selected row keyboard focus')
    await search.fill('长文完整结束。')
    assert.equal(await page.locator('.assistant-history-row').count(),1,'Search includes the full recorded reply')
    await record.click()
    await page.getByTestId('assistant-history-heading').focus()
    await page.getByTestId('assistant-history-heading').dispatchEvent('keydown',{key:'Escape',isComposing:true})
    assert.equal(await preview.count(),1,'IME Escape cannot leave the record')
    await page.getByTestId('assistant-history-heading').press('Escape')
    assert.equal(await preview.count(),0)
    assert.equal(await search.inputValue(),'长文完整结束。')
    await search.fill('')
    const total=await page.locator('.assistant-history-row').count()
    assert.ok(total>1)
    await page.getByTestId('assistant-history-filter-pending').click()
    assert.equal(await page.locator('.assistant-history-row').count(),0)
    await page.getByRole('button',{name:'清除筛选，显示全部记录',exact:true}).click()
    assert.equal(await page.locator('.assistant-history-row').count(),total)
    await page.getByTestId('assistant-history-filter-ended').click()
    assert.equal(await page.locator('.assistant-history-row').count(),total)
    await page.getByTestId('assistant-history-filter-all').click()
    const rowHeights=await page.locator('.assistant-history-row').evaluateAll(rows=>rows.map(el=>el.getBoundingClientRect().height))
    assert.ok(rowHeights.every(height=>height<=82),'Directory rows preserve compact writing density')
    await shot('task-directory-sidebar')
    await index.evaluate(el=>{el.scrollTop=el.scrollHeight})
    await record.focus()
    const returnTop=await index.evaluate(el=>el.scrollTop)
    await record.press('Enter')
    await back.click()
    assert.ok(Math.abs((await index.evaluate(el=>el.scrollTop))-returnTop)<1,'Returning restores the directory position before it was hidden')
    assert.equal(await record.evaluate(el=>el===document.activeElement),true)
    await record.click()
    await page.getByTestId('assistant-expand').click()
    assert.equal(await panel.getAttribute('data-layout'),'expanded')
    for(const theme of ['qingzhou','moye','xuanzhi']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      for(const zoom of [1,1.25]){
        await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
        await page.waitForTimeout(100)
        assert.ok(await index.isVisible(),'Wide reading keeps the directory visible')
        const geometry=await page.getByTestId('assistant-task-browser').evaluate(el=>{const list=el.querySelector('.assistant-history-index'),detail=el.querySelector('.assistant-history-preview');return {list:list.getBoundingClientRect().right,detail:detail.getBoundingClientRect().left,width:el.clientWidth,scroll:el.scrollWidth}})
        assert.ok(geometry.list<=geometry.detail+1&&geometry.scroll<=geometry.width+1)
        await preview.evaluate(el=>el.scrollTop=0)
        await shot('task-reading-'+theme+'-'+zoom)
        const listTop=await index.evaluate(el=>el.scrollTop)
        await preview.evaluate(el=>el.scrollTop=el.scrollHeight)
        assert.equal(await index.evaluate(el=>el.scrollTop),listTop,'Full-text scrolling does not move the directory')
        assert.ok(await back.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>0&&r.bottom<innerHeight&&!!hit&&el.contains(hit)}),'Return remains reachable at the end of a long record')
        assert.ok(await preview.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
        assert.equal(await preview.locator('.assistant-document').evaluate(el=>getComputedStyle(el).fontSize),'12.5px')
      }
    }
    await shot('task-reading-end-sticky-125')
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    await page.getByTestId('assistant-expand').click()
    // The actual pane width, rather than the window, controls the single-column layout.
    await panel.evaluate(el=>el.style.setProperty('width','280px','important'))
    for(const zoom of [1,1.25]){
      await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
      await page.waitForTimeout(100)
      assert.equal(await index.isVisible(),false)
      assert.ok(await preview.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Narrow full text cannot overflow horizontally')
      await back.click()
      assert.ok(await index.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Narrow directory cannot overflow horizontally')
      await shot('task-directory-narrow-'+zoom)
      await record.click()
      await preview.getByRole('button',{name:'刷新这条任务',exact:true}).waitFor()
      await shot('task-reading-narrow-'+zoom)
    }
    await panel.evaluate(el=>el.style.removeProperty('width'))
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    assert.equal(seen.length,beforeReads,'All task UI navigation is read-only')
    console.log('PASS compact task directory, reply search, state filters, keyboard return, IME, wide independent reading, sticky actions and narrow themes/zoom')
  }
  if(taskReading){
    const compactMetrics=[]
    const preview=page.getByTestId('assistant-history-preview'),index=page.getByTestId('assistant-history-index'),panel=page.getByTestId('assistant-sidebar')
    const initialLayout=await panel.getAttribute('data-layout'),beforeReads=seen.length
    const draft=await page.getByTestId('field-assistant-instruction').inputValue(),transcript=await page.locator('.assistant-chat-message .assistant-message-body').allTextContents(),savedTurns=await readConversationValue('turns')
    if(initialLayout!=='expanded')await page.getByTestId('assistant-expand').click()
    const input=page.getByLabel('查找当前任务全文'),status=page.locator('#assistant-history-find-status')
    const waitDetail=()=>page.waitForFunction(()=>{const button=document.querySelector('.assistant-history-detail-header button[aria-label="刷新这条任务"]');return button&&!button.disabled})
    const search=async(query,count)=>{await input.fill(query);await page.waitForFunction(count=>(CSS.highlights.get('assistant-history-find')?.size??0)===count&&document.querySelector('#assistant-history-find-status')?.textContent!=='查找中…',count)}
    const activeText=()=>page.evaluate(()=>[...CSS.highlights.get('assistant-history-find-active')??[]].map(range=>range.toString()))
    const hit=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect(),point=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&point&&el.contains(point)})
    await waitDetail()
    const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    const paragraph=preview.locator('h2').filter({hasText:'第 20 处推敲'})
    const readingOffset=()=>paragraph.evaluate(el=>el.getBoundingClientRect().top-el.closest('.assistant-history-preview').querySelector('.assistant-history-detail-header').getBoundingClientRect().bottom)
    await page.getByLabel('跳转记录段落').selectOption('20');await paint()
    const originalOffset=await readingOffset()
    assert.ok(originalOffset>=10&&originalOffset<16)
    await page.getByTestId('assistant-field-history').locator('.assistant-history-row').first().click()
    assert.equal(await preview.evaluate(el=>el.scrollTop),0,'An unread record starts at its own beginning')
    await record.click();await waitDetail();await paint()
    assert.ok(Math.abs(await readingOffset()-originalOffset)<2,'Switching between records retains the long reply position')
    await page.getByTestId('assistant-history-back').click();await record.click();await waitDetail();await paint()
    assert.ok(Math.abs(await readingOffset()-originalOffset)<2,'Returning to the directory then reopening retains the position')
    assert.equal(await page.getByTestId('assistant-history-heading').evaluate(el=>el===document.activeElement),true)
    await page.getByTestId('assistant-mode-agent').click();await page.getByTestId('assistant-mode-tasks').click();await paint()
    assert.ok(Math.abs(await readingOffset()-originalOffset)<2,'A hidden conversation tab cannot reset task reading')
    await preview.getByRole('button',{name:'查找本条',exact:true}).click()
    await page.getByLabel('跳转记录段落').selectOption('20');await paint()
    await page.getByTestId('assistant-history-back').click();await record.click();await waitDetail();await paint()
    assert.equal(await input.count(),0)
    assert.ok(Math.abs(await readingOffset()-originalOffset)<2,'Restoration accounts for the closed find row height')
    await preview.getByRole('button',{name:'刷新这条任务',exact:true}).click();await waitDetail();await paint()
    assert.ok(Math.abs(await readingOffset()-originalOffset)<2,'An unchanged status refresh does not move the reader')
    await app.evaluate(({ipcMain})=>{
      const channel='assistant-runs:status';globalThis.__positionStatus=ipcMain._invokeHandlers.get(channel)
      ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>{
        const result=await globalThis.__positionStatus(...args)
        return result.ok&&result.value?.goal==='LONG'?{...result,value:{...result.value,result:{...result.value.result,message:result.value.result.message+'\n\n本条回复已更新'}}}:result
      })
    })
    try{
      await preview.getByRole('button',{name:'刷新这条任务',exact:true}).click();await waitDetail();await paint()
      assert.ok((await preview.textContent()).includes('本条回复已更新'))
      assert.equal(await preview.evaluate(el=>el.scrollTop),0,'Changed reply content does not inherit the old offset')
    }finally{
      await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('assistant-runs:status');ipcMain.handle('assistant-runs:status',globalThis.__positionStatus);delete globalThis.__positionStatus})
    }
    await preview.getByRole('button',{name:'刷新这条任务',exact:true}).click();await waitDetail();await paint()
    await preview.evaluate(el=>el.scrollTop=0)
    await page.getByTestId('assistant-history-heading').focus();await page.getByTestId('assistant-history-heading').press('Control+f')
    assert.equal(await page.getByTestId('assistant-mode-tasks').getAttribute('aria-pressed'),'true')
    assert.equal(await input.evaluate(el=>el===document.activeElement),true)
    await search('LONG',1)
    await input.fill('修复师');await page.waitForFunction(()=>(CSS.highlights.get('assistant-history-find')?.size??0)>3)
    const listTop=await index.evaluate(el=>el.scrollTop),beforeJump=await preview.evaluate(el=>el.scrollTop)
    await input.dispatchEvent('keydown',{key:'Enter',isComposing:true})
    assert.deepEqual(await activeText(),[])
    assert.equal(await preview.evaluate(el=>el.scrollTop),beforeJump)
    await input.press('Shift+Enter')
    assert.deepEqual(await activeText(),['修复师'])
    assert.ok((await status.innerText()).match(/^(\d+) \/ \1$/),'First previous selects the last match')
    assert.equal(await index.evaluate(el=>el.scrollTop),listTop)
    assert.ok(await preview.evaluate(el=>{const range=[...CSS.highlights.get('assistant-history-find-active')][0],r=range.getBoundingClientRect(),header=el.querySelector('.assistant-history-detail-header').getBoundingClientRect();return r.top>=header.bottom&&r.top<el.getBoundingClientRect().bottom}),'Search result remains below the sticky header')
    if(reading){
      await search('跨格式',1);await input.press('Enter');assert.deepEqual(await activeText(),['跨格式'])
      await search('分段边界甲分段边界乙',0)
      await search('OFFSET',1);await input.press('Enter');assert.deepEqual(await activeText(),['OFFSET'])
      await search('[a.*]',1)
      await search('密',1000);await preview.getByText('仅显示前 1000 处，请输入更具体的关键词。',{exact:true}).waitFor()
    }
    await search('',0)
    await page.getByLabel('跳转记录段落').selectOption('20')
    assert.ok(await preview.locator('h2').filter({hasText:'第 20 处推敲'}).evaluate(el=>{const r=el.getBoundingClientRect(),header=el.closest('.assistant-history-preview').querySelector('.assistant-history-detail-header').getBoundingClientRect();return r.top>=header.bottom&&r.top<header.bottom+35}))
    assert.equal(await index.evaluate(el=>el.scrollTop),listTop)
    await input.press('Escape')
    assert.equal(await input.count(),0);assert.equal(await preview.count(),1)
    assert.equal(await preview.getByRole('button',{name:'查找本条',exact:true}).evaluate(el=>el===document.activeElement),true)
    assert.equal(await page.evaluate(()=>CSS.highlights.has('assistant-history-find')),false)
    await preview.getByRole('button',{name:'查找本条',exact:true}).press('Escape')
    assert.equal(await preview.count(),0);assert.equal(await panel.getAttribute('data-layout'),'expanded')
    await page.getByLabel('搜索助笔任务').press('Control+f')
    assert.equal(await page.getByLabel('搜索助笔任务').evaluate(el=>el===document.activeElement),true)
    await page.getByLabel('搜索助笔任务').fill('')
    const copiedText=async()=> (await app.evaluate(({clipboard})=>clipboard.readText())).replace(/\r\n/g,'\n')
    await app.evaluate(async({clipboard,ClipboardItem})=>{globalThis.__historyClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))))})
    try{
      await page.getByTestId('assistant-field-history').locator('.assistant-history-row').first().click()
      await preview.getByRole('button',{name:'查找本条',exact:true}).click()
      await search('原书设想A',1)
      await preview.locator('.assistant-history-goal > p').evaluate(el=>{const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range)})
      await preview.getByRole('button',{name:'复制完整任务记录',exact:true}).click()
      await preview.getByText('已复制',{exact:true}).waitFor()
      assert.equal(await page.evaluate(()=>getSelection().toString()),'核心设想')
      assert.equal(await preview.getByRole('button',{name:'复制完整任务记录',exact:true}).evaluate(el=>el===document.activeElement),true)
      const rawFieldCopy=await app.evaluate(({clipboard})=>clipboard.readText())
      await writeFile(join(evidence,'clipboard-field.json'),JSON.stringify({text:rawFieldCopy},null,2))
      const fieldCopy=rawFieldCopy.replace(/\r\n/g,'\n')
      assert.ok(fieldCopy.includes('修改前\n原书设想A'))
      assert.ok(fieldCopy.includes('建议修改为\n'+longCandidate))
      await page.getByTestId('assistant-history-back').click();await record.click();await waitDetail()
      assert.equal(await input.count(),0,'A different record starts with closed, cleared find controls')
      const copy=preview.getByRole('button',{name:'复制完整任务记录',exact:true})
      await page.evaluate(()=>{window.__historyOriginalWrite=navigator.clipboard.writeText.bind(navigator.clipboard);window.__historyOriginalExec=document.execCommand.bind(document);document.execCommand=()=>false;navigator.clipboard.writeText=async()=>{throw new Error('synthetic clipboard failure')}})
      await copy.click();await preview.getByText('复制未完成，请重试，或直接选择下方文字复制。',{exact:true}).waitFor()
      await page.evaluate(()=>{navigator.clipboard.writeText=window.__historyOriginalWrite;document.execCommand=window.__historyOriginalExec})
      await copy.click();await preview.getByText('已复制',{exact:true}).waitFor()
      assert.equal(await copiedText(),'原要求或修改目标\nLONG\n\n'+longAnswer)
      await page.evaluate(()=>{navigator.clipboard.writeText=()=>new Promise((resolve,reject)=>{window.__historyCopyFail=()=>reject(new Error('delayed copy failure'))})})
      await copy.click();await page.waitForFunction(()=>typeof window.__historyCopyFail==='function')
      await page.locator('.assistant-history-row').filter({hasText:'DELAY'}).click();await waitDetail()
      await page.evaluate(()=>window.__historyCopyFail());await page.waitForTimeout(100)
      assert.equal(await copy.innerText(),'复制记录')
      assert.equal(await preview.locator('.assistant-history-copy-error').count(),0,'Late clipboard feedback cannot enter a new record')
      assert.equal(await copiedText(),'原要求或修改目标\nLONG\n\n'+longAnswer,'Late permission denial cannot overwrite the clipboard')
      await page.evaluate(()=>{navigator.clipboard.writeText=window.__historyOriginalWrite;delete window.__historyOriginalWrite;delete window.__historyOriginalExec;delete window.__historyCopyFail})
      await page.getByTestId('assistant-mode-agent').click()
      const chatReply=page.locator('.assistant-chat-message.assistant').filter({hasText:'长文完整结束。'}).first()
      await chatReply.locator('.assistant-message-actions > button').first().click()
      await chatReply.getByText('已复制',{exact:true}).waitFor()
      assert.equal(await copiedText(),longAnswer,'Conversation copy uses the real desktop clipboard too')
      await page.getByTestId('assistant-mode-tasks').click()

    }finally{
      await app.evaluate(async({clipboard})=>{const items=globalThis.__historyClipboard;if(items.length)await clipboard.write(items);else clipboard.clear();delete globalThis.__historyClipboard})
      await page.evaluate(()=>{if(window.__historyOriginalWrite)navigator.clipboard.writeText=window.__historyOriginalWrite;if(window.__historyOriginalExec)document.execCommand=window.__historyOriginalExec;delete window.__historyOriginalWrite;delete window.__historyOriginalExec;delete window.__historyCopyFail})
    }
    await record.click();await waitDetail();await preview.getByRole('button',{name:'查找本条',exact:true}).click()
    await search('修复师',33)
    await page.getByTestId('assistant-mode-agent').click()
    assert.equal(await page.evaluate(()=>CSS.highlights.has('assistant-history-find')),false)
    await page.getByTestId('field-assistant-instruction').press('Control+f')
    await page.getByTestId('assistant-find').fill('修复师');await page.waitForFunction(()=>(CSS.highlights.get('assistant-find')?.size??0)>3)
    assert.equal(await page.evaluate(()=>CSS.highlights.has('assistant-history-find')),false)
    await page.getByTestId('assistant-mode-tasks').click()
    await page.waitForFunction(()=>(CSS.highlights.get('assistant-history-find')?.size??0)===33)
    assert.equal(await page.evaluate(()=>CSS.highlights.has('assistant-find')),false,'Chat and history own separate highlight registrations')
    await input.press('Escape')
    await preview.getByRole('button',{name:'查找本条',exact:true}).press('Escape')
    await record.press('Escape')
    assert.equal(await panel.getAttribute('data-layout'),'sidebar','Hidden chat search cannot intercept Escape in task mode')
    assert.equal(await page.getByTestId('field-assistant-instruction').evaluate(el=>el===document.activeElement),false)
    await page.getByTestId('assistant-expand').click();await record.click();await waitDetail()
    await preview.getByRole('button',{name:'查找本条',exact:true}).click();await search('修复师',33)
    for(const theme of ['qingzhou','moye','xuanzhi']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      for(const zoom of [1,1.25]){
        await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
        await page.getByLabel('跳转记录段落').selectOption('20')
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
        assert.ok(await hit(input));assert.ok(await hit(preview.getByRole('button',{name:'复制完整任务记录',exact:true})))
        assert.ok(await preview.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
        await shot('task-reading-tools-'+theme+'-'+zoom)
      }
    }
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    await page.getByTestId('assistant-expand').click()
    await panel.evaluate(el=>el.style.setProperty('width','280px','important'))
    for(const zoom of [1,1.25]){
      await window.evaluate((win,zoom)=>win.webContents.setZoomFactor(zoom),zoom)
      await preview.getByRole('button',{name:'关闭记录查找',exact:true}).click();await paint()
      assert.ok(await preview.evaluate(el=>el.querySelector('.assistant-history-detail-header').getBoundingClientRect().height<=170),'Narrow normal tools preserve a compact reading header')
      const normalHeight=await preview.locator('.assistant-history-detail-header').evaluate(el=>el.getBoundingClientRect().height)
      await shot('task-compact-header-narrow-'+zoom)
      await preview.getByRole('button',{name:'查找本条',exact:true}).click()
      await page.getByLabel('跳转记录段落').selectOption('20')
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      assert.ok(await preview.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
      assert.ok(await hit(input));assert.ok(await hit(preview.getByRole('button',{name:'记录内下一处匹配',exact:true})))
      assert.ok(await preview.evaluate(el=>el.clientHeight-el.querySelector('.assistant-history-detail-header').getBoundingClientRect().height>180),'Narrow tools still leave usable reading space')
      assert.ok(await preview.evaluate(el=>el.querySelector('.assistant-history-detail-header').getBoundingClientRect().height<=235),'Narrow expanded find does not crowd out the record')
      compactMetrics.push({zoom,normalHeight,...await preview.evaluate(el=>({findHeight:el.querySelector('.assistant-history-detail-header').getBoundingClientRect().height,paneWidth:el.clientWidth,paneHeight:el.clientHeight,bodyFont:getComputedStyle(el.querySelector('.assistant-document')).fontSize}))})
      await shot('task-reading-tools-narrow-'+zoom)
    }
    await panel.evaluate(el=>el.style.removeProperty('width'))
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
    if(initialLayout==='expanded')await page.getByTestId('assistant-expand').click()
    await preview.getByRole('button',{name:'关闭记录查找',exact:true}).click()
    assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),draft)
    assert.deepEqual(await page.locator('.assistant-chat-message .assistant-message-body').allTextContents(),transcript)
    assert.deepEqual(await readConversationValue('turns'),savedTurns)
    assert.equal(seen.length,beforeReads)
    await writeFile(join(evidence,'compact-reading-metrics.json'),JSON.stringify(compactMetrics,null,2))
    console.log('PASS task-local find, independent reading positions, compact header, scope-owned highlights, heading offsets, full copy/retry/late failure, keyboard/IME and dense themed reading tools')
  }
  await page.getByRole('button',{name:'返回当前对话',exact:true}).click()
  await page.getByTestId('field-assistant-instruction').fill('RESTART')
  await sendMessage()
  await page.getByTestId('author-question-card').waitFor({timeout:60000})
  const restartAnswer='还未提交的长篇人物动机。\n'.repeat(80)
  if(answerDraft){
    await page.getByLabel('你希望故事如何展开？：自由回答').fill(restartAnswer)
    await page.getByLabel('雨夜',{exact:true}).check()
    await waitAnswerSaved()
    assert.equal(await page.getByTestId('submit-author-answer').isDisabled(),true,'The unanswered optional question still needs an explicit skip or answer')
    assert.ok((await page.getByTestId('author-question-progress').innerText()).includes('已答 2 / 3 题'))
    assert.equal((await readAnswerDraft()).answers[0].customText,restartAnswer)
  }
  if(recovery){
    await window.evaluate(win=>win.webContents.setZoomFactor(1.25))
    await revealPending('查看待答问题',true);await shot('pending-question-125')
    assert.equal(await page.getByTestId('submit-author-answer').isDisabled(),true)
    await window.evaluate(win=>win.webContents.setZoomFactor(1))
  }
  if(taskUi){
    const beforeReads=seen.length
    await page.getByTestId('assistant-mode-tasks').click()
    await page.getByLabel('搜索助笔任务').fill('')
    await page.getByTestId('assistant-history-filter-pending').click()
    const pending=page.locator('.assistant-history-row').filter({hasText:'RESTART'})
    await pending.waitFor();assert.equal(await page.locator('.assistant-history-row').count(),1)
    assert.ok((await pending.innerText()).includes('待回答'))
    await pending.click()
    await page.getByRole('button',{name:'回到这个待处理任务',exact:true}).waitFor()
    await shot('task-pending-question')
    await page.getByRole('button',{name:'返回当前对话',exact:true}).click()
    assert.equal(seen.length,beforeReads)
    if(answerDraft)assert.equal(await page.getByLabel('你希望故事如何展开？：自由回答').inputValue(),restartAnswer)
    console.log('PASS pending task filter keeps the original unanswered draft without executing')
  }
  const waiting=await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent().then(r=>r.find(v=>v.status==='waiting-input')))
  const beforeRestart=seen.length
  await app.close();app=await _electron.launch({args:[entry,'--disable-gpu'],env});page=await app.firstWindow()
  await openBook()
  await page.getByRole('button',{name:'恢复任务',exact:true}).waitFor({timeout:15000})
  assert.equal(seen.length,beforeRestart,'Restart must not invoke a model')
  if(answerTranscript){assert.equal((await confirmedAnswers()).length,1);assert.equal((await confirmedAnswers())[0].content,firstAnswerText);assert.equal(await page.locator('[data-answer-submission]').count(),1)}
  if(answerDraft){
    assert.equal(await page.getByLabel('你希望故事如何展开？：自由回答').inputValue(),restartAnswer)
    assert.equal(await page.getByLabel('雨夜',{exact:true}).isChecked(),true)
    assert.equal(await page.getByLabel('跳过这道问题').isChecked(),false)
    await page.getByText('已恢复上次填写的回答，请核对后提交。',{exact:true}).waitFor()
    await page.getByTestId('author-question-card').locator('header').scrollIntoViewIfNeeded()
    await page.screenshot({path:join(evidence,'restored-answer-draft.png')})
  }
  await page.getByRole('button',{name:'恢复任务',exact:true}).click()
  await page.getByTestId('submit-author-answer').waitFor()
  await page.getByLabel('雨夜的悬疑').check();await page.getByLabel('雨夜',{exact:true}).check()
  await page.getByLabel('跳过这道问题').check()
  await page.getByTestId('submit-author-answer').focus()
  await page.getByTestId('submit-author-answer').press('Enter')
  const completionDeadline=Date.now()+60000
  while((await page.evaluate(id=>window.novelDesktop.fieldAssistant.runs.status(id),waiting.id)).status!=='completed'){assert.ok(Date.now()<completionDeadline,'resumed run did not complete');await page.waitForTimeout(150)}
  await page.locator('.assistant-conversation').getByText('已根据作者的真实回答继续原来的故事目标。',{exact:true}).last().waitFor({timeout:60000}).catch(async error=>{console.error('UI:',await page.locator('.field-assistant-error').allTextContents());console.error('Runs:',await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent()));throw error})
  assert.equal((await page.evaluate(id=>window.novelDesktop.fieldAssistant.runs.status(id),waiting.id)).status,'completed')
  if(focusFlow)assert.ok(await page.getByTestId('field-assistant-instruction').evaluate(el=>document.activeElement===el),'An explicit answer still returns to the composer when the author has not moved elsewhere')
  if(answerTranscript){const records=await waitConfirmedAnswers(2);assert.ok(records[1].content.includes('选择：雨夜的悬疑'));assert.ok(records[1].content.endsWith('已主动跳过'));assert.ok(!records[1].content.includes('还未提交的长篇'));assert.equal(await page.locator('[data-answer-submission]').count(),2)}
  console.log('PASS explicit recovery after restart')
  await page.getByTestId('field-assistant-instruction').fill('SCOPE')
  await sendMessage()
  await page.getByTestId('author-question-card').waitFor({timeout:60000})
  if(answerDraft){
    assert.equal(await page.getByLabel('你希望故事如何展开？：自由回答').inputValue(),'','New questions cannot inherit previous answers')
    assert.equal(await page.getByLabel('雨夜',{exact:true}).isChecked(),false)
    await page.getByLabel('温暖的相遇').check()
    await page.getByLabel('雨夜',{exact:true}).check();await page.getByLabel('旧物记忆',{exact:true}).check()
    await page.getByLabel('还有什么想补充的？：自由回答').fill('切换作品后继续完善这份回答。')
    await waitAnswerSaved()
  }
  const scopeRun=await page.evaluate(()=>window.novelDesktop.fieldAssistant.runs.recent().then(r=>r.find(v=>v.goal==='SCOPE')))
  const beforeSwitch=seen.length
  await page.getByRole('button',{name:'返回我的作品',exact:true}).click()
  await page.evaluate(parentPath=>window.novelDesktop.projects.create({parentPath,name:'另一部B',genre:'悬疑'}),books)
  await openBook('另一部B')
  if(replyComparison){assert.equal(await page.getByTestId('assistant-open-comparison').count(),0);assert.equal(await page.getByTestId('assistant-reply-comparison').count(),0)}
  assert.equal(await page.getByTestId('author-question-card').count(),0)
  const wrongBook=await page.evaluate(async id=>{try{await window.novelDesktop.fieldAssistant.runs.status(id);return false}catch(error){return error.code==='NOT_FOUND'}},scopeRun.id)
  assert.equal(wrongBook,true)
  await page.getByRole('button',{name:'返回我的作品',exact:true}).click()
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({hasText:'原书A'}).first().click()
  await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
  if(await page.locator('.assistant-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.assistant-toggle').click()
  await page.getByTestId('author-question-card').waitFor({timeout:60000})
  assert.equal(seen.length,beforeSwitch)
  if(replyComparison)assert.equal(await page.getByTestId('assistant-reply-comparison').evaluate(el=>el.open),false,'Returning to a book cannot reopen a comparison from another scope')
  if(answerDraft){
    assert.equal(await page.getByLabel('温暖的相遇').isChecked(),true)
    assert.equal(await page.getByLabel('雨夜',{exact:true}).isChecked(),true);assert.equal(await page.getByLabel('旧物记忆',{exact:true}).isChecked(),true)
    assert.equal(await page.getByLabel('还有什么想补充的？：自由回答').inputValue(),'切换作品后继续完善这份回答。')
    assert.equal((await readAnswerDraft()).runId,scopeRun.id)
  }
  await page.getByTestId('author-question-card').getByRole('button',{name:'停止任务',exact:true}).click()
  await page.getByTestId('author-question-card').waitFor({state:'hidden'})
  const late=await page.evaluate(async run=>{try{await window.novelDesktop.fieldAssistant.runs.answer({runId:run.id,questionId:run.question.id,questionVersion:run.question.version,answerSubmissionId:'late',answers:[]});return false}catch(error){return error.code==='CONFLICT'}},scopeRun)
  assert.equal(late,true);assert.equal((await page.evaluate(id=>window.novelDesktop.fieldAssistant.runs.status(id),scopeRun.id)).status,'cancelled')
  if(answerDraft)assert.equal(await readAnswerDraft(),null,'Confirmed cancellation clears the stopped draft')
  if(answerTranscript){assert.equal((await confirmedAnswers()).length,2);assert.ok(!(await confirmedAnswers()).some(turn=>turn.runId===scopeRun.id))}
  if(candidateScope){
    // Keep this after restart/question checks: a hand-edited adopted field deliberately
    // cannot use the one-step undo that earlier scenarios exercise.
    await page.getByTestId('field-assistant-instruction').fill('FIELD_EDIT')
    await sendMessage()
    await page.getByTestId('apply-field-candidate').waitFor({timeout:90000})
    await page.getByTestId('apply-field-candidate').click()
    await page.waitForFunction(async()=> (await window.novelDesktop.fieldAssistant.runs.recent()).some(run=>run.goal==='FIELD_EDIT'&&run.status==='completed'),undefined,{timeout:60000})
    await page.waitForFunction(expected=>document.querySelector('.profile-premise textarea')?.value===expected,longCandidate,{timeout:5000}).catch(async error=>{
      const state=await page.evaluate(async()=>({runs:await window.novelDesktop.fieldAssistant.runs.recent(),tasks:await window.novelDesktop.fieldAssistant.recent((await window.novelDesktop.fieldAssistant.runs.recent())[0].workItemId),errors:[...document.querySelectorAll('.field-assistant-error')].map(el=>el.textContent),candidate:document.querySelector('[data-testid="field-assistant-candidate"]')?.textContent,actual:document.querySelector('.profile-premise textarea')?.value}))
      await writeFile(join(evidence,'candidate-edit-state.json'),JSON.stringify({state,requests:seen},null,2));throw error
    })
    assert.equal(await page.locator('.profile-premise textarea').inputValue(),longCandidate)
    await page.locator('.profile-premise textarea').fill('作者在采用后继续写下的情节，必须完整保留。')
    assert.equal(await page.getByTestId('undo-field-candidate').isDisabled(),true)
    await page.getByText('当前输入或目标已变化，本次回填不能再直接撤销；当前内容会保留。',{exact:true}).waitFor()
    await page.getByTestId('undo-field-candidate').scrollIntoViewIfNeeded()
    await page.screenshot({path:join(evidence,'candidate-undo-unavailable.png')})
    assert.equal(await page.evaluate(()=>window.novelDesktop.workspace.getBookProfile().then(p=>p.coreIdea)),'原书设想A')
    await page.getByTestId('field-assistant-instruction').fill('FIELD_SCOPE')
    await sendMessage()
    await page.getByTestId('apply-field-candidate').waitFor({timeout:90000})
    // Delay only an already-authorized permit in this disposable main process.
    // Switching books must stop the renderer before the field-write/receipt steps.
    await app.evaluate(({ipcMain})=>{
      const prepare='assistant:prepare-field',ack='assistant:acknowledge-field'
      globalThis.__candidatePrepare=ipcMain._invokeHandlers.get(prepare)
      globalThis.__candidateAck=ipcMain._invokeHandlers.get(ack)
      globalThis.__candidateAcks=0
      ipcMain.removeHandler(prepare);ipcMain.removeHandler(ack)
      ipcMain.handle(prepare,async(...args)=>{
        const result=await globalThis.__candidatePrepare(...args)
        globalThis.__candidatePermitOk=result.ok&&Boolean(result.value?.token)
        return new Promise(resolve=>{globalThis.__candidateRelease=()=>resolve(result)})
      })
      ipcMain.handle(ack,(...args)=>{globalThis.__candidateAcks++;return globalThis.__candidateAck(...args)})
    })
    try{
      await page.getByTestId('apply-field-candidate').click()
      const deadline=Date.now()+15000
      while(!await app.evaluate(()=>Boolean(globalThis.__candidateRelease))){assert.ok(Date.now()<deadline,'Permit was not captured');await page.waitForTimeout(50)}
      assert.equal(await app.evaluate(()=>globalThis.__candidatePermitOk),true,'Delayed permit must be authorized, not an error envelope')
      const beforeCandidateSwitch=seen.length
      await page.getByRole('button',{name:'返回我的作品',exact:true}).click()
      await page.locator('[data-library-view="all"]').click()
      await page.locator('.work-item-open').filter({hasText:'另一部B'}).first().click()
      await page.getByTestId('workspace-loading').waitFor({state:'hidden',timeout:60000})
      if(await page.locator('.assistant-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.assistant-toggle').click()
      await page.getByTestId('field-assistant-instruction').fill('另一部作品正在准备的新要求')
      await app.evaluate(()=>globalThis.__candidateRelease())
      await page.waitForTimeout(200)
      assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),'另一部作品正在准备的新要求')
      assert.equal(await page.getByTestId('send-field-assistant').isDisabled(),false)
      assert.equal(await page.getByTestId('field-assistant-candidate').count(),0)
      assert.deepEqual(await page.locator('.field-assistant-error').allTextContents(),[])
      assert.equal(await app.evaluate(()=>globalThis.__candidateAcks),0)
      assert.equal(seen.length,beforeCandidateSwitch)
      await page.screenshot({path:join(evidence,'candidate-book-switch.png')})
    }finally{
      await app.evaluate(({ipcMain})=>{
        globalThis.__candidateRelease?.()
        ipcMain.removeHandler('assistant:prepare-field');ipcMain.handle('assistant:prepare-field',globalThis.__candidatePrepare)
        ipcMain.removeHandler('assistant:acknowledge-field');ipcMain.handle('assistant:acknowledge-field',globalThis.__candidateAck)
        for(const key of ['__candidatePrepare','__candidateAck','__candidateAcks','__candidateRelease','__candidatePermitOk'])delete globalThis[key]
      })
    }
    console.log('PASS undo availability, manual input protection, and delayed permit across real book switch')
  }
  assert.deepEqual(errors,[]);assert.deepEqual(rendererErrors,[])
  await writeFile(join(evidence,'result.json'),JSON.stringify({ok:true,recovery,answerDraft,answerTranscript,reading,candidateScope,receiptRecovery,taskHistory,taskUi,taskReading,replyComparison,comparisonReading,messageActions,composeDraft,chatPosition,focusFlow,reviewNavigation,reviewFreshness,protocol:gemini?'gemini-native':'openai-compatible',nativeRequests:nativeRequests.length,signedReplies:nativeReplies.size,modelRequests:seen.length,rendererErrors},null,2))
  console.log(JSON.stringify({ok:true,checks:['real three-mode question UI and IPC','recommendation is not an answer','IME blocks submission','defer/reopen retains input','three themed layouts and 125% zoom','answer resumes original call','real field adoption and undo keep formal data unchanged','restart does not execute','explicit restart recovery keeps run ID','A to B to A retains pending question','explicit cancellation rejects late answer'],modelRequests:seen.length},null,2))


  if(acceptance){
    // A separate disposable profile and loopback provider remain live only for author review.
    // This mode is opt-in and reached only after the complete selected checks passed.
    await page.getByTestId('assistant-mode-agent').click()
    await page.evaluate(()=>document.documentElement.dataset.theme='qingzhou')
    const previewWindow=await app.browserWindow(page)
    await previewWindow.evaluate(win=>{win.webContents.setZoomFactor(1);win.setTitle('岚笺 · 智能助笔验收（临时作品／模拟接口）')})
    await page.getByTestId('field-assistant-instruction').fill('这是验收草稿：保留人物的犹豫与善意，先讨论几种写法。')
    const budget=page.getByTestId('assistant-context-budget')
    if(!await budget.evaluate(el=>el.open))await budget.locator(':scope > summary').click()
    await page.getByRole('button',{name:'查看本次发送内容',exact:true}).click()
    await page.getByTestId('assistant-send-review').waitFor()
    await page.waitForFunction(()=>document.querySelector('[data-testid="send-field-assistant"]')?.textContent==='确认发送')
    if(await budget.evaluate(el=>el.open))await budget.locator(':scope > summary').click()
    await page.getByTestId('assistant-reveal-review').click()
    await previewWindow.evaluate(win=>{win.show();win.focus()})
    const capture=await previewWindow.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(join(evidence,'acceptance-ready.png'),Buffer.from(capture,'base64'))
    const ready={status:'ready',pid:app.process().pid,entry,temporaryRoot:root,userData,books,protocol:gemini?'gemini-native':'openai-compatible',syntheticOnly:true}
    await writeFile(join(evidence,'acceptance-ready.json'),JSON.stringify(ready,null,2));console.log(JSON.stringify({acceptanceReady:true,pid:ready.pid,evidence}))
    await app.waitForEvent('close',{timeout:0});app=undefined
    await writeFile(join(evidence,'acceptance-ready.json'),JSON.stringify({...ready,status:'closed'},null,2))
  }

} catch(error) {
  await writeFile(join(evidence,'failure.txt'),error.stack||String(error));
  if(app)await app.firstWindow().then(async page=>{const win=await app.browserWindow(page);const png=await win.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(evidence,'failure.png'),Buffer.from(png,'base64'))}).catch(()=>{});
  throw error
} finally {
  if (app) {
    // A preload failure cannot acknowledge the application's graceful close IPC.
    // Only this isolated fixture may fall back to exiting its owned process.
    const hasApi = await app.firstWindow().then(page => page.evaluate(() => Boolean(window.novelDesktop))).catch(() => false)
    if (!hasApi) await app.evaluate(({ app }) => { app.exit(1) }).catch(() => {})
    else await app.close()
  }
  await new Promise(resolve => server.close(resolve))
  // Verify the exact owned temporary directory before recursive disposal.
  const target = await realpath(root)
  assert.equal(dirname(target), temporaryParent)
  assert.ok(basename(target).startsWith('lanjian-author-interaction-smoke-'))
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
