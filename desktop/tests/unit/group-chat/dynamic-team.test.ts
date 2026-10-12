import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GroupChatService, type GroupChatPorts } from '../../../src/main/modules/group-chat/application/group-chat-service'
import { FileGroupSessionStore } from '../../../src/main/modules/group-chat/adapters/session-store'
import { captureGroupTeam, legacyGroupTeam, restoreGroupTeam } from '../../../src/main/modules/group-chat/domain/creative-team'
import { creativePolicyRun, type CreativePolicyRun } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { decodeGroupProfile } from '../../../src/contracts/group-chat/group-chat'
import { AppError } from '../../../src/contracts/core/app-error'
import { createGroupTools } from '../../../src/main/modules/group-chat/adapters/group-tools'
import { parseMentions } from '../../../src/main/modules/group-chat/domain/mention-parser'
import type { OfficialCreativeReference } from '@lanjian/writing-plugin-package/official'

const registry = JSON.parse(await readFile(new URL('../../../../packages/writing-plugin-package/official-history/releases.json', import.meta.url), 'utf8')) as { sets: OfficialCreativeReference[][] }
const originalReleased = registry.sets.find(set => set.some(ref => ref.pluginId === 'lanjian.official.creative-team' && ref.version === '1.0.0') && set.some(ref => ref.pluginId === 'lanjian.official.story-planning' && ref.version === '1.6.0'))
assert.ok(originalReleased, 'The actual complete original team release must remain registered')

const command = (view: { id: string; revision: number }) => ({ sessionId: view.id, expectedRevision: view.revision })
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-dynamic-team-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = new FileGroupSessionStore(root, 'author')
  const state = { authorized: true, withdrawBeforeAgentCommit: false, captures: [] as string[], requests: 0, policy: creativePolicyRun() as CreativePolicyRun }
  const capture = async () => creativePolicyRun()
  const ports: GroupChatPorts = {
    team: async () => captureGroupTeam(state.policy),
    defaults: async team => team.members.map(member => ({ memberId: member.id, profile: decodeGroupProfile({ connectionId: 'global-test', model: 'fixture', parameterPolicy: { version: 2, mode: 'auto' } }) })),
    capture: async (profile, task) => {
      state.captures.push(task)
      return { identity: createHash('sha256').update(JSON.stringify({ profile, task })).digest('hex'), model: { model: profile.model, connectionId: profile.connectionId, step: async () => { state.requests++; return { content: '仅核对讨论职责。', toolCalls: [] } } }, run: async operation => operation() }
    },
    assertScope: async session => {
      if (!state.authorized) throw new AppError('CONFLICT', '团队授权已撤销。', { recoverable: true })
      if (session.format === 2 && session.origin) await restoreGroupTeam(capture, session.origin, session.view.team)
    },
    inScope: async (_session, operation) => operation(), tools: (s, work) => createGroupTools(s, work),
  }
  const store = { list: () => files.list(), read: (id: string) => files.read(id), write: (session: Parameters<typeof files.write>[0], before?: () => Promise<void>) => files.write(session, async () => {
    if (state.withdrawBeforeAgentCommit && session.transcript.at(-1)?.role === 'agent') state.authorized = false
    await before?.()
  }) }
  return { root, files, state, ports, service: new GroupChatService('author', store, ports) }
}

test('original released team stays readable and missing original orchestration makes zero requests while the new discussion uses its actual task', async t => {
  const f = await fixture(t), current = creativePolicyRun().snapshot!()
  const original = { ...current, released: originalReleased }
  f.state.policy = creativePolicyRun([], original.composition, original.slotParams, original.released)
  const old = await f.service.create('原团队讨论')
  f.state.policy = creativePolicyRun()
  const fresh = await f.service.create('新团队讨论')
  assert.equal(old.team.members.find(member => member.id === 'reviewer')!.capabilities.includes('review.read'), false)
  assert.equal(fresh.team.members.find(member => member.id === 'reviewer')!.capabilities.includes('review.read'), true)
  const saved = await f.files.read(old.id)
  assert.deepEqual(saved.origin!.policy.released, original.released)
  const input = { ...command(old), operationId: randomUUID(), memberId: 'reviewer', message: '只核对职责。' }
  await f.service.send(input)
  await f.service.drain(old.id)
  assert.deepEqual(f.state.captures, [])
  assert.equal(f.state.requests, 0)
  assert.match((await f.service.get({ sessionId: old.id, limit: 100 })).notice, /编排方法.*新建讨论/u)
  await f.service.send(input)
  assert.equal(f.state.requests, 0)
  assert.deepEqual((await f.service.get({ sessionId: old.id, limit: 100 })).team, old.team)
  await f.service.send({ ...command(fresh), operationId: randomUUID(), memberId: 'reviewer', message: '只核对职责。' })
  await f.service.drain(fresh.id)
  assert.deepEqual(f.state.captures, ['review'])
})

