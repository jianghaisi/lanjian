import assert from 'node:assert/strict'
import test from 'node:test'
import { CompanionVoiceService, type CompanionInferencePort } from '../../../src/main/modules/companion/application/companion-voice-service'
import type { CompanionVoiceEvent, CompanionVoiceRequest } from '../../../src/contracts/companion/companion-voice-contracts'
function fixture(overrides: Partial<CompanionInferencePort> = {}) {
  const calls: unknown[] = []; let id = 0
  const service = new CompanionVoiceService({
    async prepare() {},
    async prepareText() { calls.push('prepare-text') }, stopText() { calls.push('stop-text') }, stopSpeech() { calls.push('stop-speech') },
    async chat(text, context, history, _signal, delta) { calls.push({ text, context, history }); delta('你'); delta('你好。'); return '你好。' },
    async speak(text, voice, _signal, audio) { calls.push({ text, voice }); audio(new Uint8Array([1, 0])) },
    stop() { calls.push('stop') }, cancel() { calls.push('cancel') }, ...overrides,
  }, () => `s-${++id}`, () => new Date('2026-09-11T06:05:04Z'))
  service.updateLibrary([{ id: 'book-1', title: '雾城来信', chapter: '第七章' }])
  const session = service.open(10, 'library-current')
  const input: CompanionVoiceRequest = { ...session, requestId: 'r-1', action: 'chat', text: '你好', voice: 'ningguang', mute: false }
  return { service, calls, input }
}
test('selected continuation is independent of shelf order and invalidates the previous work conversation', async () => {
  const { service, input } = fixture()
  service.configure({ textModel: false, speechModel: false, preload: false, voice: 'ningguang' })
  const books = [{ id: 'test', title: '测试文稿', chapter: null }, { id: 'real', title: '我家美少女', chapter: '第三章' }]
  service.updateLibrary(books, 'real')
  const session = service.open(10, 'library-current')
  const result = await service.request(10, { ...input, ...session, text: '继续创作是哪部作品？' }, () => {})
  assert.match(result.text, /我家美少女/); assert.doesNotMatch(result.text, /测试文稿/)
  service.updateLibrary(books, 'test')
  await assert.rejects(service.request(10, { ...input, ...session, requestId: 'old' }, () => {}))
})

