import { AppError } from '../../../core/errors/app-error'
const unavailable = () => new AppError('FEATURE_UNAVAILABLE', '本地模型正被另一项任务使用，请稍后重试。', {recoverable:true})
/** One active owner, one bounded waiter. Only idle ownership can be transferred. */
export class LocalModelScheduler {
  private active?: symbol
  private resident?: { owner: string; stop: () => void }
  private waiter?: { signal?: AbortSignal; owner: string; stop: () => void; resolve: (release: () => void) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; abort: () => void }
  async acquire(owner: string, stop: () => void, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new AppError('CONFLICT','本地请求已停止。',{recoverable:true})
    if (!this.active) return this.enter(owner, stop)
    if (this.waiter) throw unavailable()
    return new Promise((resolve,reject) => {
      const abort = () => {
        if (this.waiter?.abort !== abort) return
        clearTimeout(this.waiter.timer); this.waiter=undefined; signal?.removeEventListener('abort',abort)
        reject(new AppError('CONFLICT','等待本地模型的请求已停止。',{recoverable:true}))
      }
      const timer=setTimeout(() => { abort() },30_000)
      this.waiter={signal,owner,stop,resolve,reject,timer,abort}
      signal?.addEventListener('abort',abort,{once:true})
      if (signal?.aborted) abort()
    })
  }
  private enter(owner: string, stop: () => void): () => void {
    if (this.resident && this.resident.owner !== owner) this.resident.stop()
    this.resident={owner,stop}
    const token=Symbol();this.active=token
    return () => this.release(token)
  }
  private release(token: symbol): void {
      if(this.active!==token)return
      this.active=undefined
      const next=this.waiter;this.waiter=undefined
      if(next){clearTimeout(next.timer);next.signal?.removeEventListener('abort',next.abort)
        if(next.signal?.aborted)next.reject(new AppError('CONFLICT','等待已停止。',{recoverable:true}))
        else next.resolve(this.enter(next.owner,next.stop))
      }
  }
  stop(owner?: string): void {
    const next=this.waiter;this.waiter=undefined
    if(next && (!owner || next.owner===owner)){clearTimeout(next.timer);next.signal?.removeEventListener('abort',next.abort);next.reject(unavailable())}
    else this.waiter=next
    if (owner && this.resident?.owner!==owner) return
    const token=this.active
    const resident=this.resident;this.resident=undefined
    resident?.stop()
    if(token)this.release(token)
  }
}
