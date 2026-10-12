import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, defineComponent, h, nextTick, reactive } from 'vue'
import { useInspiration } from '../../../src/renderer/features/inspiration/composables/use-inspiration'
import type { DesktopApi, ProjectSummary } from '../../../src/contracts'
import type { InspirationCard, InspirationReadSource, InspirationSelection, InspirationSource, InspirationVideoJob } from '../../../src/contracts/inspiration/types'
import { sourceLink } from '../../../src/renderer/features/inspiration/utils/source-link'

const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {resolve,promise}}
const settle=async()=>{await nextTick();await new Promise(r=>setImmediate(r))}
const card=(id:string)=>({id,sourceId:id,sourceVersion:'v'} as InspirationCard)
const reading=(id:string)=>({source:{id,version:'v'},segments:[],nextOffset:2} as unknown as InspirationReadSource)
function mount(t:test.TestContext,overrides:Partial<DesktopApi['inspiration']>={}){
  const props=reactive({visible:true,book:{id:'A'} as ProjectSummary|null,projects:[],api:{inspiration:{listSources:async()=>[],listClassifications:async()=>[],listJobs:async()=>[],listVideoJobs:async()=>[],capabilities:async()=>({}),search:async()=>({cards:[],total:0,nextOffset:-1}),readSource:async({sourceId}:{sourceId:string})=>reading(sourceId),readEvidence:async(id:string)=>reading(id),...overrides}} as unknown as DesktopApi})
  const renderer=createRenderer<any,any>({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),insert(){},remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}})
  let library!:ReturnType<typeof useInspiration>
  const app=renderer.createApp(defineComponent({setup(){library=useInspiration(props);return()=>h('div')}}))
  app.mount({});t.after(()=>app.unmount());return {props,library}
}
test('late source pagination cannot replace the selected card',async t=>{
  const page=deferred<InspirationReadSource>(),f=mount(t,{readSource:async i=>i.offset?page.promise:reading(i.sourceId)})
  await settle();await f.library.inspect(card('A'));const pending=f.library.readMore()
  await f.library.inspect(card('B'));page.resolve(reading('A'));await pending
  assert.equal(f.library.reading.value?.source.id,'B')
})
test('card reads do not invalidate the independent library loading state',async t=>{
  const sources=deferred<[]>(),f=mount(t,{listSources:()=>sources.promise})
  await f.library.inspect(card('A'));sources.resolve([]);await settle()
  assert.equal(f.library.loading.value,false);assert.equal(f.library.initialized.value,true)
})
test('late material preview is discarded after target book or card changes',async t=>{
  const preview=deferred<InspirationSelection>(),f=mount(t,{prepareSelection:()=>preview.promise})
  await settle();await f.library.inspect(card('A'));const pending=f.library.prepareSelection()
  f.props.book={id:'B'} as ProjectSummary;await settle();preview.resolve({bookTitle:'A',token:'old'} as InspirationSelection);await pending
  assert.equal(f.library.selection.value,null);assert.equal(f.library.targetBook.value,'B')
})
test('hidden library discards late reads and clears its loading indicator',async t=>{
  const response=deferred<InspirationReadSource>(),f=mount(t,{readEvidence:()=>response.promise})
  await settle();const pending=f.library.inspect(card('A'));f.props.visible=false;await settle()
  response.resolve(reading('A'));await pending
  assert.equal(f.library.reading.value,null);assert.equal(f.library.loading.value,false)
})

test('unextracted sources can be read without a model and closed reads cannot reopen them',async t=>{
  let calls=0;const pending=deferred<InspirationReadSource>()
  const source={id:'A',version:'v',title:'没有卡片的原文'} as InspirationSource
  const f=mount(t,{readSource:async()=>{calls++;return pending.promise},extract:async()=>{throw new Error('reading must not infer')}})
  await settle();const read=f.library.inspectSource(source)
  assert.equal(f.library.inspectedSource.value?.id,'A');assert.equal(f.library.selected.value,null);assert.equal(f.library.model.value,null)
  f.library.closeReading();pending.resolve(reading('A'));await read
  assert.equal(f.library.reading.value,null);assert.equal(f.library.inspectedSource.value,null);assert.equal(f.library.readingBusy.value,false);assert.equal(calls,1)
})