test('warmup preserves safe actionable failures instead of returning an indistinguishable false', async () => {
  const { service } = fixture({ prepare: async () => { throw new Error('VOICE_PREPARATION_STALLED:runtime') } })
  service.configure({ textModel: false, speechModel: true, preload: true, voice: 'ningguang' })
  await assert.rejects(service.warmup(), error => error instanceof Error && /初始化语音环境/.test(error.message))
})
for (const textModel of [false, true]) for (const speechModel of [false, true]) {
  test(`optional models: text=${textModel}, speech=${speechModel} calls only enabled inference`, async () => {
    const { service, calls, input } = fixture()
    service.configure({ textModel, speechModel, preload: false, voice: 'ningguang' })
    const result = await service.request(10, { ...input, text: '现在几点？' }, () => {})
    assert.equal(calls.filter(value => typeof value === 'object' && value && 'context' in value).length, Number(textModel))
    assert.equal(calls.filter(value => typeof value === 'object' && value && 'voice' in value).length, Number(speechModel))
    if (!textModel) assert.match(result.text, /2026.*星期/)
    assert.equal(await service.warmup(), false)
    assert.ok(!calls.includes('prepare-text'))
  })
}
test('presets and tap work without inference installed; enabled AI failure is not replaced by presets', async () => {
  const fail = async () => { throw Error('model-not-installed') }
  const { service, calls, input } = fixture({ chat: fail, speak: fail, prepare: fail, prepareText: fail })
  service.configure({ textModel: false, speechModel: false, preload: true, voice: 'ningguang' })
  await service.warmup()
  const reply = await service.request(10, { ...input, text: '请写一段故事' }, () => {})
  assert.match(reply.text, /预设陪伴模式/)
  assert.match((await service.request(10, { ...input, action: 'tap', text: '', requestId: 'tap' }, () => {})).text, /我在呢/)
  await assert.rejects(service.request(10, { ...input, action: 'tap', text: '', requestId: 'tap-again' }, () => {}))
  service.configure({ textModel: true, speechModel: false, preload: false, voice: 'ningguang' })
  await assert.rejects(service.request(10, { ...input, requestId: 'enabled-failure' }, () => {}), /model-not-installed/)
  assert.ok(!calls.includes('prepare-text'))
})
test('speech-only tap sends text before waiting for cold TTS and never uses Qwen', async () => {
  let finish!: () => void
  const { service, input, calls } = fixture({ prepare: () => new Promise(resolve => { finish = resolve }) })
  service.configure({ textModel: false, speechModel: true, preload: true, voice: 'ningguang' })
  const warm = service.warmup(), events: CompanionVoiceEvent[] = []
  const reply = service.request(10, { ...input, action: 'tap', text: '' }, event => events.push(event))
  assert.equal(events[0]?.kind, 'text')
  assert.ok(!calls.includes('prepare-text'))
  finish(); await warm; await reply
  assert.equal(events.filter(event => event.kind === 'audio').length, 1)
  assert.ok(!calls.some(value => typeof value === 'object' && value && 'context' in value))
})
test('intelligent chat joins pending speech preparation before using the shared scheduler', async () => {
  let finish!: () => void
  const { service, input, calls } = fixture({ prepare: () => new Promise(resolve => { finish = resolve }) })
  const warm = service.prepare('ningguang')
  const reply = service.request(10, input, () => {})
  assert.ok(!calls.some(value => typeof value === 'object' && value && 'context' in value))
  finish(); await warm; await reply
  assert.equal(calls.filter(value => typeof value === 'object' && value && 'context' in value).length, 1)
  assert.equal(calls.filter(value => typeof value === 'object' && value && 'voice' in value).length, 1)
})

test('cancelling chat while it joins preparation cannot start late text or audio inference', async () => {
  let finish!: () => void
  const { service, input, calls } = fixture({ prepare: () => new Promise(resolve => { finish = resolve }) })
  const warm = service.prepare('ningguang'), events: CompanionVoiceEvent[] = []
  const reply = service.request(10, input, event => events.push(event))
  service.cancel(10, input.sessionId)
  finish(); await warm; await assert.rejects(reply)
  assert.ok(!calls.some(value => typeof value === 'object' && value && ('context' in value || 'voice' in value)))
  assert.ok(!events.some(event => event.kind === 'text' || event.kind === 'audio'))
})

