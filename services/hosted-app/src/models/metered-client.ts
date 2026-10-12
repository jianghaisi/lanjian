import { readSite } from '../admin/site-store.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { record, type PriceView } from '@lanjian/hosted-contracts'
import { AiClient } from '../../../../desktop/src/main/modules/models/application/ai-client'
import type { ModelSettingsResolver } from '../../../../desktop/src/main/modules/models/domain/model-provider'
import { geminiEndpoint } from '../../../../desktop/src/main/modules/models/adapters/gemini-native-text-client'
import { HostedDatabase, dbNumber } from '../storage/database.ts'
import { CreditLedger, usageCost, usageBudget } from '../credits/ledger.ts'
import { ModelStore } from './model-store.ts'
import { UsageStream, decodeUsage, type ModelUsage } from './usage.ts'
import { fail } from '../http/errors.ts'
import { assertTenantSpace } from '../files/quota.ts'
import type { ModelProfile } from '../../../../desktop/src/contracts/models/types'

export interface ModelScope {
  jobId: string; owner: string; bookId: string | null; preparationId?: string; model: ReturnType<ModelStore['privateConfiguration']>; price: PriceView
  controller: AbortController; started: number; calls: number; unknown: boolean; requestReservation?: string
  pending: Set<Promise<void>>
}
export class MeteredModels {
  private readonly context = new AsyncLocalStorage<ModelScope>()
  readonly ai: AiClient
  constructor(readonly db: HostedDatabase, readonly models: ModelStore, readonly credits: CreditLedger, readonly fetcher: typeof fetch = fetch) {
    const connection = () => {
      const s = this.current(); this.check(s)
      return { kind: s.model.protocol, connectionId: s.model.id, connectionName: s.model.name, baseUrl: s.model.baseUrl, apiKey: s.model.apiKey,
        profile: { connectionId: s.model.id, model: s.model.model, maxTokens: s.model.maxOutputTokens, temperature: 0.7, topP: 0.95 },
        requestGuard: { recheck: async () => this.check(s), assertActive: () => this.check(s) } }
    }
    const resolver: ModelSettingsResolver = {
      resolve: async (_task, id) => { const c = connection(); if (id !== undefined && ![c.connectionId, `global:global-hosted-${c.connectionId}`].includes(id)) fail('conflict'); return c },
      resolveConnection: async id => { const c = connection(); if (![c.connectionId, `global:global-hosted-${c.connectionId}`].includes(id)) fail('conflict'); return c }
    }
    this.ai = new AiClient(resolver, undefined, undefined, this.transport)
  }
  current(): ModelScope { const current = this.context.getStore(); if (!current) fail('configuration-required'); return current }
  run<T>(scope: ModelScope, work: () => Promise<T>): Promise<T> { return this.context.run(scope, work) }
  createScope(jobId: string, owner: string, bookId: string | null, modelId: string, expectedModelRevision: number, priceVersion: number, controller: AbortController, preparationId?: string): ModelScope {
    const model = this.models.privateConfiguration(modelId), price = this.credits.price(modelId)
    if (model.revision !== expectedModelRevision || price.version !== priceVersion) fail('conflict')
    if (price.policy.mode === 'unconfigured') fail('pricing-required')
    if (!bookId && !preparationId) fail('not-found')
    const scope: ModelScope = { jobId, owner, bookId, ...(preparationId ? { preparationId } : {}), model, price, controller, started: this.db.now(), calls: 0, unknown: false, pending: new Set() }
    if (price.policy.mode === 'request') {
      const reservation = this.credits.reserve(owner, `task_${jobId}`, model.id, price.policy.points, price.version)
      if (reservation.status !== 'reserved') fail('conflict')
      scope.requestReservation = reservation.id
      this.db.run(`UPDATE ${preparationId ? 'group_model_jobs' : 'jobs'} SET request_reservation=? WHERE id=?`, reservation.id, jobId)
    }
    return scope
  }
  /** Private member override; endpoint/key and metering remain operator-owned. */
  groupConnection(profile: ModelProfile) {
    const s = this.current(); this.check(s)
    if (!s.preparationId || profile.connectionId !== `global-hosted-${s.model.id}` || profile.model !== s.model.model || profile.maxTokens !== undefined && profile.maxTokens > s.model.maxOutputTokens) fail('conflict')
    return { kind: s.model.protocol, connectionId: profile.connectionId, connectionName: s.model.name, baseUrl: s.model.baseUrl, apiKey: s.model.apiKey,
      profile: structuredClone(profile), requestGuard: { recheck: async () => this.check(s), assertActive: () => this.check(s) } }
  }
  private check(s: ModelScope) {
    s.controller.signal.throwIfAborted()
    if (s.unknown) fail('usage-unconfirmed')
    if (this.db.now() - s.started > 10 * 60 * 1000) fail('request-limit')
    if (this.db.get('SELECT disabled FROM users WHERE id=?', s.owner)?.disabled !== 0) fail('account-disabled')
    if (s.preparationId && !this.db.get('SELECT id FROM group_model_jobs WHERE id=? AND owner_id=? AND session_id=?', s.jobId, s.owner, s.preparationId)) fail('not-found')
    if (s.bookId && !this.db.get('SELECT id FROM books WHERE id=? AND owner_id=?', s.bookId, s.owner)) fail('not-found')
    const current = this.models.get(s.model.id)
    if (!current.enabled || current.revision !== s.model.revision) fail('conflict')
  }
  private transport: typeof fetch = async (url, init = {}) => {
    const s = this.current(); this.check(s)
    const attempts = s.preparationId ? 'group_model_attempts' : 'attempts'
    // Hosted paths never expose a free arbitrary model probe or catalog proxy.
    if (init.method !== 'POST' || typeof init.body !== 'string') fail('invalid-request')
    const payload = record(JSON.parse(init.body)), endpoint = new URL(String(url))
    const openAi = s.model.protocol === 'openai-compatible'
    if (openAi) {
      if (endpoint.href !== `${s.model.baseUrl}/chat/completions` || payload.model !== s.model.model) fail('conflict')
      if (payload.stream === true) payload.stream_options = { include_usage: true }
      const key = 'max_completion_tokens' in payload ? 'max_completion_tokens' : 'max_tokens'
      const requested = payload[key]
      payload[key] = typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, s.model.maxOutputTokens) : s.model.maxOutputTokens
    } else {
      const valid = ['generateContent', 'streamGenerateContent?alt=sse'].map(action => geminiEndpoint(s.model.baseUrl, `/v1beta/models/${encodeURIComponent(s.model.model)}:${action}`))
      if (!valid.includes(endpoint.href)) fail('conflict')
      const generation = record(payload.generationConfig ?? {}), requested = generation.maxOutputTokens
      payload.generationConfig = { ...generation, maxOutputTokens: typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, s.model.maxOutputTokens) : s.model.maxOutputTokens }
    }
    const body = JSON.stringify(payload)
    // A conservative byte ceiling leaves ample room for provider tokenization overhead.
    if (Buffer.byteLength(body, 'utf8') > s.model.maxInputTokens || s.calls >= 12) fail('request-limit')
    // Before every call, including review/tool iterations, leave room to persist results.
    await assertTenantSpace(this.db.root, s.owner, s.bookId, 8 * 1024 * 1024, readSite(this.db).limits)
    // No await between the shared daily-cap check and insertion: concurrent books
    // must not both consume the final available attempt after their disk scans.
    if (dbNumber(this.db.get('SELECT (SELECT COUNT(*) FROM attempts WHERE created_at>?) + (SELECT COUNT(*) FROM group_model_attempts WHERE created_at>?) AS count', this.db.now() - 86400000, this.db.now() - 86400000)?.count) >= readSite(this.db).limits.dailyAttempts) fail('request-limit')
    const attempt = randomUUID()
    // Reserve against this request's conservative byte bound, not the unused
    // maximum context window. Otherwise short prompts consume a full-book hold.
    const inputBudget = Math.min(s.model.maxInputTokens, Buffer.byteLength(body, 'utf8') + 1024)
    const reservation = s.price.policy.mode === 'tokens' || s.price.policy.mode === 'provider-tokens'
      ? this.credits.reserve(s.owner, `call_${attempt}`, s.model.id, usageBudget(s.price.policy, inputBudget, s.model.maxOutputTokens), s.price.version)
      : null
    this.db.run(`INSERT INTO ${attempts} VALUES(?,?,?, ?,NULL,NULL,?)`, attempt, s.jobId, reservation?.id ?? null, 'prepared', this.db.now())
    // Nothing can await between final authority checks, sent evidence and fetch dispatch.
    try { this.check(s); init.signal?.throwIfAborted() }
    catch (error) { if (reservation) this.credits.release(reservation.id); this.db.run(`UPDATE ${attempts} SET status='not-sent' WHERE id=?`, attempt); throw error }
    if (reservation) this.credits.markSent(reservation.id)
    if (s.requestReservation && this.credits.get(s.requestReservation).status === 'reserved') this.credits.markSent(s.requestReservation)
    this.db.run(`UPDATE ${attempts} SET status='sent' WHERE id=?`, attempt); s.calls++
    let finished = false
    const finish = (usage: ModelUsage | null, received: boolean) => {
      if (finished) return
      finished = true
      let known = received && (s.price.policy.mode === 'request' || Boolean(usage))
      if (reservation) {
        if (known && usage) {
          let amount: number | null = null
          // Unsupported or out-of-range provider accounting must retain the
          // reservation for reconciliation, never strand a sent attempt.
          try { amount = usageCost(s.price.policy, usage.input, usage.output, usage) } catch { known = false }
          if (amount !== null && amount <= reservation.amount) this.credits.settle(reservation.id, amount)
          else known = false
        }
        if (!known) this.credits.markUnknown(reservation.id)
      }
      this.db.run(`UPDATE ${attempts} SET status=?,input_tokens=?,output_tokens=? WHERE id=?`, known ? 'known' : 'unknown', usage?.input ?? null, usage?.output ?? null, attempt)
      this.db.audit('system', 'model-usage', attempt, { modelId: s.model.id, modelRevision: s.model.revision, priceVersion: s.price.version, usage, known })
      if (!known) s.unknown = true
    }
    try {
      const signal = AbortSignal.any([s.controller.signal, ...(init.signal ? [init.signal] : []), AbortSignal.timeout(180000)])
      const response = await this.fetcher(endpoint, { ...init, body, signal, redirect: 'error' })
      if (!response.ok || !response.body) { await response.body?.cancel(); finish(null, false); fail('model-failed') }
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        const chunks: Uint8Array[] = [], reader = response.body.getReader(); let size = 0
        try {
          for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4 * 1024 * 1024) { await reader.cancel(); fail('request-too-large') } chunks.push(part.value) }
        } finally { reader.releaseLock() }
        const bytes = Buffer.concat(chunks), value: unknown = JSON.parse(bytes.toString('utf8'))
        finish(decodeUsage(value, s.model.protocol), true)
        return new Response(bytes, { headers: { 'content-type': 'application/json' } })
      }
      const reader = response.body.getReader(), usage = new UsageStream(s.model.protocol)
      let size = 0, outputClosed = false
      const stream = new ReadableStream<Uint8Array>({
        start: controller => {
          const pump = (async () => {
            try {
              for (;;) {
                const part = await reader.read()
                if (part.done) {
                  usage.push(new Uint8Array(), true)
                  if (openAi && !usage.done) fail('model-failed')
                  finish(usage.usage, true); break
                }
                size += part.value.byteLength
                if (size > 4 * 1024 * 1024) fail('request-too-large')
                usage.push(part.value)
                if (usage.done) finish(usage.usage, true)
                if (!outputClosed) controller.enqueue(part.value)
                if (usage.done) { await reader.cancel(); break }
              }
              if (!outputClosed) { outputClosed = true; controller.close() }
            } catch {
              finish(null, false)
              if (!outputClosed) { outputClosed = true; controller.error(new Error('Model stream interrupted.')) }
              await reader.cancel().catch(() => undefined)
            } finally { reader.releaseLock() }
          })()
          s.pending.add(pump); void pump.finally(() => s.pending.delete(pump)).catch(() => undefined)
        },
        async cancel() { outputClosed = true; await reader.cancel(); finish(null, false) }
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    } catch { finish(null, false); fail(s.unknown ? 'usage-unconfirmed' : 'model-failed') }
  }
  async finish(scope: ModelScope, hasCandidate: boolean): Promise<void> {
    await Promise.allSettled([...scope.pending])
    if (!scope.requestReservation) return
    const r = this.credits.get(scope.requestReservation)
    if (r.status === 'reserved') this.credits.release(r.id)
    else if (r.status === 'sent') {
      if (hasCandidate) this.credits.settle(r.id, r.amount)
      else if (scope.unknown) this.credits.markUnknown(r.id)
      else this.credits.settle(r.id, 0)
    }
  }
}
