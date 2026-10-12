export interface DraftRecord<T> { baseline: string; data: T; updatedAt: number }
/** Recovery copies are private to a browser tab, account, book and document. */
export class DraftStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private readonly owner: string, private readonly book: string) {}
  private key(document: string) { return `lanjian-hosted-draft:${JSON.stringify([this.owner, this.book, document])}` }
  read<T>(document: string): DraftRecord<T> | null {
    const value = this.storage.getItem(this.key(document)); if (!value) return null
    const p: unknown = JSON.parse(value)
    if (!p || typeof p !== 'object' || !('baseline' in p) || typeof p.baseline !== 'string' || !('data' in p) || !('updatedAt' in p) || typeof p.updatedAt !== 'number') throw new Error('恢复副本格式有误，请先导出当前内容。')
    return p as DraftRecord<T>
  }
  write<T>(document: string, baseline: string, data: T) { this.storage.setItem(this.key(document), JSON.stringify({ baseline, data, updatedAt: Date.now() })) }
  remove(document: string) { this.storage.removeItem(this.key(document)) }
}
/** Only the submitted draft is acknowledged; edits made during a save stay dirty. */
export function acknowledge<T>(submitted: T, current: T, equal: (a: T, b: T) => boolean) { return equal(submitted, current) }