test('changing an unextracted source during pagination preserves the newer reading',async t=>{
  const pending=deferred<InspirationReadSource>(),f=mount(t,{readSource:i=>i.offset?pending.promise:Promise.resolve(reading(i.sourceId))})
  await settle();await f.library.inspectSource({id:'A',version:'v'} as InspirationSource);const more=f.library.readMore()
  await f.library.inspectSource({id:'B',version:'v'} as InspirationSource);pending.resolve(reading('A'));await more
  assert.equal(f.library.reading.value?.source.id,'B');assert.equal(f.library.readingBusy.value,false)
})

test('opening the library restores an active video and stopping it cannot be undone by a stale refresh',async t=>{
  const active={id:'video',status:'running',progress:50} as InspirationVideoJob
  const late=deferred<InspirationVideoJob[]>();let reads=0
  const f=mount(t,{listVideoJobs:async()=>++reads===1?[active]:late.promise,stopVideo:async()=>({...active,status:'cancelled'})})
  await settle();assert.equal(f.library.video.value?.id,'video');assert.equal(f.library.video.value?.status,'running')
  const refresh=f.library.refresh();await f.library.stopVideo();late.resolve([active]);await refresh
  assert.equal(f.library.video.value?.status,'cancelled');assert.equal(f.library.videoJobs.value[0].status,'cancelled')
})

test('restored video polling publishes actual progress and stops when the library is hidden',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const active={id:'video',status:'running',progress:40,updatedAt:'2026-10-11T12:00:00.000Z'} as InspirationVideoJob;let polls=0
  const f=mount(t,{listVideoJobs:async()=>[active],videoJob:async()=>{polls++;return {...active,progress:65}}})
  await settle();t.mock.timers.tick(1500);await settle()
  assert.equal(f.library.video.value?.progress,65);assert.equal(polls,1)
  f.props.visible=false;await settle();t.mock.timers.tick(5000);await settle();assert.equal(polls,1)
})

test('title filtering can find sources beyond the recent thirty without extracting cards',async t=>{
  const sources=Array.from({length:35},(_,i)=>({id:String(i),title:`故事${i}`,author:i===34?'林渡':'',kind:'novel'} as InspirationSource))
  const f=mount(t,{listSources:async()=>sources});await settle();f.library.sourceQuery.value='林渡';await settle()
  assert.deepEqual(f.library.visibleSources.value.map(s=>s.id),['34']);assert.equal(f.library.cards.value.length,0)
})

test('an earlier individual video read cannot regress a newer completed history snapshot',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const active={id:'video',status:'running',progress:40,updatedAt:'2026-10-11T12:00:00.000Z'} as InspirationVideoJob
  const done={...active,status:'succeeded' as const,progress:100,updatedAt:'2026-10-11T12:00:01.000Z'};let reads=0
  const f=mount(t,{listVideoJobs:async()=>[++reads===1?active:done],videoJob:async()=>active})
  await settle();t.mock.timers.tick(1500);await settle()
  assert.equal(f.library.video.value?.status,'succeeded');assert.equal(f.library.video.value?.progress,100)
})

test('video source links retain Bilibili part and exact timestamp while rejecting unsafe navigation',()=>{
  const link=sourceLink({url:'https://www.bilibili.com/video/BV13x41117TL?p=3'},92.9)!
  assert.equal(new URL(link).searchParams.get('p'),'3');assert.equal(new URL(link).searchParams.get('t'),'92')
  assert.equal(sourceLink({url:'https://www.bilibili.com/video/BV13x41117TL'},0),'https://www.bilibili.com/video/BV13x41117TL?t=0')
  assert.equal(sourceLink({url:'https://www.douyin.com/video/123'},15),'https://www.douyin.com/video/123')
  for(const url of ['javascript:alert(1)','file:///private','https://bilibili.com.evil.example/video/BV123','https://user:secret@www.bilibili.com/video/BV123','https://www.bilibili.com:444/video/BV123'])assert.equal(sourceLink({url}),undefined)
  assert.equal(sourceLink({url:'https://www.bilibili.com/video/BV123'},NaN),undefined)
})

