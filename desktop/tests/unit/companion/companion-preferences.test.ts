import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { COMPANION_STORAGE_KEY, createCompanionPreferences } from '../../../src/renderer/features/companion/composables/companion-preferences'
import { defaultCompanionOptions } from '../../../src/renderer/features/companion/services/companion-controller'

function memory(initial: string | null = null) {
  let value = initial
  let writes = 0
  let failing = false
  return {
    getItem(key: string) { assert.equal(key, COMPANION_STORAGE_KEY); return value },
    setItem(key: string, next: string) { assert.equal(key, COMPANION_STORAGE_KEY); if (failing) throw new Error('disk unavailable'); value = next; writes++ },
    get value() { return value }, get writes() { return writes },
    fail(enabled = true) { failing = enabled }
  }
}

test('companion preferences persist global values and isolated per-book overrides through reload', () => {
  const storage = memory()
  const book = ref('book-a')
  const settings = createCompanionPreferences(storage, book)
  assert.deepEqual(settings.options.value, defaultCompanionOptions)
  assert.equal(settings.update({ writingMode: 'detailed', followPointer: false }), true)
  assert.equal(settings.setProjectSpecific(true), true)
  assert.equal(settings.update({ writingMode: 'hidden' }), true)
  book.value = 'book-b'
  assert.equal(settings.projectSpecific.value, false)
  assert.equal(settings.options.value.writingMode, 'detailed')
  settings.setProjectSpecific(true)
  settings.update({ writingMode: 'chibi' })
  book.value = 'book-a'
  assert.equal(settings.options.value.writingMode, 'hidden')
  const reloaded = createCompanionPreferences(storage, book)
  assert.equal(reloaded.options.value.writingMode, 'hidden')
  reloaded.setProjectSpecific(false)
  assert.equal(reloaded.options.value.writingMode, 'detailed')
  book.value = 'book-b'
  assert.equal(reloaded.options.value.writingMode, 'chibi')
})

test('failed preference persistence retains acknowledged settings and permits explicit retry', () => {
  const storage = memory()
  const settings = createCompanionPreferences(storage, ref('book-a'))
  settings.update({ writingMode: 'detailed' })
  const acknowledged = storage.value
  storage.fail()
  assert.equal(settings.update({ writingMode: 'hidden' }), false)
  assert.equal(settings.setProjectSpecific(true), false)
  assert.equal(settings.options.value.writingMode, 'detailed')
  assert.equal(settings.projectSpecific.value, false)
  assert.equal(storage.value, acknowledged)
  assert.match(settings.error.value, /保存失败/)
  storage.fail(false)
  assert.equal(settings.update({ writingMode: 'hidden' }), true)
  assert.equal(settings.error.value, '')
})

test('unreadable, unsupported and malformed saved preferences never overwrite original records', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, defaults: {}, projects: [] }), JSON.stringify({ version: 1, defaults: {}, projects: 'bad' })]) {
    const storage = memory(raw)
    const settings = createCompanionPreferences(storage, ref('book-a'))
    assert.match(settings.error.value, /读取|损坏|版本/)
    assert.equal(settings.update({ writingMode: 'hidden' }), false)
    assert.equal(settings.setProjectSpecific(true), false)
    assert.equal(storage.value, raw)
    assert.equal(storage.writes, 0)
  }
})

test('storage read failure cannot be treated as a fresh empty preference namespace', () => {
  let writes = 0
  const settings = createCompanionPreferences({ getItem() { throw new Error('locked') }, setItem() { writes++ } }, ref('book'))
  assert.equal(settings.update({ autoBlink: false }), false)
  assert.equal(writes, 0)
  assert.equal(settings.options.value.autoBlink, true)
})

test('project preference cap refuses a new override without replacing existing projects', () => {
  const projects = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`book-${index}`, defaultCompanionOptions]))
  const storage = memory(JSON.stringify({ version: 1, defaults: defaultCompanionOptions, projects }))
  const book = ref('book-new')
  const settings = createCompanionPreferences(storage, book)
  assert.equal(settings.setProjectSpecific(true), false)
  assert.match(settings.error.value, /100/)
  assert.equal(storage.writes, 0)
  book.value = 'book-0'
  assert.equal(settings.setProjectSpecific(false), true)
  book.value = 'book-new'
  assert.equal(settings.setProjectSpecific(true), true)
  book.value = ''
  assert.equal(settings.setProjectSpecific(true), false)
})

test('explicit damaged-preference recovery backs up exact bytes before replacing defaults', () => {
  const raw = '{original damaged record'
  const values = new Map([[COMPANION_STORAGE_KEY, raw]])
  const writes: string[] = []
  const settings = createCompanionPreferences({
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes.push(key); values.set(key, value) }
  }, ref('book-a'))
  assert.equal(settings.recoverDefaults(), true)
  assert.equal(writes.length, 2)
  assert.ok(writes[0]!.startsWith(`${COMPANION_STORAGE_KEY}-recovery-`))
  assert.equal(values.get(writes[0]!), raw)
  assert.equal(writes[1], COMPANION_STORAGE_KEY)
  assert.deepEqual(settings.options.value, defaultCompanionOptions)
  assert.equal(settings.error.value, '')
  assert.equal(settings.update({ autoBlink: false }), true)
})

test('changed records and failed recovery backups are never overwritten by default restoration', () => {
  const raw = '{original damaged record'
  let value = raw
  let failBackup = true
  let primaryWrites = 0
  const settings = createCompanionPreferences({
    getItem() { return value },
    setItem(key, next) {
      if (key !== COMPANION_STORAGE_KEY && failBackup) throw new Error('quota exceeded')
      if (key === COMPANION_STORAGE_KEY) { primaryWrites++; value = next }
    }
  }, ref('book-a'))
  assert.equal(settings.recoverDefaults(), false)
  assert.equal(value, raw)
  assert.equal(primaryWrites, 0)
  failBackup = false
  value = '{different damaged record'
  assert.equal(settings.recoverDefaults(), false)
  assert.equal(primaryWrites, 0)
  assert.match(settings.error.value, /已变化/)
  assert.equal(settings.update({ autoBlink: false }), false)
})
