import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import type { PluginAuthoringApi, PluginDraft } from '../../../src/contracts/writing-plugins/authoring'

// This renderer module registers a beforeunload listener; each Node test file
// owns an isolated process and supplies only that browser event surface.
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
const { acceptDraftMerge, draftDirty, draftSession, saveDraftSession } = await import('../../../src/renderer/features/writing-plugins/draft-session')
const draft = (): PluginDraft => ({ id: randomUUID(), pluginId: `personal.${randomUUID()}`, revision: 1, updatedAt: '2026-10-01T00:00:00.000Z', upstream: null, manifestText: 'original', files: [{ path: 'main.js', content: 'original source' }] })

test('a clean mounted session adopts a newer tool edit, ignoring older or same revision snapshots', () => {
  const original = draft(), session = draftSession(original)
  const next = { ...original, revision: 2, manifestText: 'model edit' }
  assert.equal(draftSession(next), session); assert.equal(session.draft.manifestText, 'model edit')
  draftSession(original); draftSession({ ...next, manifestText: 'different same revision' })
  assert.equal(session.draft.manifestText, 'model edit'); assert.equal(draftDirty(session), false)
})

test('dirty input, IME and saves cannot be overwritten by refresh; explicit merge retains input and uses CAS', async () => {
  const original = draft(), session = draftSession(original), next = { ...original, revision: 2, manifestText: 'tool edit' }
  session.composing = true; draftSession(next); assert.equal(session.draft.revision, 1)
  assert.throws(() => acceptDraftMerge(session, next)); session.composing = false
  session.saving = true; draftSession(next); assert.equal(session.draft.revision, 1)
  assert.throws(() => acceptDraftMerge(session, next)); session.saving = false
  session.draft.manifestText = 'author merged edit'; session.draft.files[0].content = 'author source'
  draftSession(next); assert.equal(session.draft.manifestText, 'author merged edit'); assert.equal(session.draft.revision, 1)
  assert.throws(() => acceptDraftMerge(session, { ...next, id: randomUUID() }))
  assert.throws(() => acceptDraftMerge(session, { ...next, pluginId: 'personal.other' }))
  acceptDraftMerge(session, next)
  assert.equal(session.draft.manifestText, 'author merged edit'); assert.equal(session.draft.files[0].content, 'author source')
  assert.equal(session.draft.revision, 2); assert.equal(draftDirty(session), true)
  const api = { saveDraft: async (input: Parameters<PluginAuthoringApi['saveDraft']>[0]) => {
    assert.equal(input.revision, 2); assert.equal(input.manifestText, 'author merged edit')
    return { ...session.draft, ...input, revision: 3 }
  } } as PluginAuthoringApi
  await saveDraftSession(session, api); assert.equal(session.draft.revision, 3); assert.equal(draftDirty(session), false)
  assert.throws(() => acceptDraftMerge(session, next))
})

test('one save lane preserves newer keystrokes and a concurrent external conflict never marks them saved', async () => {
  const session = draftSession(draft()); session.draft.manifestText = 'first'
  let release!: () => void, started!: () => void
  const waiting = new Promise<void>(r => { release = r }), begun = new Promise<void>(r => { started = r })
  let count = 0
  const api = { saveDraft: async (input: Parameters<PluginAuthoringApi['saveDraft']>[0]) => {
    count++; started(); if (count === 1) await waiting
    else throw { code: 'CONFLICT', message: '草稿已被其他操作更新。' }
    return { ...session.draft, ...input, revision: input.revision + 1 }
  } } as PluginAuthoringApi
  const first = saveDraftSession(session, api); await begun
  session.draft.manifestText = 'newer author input'
  assert.equal(saveDraftSession(session, api), first)
  draftSession({ ...session.draft, revision: 5, manifestText: 'external while saving' })
  assert.equal(session.draft.manifestText, 'newer author input')
  release(); await assert.rejects(first)
  assert.equal(count, 2); assert.equal(session.draft.revision, 2)
  assert.equal(session.draft.manifestText, 'newer author input'); assert.equal(draftDirty(session), true)
  assert.match(session.error, /其他操作/)
})

