import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '../../../src/main/core/errors/app-error'
import { atomicWriteText } from '../../../src/main/platform/storage/atomic-file'
import type { DesktopPetContext } from '../../../src/contracts/companion/desktop-pet'
import { defaultDesktopPetPreferences, decodeDesktopPetCommand, decodeDesktopPetContext, DesktopPetPreferencesStore, restoreDesktopPetPosition, type StoredDesktopPetPreferences } from '../../../src/main/modules/companion/application/desktop-pet-policy'

const context = (): DesktopPetContext => ({ mode: 'chibi', scope: 'book:chapter', taskId: '', taskStatus: '', quiet: false, reducedMotion: false, followPointer: true, autoBlink: true, stateFeedback: true, intensity: .45, focusHidden: true })
const saved = (): StoredDesktopPetPreferences => ({ enabled: false, preferences: { ...defaultDesktopPetPreferences }, position: null })
const validation = (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR'
const storage = (error: unknown) => error instanceof AppError && error.code === 'STORAGE_ERROR'
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-desktop-pet-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}
const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const secondary = { x: -1600, y: -200, width: 1600, height: 1000 }

test('context decoder accepts the precise task context and current task status families', () => {
  for (const taskStatus of ['', 'idle', 'queued', 'preparing', 'running', 'streaming', 'resuming', 'paused', 'succeeded', 'completed', 'failed', 'cancelled', 'interrupted', 'stopped']) {
    assert.deepEqual(decodeDesktopPetContext({ ...context(), taskStatus }), { ...context(), taskStatus })
  }
  assert.equal(decodeDesktopPetContext({ ...context(), scope: '章'.repeat(200) }).scope.length, 200)
  assert.equal(decodeDesktopPetContext({ ...context(), stateFeedback: false }).stateFeedback, false)
})
test('context rejects missing/unknown fields, invalid statuses, unsafe IDs and non-finite or coerced preferences', () => {
  const { quiet: _quiet, ...missing } = context()
  for (const input of [null, [], missing, { ...context(), extra: true }, { ...context(), taskStatus: 'provider raw error' },
    { ...context(), scope: 'a'.repeat(201) }, { ...context(), taskId: 'id\nsecret' }, { ...context(), quiet: 1 },
    { ...context(), mode: 'grok' }, { ...context(), stateFeedback: 'false' }, { ...context(), stateFeedback: undefined }, { ...context(), intensity: NaN }, { ...context(), intensity: Infinity }, { ...context(), intensity: -1 }, { ...context(), intensity: 1.01 }]) {
    assert.throws(() => decodeDesktopPetContext(input), validation)
  }
})
test('commands are strict discriminated unions and return detached preferences', () => {
  for (const panel of [null, 'menu', 'chat', 'care', 'settings']) assert.deepEqual(decodeDesktopPetCommand({ type: 'panel', panel }), { type: 'panel', panel })
  for (const type of ['toggle', 'hide', 'locate', 'return-to-writing', 'settings', 'drag-start', 'drag-end']) assert.deepEqual(decodeDesktopPetCommand({ type }), { type })
  for (const mode of ['detailed', 'chibi']) assert.deepEqual(decodeDesktopPetCommand({ type: 'mode', mode }), { type: 'mode', mode })
  assert.deepEqual(decodeDesktopPetCommand({ type: 'hover', interactive: true }), { type: 'hover', interactive: true })
  const input = { type: 'configure', preferences: { ...defaultDesktopPetPreferences, scale: 1.8, reminderMinutes: 240 } }
  const decoded = decodeDesktopPetCommand(input)
  input.preferences.scale = 1
  assert.equal(decoded.type === 'configure' && decoded.preferences.scale, 1.8)
})
test('commands reject arbitrary commands, extra arguments and invalid ranges', () => {
  for (const input of [undefined, [], { type: 'execute' }, { type: 'hide', position: {} }, { type: 'hover', interactive: 'true' }, { type: 'mode', mode: 'hidden' },
    { type: 'panel' }, { type: 'panel', panel: 'browser' }, { type: 'panel', panel: 'settings', x: 0 },
    { type: 'configure', preferences: {} }, { type: 'configure', preferences: { ...defaultDesktopPetPreferences, extra: true } },
    ...[{ scale: .59 }, { scale: 1.81 }, { scale: '1' }, { scale: Infinity }, { alwaysOnTop: 1 }, { reminderMinutes: -1 }, { reminderMinutes: 241 }, { reminderMinutes: 1.2 }].map(patch => ({ type: 'configure', preferences: { ...defaultDesktopPetPreferences, ...patch } }))]) {
    assert.throws(() => decodeDesktopPetCommand(input), validation)
  }
})
test('interactive region commands accept empty lists and bounded fractional rectangles as detached data', () => {
  assert.deepEqual(decodeDesktopPetCommand({ type: 'regions', regions: [] }), { type: 'regions', regions: [] })
  const region = { x: .25, y: 4096, width: 4096, height: .5 }, regions = Array.from({ length: 24 }, () => ({ ...region }))
  const decoded = decodeDesktopPetCommand({ type: 'regions', regions })
  regions[0]!.x = 200
  assert.equal(decoded.type === 'regions' && decoded.regions[0]!.x, .25)
})
test('interactive region commands reject excessive count, missing or unknown fields, invalid geometry and coercion', () => {
  const region = { x: 0, y: 0, width: 40, height: 50 }
  for (const command of [
    { type: 'regions', regions: Array.from({ length: 25 }, () => region) }, { type: 'regions', regions: null }, { type: 'regions', regions: [], extra: true },
    ...[null, {}, { ...region, z: 0 }, { ...region, x: -1 }, { ...region, y: 4097 }, { ...region, width: 0 }, { ...region, height: -1 }, { ...region, height: 4097 }, { ...region, x: NaN }, { ...region, width: Infinity }, { ...region, width: '40' }].map(value => ({ type: 'regions', regions: [value] }))
  ]) assert.throws(() => decodeDesktopPetCommand(command), validation)
})
test('position retains fully visible negative-coordinate secondary display position', () => {
  const point = { x: -1500, y: -150 }
  assert.deepEqual(restoreDesktopPetPosition(point, { width: 240, height: 360 }, [primary, secondary], { x: 100, y: 100 }), point)
})
test('position restores disconnected display using a visible fallback point', () => {
  assert.deepEqual(restoreDesktopPetPosition({ x: -1500, y: -150 }, { width: 240, height: 360 }, [primary], { x: 300, y: 200 }), { x: 300, y: 200 })
})
test('position recovery without fallback chooses the nearest monitor and clamps whole window', () => {
  assert.deepEqual(restoreDesktopPetPosition({ x: -2000, y: 1200 }, { width: 240, height: 360 }, [primary, secondary]), { x: -1600, y: 440 })
})
test('increased pet scale repositions from the screen edge without losing its visible body', () => {
  const point = { x: 1650, y: 650 }
  assert.deepEqual(restoreDesktopPetPosition(point, { width: 240, height: 360 }, [primary]), point)
  assert.deepEqual(restoreDesktopPetPosition(point, { width: 360, height: 540 }, [primary]), { x: 1560, y: 500 })
})
test('fallback preserves negative monitor space, and initial placement stays inset', () => {
  assert.deepEqual(restoreDesktopPetPosition(null, { width: 240, height: 360 }, [primary, secondary], { x: -800, y: 100 }), { x: -800, y: 100 })
  assert.deepEqual(restoreDesktopPetPosition(null, { width: 240, height: 360 }, [primary]), { x: 1656, y: 656 })
})
test('a monitor that fits is chosen over a nearer work area too small for the pet', () => {
  assert.deepEqual(restoreDesktopPetPosition({ x: -100, y: 0 }, { width: 300, height: 400 }, [{ x: -100, y: 0, width: 100, height: 100 }, primary]), { x: 0, y: 0 })
})
test('oversized windows anchor top-left rather than producing inverted or non-finite clamps', () => {
  assert.deepEqual(restoreDesktopPetPosition({ x: 500, y: 500 }, { width: 800, height: 600 }, [{ x: -320, y: -200, width: 320, height: 200 }]), { x: -320, y: -200 })
})
test('position policy rejects invalid geometry and empty monitor lists', () => {
  for (const size of [{ width: 0, height: 10 }, { width: NaN, height: 10 }, { width: 10, height: Infinity }]) assert.throws(() => restoreDesktopPetPosition(null, size, [primary]), validation)
  assert.throws(() => restoreDesktopPetPosition(null, { width: 10, height: 10 }, []), validation)
  assert.throws(() => restoreDesktopPetPosition({ x: Infinity, y: 0 }, { width: 10, height: 10 }, [primary]), validation)
  assert.throws(() => restoreDesktopPetPosition(null, { width: 10, height: 10 }, [{ ...primary, width: -1 }]), validation)
})
test('missing preference file returns detached defaults without writing any file or directory', () => fixture(async root => {
  const directory = join(root, 'not-yet-created'), store = new DesktopPetPreferencesStore(directory)
  const first = await store.read(); first.preferences.scale = 1.5
  assert.deepEqual(await store.read(), saved())
  assert.deepEqual(await readdir(root), [])
}))
test('preferences round trip atomically only through userData desktop-pet.json', () => fixture(async root => {
  const store = new DesktopPetPreferencesStore(root), value = saved()
  value.enabled = true
  value.preferences.clickThrough = true; value.preferences.reminderMinutes = 25; value.position = { x: -900, y: -100 }
  await store.save(value)
  assert.deepEqual(await store.read(), value)
  assert.deepEqual(await readdir(root), ['desktop-pet.json'])
  assert.deepEqual(JSON.parse(await readFile(join(root, 'desktop-pet.json'), 'utf8')), value)
}))