test('tampered diagnostic team metadata or original source hash cannot restore authority', async t => {
  const f = await fixture(t), view = await f.service.create('元数据核验'), saved = await f.files.read(view.id), capture = async () => creativePolicyRun()
  const changed = structuredClone(saved.view.team); changed.members[0].capabilities.push('manuscript.candidate')
  await assert.rejects(restoreGroupTeam(capture, saved.origin!, changed), error => error instanceof AppError && error.code === 'CONFLICT')
  await assert.rejects(restoreGroupTeam(capture, { ...saved.origin!, teamHash: '0'.repeat(64) }, saved.view.team), error => error instanceof AppError && error.code === 'CONFLICT')
  assert.equal(f.state.requests, 0)
})

test('withdrawal at actual temporary-file commit publishes no late message through memory or storage', async t => {
  const f = await fixture(t), view = await f.service.create('实际提交撤权')
  f.state.withdrawBeforeAgentCommit = true
  await f.service.send({ ...command(view), operationId: randomUUID(), memberId: 'editor', message: '只核对职责。' })
  await f.service.drain(view.id)
  assert.equal(f.state.requests, 1)
  assert.equal((await f.service.get({ sessionId: view.id, limit: 100 })).messages.filter(message => message.role === 'agent').length, 0)
  const stored = await f.files.read(view.id)
  assert.equal(stored.transcript.filter(message => message.role === 'agent').length, 0)
  assert.equal(stored.intent, 'model')
})

test('format1 projects exact old metadata as readonly, retains matching receipts, and preserves original bytes', async t => {
  const f = await fixture(t), view = await f.service.create('原七人历史'), saved = await f.files.read(view.id)
  const { origin: _origin, ...raw } = saved, { team: _team, readOnly: _readOnly, ...oldView } = raw.view
  const operationId = randomUUID(), legacy = { ...raw, format: 1, view: oldView, operations: [{ id: operationId, message: '原操作', memberId: 'editor' }] }
  const path = join(f.root, 'group-chat', createHash('sha256').update('author').digest('hex'), view.id + '.json')
  await writeFile(path, JSON.stringify(legacy))
  const before = await readFile(path), restored = new GroupChatService('author', f.files, f.ports)
  const result = await restored.get({ sessionId: view.id, limit: 100 })
  assert.equal(result.readOnly, true); assert.deepEqual(result.team, legacyGroupTeam())
  assert.equal((await restored.send({ ...command(result), operationId, message: '原操作', memberId: 'editor' })).readOnly, true)
  await assert.rejects(restored.send({ ...command(result), operationId: randomUUID(), message: '新操作' }), error => error instanceof AppError && error.code === 'CONFLICT')
  await assert.rejects(restored.saveDraft({ ...command(result), draft: '新输入', position: { top: 0, atBottom: true } }))
  await assert.rejects(restored.stop(command(result)))
  await assert.rejects(restored.scope(view.id, async () => true))
  assert.deepEqual(await readFile(path), before); assert.equal(f.state.requests, 0)
})

test('unknown members and a prose member without a chapter approval contract send no model request', async t => {
  const f = await fixture(t), view = await f.service.create('成员与正文门禁')
  await assert.rejects(f.service.send({ ...command(view), operationId: randomUUID(), memberId: 'constructor', message: '只核对职责。' }))
  await f.service.send({ ...command(view), operationId: randomUUID(), memberId: 'writer', message: '核对正文任务入口。' })
  await f.service.drain(view.id)
  const result = await f.service.get({ sessionId: view.id, limit: 100 })
  assert.equal(result.status, 'failed'); assert.match(result.notice, /书稿|正文章契/)
  assert.equal(f.state.captures.length, 0); assert.equal(f.state.requests, 0)
})

test('ambiguous aliases reject while unique member identifiers select deterministically', () => {
  const patterns = new Map([['constructor', ['@协作', '@constructor']], ['prototype', ['@协作', '@prototype', '@constructor']]])
  assert.throws(() => parseMentions('@协作 核对职责', patterns, 'constructor'), error => error instanceof AppError && /多位成员|唯一/.test(error.message))
  assert.equal(parseMentions('@constructor 核对职责', patterns, 'prototype').targetCatId, 'constructor')
})
