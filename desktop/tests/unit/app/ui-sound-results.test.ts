import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
const { createAppFeedbackActions } = await import(new URL('../../../src/renderer/app/composables/create-feedback-actions.js', import.meta.url).href)

test('explicit action result follows resolution/rejection; ordinary notices and background guards stay silent', async () => {
  const sounds: string[] = [], toast = ref(''), busy = ref(false)
  const original = globalThis.window
  globalThis.window = { setTimeout: () => 1 } as unknown as Window & typeof globalThis
  try {
    const actions = createAppFeedbackActions({ toast, busy, beginSoundResult: () => (cue: string) => sounds.push(cue) })
    actions.notice('Information only')
    await actions.guard(async () => 1)
    assert.deepEqual(sounds, [])
    let finish!: () => void
    const running = actions.guard(() => new Promise<void>(resolve => { finish = resolve }), 'Saved')
    assert.equal(busy.value, true); assert.deepEqual(sounds, [])
    finish(); await running
    assert.deepEqual(sounds, ['success']); assert.equal(busy.value, false)
    const failure = new Error('not saved')
    await assert.rejects(actions.guard(async () => { throw failure }, 'Saved'), error => error === failure)
    assert.deepEqual(sounds, ['success', 'error']); assert.equal(busy.value, false)
    assert.equal(toast.value, 'not saved')
    const quiet = createAppFeedbackActions({ toast, busy, beginSoundResult: () => undefined })
    await quiet.guard(async () => 2, 'Background saved')
    assert.deepEqual(sounds, ['success', 'error'])
  } finally { globalThis.window = original }
})
