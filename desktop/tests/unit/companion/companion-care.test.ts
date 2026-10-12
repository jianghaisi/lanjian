import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPetCare, advancePetCare, newPetCare } from '../../../src/main/modules/companion/domain/companion-care'
import { CompanionCareStore } from '../../../src/main/modules/companion/adapters/companion-care-store'
import { CompanionCareService } from '../../../src/main/modules/companion/application/companion-care-service'
import { CompanionSettingsStore } from '../../../src/main/modules/companion/adapters/companion-settings-store'
import { DesktopPetPreferencesStore } from '../../../src/main/modules/companion/application/desktop-pet-policy'
import { decodePetCareState, decodePetCareRequest, petLevel, type PetCareState, type PetCareAction } from '../../../src/contracts/companion/companion-care'
const date=new Date('2026-09-20T12:00:00+08:00'),day='2026-09-20'
const request=(state:PetCareState,action:PetCareAction)=>({requestId:randomUUID(),revision:state.revision,action})
test('interrupted EFS replacement is never interpreted as a new empty profile',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pet-interrupted-'));t.after(()=>rm(root,{recursive:true,force:true}))
  for(const name of ['companion-care','companion-settings','desktop-pet'])await writeFile(join(root,`${name}.json.interrupted.efs-backup`),'preserved recovery bytes')
  await assert.rejects(new CompanionCareStore(root).read(),/原记录已保留/)
  await assert.rejects(new CompanionSettingsStore(root).read(),/原文件已保留/)
  await assert.rejects(new DesktopPetPreferencesStore(root).read(),/原文件已保留/)
})
test('explicit window settings recovery backs up corruption and returns safely disabled defaults',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pet-recover-'));t.after(()=>rm(root,{recursive:true,force:true}))
  await writeFile(join(root,'desktop-pet.json'),'broken-original')
  const store=new DesktopPetPreferencesStore(root);await assert.rejects(store.read())
  const recovered=await store.recover();assert.equal(recovered.enabled,false);assert.equal(recovered.preferences.clickThrough,false)
  const backup=(await readdir(root)).find(name=>name.endsWith('.bak'))!;assert.equal(await readFile(join(root,backup),'utf8'),'broken-original')
})
test('bounded care, item economy, daily reward and clock rollback are deterministic and idempotent',()=>{
  let state=newPetCare(day)
  const buy=request(state,{type:'buy',item:'food'});state=applyPetCare(state,buy,date)
  assert.equal(state.coins,32);assert.equal(state.inventory.food,4)
  assert.equal(applyPetCare(state,buy,date),state)
  assert.throws(()=>applyPetCare(state,{...buy,action:{type:'buy',item:'toy'}},date))
  for(const item of ['food','water','toy'] as const)state=applyPetCare(state,request(state,{type:'use',item}),date)
  state=applyPetCare(state,request(state,{type:'claim-daily'}),date);assert.equal(state.coins,62)
  assert.throws(()=>applyPetCare(state,request(state,{type:'claim-daily'}),new Date('2026-09-19')))
  assert.equal(state.daily.day,day);assert.equal(state.hunger,100);assert.equal(state.thirst,100);assert.equal(state.energy,72)
  assert.ok(state.achievements.includes('first-care'));assert.equal(petLevel(400),3)
  const noStock={...state,inventory:{...state.inventory,toy:0}};assert.throws(()=>applyPetCare(noStock,request(noStock,{type:'use',item:'toy'}),date))
  const poor={...state,coins:0};assert.throws(()=>applyPetCare(poor,request(poor,{type:'buy',item:'food'}),date))
  decodePetCareState(state)
})
test('focus rewards occur once after online completion; pause/cancel/suspend cannot finish early',()=>{
  let state=newPetCare(day);state=applyPetCare(state,request(state,{type:'focus-start',minutes:5}),date)
  state=advancePetCare(state,10,day);assert.equal(state.focus?.elapsed,10)
  const before=state;assert.equal(advancePetCare(state,3600,day),before);assert.equal(advancePetCare(state,-5,day),before)
  state=applyPetCare(state,request(state,{type:'focus-pause'}),date);state=advancePetCare(state,10,day);assert.equal(state.focus?.elapsed,10)
  state=applyPetCare(state,request(state,{type:'focus-resume'}),date)
  for(let i=0;i<29;i++)state=advancePetCare(state,10,day)
  assert.equal(state.focus?.status,'complete');assert.equal(state.coins,55);assert.equal(state.totals.focus,1)
  state=advancePetCare(state,10,day);assert.equal(state.coins,55)
  state=applyPetCare(state,request(state,{type:'focus-start',minutes:5}),date)
  state=applyPetCare(state,request(state,{type:'focus-cancel'}),date);assert.equal(state.coins,55);assert.equal(state.focus,null)
})
test('sleep restores energy, arbitrary input and nonfinite/future state are rejected',()=>{
  let state={...newPetCare(day),energy:30};state=applyPetCare(state,request(state,{type:'sleep'}),date)
  state=advancePetCare(state,10,day);assert.equal(state.energy,32.5)
  assert.throws(()=>decodePetCareState({...state,version:2}));assert.throws(()=>decodePetCareState({...state,coins:NaN}))
  assert.throws(()=>decodePetCareRequest({...request(state,{type:'pat'}),action:{type:'grant-coins',amount:100}}))
})
test('serialized store commits balance and inventory together, preserves corruption and retries exact requests',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pet-care-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const store=new CompanionCareStore(root),service=new CompanionCareService(store),state=await service.get(),buy=request(state,{type:'buy',item:'food'})
  const both=await Promise.all([service.act(buy),service.act(buy)]);assert.equal(both[0]!.coins,32);assert.equal(both[1]!.inventory.food,4)
  assert.equal((await new CompanionCareService(new CompanionCareStore(root)).get()).coins,32)
  const bytes=await readFile(join(root,'companion-care.json'),'utf8')
  const failure=new CompanionCareService(new CompanionCareStore(root,async()=>{throw new Error('private disk path')}))
  await assert.rejects(failure.act(request(both[1]!,{type:'buy',item:'toy'})),/未能保存/)
  assert.equal(await readFile(join(root,'companion-care.json'),'utf8'),bytes)
  await writeFile(join(root,'companion-care.json'),'{"version":99}')
  await assert.rejects(service.act(request(both[1]!,{type:'pat'})),/原记录已保留/)
  await service.recover();const backup=(await readdir(root)).find(name=>name.endsWith('.bak'))!
  assert.equal(await readFile(join(root,backup),'utf8'),'{"version":99}')
})
test('restart pauses in-progress focus and disabled queued ticks do not mutate state',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pet-focus-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const store=new CompanionCareStore(root),first=new CompanionCareService(store)
  let state=await first.get();state=await first.act(request(state,{type:'focus-start',minutes:5}));await first.tick(10)
  const restarted=new CompanionCareService(new CompanionCareStore(root));state=await restarted.get()
  assert.equal(state.focus?.status,'paused');assert.equal(state.focus?.elapsed,10)
  assert.deepEqual(await restarted.tick(10,()=>false),state)
})
