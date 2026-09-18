import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeCompanionEvent, decodeCompanionOpen, decodeCompanionRequest, decodeCompanionRuntimeOptions, companionVoiceResultDecoders, voiceId } from '../../../src/contracts/companion/companion-voice-contracts'
const request = { sessionId: 'session-1', requestId: 'request-1', action: 'chat', text: '你好', voice: 'ningguang', mute: false }
test('runtime configuration accepts only independent booleans and a fixed voice; tap cannot inject text', () => {
  const options = { textModel: false, speechModel: true, preload: true, voice: 'ningguang' }
  assert.deepEqual(decodeCompanionRuntimeOptions(options), options)
  for (const patch of [{ textModel: 'false' }, { speechModel: 0 }, { preload: null }, { voice: '../model' }, { path: 'secret' }]) assert.throws(() => decodeCompanionRuntimeOptions({ ...options, ...patch }))
  assert.deepEqual(decodeCompanionRequest({ ...request, action: 'tap', text: '' }), { ...request, action: 'tap', text: '' })
  assert.throws(() => decodeCompanionRequest({ ...request, action: 'tap' }))
  assert.doesNotThrow(() => companionVoiceResultDecoders['companion-voice:status']({ installed: false, textInstalled: false, speechInstalled: true, profile: 'gpt-sovits-v2-fp16' }))
  for (const name of ['configure','warmup','suspend'] as const) {
    assert.equal(companionVoiceResultDecoders[`companion-voice:${name}`](true), true)
    assert.throws(() => companionVoiceResultDecoders[`companion-voice:${name}`]({ ok: true }))
  }
})
test('preparation accepts only the three selected voices and a boolean result', () => {
  for(const value of ['ningguang','ganyu','keqing']) assert.equal(voiceId(value),value)
  for(const value of ['zf_001','zf_002','../voice.wav',{voice:'ganyu'},undefined]) assert.throws(()=>voiceId(value))
  assert.equal(companionVoiceResultDecoders['companion-voice:prepare'](true),true)
  assert.throws(()=>companionVoiceResultDecoders['companion-voice:prepare']({ready:true}))
})
test('voice DTO accepts only bounded fixed actions and identifiers', () => {
  assert.deepEqual(decodeCompanionRequest(request), request)
  assert.deepEqual(decodeCompanionOpen({ continueWorkId: null }), { continueWorkId: null })
  assert.deepEqual(decodeCompanionOpen({ continueWorkId: 'library-current' }), { continueWorkId: 'library-current' })
  for (const continueWorkId of ['book-1', 'E:\\books\\novel', '../book']) assert.throws(() => decodeCompanionOpen({continueWorkId}))
  for (const change of [{ text: 'x'.repeat(2001) }, { action: 'write' }, { voice: 'Vivian' }, { sessionId: '../book' }, { url: 'https://example.com' }, { mute: 1 }, { text: '' }]) assert.throws(() => decodeCompanionRequest({ ...request, ...change }))
})

test('notice DTO accepts only semantic reasons and cannot supply reminder text', () => {
  for (const notice of ['continue-hover', 'late-night']) {
    const input = {...request,action:'notice',text:'',notice}
    assert.deepEqual(decodeCompanionRequest(input),input)
  }
  for (const change of [{notice:'saved'}, {notice:['late-night']}, {action:['notice']}, {notice:undefined}, {text:'伪造保存成功'}, {context:'private'}]) {
    assert.throws(() => decodeCompanionRequest({...request,action:'notice',text:'',notice:'late-night',...change}))
  }
  assert.throws(() => decodeCompanionRequest({...request,notice:'late-night'}))
})
test('audio bridge rejects invalid PCM, ordering fields, metadata and oversized results', () => {
  const base = { sessionId: 's', requestId: 'r', sequence: 0, kind: 'audio', sampleRate: 24000, pcm: new Uint8Array([1, 0]) }
  assert.equal(decodeCompanionEvent(base).kind, 'audio')
  for (const change of [{ pcm: [1, 0] }, { pcm: new Uint8Array(3) }, { pcm: new Uint8Array(1_440_002) }, { sequence: -1 }, { sampleRate: 16000 }, { path: '/secret' }]) assert.throws(() => decodeCompanionEvent({ ...base, ...change }))
  assert.throws(() => companionVoiceResultDecoders['companion-voice:request']({ text: 'x'.repeat(601) }))
  assert.throws(() => companionVoiceResultDecoders['companion-voice:status']({ installed: true, profile: 'cloud' }))
})
