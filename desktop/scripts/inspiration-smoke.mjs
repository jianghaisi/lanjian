import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp,mkdir,realpath,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve,dirname } from 'node:path'
import { _electron } from 'playwright'
const parent=await realpath(tmpdir()),root=await realpath(await mkdtemp(join(parent,'lanjian-inspiration-smoke-')))
const books=join(root,'books'),output=resolve('../.trellis/tasks/10-11-v3-inspiration-library-video/research/native')
await mkdir(books);await mkdir(output,{recursive:true})
const errors=[],calls=[],mainLog=[],viewports=[]
const server=createServer(async(req,res)=>{try{
  res.setHeader('content-type','application/json')
  if(req.method==='GET'){res.end(JSON.stringify({data:[{id:'inspiration-fixture'}]}));return}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push(body)
  const instruction=String(body.messages.findLast(m=>m.role==='user')?.content??'');let message
  if(instruction.includes('只返回JSON')){
    const input=JSON.parse(instruction.split('\n').at(-1)),evidence=Array.isArray(input)?input.flatMap(c=>c.evidence).slice(0,2):[{segmentId:input.segmentId,quote:input.text.slice(0,30)}]
    message={role:'assistant',content:JSON.stringify({cards:[{title:'记忆的代价',narrative:'修复师为救人舍弃记忆，获救者仍认得他。他需要通过留下的旧信重新查明自己的选择。',tags:['救援','代价'],characters:['修复师'],conflict:'救人需要舍弃记忆',choice:'救人',outcome:'忘记获救者',turn:'获救者认得他',foreshadowing:'旧信',evidence}]})}
  }else{
    const last=body.messages.findLastIndex(m=>m.role==='user'),results=body.messages.slice(last+1).filter(m=>m.role==='tool'),value=results.length?JSON.parse(results.at(-1).content).value:undefined
    const tool=(name,args)=>({id:`call-${calls.length}`,type:'function',function:{name:body.tools.find(t=>t.function.name.includes(`_${name}_`)).function.name,arguments:JSON.stringify(args)}})
    message=results.length===0?{role:'assistant',content:'先从私有灵感库检索救援冲突。',tool_calls:[tool('search_inspiration_library',{query:'救援'})]}:results.length===1?{role:'assistant',content:'阅读具体情节和出处。',tool_calls:[tool('read_inspiration_card',{cardId:value.cards[0].id})]}:results.length===2?{role:'assistant',content:'重新设计本书的代价与选择。',tool_calls:[tool('save_inspiration_adaptation',{cardId:value.id,revision:value.revision,title:'本书的失忆救援',content:'修复师为了保护证人烧掉旧信，放弃追查自己的身世；证人决定主动替他寻找真相。',changes:'把被动失忆变为主动舍弃线索，交换人物行动与结果。'})]}:{role:'assistant',content:'附出处的改编候选已保存，等待作者核对。'}
  }
  res.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:50,completion_tokens:100}}))
}catch(error){errors.push(error.message);res.statusCode=500;res.end('{}')}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('LANJIAN_')&&!['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL'].includes(k)))
env.LANJIAN_USER_DATA_PATH=join(root,'profile');env.LANJIAN_GLOBAL_MODEL_DATA_PATH=join(root,'models')
let app
try{
  app=await _electron.launch({args:[resolve('out/main/index.js'),'--disable-gpu'],env});app.process().stderr?.on('data',chunk=>mainLog.push(chunk.toString()));app.process().on('exit',(code,signal)=>mainLog.push(`exit ${code} ${signal}`));const page=await app.firstWindow(),owner=await app.browserWindow(page)
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await owner.evaluate(w=>{w.setContentSize(1440,960);w.show();w.focus()})
  await page.waitForFunction(()=>Boolean(window.novelDesktop?.inspiration));const connectionId=await page.evaluate(async baseUrl=>{
    const api=window.novelDesktop,c=await api.modelConnections.list(),next=await api.modelConnections.create({expectedRevision:c.revision,name:'灵感隔离测试',baseUrl,protocol:'openai-compatible',apiKey:'synthetic-key'})
    localStorage.setItem('lanjian-loading-v1',JSON.stringify({theme:'impact',bootStyle:'brief',bootPalette:'system'}));await window.companionSettings?.update({voice:{mute:true,textModel:false,preload:false}});return next.connections.find(c=>c.name==='灵感隔离测试').id
  },`http://127.0.0.1:${server.address().port}/v1`)
  await page.reload();await page.waitForFunction(()=>['app-boot-enter','app-boot-skip-models'].some(id=>document.querySelector(`[data-testid="${id}"]`)?.getClientRects().length),undefined,{timeout:60000})
  if(await page.getByTestId('app-boot-skip-models').isVisible())await page.getByTestId('app-boot-skip-models').click();else await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({state:'hidden',timeout:60000})
  const waitJob=async status=>{for(let i=0;i<200;i++){const actual=await page.evaluate(async()=> (await window.novelDesktop.inspiration.listJobs())[0]?.status);if(actual===status)return;await page.waitForTimeout(50)}throw new Error(`Job did not reach ${status}: ${await page.locator('.inspiration-feedback.error').allTextContents()}`)}
  const capture=async name=>{await page.screenshot({path:join(output,`${name}.png`)});await writeFile(join(output,`${name}-native.png`),Buffer.from(await owner.evaluate(async w=>(await w.webContents.capturePage()).toPNG().toString('base64')),'base64'))}
  await page.getByTestId('open-inspiration-library').click();await page.getByTestId('inspiration-library').waitFor();await capture('01-empty');await page.getByRole('button',{name:'返回创作',exact:true}).click()
  await app.evaluate(({dialog},books)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[books]})},books)
  await page.getByRole('button',{name:/新建空白作品/}).click();await page.getByPlaceholder('例如：灯火照长安').fill('灵感测试作品');await page.getByTestId('create-book-genre').fill('都市奇幻');await page.locator('.create-book-modal').getByRole('button',{name:/选择/}).click();await page.getByRole('button',{name:'创建空白作品',exact:true}).click()
  const composer=page.locator('.group-composer textarea');await composer.waitFor();await composer.fill('群聊中保留的草稿');await page.waitForTimeout(1200)
  const sessionId=await page.evaluate(async connectionId=>{const api=window.novelDesktop;let s=(await api.groupChat.list()).find(s=>s.book?.title==='灵感测试作品');try{s=await api.groupChat.saveMember({sessionId:s.id,expectedRevision:s.revision,memberId:'editor',profile:{connectionId,model:'inspiration-fixture',parameterPolicy:{version:2,mode:'auto'}}})}catch(e){throw new Error(JSON.stringify(e))}return s.id},connectionId)
  await page.getByTestId('open-inspiration-library').click();assert.equal(await composer.isVisible(),false)
  await page.locator('.inspiration-library input[type=file]').setInputFiles([{name:'雨夜参考小说.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 雨夜\n修复师为救人舍弃记忆。\n第二章 旧信\n获救者认得他，并拿来一封旧信。\n第三章 选择\n他决定重新查明自己的选择。')}])
  const preview=page.getByRole('dialog',{name:'核对来源导入'});await preview.waitFor();await preview.locator('summary').click();assert.ok((await preview.locator('pre').textContent()).includes('第三章'));await capture('02-import');await preview.getByRole('button',{name:'确认收入灵感库'}).click();await preview.waitFor({state:'hidden'})
  await page.locator('.inspiration-extraction .model-catalog-trigger').click();await page.getByRole('button',{name:/手动指定模型 ID/}).click();await page.getByRole('textbox',{name:'手动模型 ID',exact:true}).fill('inspiration-fixture');await page.getByRole('button',{name:'使用此模型',exact:true}).click();await page.getByRole('spinbutton',{name:'每批调用预算'}).fill('2')
  await page.locator('.inspiration-source-shelf').getByRole('button',{name:'提取情节'}).click();await waitJob('paused-limit')
  await page.getByRole('button',{name:'继续下一批'}).click();await waitJob('succeeded')
  await page.getByRole('searchbox',{name:'搜索灵感'}).fill('救援');await page.locator('.inspiration-card').first().click();await page.locator('.inspiration-provenance blockquote').first().waitFor();await capture('03-cards')
  await page.getByRole('button',{name:'核对并收入素材'}).click();const selection=page.getByRole('dialog',{name:'核对灵感取用'});await selection.waitFor();await capture('04-selection');await selection.getByRole('button',{name:'确认收入这本书'}).click();await selection.waitFor({state:'hidden'})
  const sourcesBefore=await page.evaluate(async()=>(await window.novelDesktop.research.listSources()).sources.length);assert.equal(sourcesBefore,1)
  for(const [width,theme]of [[1440,'qingzhou'],[1200,'moye'],[1100,'qingzhou']]){await owner.evaluate((w,width)=>w.setContentSize(width,960),width);await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);await page.waitForTimeout(100);const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}));viewports.push({requestedWidth:width,theme,...actual});assert.ok(actual.scrollWidth<=actual.width);await capture(`05-${actual.width}-${theme}`)}
  assert.equal(new Set(viewports.map(v=>v.width)).size,3)
  await owner.evaluate(w=>w.setContentSize(1440,960));await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.inspiration-card').first().evaluate(e=>getComputedStyle(e).animationName),'none')
  await page.getByRole('button',{name:'回到本书群聊 →'}).click();await composer.waitFor();assert.equal(await composer.inputValue(),'群聊中保留的草稿');await composer.fill('从灵感库寻找救援情节，设计本书的改编');await page.locator('.group-composer button[type=submit]').click()
  let group
  for(let i=0;i<300;i++){group=await page.evaluate(id=>window.novelDesktop.groupChat.get({sessionId:id,limit:100}),sessionId);if(group.status==='idle'&&group.candidates.some(c=>c.kind==='adaptation'))break;await page.waitForTimeout(100)}
  assert.equal(group.status,'idle');const adaptation=group.candidates.find(c=>c.kind==='adaptation');assert.ok(adaptation,'group must persist an actual adaptation candidate');assert.ok(adaptation.references.some(r=>r.id.startsWith('inspiration:')))
  assert.equal(calls.length,8,'four extraction calls and four actual group tool steps')
  await page.locator('.group-result-card').filter({hasText:'本书的失忆救援'}).waitFor()
  await page.locator('.group-stop').waitFor({state:'hidden'})
  await page.getByText('附出处的改编候选已保存，等待作者核对。',{exact:true}).waitFor()
  assert.equal(await page.evaluate(async()=>(await window.novelDesktop.research.listSources()).sources.length),sourcesBefore,'agent never writes formal materials');await capture('06-group-adaptation')
  await page.locator('[data-nav-parent=definition]').click();const assistant=page.getByTestId('assistant-sidebar');if(!await assistant.isVisible())await page.getByRole('button',{name:'打开智能助笔侧栏',exact:true}).click();await page.getByTestId('field-assistant-instruction').fill('原智能助笔的草稿')
  await page.getByTestId('open-inspiration-library').click();await assistant.waitFor({state:'hidden'});await page.getByRole('button',{name:'返回创作',exact:true}).click();await assistant.waitFor();assert.equal(await page.getByTestId('field-assistant-instruction').inputValue(),'原智能助笔的草稿');assert.deepEqual(errors,[])
  // Use real private import/storage without paying to create cards just to read.
  const unreadDocuments=Array.from({length:31},(_,i)=>({name:`待阅${String(i+1).padStart(2,'0')}.txt`,dataBase64:Buffer.from('第一章 起点\n主角得到旧钥匙。\n第二章 风景\n河水静静流淌。\n第三章 抉择\n主角决定救人。\n第四章 结果\n主角开门救出了同伴。').toString('base64')}))
  for(let at=0;at<unreadDocuments.length;at+=20)await page.evaluate(async documents=>{const api=window.novelDesktop.inspiration,p=await api.importPreview({documents});await api.importCommit(p.token)},unreadDocuments.slice(at,at+20))
  await page.getByTestId('open-inspiration-library').click();await page.waitForFunction(()=>document.querySelectorAll('.inspiration-source-shelf article').length===30)
  assert.ok(await page.locator('.inspiration-sidebar .inspiration-source-link').evaluateAll(items=>items.length===30&&items.every(item=>item.getBoundingClientRect().height>=32)),'recent source rows must scroll rather than shrink and clip their text')
  await page.getByRole('button',{name:/更多来源/}).click();assert.equal(await page.locator('.inspiration-source-shelf article').count(),32)
  await page.locator('.inspiration-source-shelf article').filter({hasText:'待阅01'}).getByRole('button',{name:'阅读原文',exact:true}).click()
  const reader=page.getByRole('complementary',{name:'完整来源',exact:true});await reader.locator('pre').first().waitFor();assert.ok(!(await reader.textContent()).includes('第四章'))
  await reader.getByRole('button',{name:'继续阅读来源'}).click();await reader.getByText('已显示这份来源的全部 4 个片段',{exact:true}).waitFor();assert.match(await reader.textContent(),/第四章 结果/)
  await capture('07-unextracted-source');await reader.getByRole('button',{name:'关闭来源阅读'}).click()
  await page.getByRole('searchbox',{name:'按标题或作者查找来源'}).fill('待阅01');await page.waitForFunction(()=>document.querySelectorAll('.inspiration-source-shelf article').length===1)
  assert.match(await page.locator('.inspiration-source-shelf').textContent(),/待阅01/);assert.equal(calls.length,8,'unextracted original reading uses no inference');assert.deepEqual(errors,[])
  await writeFile(join(output,'checks.json'),JSON.stringify({checks:['production main/preload','library before and after actual creation','real file chooser import preview','bounded extraction and continuation','actual quotes','author material receipt','three measured widths/two themes/reduced motion','group actual search/read/adaptation without formal writes','retained group and assistant drafts','source beyond 30 remains accessible','unextracted full source pagination and title filter without inference'],viewports,group:{status:group.status,candidateId:adaptation.id,references:adaptation.references},syntheticProviderCalls:calls.length,errors},null,2));console.log('PASS native inspiration import → extract → search → selection → group adaptation; unextracted reading beyond 30 sources')
}catch(error){const page=await app?.firstWindow().catch(()=>null);if(page){await page.screenshot({path:join(output,'failed-page.png')}).catch(()=>{});await writeFile(join(output,'failed-state.json'),JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,library:document.querySelector('[data-testid=inspiration-library]')?.getBoundingClientRect().toJSON()})).catch(()=>null),null,2))}await writeFile(join(output,'failed-main.log'),mainLog.join('\n'));await writeFile(join(output,'failed-check.txt'),String(error));throw error}finally{await app?.close();await new Promise(r=>server.close(r));if(dirname(root)!==parent||!root.startsWith(join(parent,'lanjian-inspiration-smoke-'))||await realpath(root)!==root)throw new Error('Invalid cleanup root');await rm(root,{recursive:true,force:true})}
