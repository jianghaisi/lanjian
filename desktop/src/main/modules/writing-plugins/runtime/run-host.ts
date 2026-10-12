import { assertJson, codePluginLimits, pluginLimits } from '@lanjian/writing-plugin-contracts'
import { defaultGuestPolicy, validateGuestInvocation, validateGuestPolicy, type GuestBroker, type GuestInvocation, type GuestPolicy, type GuestResult, type GuestRunner } from '../domain/guest'
import { decodeGuestEvent, encodeGuestWire } from '../domain/guest-protocol'

export interface GuestProcess {
  send(wire: string): void
  kill(): void
  onMessage(listener: (wire: unknown) => void): void
  onExit(listener: () => void): void
  residentBytes(): number
}
type Job = {
  invocation: GuestInvocation; broker: GuestBroker; signal: AbortSignal
  resolve(result: GuestResult): void; timer: ReturnType<typeof setTimeout>
  abort(): void; stop?: (result: GuestResult) => void
}

/** Queue and lifecycle ownership live outside QuickJS, including hard cancellation. */
export class WritingPluginRunHost implements GuestRunner {
  private readonly queued: Job[] = []
  private readonly active = new Set<Job>()
  private disposed = false
  private disposal?: Promise<void>
  private disposalDone?: () => void
  constructor(private readonly spawn: () => GuestProcess, private readonly policy: GuestPolicy = defaultGuestPolicy) { validateGuestPolicy(policy) }
  run(invocation: GuestInvocation, broker: GuestBroker, signal: AbortSignal): Promise<GuestResult> {
    try { validateGuestInvocation(invocation) } catch { return Promise.resolve({ ok: false, code: 'invalid-input' }) }
    if (signal.aborted) return Promise.resolve({ ok: false, code: 'cancelled' })
    if (this.disposed || this.queued.length >= codePluginLimits.queued || [...this.active, ...this.queued].some(j => j.invocation.invocationId === invocation.invocationId)) return Promise.resolve({ ok: false, code: 'unavailable' })
    // Snapshot before queueing; later host/adapter mutation cannot alter guest input.
    const snapshot: GuestInvocation = JSON.parse(JSON.stringify(invocation))
    return new Promise(resolve => {
      const cancel = (result: GuestResult) => {
        if (job.stop) { job.stop(result); return }
        const index = this.queued.indexOf(job)
        if (index >= 0) { this.queued.splice(index, 1); this.release(job, result) }
      }
      const job: Job = { invocation: snapshot, broker, signal, resolve,
        timer: setTimeout(() => cancel({ ok: false, code: 'timeout' }), this.policy.invocationMs),
        abort: () => cancel({ ok: false, code: 'cancelled' }) }
      signal.addEventListener('abort', job.abort, { once: true })
      this.queued.push(job); this.pump()
    })
  }
  private release(job: Job, result: GuestResult): void {
    clearTimeout(job.timer); job.signal.removeEventListener('abort', job.abort)
    this.active.delete(job); job.resolve(result)
    this.pump()
    if (this.disposed && !this.active.size) this.disposalDone?.()
  }
  private pump(): void {
    while (!this.disposed && this.active.size < codePluginLimits.processes && this.queued.length) {
      const job = this.queued.shift()!; this.active.add(job); this.start(job)
    }
  }
  private start(job: Job): void {
    const rpc = new AbortController()
    let child: GuestProcess
    try { child = this.spawn() } catch { this.release(job, { ok: false, code: 'unavailable' }); return }
    let ending: GuestResult | undefined, exited = false, lastRpcId = 0
    const monitor = setInterval(() => {
      try { if (child.residentBytes() > codePluginLimits.processResidentBytes) stop({ ok: false, code: 'process-memory' }) }
      catch { stop({ ok: false, code: 'unavailable' }) }
    }, 100)
    const stop = (result: GuestResult) => {
      if (ending || exited) return
      ending = result; rpc.abort(); clearInterval(monitor)
      // Do not release a concurrency slot or resolve until Electron reports exit.
      child.kill()
    }
    job.stop = stop
    child.onExit(() => {
      if (exited) return
      exited = true; rpc.abort(); clearInterval(monitor)
      this.release(job, ending ?? { ok: false, code: 'process-exit' })
    })
    child.onMessage(wire => {
      if (ending || exited) return
      try {
        const event = decodeGuestEvent(wire)
        if (event.kind === 'result') { stop(event.result); return }
        if (event.id !== ++lastRpcId) { stop({ ok: false, code: 'protocol-error' }); return }
        void Promise.resolve().then(() => {
          if (rpc.signal.aborted) throw new Error('Cancelled')
          return job.broker(event.method, event.input, rpc.signal)
        }).then(value => {
          if (!ending && !exited) {
            assertJson(value, pluginLimits.outputBytes)
            child.send(encodeGuestWire({ kind: 'reply', id: event.id, ok: true, value }))
          }
        }).catch(() => {
          if (!ending && !exited) {
            try { child.send(encodeGuestWire({ kind: 'reply', id: event.id, ok: false })) }
            catch { stop({ ok: false, code: 'protocol-error' }) }
          }
        })
      } catch { stop({ ok: false, code: 'protocol-error' }) }
    })
    try { child.send(encodeGuestWire({ kind: 'start', invocation: job.invocation, policy: this.policy })) }
    catch { stop({ ok: false, code: 'protocol-error' }) }
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    this.disposal = new Promise(resolve => { this.disposalDone = resolve })
    for (const job of this.queued.splice(0)) this.release(job, { ok: false, code: 'cancelled' })
    for (const job of this.active) job.stop?.({ ok: false, code: 'cancelled' })
    if (!this.active.size) this.disposalDone?.()
    return this.disposal
  }
}
