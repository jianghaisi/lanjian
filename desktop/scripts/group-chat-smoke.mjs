import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { _electron } from 'playwright'

// Actual production main/preload/UI, isolated data and a loopback provider only.
const temporaryParent = await realpath(tmpdir())
const root = await realpath(await mkdtemp(join(temporaryParent, 'lanjian-group-smoke-')))
const books = join(root, 'books'), output = resolve('../.trellis/tasks/10-11-v3-group-chat-assistant-ui/research/native')
await mkdir(books); await mkdir(output, { recursive: true })
const calls = [], errors = []
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET') { response.setHeader('content-type','application/json'); response.end(JSON.stringify({data:[{id:'chief-model'},{id:'world-model'}]})); return }
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw); calls.push(body)
    const result = body.messages.filter(m => m.role === 'tool')
    const declared = body.messages.flatMap(m => m.tool_calls ?? []).map(c => c.id)
    assert.ok(result.every(m => declared.includes(m.tool_call_id)))
    const tool = (name, args) => ({id:`call-${calls.length}-${name}`,type:'function',function:{name:body.tools.find(t => t.function.name.includes(`_${name}_`))?.function.name ?? name,arguments:JSON.stringify(args)}})
    const latestUser=body.messages.findLastIndex(m=>m.role==='user'), goal=String(body.messages[latestUser]?.content??'').split('当前目标：').at(-1)
    if(goal.startsWith('[长文]')||goal.startsWith('[流式停止]')){
      response.setHeader('content-type','text/event-stream');response.flushHeaders()
      const stopping=goal.startsWith('[流式停止]'), paragraph=stopping?'正在流式生成，停止后不能写入会话。':'林舟沿着旧城的雨巷寻找证人。他听见钟楼响起，停下脚步核对信上的落款；名字与母亲留下的字迹不同。他决定先找修复铺的主人，问清这封信究竟从何而来。\n\n'
      for(let i=0;i<24;i++){if(response.destroyed)return;response.write(`data: ${JSON.stringify({choices:[{delta:{content:paragraph},finish_reason:null}]})}\n\n`);await new Promise(done=>setTimeout(done,stopping?300:20))}
      response.end(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);return
    }
    let message
    if(goal.startsWith('[问题]'))message=body.messages.slice(latestUser+1).some(m=>m.role==='tool')?{role:'assistant',content:'已收到你的回答，主角会先寻找证人。'}:{role:'assistant',content:'先核对主角的选择。',tool_calls:[tool('ask_author',{questions:[{id:'direction',prompt:'主角先去哪里？',mode:'single',required:true,options:[{id:'witness',label:'寻找证人',recommended:true},{id:'shop',label:'返回修复铺'}]}]})]}
    else if (body.model === 'chief-model') message = result.length ? {role:'assistant',content:'故事方向已整理，接下来请世界观设定师补齐规则。'} : {role:'assistant',content:'这个故事可以从旧物修复师的选择开始。',tool_calls:[tool('save_preparation_candidate',{kind:'definition',title:'雨夜旧物的故事',content:'修复师能听见旧物的记忆，却必须在修复与遗忘之间作出选择。'}),tool('delegate_to_member',{memberId:'world',instruction:'整理世界观并请求作者创建作品。'})]}
    else message = result.length ? {role:'assistant',content:'世界规则已经作为候选保存。'} : {role:'assistant',content:'记忆修复需要付出代价，每次修复都会忘记自己的一段往事。',tool_calls:[tool('save_preparation_candidate',{kind:'world',title:'记忆与代价',content:'都市中旧物保留主人的记忆。修复者每次改变旧物，都必须舍弃自己的一段往事。'}),...(body.tools.some(t=>t.function.name.includes('_request_book_creation_'))?[tool('request_book_creation',{title:'雨夜修复师',summary:'关于记忆、选择与代价的都市奇幻。'})]:[])]}
    response.setHeader('content-type','application/json'); response.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:32,completion_tokens:16}}))
  } catch (error) { errors.push(error.message); response.statusCode=500; response.end('{}') }
})
await new Promise(done => server.listen(0,'127.0.0.1',done))
const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH=join(root,'profile');env.LANJIAN_GLOBAL_MODEL_DATA_PATH=join(root,'models')
let app
try {
  app=await _electron.launch({args:[resolve('out/main/index.js'),'--disable-gpu'],env})
  const page=await app.firstWindow(), owner=await app.browserWindow(page)
  page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message))
  await owner.evaluate(win=>{win.setContentSize(1440,900);win.show();win.focus()})
  await page.waitForFunction(()=>Boolean(window.novelDesktop?.groupChat))
  const connectionId=await page.evaluate(async baseUrl=>{
    const api=window.novelDesktop, catalog=await api.modelConnections.list()
    const added=await api.modelConnections.create({expectedRevision:catalog.revision,name:'群聊隔离测试',baseUrl,protocol:'openai-compatible',apiKey:'synthetic-group-key'})
    const connection=added.connections.find(c=>c.name==='群聊隔离测试')
    localStorage.setItem('lanjian-companion-voice-v1',JSON.stringify({voice:'ningguang',mute:true,textModel:false,preload:false}))
    localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'impact',bootStyle:'brief',bootPalette:'system'}))
    await window.companionSettings?.update({voice:{mute:true,textModel:false,preload:false}})
    return connection.id
  },`http://127.0.0.1:${server.address().port}/v1`)
  await page.reload()
  await page.waitForFunction(()=>{
    const visible=id=>{const el=document.querySelector(`[data-testid="${id}"]`);return Boolean(el&&el.getClientRects().length)}
    return visible('app-boot-enter')||visible('app-boot-skip-models')||(!visible('app-boot')&&visible('group-chat-tab'))
  },undefined,{timeout:60000})
  if(await page.getByTestId('app-boot-skip-models').isVisible())await page.getByTestId('app-boot-skip-models').click()
  else if(await page.getByTestId('app-boot-enter').isVisible())await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({state:'hidden',timeout:60000})
  assert.equal(await page.getByTestId('book-tabs').getByTestId('group-chat-tab').count(),0,'group is not a top book tab')
  const input=page.locator('.group-composer textarea')
  async function capture(name){await writeFile(join(output,`${name}.png`),Buffer.from(await owner.evaluate(async win=>(await win.webContents.capturePage()).toPNG().toString('base64')),'base64'))}
  await capture('01-welcome')
  assert.ok(!await input.isVisible(),'no-book library has no detached group')
  await app.evaluate(({dialog},books)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[books]})},books)
  await page.getByRole('button',{name:/新建空白作品/}).click()
  await page.getByPlaceholder('例如：灯火照长安').fill('雨夜修复师')
  await page.getByTestId('create-book-genre').fill('都市奇幻')
  await page.locator('.create-book-modal').getByRole('button',{name:/选择/}).click()
  await page.getByRole('button',{name:'创建空白作品',exact:true}).click()
  await input.waitFor();await capture('01-book-welcome');assert.equal(await page.locator('[data-nav-parent=group]').getAttribute('aria-current'),'step');assert.equal(await page.locator('[data-book-tab][aria-current=page]').count(),1);await page.waitForFunction(()=>!document.querySelector('.group-composer textarea')?.disabled)
  await page.waitForTimeout(1000) // Let the initial reading-position/draft checkpoint settle before external API setup.
  const sessionId=await page.evaluate(async connectionId=>{
    const api=window.novelDesktop;let s=(await api.groupChat.list()).find(s=>s.book?.title==='雨夜修复师')
    for(const memberId of ['editor','world']) { s=await api.groupChat.get({sessionId:s.id,limit:100}); try { s=await api.groupChat.saveMember({sessionId:s.id,expectedRevision:s.revision,memberId,profile:{connectionId,model:memberId==='editor'?'chief-model':'world-model',temperature:.7,topP:.95,maxTokens:4096}}) } catch(e) { throw new Error(JSON.stringify(e)) } }
    return s.id
  },connectionId)
  assert.equal(await page.evaluate(async()=> (await window.novelDesktop.workspace.getBookProfile()).genre),'都市奇幻')
  await input.fill('我想写一本关于雨夜旧物和记忆代价的都市奇幻，请整理这本书的设定与故事方向。')
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
  await input.press('Control+Enter');assert.equal(calls.length,0,'IME cannot send')
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})))
  await input.press('Control+Enter')
  await page.waitForFunction(async id=>(await window.novelDesktop.groupChat.get({sessionId:id,limit:100})).status==='idle'&&(await window.novelDesktop.groupChat.get({sessionId:id,limit:100})).candidates.some(c=>c.kind==='world'),sessionId)
  await page.locator('.group-result-card').filter({hasText:'记忆与代价'}).waitFor();await capture('02-preparation')
  assert.deepEqual([...new Set(calls.map(c=>c.model))],['chief-model','world-model'])
  await page.getByRole('button',{name:'世界观设定师成员设置'}).click()
  await page.getByRole('dialog').waitFor();await capture('03-member-settings')
  await page.getByRole('button',{name:'关闭成员设置'}).click()
  await page.getByRole('button',{name:'进入作品',exact:false}).waitFor()
  await page.locator('.group-result-card').filter({hasText:'记忆与代价'}).locator('summary').click()
  await page.locator('.group-result-card').filter({hasText:'记忆与代价'}).getByRole('button',{name:'核对并采用'}).click()
  try { await page.getByRole('dialog',{name:'核对筹备采用'}).waitFor() } catch(error) { console.error('Preview diagnostics:',await page.locator('.group-error').allTextContents()); throw error };await capture('04-adoption-preview')
  await page.getByRole('button',{name:'确认采用到世界设定 · 世界观'}).click()
  try { await page.getByRole('dialog',{name:'核对筹备采用'}).waitFor({state:'hidden'}) } catch(error) { console.error('Adoption diagnostics:',await page.getByRole('dialog',{name:'核对筹备采用'}).innerText()); throw error }
  assert.equal(await page.evaluate(async()=> (await window.novelDesktop.workspace.getFoundation()).worldView),'都市中旧物保留主人的记忆。修复者每次改变旧物，都必须舍弃自己的一段往事。')
  await input.fill('切换标签后仍然保留的草稿');await page.waitForTimeout(800)
  await page.locator('[data-nav-parent=definition]').click();await page.locator('.studio[data-page=profile]').waitFor();await page.getByTestId('group-chat-tab').click()
  assert.equal(await input.inputValue(),'切换标签后仍然保留的草稿')
  for(const [width,name] of [[1440,'05-bound'],[1280,'06-medium'],[1100,'07-compact']]){await owner.evaluate((win,width)=>win.setContentSize(width,900),width);await page.waitForTimeout(300);await page.mouse.move(700,250);await page.waitForTimeout(150);await capture(name);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('.activitybar').evaluate(el=>el.clientHeight>400),'primary navigation must retain a real row height');assert.ok(await page.locator('[data-nav-parent=definition]').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+20,r.top+r.height/2))}),'definition must have a visible clickable icon');assert.ok(await page.locator('.group-send').evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)>=8),'group controls keep their own rounded styles')}
  for(const theme of ['qingzhou','xuanzhi','moye']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme==='moye'?'dark':'light'},theme);await page.waitForTimeout(200);await capture(`08-theme-${theme}`)}
  await owner.evaluate(win=>{win.setContentSize(1100,900);win.webContents.setZoomFactor(1.25)});await page.waitForTimeout(300);await capture('09-zoom-125');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.group-message').first().evaluate(el=>getComputedStyle(el).animationName),'none')
  await owner.evaluate(win=>{win.setContentSize(1440,900);win.webContents.setZoomFactor(1)})
  async function sendGoal(goal){await input.fill(goal);await input.press('Control+Enter')}
  await sendGoal('[长文] 按已保存资料讨论故事的因果。')
  await page.waitForFunction(async id=>{const s=await window.novelDesktop.groupChat.get({sessionId:id,limit:100});return s.status==='idle'&&s.messages.some(m=>m.role==='agent'&&m.content.startsWith('林舟沿着旧城')&&m.content.length>1500)},sessionId)
  await page.waitForFunction(()=>[...document.querySelectorAll('.group-message.agent')].at(-1)?.textContent.length>1500);await page.waitForTimeout(200);await capture('10-long-reply')
  assert.ok(await page.locator('.group-message.agent').last().innerText().then(text=>text.length>1500));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const scroll=page.getByTestId('group-chat-workspace').getByTestId('copilot-chat-view-scroll')
  await scroll.hover();await page.mouse.wheel(0,-1800);await page.waitForTimeout(250)
  const readingTop=await scroll.evaluate(el=>el.scrollTop)
  assert.ok(await scroll.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight>100),'wheel leaves the newest message')
  await page.getByRole('button',{name:'进入作品',exact:false}).click();await page.getByTestId('group-chat-tab').click();await page.waitForTimeout(250)
  assert.ok(await scroll.evaluate((el,top)=>Math.abs(el.scrollTop-top)<12,readingTop),'reading position survives tab switching')
  await sendGoal('[流式停止] 继续讨论，等作者停止。')
  await page.locator('.group-message.agent').filter({hasText:'正在流式生成，停止后不能写入会话。'}).waitFor()
  await page.locator('.group-stop').click()
  await page.waitForFunction(async id=>(await window.novelDesktop.groupChat.get({sessionId:id,limit:100})).status==='cancelled',sessionId)
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(async id=>(await window.novelDesktop.groupChat.get({sessionId:id,limit:100})).messages.some(m=>m.content.includes('正在流式生成，停止后不能写入会话。')),sessionId),false)
  await sendGoal('[问题] 先问作者主角下一步的选择。')
  await page.getByRole('radio',{name:/寻找证人/}).check();await capture('11-author-question')
  await page.getByTestId('submit-author-answer').click()
  await page.locator('.group-message.agent').filter({hasText:'已收到你的回答'}).waitFor()
  await page.getByRole('button',{name:'进入作品',exact:false}).click()
  await page.locator('[data-activity="desk"]').waitFor();await page.getByTestId('workspace-loading').waitFor({state:'hidden'})
  if(!await page.getByTestId('assistant-sidebar').isVisible())await page.getByRole('button',{name:'打开智能助笔侧栏',exact:true}).click()
  const assistant=page.getByTestId('assistant-sidebar');await assistant.waitFor();await page.getByTestId('field-assistant-instruction').fill('保留在原智能助笔中的草稿')
  await page.waitForTimeout(200);await capture('12-original-assistant')
  assert.ok(await page.getByTestId('field-assistant-instruction').evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)>=10),'archive styles cannot square the chat input')
  assert.ok(await page.locator('.global-assistant-host .field-assistant-intro').evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)>=12),'actual assistant welcome card is rounded')
  await page.evaluate(()=>{document.documentElement.dataset.theme='qingzhou';document.documentElement.style.colorScheme='light'});await page.waitForTimeout(200);await capture('13-original-assistant-light')
  for(const id of ['checks','tasks','agent']){await page.getByTestId(`assistant-mode-${id}`).click();assert.equal(await page.getByTestId(`assistant-mode-${id}`).getAttribute('aria-pressed'),'true')}
  assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),'保留在原智能助笔中的草稿')
  await page.getByTestId('group-chat-tab').click();await input.waitFor();await assistant.waitFor({state:'hidden'})
  assert.equal(await page.locator('.studio').getAttribute('data-assistant-open'),'false','hidden assistant is not presented as open in group mode')
  assert.ok(await page.locator('.activitybar').evaluate(el=>el.clientHeight>400),'primary rail stays full height with retained original assistant')
  await page.locator('[data-nav-parent=definition]').click();await assistant.waitFor();assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),'保留在原智能助笔中的草稿','original assistant input survives a group round trip')
  assert.deepEqual(errors,[])
  await writeFile(join(output,'checks.json'),JSON.stringify({checks:['native production IPC','two actual member models','structured delegation','IME','name and genre book-first creation','author world adoption','book-owned primary group navigation and retained draft','1440/1280/1100 no overflow','three themes','125% zoom','reduced motion','long Chinese streamed reply','retained reading position','stop hides late partial','actual author question/answer','original assistant modes/draft/rounded controls'],providerCalls:calls.length},null,2))
  console.log('PASS native actual book → bound group preparation → reviewed adoption; two independent models')
} finally {await app?.close();await new Promise(done=>server.close(done));if(dirname(root)!==temporaryParent || !root.startsWith(join(temporaryParent,'lanjian-group-smoke-')) || await realpath(root)!==root)throw new Error('Invalid cleanup root');await rm(root,{recursive:true,force:true})}