test('disabling speech during warmup cancels it and keeps text-only replies independent', async () => {
  let finish!: () => void, signal!: AbortSignal
  const { service, input, calls } = fixture({ prepare: (_voice, abort) => { signal = abort; return new Promise(resolve => { finish = resolve }) } })
  const warm = service.prepare('ningguang')
  service.configure({ textModel: true, speechModel: false, preload: false, voice: 'ningguang' })
  assert.equal(signal.aborted, true)
  await service.request(10, input, () => {})
  assert.ok(!calls.includes('stop-speech'), 'disabled speech stays resident'); assert.ok(!calls.includes('stop-text'))
  finish(); assert.equal(await warm, false)
})
test('disabling text aborts active inference and suppresses late text/audio without unloading idle speech', async () => {
  let finish!: (value: string) => void
  const { service, input, calls } = fixture({ chat: () => new Promise(resolve => { finish = resolve }) })
  const events: CompanionVoiceEvent[] = []
  const pending = service.request(10, input, event => events.push(event))
  service.configure({ textModel: false, speechModel: true, preload: false, voice: 'ningguang' })
  finish('晚到的模型回复'); await assert.rejects(pending)
  assert.ok(calls.includes('stop-text')); assert.ok(!calls.includes('stop-speech'))
  assert.ok(!events.some(event => event.kind === 'text' || event.kind === 'audio'))
})
test('entering work during text warmup never starts the queued speech profile', async () => {
  let finish!: () => void, signal!: AbortSignal, speechCalls = 0
  const { service } = fixture({ prepareText: abort => { signal = abort; return new Promise(resolve => { finish = resolve }) }, prepare: async () => { speechCalls++ } })
  const warm = service.warmup()
  service.clear(); assert.equal(signal.aborted, true)
  finish(); assert.equal(await warm, false); assert.equal(speechCalls, 0)
})
test('grounded context comes from confirmed summary, bounded history and main clock', async () => {
  const { service, calls, input } = fixture(); const events: CompanionVoiceEvent[] = []
  assert.deepEqual(await service.request(10, input, value => events.push(value)), { text: '你好。' })
  const request = calls.find(value => typeof value === 'object' && value && 'context' in value) as { context: string }
  const context = JSON.parse(request.context)
  assert.equal(context.page, '我的作品'); assert.equal(context.continueWork.title, '雾城来信'); assert.match(context.time, /2026/)
  assert.ok(!/path|password|apiKey/.test(request.context))
  assert.deepEqual(events.map(event => event.sequence), events.map((_event, index) => index))
  assert.equal(events.filter(event => event.kind === 'audio').length, 1)
})
test('wrong owner, stale session, unknown work and replayed request fail closed', async () => {
  const { service, calls, input } = fixture(); const count = calls.length
  await assert.rejects(service.request(11, input, () => {})); assert.equal(calls.length, count)
  assert.throws(() => service.open(10, 'unknown'))
  await service.request(10, input, () => {})
  await assert.rejects(service.request(10, input, () => {}))
  const second = service.open(10, null)
  await assert.rejects(service.request(10, { ...input, requestId: 'r-2' }, () => {}))
  await assert.rejects(service.request(10, { ...input, ...second, requestId: 'r-3', action: 'replay' }, () => {}))
})
test('cancel during text generation suppresses late text and all audio', async () => {
  let finish!: (text: string) => void
  const { service, input, calls } = fixture({ chat: () => new Promise(resolve => { finish = resolve }) })
  const events: CompanionVoiceEvent[] = []
  const promise = service.request(10, input, value => events.push(value))
  service.cancel(10, input.sessionId); finish('这是晚到的结果。')
  await assert.rejects(promise)
  assert.ok(!events.some(event => event.kind === 'audio' || event.kind === 'text'))
  assert.ok(!calls.some(value => typeof value === 'object' && value && 'voice' in value))
})
test('mute skips TTS; preview uses fixed audition and never calls LLM', async () => {
  const { service, input, calls } = fixture()
  await service.request(10, { ...input, mute: true }, () => {})
  assert.equal(calls.filter(value => typeof value === 'object' && value && 'voice' in value).length, 0)
  const events: CompanionVoiceEvent[] = []
  await service.request(10, { ...input, requestId: 'preview-1', action: 'preview', text: '不能把这里当作提示词' }, event => events.push(event))
  assert.equal(calls.filter(value => typeof value === 'object' && value && 'context' in value).length, 1)
  assert.ok(events.some(event => event.kind === 'text' && event.text === '欢迎回来。故事还在等你继续。'))
})

test('playback close and work entry retain speech; only shutdown stops both profiles', async () => {
  const { service, input, calls } = fixture()
  await service.request(10, input, () => {})
  service.cancel(10, input.sessionId)
  service.close(10, input.sessionId)
  assert.equal(calls.filter(call => call === 'stop').length, 0)
  const next = service.open(10, 'library-current')
  await assert.rejects(service.request(10, { ...input, ...next, action:'replay', requestId:'old-reply' }, () => {}))
  assert.equal(calls.filter(call => call === 'stop').length, 0)
  service.clear()
  assert.equal(calls.filter(call => call === 'stop').length, 0)
  assert.ok(calls.includes('stop-text'))
  assert.ok(!calls.includes('stop-speech'))
  service.shutdown()
  assert.equal(calls.filter(call => call === 'stop').length, 1)
  await assert.rejects(service.request(10, { ...input, ...next, requestId:'after-enter' }, () => {}))
})

