import { readSite } from '../admin/site-store.ts'
import { randomUUID } from 'node:crypto'
import { integer, modelId, operation, record, uuid } from '@lanjian/hosted-contracts'
import { decodeWritingAgentArgs } from '../../../../desktop/src/contracts/assistant/ipc'
import type { WritingAgentRequest } from '../../../../desktop/src/contracts/index'
import { HostedDatabase, dbNumber, dbString } from '../storage/database.ts'
import { BookRuntimes, type BookRuntime } from '../writing/book-runtime.ts'
import { MeteredModels, type ModelScope } from '../models/metered-client.ts'
import { writingServices } from '../writing/services.ts'
import { publicValue } from '../writing/public-value.ts'
import { HostedError, fail } from '../http/errors.ts'
import { usageCost } from '../credits/ledger.ts'
import { assertTenantSpace } from '../files/quota.ts'

const kinds = ['writing', 'foundation', 'planning', 'skeleton', 'chapter-detail'] as const
type Kind = typeof kinds[number]
type JobInput = { operation: string; modelId: string; kind: Kind; request: Record<string, unknown> }
type Job = JobInput & { id: string; owner: string; bookId: string; modelRevision: number; priceVersion: number; status: string; coreTaskId: string | null; error: string | null; createdAt: number }
export type DesktopExecution = {
  response: unknown
  taskId?: string
  poll?: () => Promise<{ status: string; candidate: boolean }>
  stop?: () => Promise<unknown>
}
function decodeInput(input: unknown): JobInput {
  const p = record(input, ['operation', 'modelId', 'kind', 'request'])
  if (!kinds.includes(p.kind as Kind)) fail('invalid-request')
  const kind = p.kind as Kind
  let request: Record<string, unknown>
  if (kind === 'writing') {
    const raw = record(p.request)
    if (['model', 'modelConnectionId', 'maxTokensOverride', 'expectedWorkItemId'].some(key => key in raw)) fail('invalid-request')
    request = { ...decodeWritingAgentArgs([raw])[0] }
  } else if (kind === 'skeleton' || kind === 'chapter-detail') {
    const raw = record(p.request, kind === 'skeleton' ? ['proposalId'] : ['proposalId', 'volume'])
    request = { proposalId: uuid(raw.proposalId), ...(kind === 'chapter-detail' ? { volume: integer(raw.volume, 1, 100) } : {}) }
  } else { record(p.request, []); request = {} }
  return { operation: operation(p.operation), modelId: modelId(p.modelId), kind, request }
}
export class HostedJobs {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void>; response?: Promise<unknown>; stop?: () => Promise<unknown> }>()
  private readonly composed = new WeakMap<BookRuntime, ReturnType<typeof writingServices>>()
  private closing = false
  constructor(readonly db: HostedDatabase, readonly runtimes: BookRuntimes, readonly meter: MeteredModels) {}
  services(r: BookRuntime) {
    let value = this.composed.get(r)
    if (!value) { value = writingServices(r, this.meter.ai); this.composed.set(r, value) }
    return value
  }
  private read(owner: string, bookId: string, id: string): Job {
    this.runtimes.books.get(owner, bookId)
    const row = this.db.get('SELECT * FROM jobs WHERE id=? AND owner_id=? AND book_id=?', uuid(id), owner, bookId)
    if (!row) fail('not-found')
    return { id, owner, bookId, operation: '', modelId: dbString(row.model_id), modelRevision: dbNumber(row.model_revision), priceVersion: dbNumber(row.price_version),
      kind: dbString(row.kind) as Kind, request: JSON.parse(dbString(row.request_json)) as Record<string, unknown>, status: dbString(row.status),
      coreTaskId: row.core_task_id === null ? null : dbString(row.core_task_id), error: row.error_code === null ? null : dbString(row.error_code), createdAt: dbNumber(row.created_at) }
  }
  async view(owner: string, bookId: string, id: string): Promise<unknown> {
    const job = this.read(owner, bookId, id)
    const row = this.db.get('SELECT result_json FROM jobs WHERE id=?', id)
    return this.runtimes.run(owner, bookId, async r => {
      const task = job.coreTaskId && job.kind === 'writing' ? await this.services(r).tasks.status(job.coreTaskId) : null
      const result = row?.result_json ? JSON.parse(dbString(row.result_json)) as unknown : null
      const reservations = this.db.all('SELECT status,amount,charged FROM reservations WHERE user_id=? AND (id=(SELECT request_reservation FROM jobs WHERE id=?) OR id IN (SELECT reservation_id FROM attempts WHERE job_id=?))', owner, id, id)
      return { id, bookId, kind: job.kind, status: job.status, modelId: job.modelId, error: job.error, createdAt: job.createdAt,
        result: publicValue(result, r.root, bookId), task: publicValue(task, r.root, bookId),
        billing: { policy: this.meter.credits.price(job.modelId, job.priceVersion).policy,
          charged: reservations.reduce((sum, value) => sum + Number(value.charged ?? 0), 0),
          reserved: reservations.reduce((sum, value) => sum + (['reserved', 'sent', 'unknown'].includes(String(value.status)) ? Number(value.amount) : 0), 0),
          needsReconciliation: reservations.some(value => value.status === 'unknown') },
        usage: this.db.all('SELECT status,input_tokens AS inputTokens,output_tokens AS outputTokens FROM attempts WHERE job_id=? ORDER BY created_at', id) }
    })
  }
  list(owner: string, bookId: string) {
    this.runtimes.books.get(owner, bookId)
    return this.db.all('SELECT id,kind,status,model_id AS modelId,error_code AS error,created_at AS createdAt FROM jobs WHERE owner_id=? AND book_id=? ORDER BY created_at DESC LIMIT 50', owner, bookId)
  }
  /** Original core commands share the same durable admission and metered transport. */
  async desktop(owner: string, bookId: string, channel: string, args: unknown[], operationId: string,
    start: (r: BookRuntime, scope: ModelScope) => Promise<DesktopExecution>): Promise<unknown> {
    this.runtimes.books.get(owner, bookId)
    if (this.closing) fail('configuration-required')
    const receipt = this.db.operation(`desktop-job:${owner}:${bookId}:${channel}`, operation(operationId), args, () => {
      const model = this.meter.models.selected()
      if (!model) fail('configuration-required')
      const price = this.meter.credits.price(model.id)
      if (price.policy.mode === 'unconfigured') fail('pricing-required')
      if (dbNumber(this.db.get("SELECT (SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running'))+(SELECT COUNT(*) FROM group_model_jobs WHERE status='running') AS count")?.count) >= readSite(this.db).limits.concurrentJobs ||
        this.db.get("SELECT id FROM jobs WHERE owner_id=? AND status IN ('queued','running')", owner) || this.db.get("SELECT id FROM group_model_jobs WHERE owner_id=? AND status='running'", owner)) fail('request-limit')
      if (this.meter.credits.wallet(owner).available < usageCost(price.policy, 0, model.maxOutputTokens)) fail('insufficient-credits')
      const id = randomUUID(), now = this.db.now()
      this.db.run('INSERT INTO jobs(id,owner_id,book_id,model_id,model_revision,price_version,kind,status,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        id, owner, bookId, model.id, model.revision, price.version, `desktop:${channel}`, 'queued', JSON.stringify({ channel }), now, now)
      return { id }
    })
    const existing = this.active.get(receipt.id)
    if (existing?.response) return existing.response
    const saved = this.db.get('SELECT result_json,status FROM jobs WHERE id=?', receipt.id)
    if (saved?.result_json) return JSON.parse(dbString(saved.result_json))
    // A receipt without a response after interruption must never redispatch.
    if (saved?.status !== 'queued') fail('conflict')
    const job = this.read(owner, bookId, receipt.id), controller = new AbortController()
    let resolve!: (value: unknown) => void, reject!: (error: unknown) => void
    const response = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
    const state = { controller, response, done: Promise.resolve(), stop: undefined as (() => Promise<unknown>) | undefined }
    this.active.set(job.id, state)
    state.done = Promise.resolve().then(async () => {
      let scope: ModelScope | undefined, candidate = false, status = 'failed', error: string | null = null
      const timer = setTimeout(() => { void this.cancel(owner, bookId, job.id).catch(() => controller.abort()) }, 10 * 60_000)
      try {
        scope = this.meter.createScope(job.id, owner, bookId, job.modelId, job.modelRevision, job.priceVersion, controller)
        this.db.run("UPDATE jobs SET status='running',updated_at=? WHERE id=?", this.db.now(), job.id)
        await this.meter.run(scope, () => this.runtimes.run(owner, bookId, async r => {
          const execution = await start(r, scope!)
          state.stop = execution.stop
          this.db.run('UPDATE jobs SET result_json=?,core_task_id=?,updated_at=? WHERE id=?', JSON.stringify(execution.response), execution.taskId ?? null, this.db.now(), job.id)
          resolve(execution.response)
          if (!execution.poll) { candidate = true; status = 'succeeded'; return }
          for (;;) {
            if (controller.signal.aborted) { await execution.stop?.(); status = 'cancelled'; return }
            const current = await execution.poll()
            if (!['queued', 'preparing', 'running', 'streaming', 'resuming', 'stopping'].includes(current.status)) {
              candidate = current.candidate
              status = ['failed', 'interrupted'].includes(current.status) ? 'failed' : current.status === 'cancelled' ? 'cancelled' : 'succeeded'
              if (status === 'failed') error = scope!.unknown ? 'usage-unconfirmed' : 'model-failed'
              return
            }
            await new Promise<void>(done => setTimeout(done, 100))
          }
        }))
      } catch (cause) {
        reject(cause); status = controller.signal.aborted ? 'cancelled' : 'failed'
        error = cause instanceof HostedError ? cause.code : scope?.unknown ? 'usage-unconfirmed' : 'model-failed'
      } finally {
        clearTimeout(timer)
        try {
          if (scope) { controller.abort(); await this.meter.finish(scope, candidate) }
          this.db.run('UPDATE jobs SET status=?,error_code=?,updated_at=? WHERE id=?', status, error, this.db.now(), job.id)
        } catch { this.db.run("UPDATE jobs SET status='interrupted',error_code='usage-unconfirmed',updated_at=? WHERE id=?", this.db.now(), job.id) }
        this.active.delete(job.id)
      }
    })
    void state.done.catch(reject)
    return response
  }
  async start(owner: string, bookId: string, input: unknown): Promise<unknown> {
    const payload = decodeInput(input)
    this.runtimes.books.get(owner, bookId)
    if (this.closing) fail('configuration-required')
    if (this.meter.models.selected()?.id !== payload.modelId) fail('configuration-required')
    const receipt = this.db.operation(`job:${owner}:${bookId}`, payload.operation, { kind: payload.kind, request: payload.request, modelId: payload.modelId }, () => {
      const model = this.meter.models.privateConfiguration(payload.modelId), price = this.meter.credits.price(model.id)
      if (price.policy.mode === 'unconfigured') fail('pricing-required')
      if (dbNumber(this.db.get("SELECT (SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running'))+(SELECT COUNT(*) FROM group_model_jobs WHERE status='running') AS count")?.count) >= readSite(this.db).limits.concurrentJobs ||
        this.db.get("SELECT id FROM jobs WHERE owner_id=? AND status IN ('queued','running')", owner) || this.db.get("SELECT id FROM group_model_jobs WHERE owner_id=? AND status='running'", owner)) fail('request-limit')
      const minimum = usageCost(price.policy, 0, model.maxOutputTokens)
      if (this.meter.credits.wallet(owner).available < minimum) fail('insufficient-credits')
      const id = randomUUID(), now = this.db.now()
      this.db.run('INSERT INTO jobs(id,owner_id,book_id,model_id,model_revision,price_version,kind,status,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?,?,?)',
        id, owner, bookId, model.id, model.revision, price.version, payload.kind, 'queued', JSON.stringify(payload.request), now, now)
      return { id }
    })
    const job = this.read(owner, bookId, receipt.id)
    if (job.status === 'queued' && !this.active.has(job.id)) {
      const controller = new AbortController()
      const done = Promise.resolve().then(() => this.execute(job, controller)).finally(() => this.active.delete(job.id))
      this.active.set(job.id, { controller, done })
      void done.catch(() => undefined)
    }
    return { id: job.id, bookId, status: job.status }
  }
  private async execute(job: Job, controller: AbortController): Promise<void> {
    let scope: ModelScope | undefined, hasCandidate = false
    let finishStatus = 'failed', errorCode: string | null = null
    const timer = setTimeout(() => { void this.cancel(job.owner, job.bookId, job.id).catch(() => controller.abort()) }, 10 * 60 * 1000)
    try {
      scope = this.meter.createScope(job.id, job.owner, job.bookId, job.modelId, job.modelRevision, job.priceVersion, controller)
      this.db.run("UPDATE jobs SET status='running',updated_at=? WHERE id=?", this.db.now(), job.id)
      await this.meter.run(scope, () => this.runtimes.run(job.owner, job.bookId, async r => {
        // Keep headroom for context packages, partials and durable candidate writes.
        await assertTenantSpace(this.db.root, job.owner, job.bookId, 8 * 1024 * 1024, readSite(this.db).limits)
        const services = this.services(r)
        if (job.kind === 'writing') {
          controller.signal.throwIfAborted()
          const request = { ...job.request, expectedWorkItemId: r.root } as WritingAgentRequest
          const task = await services.tasks.start({ operationId: job.id, request })
          job.coreTaskId = task.id
          this.db.run('UPDATE jobs SET core_task_id=? WHERE id=?', task.id, job.id)
          for (;;) {
            if (controller.signal.aborted) await services.tasks.cancel(task.id)
            const current = await services.tasks.status(task.id)
            if (!['queued', 'preparing', 'running', 'streaming', 'resuming'].includes(current.status)) {
              hasCandidate = Boolean(current.artifact || current.partial?.content)
              finishStatus = current.status === 'succeeded' ? 'succeeded' : current.status === 'cancelled' ? 'cancelled' : 'failed'
              if (finishStatus === 'failed') errorCode = scope?.unknown ? 'usage-unconfirmed' : 'model-failed'
              return
            }
            await new Promise<void>(resolve => setTimeout(resolve, 100))
          }
        }
        let result: unknown
        if (job.kind === 'foundation') result = await services.foundation.generate()
        else if (job.kind === 'planning') result = await services.packages.save(await services.planning.generate(r.root, controller.signal))
        else if (job.kind === 'skeleton') result = await services.skeletons.generate(String(job.request.proposalId), controller.signal)
        else result = await services.details.generate(String(job.request.proposalId), Number(job.request.volume), controller.signal)
        controller.signal.throwIfAborted()
        this.db.run('UPDATE jobs SET result_json=?,updated_at=? WHERE id=?', JSON.stringify(result), this.db.now(), job.id)
        hasCandidate = true; finishStatus = 'succeeded'
      }))
    } catch (error) {
      finishStatus = controller.signal.aborted ? 'cancelled' : 'failed'
      errorCode = error instanceof HostedError ? error.code : scope?.unknown ? 'usage-unconfirmed' : 'model-failed'
    } finally {
      clearTimeout(timer)
      try {
        if (scope) { controller.abort(); await this.meter.finish(scope, hasCandidate) }
        this.db.run('UPDATE jobs SET status=?,error_code=?,updated_at=? WHERE id=?', finishStatus, errorCode, this.db.now(), job.id)
      } catch {
        // Persisted sent/unknown reservations remain recoverable; never fabricate settlement.
        this.db.run("UPDATE jobs SET status='interrupted',error_code='usage-unconfirmed',updated_at=? WHERE id=?", this.db.now(), job.id)
      }
    }
  }
  async cancel(owner: string, bookId: string, id: string): Promise<unknown> {
    const job = this.read(owner, bookId, id)
    // Abort the owning core task first; otherwise it can observe the transport
    // abort as an independent provider failure before its own stop signal exists.
    const active = this.active.get(id)
    if (active?.stop) await active.stop()
    else if (job.coreTaskId && job.kind === 'writing') await this.runtimes.run(owner, bookId, r => this.services(r).tasks.cancel(job.coreTaskId!))
    this.active.get(id)?.controller.abort()
    return { id, stopping: this.active.has(id) }
  }
  async settleForTest(id: string) { await this.active.get(id)?.done }
  recoverAfterRestart() {
    this.db.run("UPDATE jobs SET status='interrupted',error_code='usage-unconfirmed',updated_at=? WHERE status IN ('queued','running')", this.db.now())
    this.db.run("UPDATE attempts SET status='unknown' WHERE status='sent'")
    this.db.run("UPDATE group_model_jobs SET status='interrupted',updated_at=? WHERE status='running'", this.db.now())
    this.db.run("UPDATE group_model_attempts SET status='unknown' WHERE status='sent'")
  }
  async close() {
    this.closing = true
    await Promise.allSettled([...this.active.entries()].map(async ([id, value]) => {
      const row = this.db.get('SELECT owner_id,book_id FROM jobs WHERE id=?', id)
      try { if (row) await this.cancel(dbString(row.owner_id), dbString(row.book_id), id) }
      finally { value.controller.abort() }
    }))
    await Promise.allSettled([...this.active.values()].map(value => value.done))
  }
}
