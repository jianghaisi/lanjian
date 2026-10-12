import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer } from 'vue'
import { useProseEventSettlement } from '../../../src/renderer/features/timeline/composables/use-prose-event-settlement'
import type { SettlementApi, SettlementDraft, SettlementPage, SettlementTask } from '../../../src/contracts/timeline/prose-event-settlement-contracts'

for(const status of ['succeeded','failed'])test('an extraction that is already '+status+' at acknowledgement refreshes candidates and terminal feedback',async t=>{
 const basis={chapterId:1,documentId:'doc',bodyVersionId:'version',bodyHash:'a'.repeat(64),revision:'1',position:1,fingerprint:'b'.repeat(64)}
 const draft:SettlementDraft={id:'draft',revision:1,taskId:'task',source:basis,updatedAt:'2026-10-01T00:00:00Z',
  fields:{time:'夜',characters:['甲'],location:'屋内',event:'开门',result:''},quotes:[{start:0,end:2,quote:'开门'}],supplements:[]}
 const task:SettlementTask={id:'task',chapterId:1,status,error:status==='failed'?'格式无效':null,drafts:status==='succeeded'?[draft]:[],rawOutput:status==='failed'?'invalid':'[]'}
 const stored:SettlementPage={source:{basis,title:'第一章',body:'开门',plans:[],contract:null,contractEvents:[]},drafts:[],history:[],tasks:[]}
 const api:Pick<SettlementApi,'chapterSettlement'|'cancelSettlement'|'startSettlementExtraction'>={
  chapterSettlement:async()=>structuredClone(stored),
  cancelSettlement:async()=>true,
  startSettlementExtraction:async()=>{stored.tasks=[task];stored.drafts=task.drafts;return structuredClone(task)}
 }
 const previous=Object.fromEntries(['window','localStorage'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]))
 Object.defineProperty(globalThis,'window',{configurable:true,value:{novelDesktop:{events:api}}})
 const saved=new Map<string,string>()
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)}})
 const renderer=createRenderer<object,object>({
  createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},patchProp(){},insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null
 })
 let state!:ReturnType<typeof useProseEventSettlement>
 const app=renderer.createApp({setup(){state=useProseEventSettlement({workItemId:'book',chapterId:1,body:'开门',title:'第一章'},()=>assert.fail('extraction must not confirm facts'));return()=>null}})
 t.after(()=>{app.unmount();for(const [name,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name)}})
 app.mount({})
 await state.toggle();await state.start()
 assert.deepEqual(state.candidates.value.map(d=>d.id),task.drafts.map(d=>d.id))
 assert.equal(state.activeTasks.value.length,0)
 assert.ok(!state.message.value.includes('正在提取'))
 if(status==='succeeded')assert.equal(state.choices.draft.selected,false)
 assert.equal(state.page.value!.history.length,0)
})