test('legacy preferences default to disabled without rewriting appearance or position', () => fixture(async root => {
  const path = join(root, 'desktop-pet.json')
  const legacy = { preferences: { ...defaultDesktopPetPreferences, scale: 1.5, clickThrough: true }, position: { x: -900, y: 40 } }
  const original = JSON.stringify(legacy)
  await writeFile(path, original)
  const store = new DesktopPetPreferencesStore(root)
  assert.deepEqual(await store.read(), { ...legacy, enabled: false })
  assert.equal(await readFile(path, 'utf8'), original)
  await store.save({ ...legacy, enabled: true })
  assert.deepEqual(await new DesktopPetPreferencesStore(root).read(), { ...legacy, enabled: true })
}))

test('invalid enabled values preserve the original file and block writes', () => fixture(async root => {
  const path = join(root, 'desktop-pet.json')
  for (const enabled of ['true', 1, null]) {
    const original = JSON.stringify({ ...saved(), enabled })
    await writeFile(path, original)
    const store = new DesktopPetPreferencesStore(root)
    await assert.rejects(store.read(), storage)
    await assert.rejects(store.save(saved()), storage)
    assert.equal(await readFile(path, 'utf8'), original)
  }
}))
test('malformed JSON is preserved byte-for-byte and blocks later saves', () => fixture(async root => {
  const path = join(root, 'desktop-pet.json'), original = '{broken json not disposable'
  await writeFile(path, original)
  const store = new DesktopPetPreferencesStore(root)
  await assert.rejects(store.read(), storage); await assert.rejects(store.save(saved()), storage)
  assert.equal(await readFile(path, 'utf8'), original)
  assert.deepEqual(await readdir(root), ['desktop-pet.json'])
}))
test('malformed stored schema, unknown fields and invalid position remain evidence, not defaults', () => fixture(async root => {
  for (const value of [{ ...saved(), version: 1 }, { ...saved(), position: { x: 0, y: 0, z: 0 } }, { ...saved(), position: { x: 1.2, y: 0 } }, { ...saved(), preferences: { ...defaultDesktopPetPreferences, scale: 99 } }]) {
    const path = join(root, 'desktop-pet.json'), original = JSON.stringify(value)
    await writeFile(path, original)
    const store = new DesktopPetPreferencesStore(root)
    await assert.rejects(store.read(), storage); await assert.rejects(store.save(saved()), storage)
    assert.equal(await readFile(path, 'utf8'), original)
  }
}))
test('invalid runtime save is rejected before storage writes', () => fixture(async root => {
  const store = new DesktopPetPreferencesStore(root)
  await assert.rejects(store.save({ enabled: false, preferences: { ...defaultDesktopPetPreferences }, position: { x: NaN, y: 0 } }), validation)
  assert.deepEqual(await readdir(root), [])
}))
test('serialized saves snapshot their caller data and reads await the latest queued save', () => fixture(async root => {
  let active = 0, maxActive = 0
  const store = new DesktopPetPreferencesStore(root, async (path, text) => {
    active++; maxActive = Math.max(maxActive, active)
    try { await new Promise(resolve => setTimeout(resolve, 5)); await atomicWriteText(path, text) } finally { active-- }
  })
  const first = saved(), second = saved(); first.preferences.scale = 1.2; second.preferences.scale = 1.5
  const one = store.save(first), two = store.save(second), read = store.read()
  second.preferences.scale = 1
  await Promise.all([one, two])
  assert.equal((await read).preferences.scale, 1.5); assert.equal(maxActive, 1)
  assert.deepEqual(await readdir(root), ['desktop-pet.json'])
}))
test('write failure preserves previous file and cause, then the serialization queue recovers', () => fixture(async root => {
  const path = join(root, 'desktop-pet.json'), original = JSON.stringify(saved())
  await writeFile(path, original)
  const failure = Object.assign(new Error('private filesystem path'), { code: 'EACCES' }); let fail = true
  const store = new DesktopPetPreferencesStore(root, async (target, text) => { if (fail) throw failure; await atomicWriteText(target, text) })
  const value = saved(); value.preferences.scale = 1.4
  await assert.rejects(store.save(value), error => error instanceof AppError && error.code === 'STORAGE_ERROR' && error.cause === failure && !error.message.includes('private'))
  assert.equal(await readFile(path, 'utf8'), original)
  fail = false; await store.save(value)
  assert.deepEqual(await store.read(), value)
}))
test('preference path cannot be a directory junction leading outside userData', () => fixture(async root => {
  const directory = join(root, 'profile'), outside = join(root, 'outside')
  await mkdir(directory); await mkdir(outside); await writeFile(join(outside, 'evidence.txt'), 'keep')
  await symlink(outside, join(directory, 'desktop-pet.json'), 'junction')
  const store = new DesktopPetPreferencesStore(directory)
  await assert.rejects(store.read(), storage); await assert.rejects(store.save(saved()), storage)
  assert.equal(await readFile(join(outside, 'evidence.txt'), 'utf8'), 'keep')
}))
test('store rejects relative directory rather than writing into the working project', () => {
  assert.throws(() => new DesktopPetPreferencesStore('book'), validation)
})


test('pre-lock preferences migrate without enabling the pet or discarding the saved location', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pet-lock-migration-'))
  try {
    const legacy = {enabled:false,preferences:{scale:1.25,alwaysOnTop:true,clickThrough:false,reminderMinutes:25},position:{x:-900,y:40}}
    const file = join(root,'desktop-pet.json'), bytes = JSON.stringify(legacy)
    await writeFile(file,bytes)
    const store = new DesktopPetPreferencesStore(root), migrated = await store.read()
    assert.deepEqual(migrated,{...legacy,preferences:{...legacy.preferences,positionLocked:false}})
    assert.equal(await readFile(file,'utf8'),bytes,'read migration must not rewrite the original')
    migrated.preferences.positionLocked=true;await store.save(migrated)
    assert.deepEqual(await new DesktopPetPreferencesStore(root).read(),migrated)
    assert.throws(()=>decodeDesktopPetCommand({type:'configure',preferences:legacy.preferences}))
    assert.throws(()=>decodeDesktopPetCommand({type:'configure',preferences:{...migrated.preferences,positionLocked:'yes'}}))
  } finally { await rm(root,{recursive:true,force:true}) }
})