test('closing during synthesis cancels owned inference and rejects late audio', async () => {
  let finish!: () => void, late!: () => void
  const { service, input, calls } = fixture({ speak: (_text,_voice,_signal,audio) => new Promise(resolve => { finish=resolve;late=()=>audio(new Uint8Array([1,0])) }) })
  const events: CompanionVoiceEvent[] = []
  const pending = service.request(10, { ...input,action:'preview' }, event=>events.push(event))
  service.close(10,input.sessionId)
  assert.throws(late)
  finish(); await assert.rejects(pending)
  assert.equal(events.some(event=>event.kind==='audio'),false)
  assert.equal(calls.includes('cancel'),true)
  assert.equal(calls.includes('stop'),false)
})

test('speech preparation is deduplicated and remains alive through UI close and work entry', async () => {
  let finish!: () => void, signal!: AbortSignal, preparations = 0
  const {service,input,calls} = fixture({ prepare: (_voice,abort) => { preparations++;signal=abort;return new Promise(resolve=>{finish=resolve}) } })
  const first=service.prepare('ningguang'), second=service.prepare('ningguang')
  assert.equal(preparations,1)
  assert.equal(await service.prepare('ganyu'),false)
  service.close(10,input.sessionId)
  assert.equal(signal.aborted,false)
  service.clear(); assert.equal(signal.aborted,false)
  finish(); assert.equal(await first,true); assert.equal(await second,true)
  assert.equal(calls.some(value=>typeof value==='object'&&value&&'voice' in value),false)
})

test('main resolves path-valued library IDs without exposing paths to inference', async () => {
  const { service, calls, input } = fixture()
  service.updateLibrary([{ id: 'E:\\books\\my-book', title: '路径作品', chapter: null }])
  const session = service.open(10, 'library-current')
  await service.request(10, { ...input, ...session }, () => {})
  const request = calls.find(value => typeof value === 'object' && value && 'context' in value) as { context: string }
  assert.equal(JSON.parse(request.context).continueWork.title, '路径作品')
  assert.ok(!request.context.includes('books'))
  service.updateLibrary([])
  assert.throws(() => service.open(10, 'library-current'))
  await assert.rejects(service.request(10, { ...input, ...session, requestId: 'stale' }, () => {}))
})

test('proactive notices use confirmed work data, skip LLM and enforce main cooldown across sessions', async () => {
  const { service, calls, input } = fixture()
  const notice: CompanionVoiceRequest = { ...input, action: 'notice', text: '', notice: 'continue-hover' }
  const result = await service.request(10, notice, () => {})
  assert.match(result.text, /雾城来信/)
  assert.match(result.text, /上次的章节/)
  assert.ok(!calls.some(value => typeof value === 'object' && value && 'context' in value))
  assert.equal(calls.filter(value => typeof value === 'object' && value && 'voice' in value).length, 1)
  const next = service.open(10, 'library-current')
  await assert.rejects(service.request(10, { ...notice, ...next, requestId: 'again' }, () => {}))
})

test('rest reminder uses main local clock and never invents operation outcomes', async () => {
  const outputs: string[] = []
  let clock = new Date(2026,8,12,14,0)
  const service = new CompanionVoiceService({
    async prepare() {},
    async prepareText() {}, stopText() {}, stopSpeech() {},
    async chat() { throw Error('notice-must-not-run-LLM') },
    async speak(text) { outputs.push(text) }, stop() {}, cancel() {},
  }, () => 's', () => clock)
  const session = service.open(10, null)
  const input: CompanionVoiceRequest = { ...session, requestId: 'day', action: 'notice', notice: 'late-night', text: '', voice: 'ningguang', mute: false }
  await assert.rejects(service.request(10, input, () => {}))
  assert.equal(outputs.length, 0)
  clock = new Date(2026,8,12,23,10)
  await service.request(10, { ...input, requestId: 'night' }, () => {})
  assert.match(outputs[0]!, /早点休息/)
  assert.ok(!/保存|字数|完成/.test(outputs[0]!))
})
