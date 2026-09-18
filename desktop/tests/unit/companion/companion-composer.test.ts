import assert from 'node:assert/strict'
import test from 'node:test'
import { placeCompanionComposer } from '../../../src/renderer/features/companion/services/companion-composer-placement'
import { defaultCompanionVoicePreferences, normalizeCompanionVoicePreferences } from '../../../src/renderer/features/companion/services/companion-voice-preferences'

test('composer stays at column bottom across desktop sizes and zoom without changing input geometry', () => {
  for (const [w, h] of [[1920,1080],[1440,900],[1100,760]]) for (const zoom of [1,1.25]) {
    const safe = { left: 0, top: 90 / zoom, right: w / zoom, bottom: (h - 48) / zoom }
    const stage = { ...safe, right: w * .29 / zoom }
    const before = JSON.stringify([safe,stage])
    for (const height of [118,140,220,2000]) {
      const placed = placeCompanionComposer(safe,stage,height)
      assert.ok(placed.left >= stage.left && placed.right <= stage.right)
      assert.ok(placed.top >= safe.top && placed.bottom <= safe.bottom)
      assert.equal(placed.bottom, stage.bottom - 12)
      assert.ok(placed.width <= 400)
    }
    assert.equal(JSON.stringify([safe,stage]),before)
  }
})
test('voice preferences migrate existing values and reject unknown voice/settings data', () => {
  assert.deepEqual(normalizeCompanionVoicePreferences(null),defaultCompanionVoicePreferences)
  assert.deepEqual(normalizeCompanionVoicePreferences({voice:'zf_002',volume:.4,mute:true}),{voice:'ningguang',volume:.4,mute:true,proactive:true,subtitles:true,textModel:true,preload:true})
  assert.equal(normalizeCompanionVoicePreferences({proactive:false,subtitles:false}).proactive,false)
  assert.equal(normalizeCompanionVoicePreferences({proactive:false,subtitles:false}).subtitles,false)
  assert.deepEqual(normalizeCompanionVoicePreferences({voice:'external-file',volume:NaN,mute:'true',text:'private draft'}),defaultCompanionVoicePreferences)
  assert.equal(normalizeCompanionVoicePreferences({volume:-5}).volume,0)
  assert.equal(normalizeCompanionVoicePreferences({volume:8}).volume,1)
  for(const voice of ['ningguang','ganyu','keqing']) assert.equal(normalizeCompanionVoicePreferences({voice}).voice,voice)
  assert.equal(normalizeCompanionVoicePreferences({voice:'zf_001'}).voice,'ningguang')
})
test('settings and conversation share one preference value; failed persistence preserves saved state', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  const values = new Map([['lanjian-companion-voice-v1',JSON.stringify({voice:'zf_002',volume:.4,mute:false})]])
  let failed = false
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key) ?? null,setItem:(key:string,value:string)=>{if(failed)throw Error('storage-full');values.set(key,value)}}})
  try {
    const { useCompanionVoicePreferences } = await import('../../../src/renderer/features/companion/composables/use-companion-voice-preferences')
    const settings = useCompanionVoicePreferences(), conversation = useCompanionVoicePreferences()
    assert.equal(settings.preferences.value.voice,'ningguang')
    settings.update({volume:.25,mute:true})
    assert.equal(conversation.preferences.value.volume,.25)
    assert.equal(conversation.preferences.value.mute,true)
    assert.deepEqual(JSON.parse(values.get('lanjian-companion-voice-v1')!),{voice:'ningguang',volume:.25,mute:true,proactive:true,subtitles:true,textModel:true,preload:true})
    failed = true; settings.update({volume:.9})
    assert.equal(conversation.preferences.value.volume,.25)
    assert.match(settings.error.value,/未保存/)
    failed = false; settings.update({volume:.5}); assert.equal(settings.error.value,'')
  } finally {
    if(original)Object.defineProperty(globalThis,'localStorage',original)
    else Reflect.deleteProperty(globalThis,'localStorage')
  }
})
