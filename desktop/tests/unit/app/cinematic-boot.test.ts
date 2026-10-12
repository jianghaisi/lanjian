import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceCinematic, advanceArrayWait, repeatWaveTime, rectTransform, cinematicStage, archiveWave, interpolateRect, typed, progress, scanScale, archiveLift, structureSeparation, archiveOpen, shutterOffset, handoffPress } from '../../../src/renderer/app/components/boot/cinematic-timeline'
import { selectContinueProject } from '../../../src/renderer/features/library/composables/continue-project'
import type { ProjectSummary } from '../../../src/contracts/index'

test('hidden time pauses; slow readiness passes scan/welcome and holds only after the first array sweep',()=>{
  let time=0
  for(let frame=0;frame<3000;frame++)time=advanceCinematic(time,1/60,false,false)
  assert.equal(time,0)
  for(let frame=0;frame<3000;frame++)time=advanceCinematic(time,1/60,false,true)
  assert.equal(cinematicStage(time),'array')
  assert.ok(time>19.6&&time<20)
  const held=time
  for(let frame=0;frame<3000;frame++)time=advanceCinematic(time,1/60,false,true)
  assert.equal(time,held)
  for(let frame=0;frame<3000;frame++)time=advanceCinematic(time,1/60,true,true)
  assert.equal(cinematicStage(time),'await-click')
  assert.equal(advanceCinematic(time,10,true,true),time)
})

test('a waiting array repeats forward and completes the current pass before resuming',()=>{
  assert.equal(advanceArrayWait(3,1,true,false),3,'hidden readiness must not consume a wave')
  assert.equal(advanceArrayWait(3,.05,true,true),3.05,'ready midway must not cut the wave')
  assert.equal(advanceArrayWait(7.98,.05,true,true),null)
  assert.ok(Math.abs(advanceArrayWait(7.98,.05,false,true)!-8.03)<1e-10)
  assert.ok(repeatWaveTime(5)>repeatWaveTime(2))
  assert.ok(repeatWaveTime(13)>repeatWaveTime(10))
  assert.equal(repeatWaveTime(0),repeatWaveTime(8))
  assert.equal(archiveWave(0,0,repeatWaveTime(0)),0,'restart begins offscreen with zero crest')
})

test('handoff transform maps a fixed layout to the destination without changing its dimensions',()=>{
  const source={x:300,y:180,width:800,height:400},target={x:40,y:100,width:500,height:300}
  assert.equal(rectTransform(source,source),'translate3d(0px,0px,0) scale(1,1)')
  assert.equal(rectTransform(source,target),'translate3d(-260px,-80px,0) scale(0.625,0.75)')
  assert.equal(rectTransform(target,target),'translate3d(0px,0px,0) scale(1,1)')
  assert.deepEqual(source,{x:300,y:180,width:800,height:400})
})

test('the full timeline visits every requested stage in order and survives an elapsed-time spike',()=>{
  let time=0
  const seen=new Set<string>()
  for(let frame=0;frame<2400;frame++){seen.add(cinematicStage(time));time=advanceCinematic(time,1/60,true,true)}
  assert.deepEqual([...seen],['access','mark','identity','scan','welcome','array','extract','inspect','await-click'])
  assert.ok(advanceCinematic(2,30,true,true)<3,'a suspended frame must not skip the logo')
})

test('typewriter respects Unicode boundaries and does not expose text before its cue',()=>{
  assert.equal(typed('岚📖笺',0,1,3),'')
  assert.equal(typed('岚📖笺',3,1,3),'岚📖')
  assert.equal(typed('岚📖笺',9,1,3),'岚📖笺')
})

test('traveling crest moves between rows continuously, then settles before close-up',()=>{
  const crest=(time:number)=>{const rows=Array.from({length:81},(_,i)=>i-40);return rows.reduce((best,row)=>archiveWave(row,0,time)>archiveWave(best,0,time)?row:best,rows[0]!) }
  assert.ok(crest(15)>crest(14),'crest advances along camera-right')
  assert.ok(crest(19)>crest(18),'crest continues right instead of returning')
  const peaks=[]
  for(let t=13;t<20;t+=.02)if(archiveWave(0,0,t)>archiveWave(0,0,t-.02)&&archiveWave(0,0,t)>=archiveWave(0,0,t+.02))peaks.push(t)
  assert.equal(peaks.length,1,'each dossier is raised only once during the array shot')
  assert.ok(Math.abs(archiveWave(1,0,16)-archiveWave(1,0,16.001))<.03)
  assert.equal(archiveWave(0,0,25),0)

})

test('handoff uses actual bounds and lands exactly even when the target is resized',()=>{
  const source={x:410,y:200,width:640,height:470},target={x:25,y:120,width:730,height:280}
  assert.deepEqual(interpolateRect(source,target,0),source)
  const halfway=interpolateRect(source,target,.5)
  assert.ok(halfway.x>target.x&&halfway.x<source.x)
  const resized={x:18,y:88,width:590,height:260}
  assert.deepEqual(interpolateRect(halfway,resized,1),resized)
  assert.equal(progress(1.65,1.65,1.65),1,'a final-frame resize has a finite exact endpoint')
})

test('boot and library select the same real last work and preserve shelf order and empty state',()=>{
  const books=[{id:'first',title:'第一部'},{id:'second',title:'最近续写'}] as ProjectSummary[]
  const snapshot=JSON.stringify(books)
  assert.equal(selectContinueProject(books,'second'),books[1])
  assert.equal(selectContinueProject(books,'gone'),books[0])
  assert.equal(selectContinueProject([],null),undefined)
  assert.equal(JSON.stringify(books),snapshot)
})


test('scan starts outside the viewport; extraction stages and material layers reassemble',()=>{
  assert.ok(scanScale(5)>2.5);assert.ok(scanScale(6)<scanScale(5));assert.ok(scanScale(8.9)<1.001)
  assert.ok(archiveLift(21.6)>.5&&archiveLift(21.6)<1)
  assert.ok(archiveLift(25)>5)
  assert.equal(structureSeparation(25),0);assert.ok(structureSeparation(28.5)>.99);assert.equal(structureSeparation(31),0)
})


test('array reveal follows the forward wave direction and settles before retrieval',()=>{
  assert.ok(archiveOpen(-20,0,12.5)>archiveOpen(20,0,12.5))
  assert.ok(archiveOpen(0,-2,12.5)>archiveOpen(0,2,12.5))
  for(const row of [-130,0,130])for(const lane of [-8,0,8]){
    assert.equal(archiveOpen(row,lane,11),0)
    assert.equal(archiveOpen(row,lane,15),1)
  }
})

test('shutters travel only right and cover the exact stage cuts',()=>{
  for(const [start,cut] of [[8.64,9],[11.64,12]])for(let band=0;band<3;band++){
    assert.ok(shutterOffset(start,start,band)<=-100)
    assert.ok(shutterOffset(start+.8,start,band)>=100)
    assert.equal(shutterOffset(cut,start,band),0,'the entire stage cut is behind the moving cover')
    for(let t=start;t<start+.8;t+=.01)assert.ok(shutterOffset(t+.01,start,band)>=shutterOffset(t,start,band)-1e-9)
  }
})

test('click press is bounded, returns once and leaves the arrival endpoint exact',()=>{
  assert.equal(handoffPress(0),1)
  assert.ok(handoffPress(.075)<.99)
  for(let t=0;t<1.7;t+=.001)assert.ok(handoffPress(t)>=.988&&handoffPress(t)<=1)
  assert.equal(handoffPress(.2),1)
  assert.equal(handoffPress(1.65),1)
})
