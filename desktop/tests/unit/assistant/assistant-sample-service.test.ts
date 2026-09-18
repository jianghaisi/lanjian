import assert from 'node:assert/strict'
import test from 'node:test'
import { draftAssistantSample } from '../../../src/main/modules/assistant/application/assistant-sample-service'
import type { AssistantConversationRequest } from '../../../src/contracts/assistant/assistant-conversation-contracts'
const input:AssistantConversationRequest={operationId:'sample',workItemId:'book',page:'world',message:'写1000字测试小说',targets:[],chapterId:null,selectedCharacters:0,history:[]}

test('short samples are continued with the existing prose and author constraints',async()=>{
  let calls=0
  const result=await draftAssistantSample(input,'写一个悬疑故事',{async complete(prompt,draft,context){calls++;assert.match(context,/动态境界/);if(calls===1){assert.match(prompt,/1000/);return {content:'雨'.repeat(600)}}assert.equal(draft.length,600);assert.match(prompt,/需要 400/);return {content:'灯'.repeat(400)}}},'动态境界：凡人',new AbortController().signal)
  assert.equal(calls,2);assert.equal((result.match(/雨|灯/g)||[]).length,1000)
})
test('continue retains previous dialogue as data, without a formal document dependency',async()=>{
  await draftAssistantSample({...input,message:'继续',history:[{role:'user',content:'写测试故事'},{role:'assistant',content:'阿宁发现旧钥匙。'}]},'续写',{async complete(prompt){assert.match(prompt,/阿宁发现旧钥匙/);return {content:'风'.repeat(500)}}},'',new AbortController().signal)
})
test('output failures and aborts cannot become successful samples',async()=>{
  const controller=new AbortController();controller.abort()
  await assert.rejects(()=>draftAssistantSample(input,'试写',{async complete(){throw Error('must not call')}},'',controller.signal))
  await assert.rejects(()=>draftAssistantSample(input,'试写',{async complete(){return {content:'没有写作'}}},'',new AbortController().signal),/重复/)
  await assert.rejects(()=>draftAssistantSample({...input,message:'写5000字测试'},'试写',{async complete(){throw Error('must not call')}},'',new AbortController().signal),/最多 2000/)
})

test('native roles preserve the prior story and repeated paragraphs trigger another model step',async()=>{
  const previous='林浩已经穿过天机阁的密道，来到雪山尽头的驿站。'.repeat(3)
  let calls=0
  const statuses:string[]=[]
  const result=await draftAssistantSample({...input,message:'继续',history:[{role:'user',content:'写测试小说'},{role:'assistant',content:previous}]},'接续故事',{
    async complete(){throw Error('History must not be flattened into one user message')},
    async completeMessages(messages){calls++;assert.equal(messages[2].role,'assistant');assert.equal(messages[2].content,previous);assert.ok(!messages.at(-1)!.content.includes(previous));if(calls===1)return {content:previous};assert.match(messages.at(-1)!.content,/未被接纳/);return {content:'灯'.repeat(500)}}
  },'',new AbortController().signal,message=>statuses.push(message))
  assert.equal(calls,2);assert.equal(result,'灯'.repeat(500));assert.ok(statuses.some(message=>message.includes('重复前文')))
})

test('a repeated prefix does not discard new prose or count the old story toward the goal',async()=>{
  const previous='雨'.repeat(600)
  let calls=0
  const result=await draftAssistantSample({...input,message:'继续',history:[{role:'assistant',content:previous}]},'接续故事',{
    async complete(){throw Error('native history required')},
    async completeMessages(messages){calls++;if(calls===1)return {content:previous+'\n\n'+'灯'.repeat(300)};assert.match(messages.at(-1)!.content,/需要 200/);assert.equal(messages.at(-2)!.content,'灯'.repeat(300));return {content:'风'.repeat(200)}}
  },'',new AbortController().signal)
  assert.equal(calls,2);assert.equal(result,'灯'.repeat(300)+'\n\n'+'风'.repeat(200));assert.ok(!result.includes(previous))
})
