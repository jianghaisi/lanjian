import assert from 'node:assert/strict'
import test from 'node:test'
import { chapterLifecycleCanTransition, chapterLifecycleStates } from '../../src/main/modules/manuscript/domain/chapter-lifecycle'
import { factBatchCanTransition, factBatchIsTerminal, factBatchStates } from '../../src/main/modules/review/domain/fact-batch-lifecycle'
import { taskRunCanTransition, taskRunIsTerminal, taskRunStates } from '../../src/main/modules/assistant/domain/task-run-lifecycle'

test('chapter lifecycle exhaustively rejects every shortcut outside the V2 transition map', () => {
  const allowed: Record<string, string[]> = {
    PLANNED: ['PLANNED', 'DRAFTING', 'ARCHIVED'],
    DRAFTING: ['DRAFTING', 'REVIEWABLE', 'REVISING', 'ARCHIVED'],
    REVIEWABLE: ['REVIEWABLE', 'CONFIRMED', 'REVISING', 'ARCHIVED'],
    CONFIRMED: ['CONFIRMED', 'REVISING', 'ARCHIVED'],
    REVISING: ['REVISING', 'PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED', 'ARCHIVED']
  }
  for (const current of chapterLifecycleStates.filter((state) => state !== 'ARCHIVED')) {
    for (const target of chapterLifecycleStates) {
      assert.equal(chapterLifecycleCanTransition({ status: current, archivedFrom: null }, target), allowed[current].includes(target), `${current} -> ${target}`)
    }
  }
  for (const archivedFrom of chapterLifecycleStates.filter((state) => state !== 'ARCHIVED')) {
    for (const target of chapterLifecycleStates) {
      assert.equal(chapterLifecycleCanTransition({ status: 'ARCHIVED', archivedFrom }, target), target === 'ARCHIVED' || target === archivedFrom, `ARCHIVED(${archivedFrom}) -> ${target}`)
    }
  }
})

test('task runs have immutable terminal history and resume through a child run', () => {
  const allowed: Record<string, string[]> = {
    queued: ['queued', 'preparing', 'running', 'paused', 'cancelled', 'failed', 'interrupted'],
    resuming: ['resuming', 'preparing', 'running', 'paused', 'cancelled', 'failed', 'interrupted'],
    preparing: ['preparing', 'running', 'paused', 'cancelled', 'failed', 'interrupted'],
    running: ['running', 'streaming', 'succeeded', 'paused', 'cancelled', 'failed', 'interrupted'],
    streaming: ['streaming', 'succeeded', 'paused', 'cancelled', 'failed', 'interrupted'],
    paused: ['paused', 'cancelled'],
    succeeded: ['succeeded'], cancelled: ['cancelled'], failed: ['failed'], interrupted: ['interrupted']
  }
  for (const current of taskRunStates) {
    for (const target of taskRunStates) assert.equal(taskRunCanTransition(current, target), allowed[current].includes(target), `${current} -> ${target}`)
  }
  assert.deepEqual(taskRunStates.filter(taskRunIsTerminal), ['succeeded', 'cancelled', 'failed', 'interrupted'])
})

test('fact review lifecycle keeps partial approval processable without reopening terminal batches', () => {
  const allowed: Record<string, string[]> = {
    PENDING: ['PENDING', 'IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'],
    IN_REVIEW: ['IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'],
    APPROVED: ['APPROVED'],
    PARTIALLY_APPROVED: ['PARTIALLY_APPROVED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'],
    REJECTED: ['REJECTED'], SUPERSEDED: ['SUPERSEDED'], STALE: ['STALE']
  }
  for (const current of factBatchStates) {
    for (const target of factBatchStates) assert.equal(factBatchCanTransition(current, target), allowed[current].includes(target), `${current} -> ${target}`)
  }
  assert.equal(factBatchIsTerminal('PARTIALLY_APPROVED'), false)
  assert.deepEqual(factBatchStates.filter(factBatchIsTerminal), ['APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'])
})

test('chapter confirmation, task success and fact approval remain separate state spaces', () => {
  assert.equal(chapterLifecycleStates.includes('CONFIRMED'), true)
  assert.equal(taskRunStates.includes('succeeded'), true)
  assert.equal(factBatchStates.includes('APPROVED'), true)
  assert.equal((taskRunStates as readonly string[]).includes('CONFIRMED'), false)
  assert.equal((factBatchStates as readonly string[]).includes('succeeded'), false)
  assert.equal((chapterLifecycleStates as readonly string[]).includes('APPROVED'), false)
})