const novels=[{id:'A',version:'v',title:'城市旧信',author:'林渡',kind:'novel'},{id:'B',version:'v',title:'山中重逢',author:'',kind:'novel'}] as InspirationSource[]
const categories=[{sourceId:'A',genreId:'urban' as const,revision:1,updatedAt:'2026-10-12'},{sourceId:'B',genreId:'xianxia' as const,revision:1,updatedAt:'2026-10-12'}]
test('overview never searches pooled cards; detail queries and pagination bind the selected book and section',async t=>{
  const requests:unknown[]=[],f=mount(t,{listSources:async()=>novels,listClassifications:async()=>categories,search:async i=>{requests.push(i);return {cards:[card(i.sourceId!)],sources:[],total:35,nextOffset:i.offset===0?30:-1}}})
  await settle();assert.equal(requests.length,0);f.library.genre.value='urban';f.library.sourceQuery.value='林渡';f.library.openSource(novels[0]);await settle()
  f.library.section.value='scene';await settle();await f.library.search(true)
  assert.deepEqual(requests,[{query:'',sourceId:'A',cardKind:'scene',offset:0,limit:30},{query:'',sourceId:'A',cardKind:'scene',offset:30,limit:30}])
  f.library.returnToList();assert.equal(f.library.cards.value.length,0);assert.equal(f.library.genre.value,'urban');assert.equal(f.library.sourceQuery.value,'林渡');assert.deepEqual(f.library.visibleSources.value.map(s=>s.id),['A'])
})
test('late scene and summary responses cannot replace another book or section',async t=>{
  const old=deferred<any>(),f=mount(t,{listSources:async()=>novels,listClassifications:async()=>categories,search:i=>i.sourceId==='A'&&i.cardKind==='scene'?old.promise:Promise.resolve({cards:[card(i.sourceId!)],sources:[],total:1,nextOffset:-1})})
  await settle();f.library.openSource(novels[0]);f.library.section.value='scene';await settle();f.library.selected.value=card('A');f.library.selection.value={token:'stale'} as InspirationSelection
  f.library.openSource(novels[1]);assert.equal(f.library.selected.value,null);assert.equal(f.library.selection.value,null);assert.equal(f.library.cards.value.length,0)
  f.library.section.value='arc';await settle();old.resolve({cards:[card('A')],total:1,nextOffset:-1});await settle()
  assert.deepEqual(f.library.cards.value.map(c=>c.sourceId),['B']);assert.equal(f.library.section.value,'arc')
})
test('category receipt stays attached to the originating book during a switch and independent refresh',async t=>{
  const saved=deferred<any>(),f=mount(t,{listSources:async()=>novels,listClassifications:async()=>categories,setClassification:()=>saved.promise})
  await settle();f.library.openSource(novels[0]);f.library.genreDraft.value='history';f.library.section.value='jobs';assert.equal(f.library.genreDraft.value,'history')
  const pending=f.library.saveClassification();f.library.openSource(novels[1]);await f.library.refresh();saved.resolve({...categories[0],genreId:'history',revision:2});await pending
  assert.equal(f.library.genreDraft.value,'xianxia');assert.equal(f.library.classificationFor('A')?.genreId,'history');assert.equal(f.library.genreCount('history'),1);assert.match(f.library.notice.value,/城市旧信/)
})
test('classification failure keeps novels and original readable; dirty choices survive refresh and conflicts',async t=>{
  let fail=false;const f=mount(t,{listSources:async()=>novels,listClassifications:async()=>{if(fail)throw new Error('分类读取失败');return categories},setClassification:async()=>{throw new Error('分类已变化')}})
  await settle();f.library.openSource(novels[0]);await settle();f.library.genreDraft.value='history';await f.library.refresh();assert.equal(f.library.genreDraft.value,'history')
  await f.library.saveClassification();assert.equal(f.library.genreDraft.value,'history');assert.match(f.library.classificationError.value,/已变化/);assert.equal(f.library.classificationFor('A')?.genreId,'urban')
  f.library.genre.value='urban';fail=true;await f.library.refresh();assert.equal(f.library.classificationReady.value,false);assert.equal(f.library.visibleSources.value.length,2);assert.equal(f.library.reading.value?.source.id,'A')
})
test('refresh after changed source version re-reads the new original without losing genre filters',async t=>{
  let version='v';const f=mount(t,{listSources:async()=>[{...novels[0],version}],listClassifications:async()=>categories,readSource:async i=>({...reading(i.sourceId),source:{...novels[0],version:i.sourceVersion}})})
  await settle();f.library.openSource(f.library.sources.value[0]);await settle();f.library.genre.value='urban';version='new';await f.library.refresh();await settle()
  assert.equal(f.library.reading.value?.source.version,'new');assert.equal(f.library.genre.value,'urban')
})
