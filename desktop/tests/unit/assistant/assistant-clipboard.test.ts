import assert from 'node:assert/strict'
import test from 'node:test'
import { copyAssistantText } from '../../../src/renderer/features/assistant/services/assistant-clipboard'

function fixture(write: (text: string) => Promise<void>, execResult = true, inDialog = false) {
  const originals = new Map(['navigator', 'document', 'window', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const calls: string[] = [], values: string[] = [], savedRange = { contents: '作者选中的文字' }
  const dialog = { append: () => calls.push('dialog-append') }
  class Element {
    isConnected = true
    closest() { return inDialog ? dialog : null }
    focus(options: unknown) { assert.deepEqual(options, { preventScroll: true }); calls.push('restore-focus') }
  }
  const input = { value: '', readOnly: false, tabIndex: 0, style: { cssText: '' }, setAttribute() {}, select() { calls.push('select') }, remove() { calls.push('remove') } }
  const globals = {
    navigator: { clipboard: { writeText: write } }, HTMLElement: Element,
    window: { getSelection: () => ({ rangeCount: 1, getRangeAt: () => ({ cloneRange: () => savedRange }), removeAllRanges: () => calls.push('clear-ranges'), addRange: (value: unknown) => { assert.equal(value, savedRange); calls.push('restore-range') } }) },
    document: { activeElement: new Element(), body: { append: () => calls.push('body-append') }, createElement: () => input, execCommand: (command: string) => { assert.equal(command, 'copy'); assert.equal(input.readOnly, true); values.push(input.value); calls.push('copy'); return execResult } }
  }
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  return { calls, values, restore() { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) } } }
}

test('browser copy success needs no temporary selection or DOM changes', async () => {
  const written: string[] = [], f = fixture(async text => { written.push(text) })
  try { assert.equal(await copyAssistantText('全文\n末尾  '), true); assert.deepEqual(written, ['全文\n末尾  ']); assert.deepEqual(f.calls, []) } finally { f.restore() }
})
for (const dialog of [false, true]) test(`denied clipboard uses explicit selection copy and restores focus/ranges (dialog=${dialog})`, async () => {
  const f = fixture(async () => { throw new Error('Permission denied') }, true, dialog)
  try {
    const text = '完整长文。'.repeat(5000) + '\n末尾  '
    assert.equal(await copyAssistantText(text), true); assert.deepEqual(f.values, [text])
    assert.deepEqual(f.calls, [dialog ? 'dialog-append' : 'body-append', 'select', 'copy', 'remove', 'restore-focus', 'clear-ranges', 'restore-range'])
  } finally { f.restore() }
})
test('a failed selection copy still removes temporary DOM and restores the author selection', async () => {
  const f = fixture(async () => { throw new Error('Denied') }, false)
  try { await assert.rejects(copyAssistantText('稿'), /Copy unavailable/); assert.deepEqual(f.calls.slice(-4), ['remove', 'restore-focus', 'clear-ranges', 'restore-range']) } finally { f.restore() }
})
test('late rejection after switching scope cannot start a selection copy or steal focus', async () => {
  let reject!: (error: Error) => void, current = true
  const f = fixture(() => new Promise<void>((_, fail) => { reject = fail }))
  try {
    const pending = copyAssistantText('旧记录', () => current); current = false; reject(new Error('Late denial'))
    assert.equal(await pending, false); assert.deepEqual(f.calls, []); assert.deepEqual(f.values, [])
  } finally { f.restore() }
})
test('inactive and late successful copies cannot report success for a new scope', async () => {
  let resolve!: () => void, current = false, count = 0
  const f = fixture(() => { count++; return new Promise<void>(done => { resolve = done }) })
  try {
    assert.equal(await copyAssistantText('旧', () => current), false); assert.equal(count, 0)
    current = true; const pending = copyAssistantText('旧', () => current); current = false; resolve()
    assert.equal(await pending, false); assert.deepEqual(f.calls, [])
  } finally { f.restore() }
})
