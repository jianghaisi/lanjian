import assert from 'node:assert/strict'
import test from 'node:test'
import { FactExtractionJobService } from '../../../src/main/modules/review/application/fact-extraction-job-service'

test('keeps one extraction job per chapter and exposes its completed review batch', async () => {
  const jobId = '11111111-1111-4111-8111-111111111111'
  let release: (() => void) | undefined
  const service = new FactExtractionJobService({ extract: async () => {
    await new Promise<void>((resolve) => { release = resolve })
    return { id: 'batch-1' } as never
  } }, undefined, () => new Date('2026-09-02T00:00:00.000Z'), () => jobId)
  const started = await service.start('book-a', 1)
  assert.equal(started.status, 'running')
  await assert.rejects(service.start('book-a', 1), (error: { code?: string }) => error.code === 'CONFLICT')
  release?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const finished = await service.status(jobId)
  assert.equal(finished.status, 'completed')
  assert.equal(finished.batch?.id, 'batch-1')
})

test('cancels an extraction job without accepting a late model result', async () => {
  let release: (() => void) | undefined
  const service = new FactExtractionJobService({ extract: async () => {
    await new Promise<void>((resolve) => { release = resolve })
    return { id: 'late-batch' } as never
  } }, undefined, () => new Date('2026-09-02T00:00:00.000Z'), () => '22222222-2222-4222-8222-222222222222')
  await service.start('book-a', 2)
  assert.equal((await service.cancel('22222222-2222-4222-8222-222222222222')).status, 'cancelled')
  release?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const state = await service.status('22222222-2222-4222-8222-222222222222')
  assert.equal(state.status, 'cancelled')
  assert.equal(state.batch, undefined)
})

test('persists extraction lifecycle and exposes an interrupted task after restart', async () => {
  const jobs = new Map<string, any>()
  const creates: Array<{ id: string; parentTaskId?: string }> = []
  const persistence = {
    initialize: async (workItemId: string) => {
      for (const job of jobs.values()) {
        if (job.workItemId === workItemId && job.status === 'running') {
          job.status = 'interrupted'
          job.completedAt = '2026-09-02T00:01:00.000Z'
          job.error = { code: 'APP_RESTARTED', message: '已中断' }
        }
      }
    },
    create: async ({ id, workItemId, chapterId, parentTaskId }: { id: string; workItemId: string; chapterId: number; parentTaskId?: string }) => {
      creates.push({ id, ...(parentTaskId ? { parentTaskId } : {}) })
      const parent = parentTaskId ? jobs.get(parentTaskId) : null
      const job = { id, workItemId, chapterId, status: 'running' as const, startedAt: '2026-09-02T00:00:00.000Z',
        attempt: parent ? (parent.attempt || 1) + 1 : 1, ...(parentTaskId ? { parentTaskId } : {}) }
      jobs.set(id, job)
      return structuredClone(job)
    },
    read: async (_workItemId: string, id: string) => structuredClone(jobs.get(id) ?? null),
    find: async (id: string) => structuredClone(jobs.get(id) ?? null),
    list: async (_workItemId: string, chapterId?: number) => [...jobs.values()]
      .filter((job) => chapterId === undefined || job.chapterId === chapterId)
      .map((job) => structuredClone(job)),
    transition: async ({ id, status, error }: any) => {
      const job = jobs.get(id)
      job.status = status
      job.completedAt = '2026-09-02T00:01:00.000Z'
      if (error) job.error = error
      return structuredClone(job)
    }
  }
  const id = '33333333-3333-4333-8333-333333333333'
  const initial = new FactExtractionJobService({ extract: async () => {
    await new Promise<void>(() => undefined)
    return null
  } }, persistence, () => new Date('2026-09-02T00:00:00.000Z'), () => id)
  await initial.start('book-a', 3)

  const restarted = new FactExtractionJobService({ extract: async () => null }, persistence)
  await restarted.start('book-a', 4)
  // Initializing the same project turns the abandoned active run into a visible
  // interrupted record; it must not be silently treated as completed.
  const recovered = await restarted.status(id)
  assert.equal(recovered.status, 'interrupted')
  assert.equal(recovered.error?.code, 'APP_RESTARTED')
  const operationId = '55555555-5555-4555-8555-555555555555'
  const [retried, replayed] = await Promise.all([restarted.retry(id, operationId), restarted.retry(id, operationId)])
  assert.equal(retried.chapterId, 3)
  assert.equal(replayed.id, retried.id)
  assert.equal(creates.at(-1)?.parentTaskId, id)
  assert.equal((await restarted.retry(id, operationId)).id, retried.id)
  assert.equal(creates.filter((entry) => entry.id === operationId).length, 1)
})

test('does not persist an untrusted extraction exception that contains a credential', async () => {
  const marker = 'LANJIAN-SECRET-EXTRACTION-DO-NOT-PERSIST'
  let state: any
  const persistence = {
    initialize: async () => undefined,
    create: async ({ id, workItemId, chapterId }: any) => (state = { id, workItemId, chapterId, status: 'running' as const, startedAt: '2026-09-02T00:00:00.000Z' }),
    read: async () => structuredClone(state),
    find: async () => structuredClone(state),
    list: async () => state ? [structuredClone(state)] : [],
    transition: async ({ status, error }: any) => (state = { ...state, status, ...(error ? { error } : {}), completedAt: '2026-09-02T00:01:00.000Z' })
  }
  const id = '44444444-4444-4444-8444-444444444444'
  const service = new FactExtractionJobService({ extract: async () => {
    throw new Error(`provider echoed Authorization: Bearer ${marker}`)
  } }, persistence, () => new Date('2026-09-02T00:00:00.000Z'), () => id)
  await service.start('book-a', 1)
  let failed = await service.status(id)
  for (let attempt = 0; attempt < 50 && failed.status === 'running'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
    failed = await service.status(id)
  }
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error?.message, '变化提炼未完成，请检查模型连接后重试。')
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(marker))
  assert.doesNotMatch(JSON.stringify(state), new RegExp(marker))
})