test('IME keeps exact incomplete manifest and source locally until the editor releases input', async () => {
  const session = draftSession(draft()), submitted: unknown[] = []
  const manifestText = '{\n  "中文": "未完成 🌙  ', source = '\n// 未结束输入\nconst  '
  session.composing = true; session.draft.manifestText = manifestText; session.draft.files[0].content = source
  const api = { saveDraft: async (input: Parameters<PluginAuthoringApi['saveDraft']>[0]) => {
    submitted.push(input); return { ...session.draft, ...input, revision: input.revision + 1 }
  } } as PluginAuthoringApi
  await saveDraftSession(session, api)
  assert.equal(submitted.length, 0); assert.equal(draftDirty(session), true); assert.equal(session.saving, false)
  session.composing = false
  await saveDraftSession(session, api)
  assert.deepEqual(submitted, [{ id: session.draft.id, revision: 1, manifestText, files: [{ path: 'main.js', content: source }] }])
  assert.equal(session.draft.revision, 2); assert.equal(draftDirty(session), false)
})

test('an older save receipt cannot consume later IME text; leaving input resumes from its acknowledged revision', async () => {
  const session = draftSession(draft()), submitted: Parameters<PluginAuthoringApi['saveDraft']>[0][] = []
  let release!: () => void
  const waiting = new Promise<void>(r => { release = r })
  const api = { saveDraft: async (input: Parameters<PluginAuthoringApi['saveDraft']>[0]) => {
    submitted.push(input); if (submitted.length === 1) await waiting
    return { ...session.draft, ...input, revision: input.revision + 1 }
  } } as PluginAuthoringApi
  session.draft.manifestText = 'before IME'
  const first = saveDraftSession(session, api)
  session.composing = true; session.draft.manifestText = '中文输入中'; session.draft.files[0].content = '最后一段原文'
  release(); await first
  assert.equal(submitted.length, 1); assert.equal(session.draft.manifestText, '中文输入中')
  assert.equal(session.draft.files[0].content, '最后一段原文'); assert.equal(draftDirty(session), true)
  session.composing = false; await saveDraftSession(session, api)
  assert.equal(submitted[1].revision, 2); assert.equal(submitted[1].manifestText, '中文输入中')
  assert.equal(submitted[1].files[0].content, '最后一段原文'); assert.equal(draftDirty(session), false)
})

test('a failed departure save remains recoverable in its own draft while another draft saves', async () => {
  const original = draft(), session = draftSession(original), other = draftSession(draft())
  session.draft.manifestText = '离页前原文'; session.draft.files[0].content = '未完成源码  '
  other.draft.manifestText = '另一份草稿'
  let reject!: (reason: unknown) => void
  const waiting = new Promise<PluginDraft>((_, r) => { reject = r })
  const api = { saveDraft: async (input: Parameters<PluginAuthoringApi['saveDraft']>[0]) => {
    if (input.id === original.id) return waiting
    return { ...other.draft, ...input, revision: input.revision + 1 }
  } } as PluginAuthoringApi
  const leaving = saveDraftSession(session, api)
  await saveDraftSession(other, api)
  assert.equal(draftDirty(other), false); assert.equal(session.saving, true)
  reject({ code: 'STORAGE', message: '草稿保存暂时失败。' }); await assert.rejects(leaving)
  assert.equal(draftSession(original), session); assert.equal(session.draft.manifestText, '离页前原文')
  assert.equal(session.draft.files[0].content, '未完成源码  '); assert.equal(draftDirty(session), true)
  assert.equal(session.saving, false); assert.equal(session.composing, false); assert.match(session.error, /保存暂时失败/)
  await saveDraftSession(session, { saveDraft: async input => ({ ...session.draft, ...input, revision: input.revision + 1 }) } as PluginAuthoringApi)
  assert.equal(draftDirty(session), false); assert.equal(session.error, ''); assert.equal(other.draft.manifestText, '另一份草稿')
})
