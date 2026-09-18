export type ManuscriptEditSnapshot = Readonly<{
  title: string
  content: string
  selectionStart: number
  selectionEnd: number
}>

export type ManuscriptHistoryRecordOptions = Readonly<{
  group: string
  coalesceMs?: number
  at?: number
}>

function sameSnapshot(left: ManuscriptEditSnapshot, right: ManuscriptEditSnapshot): boolean {
  return left.title === right.title
    && left.content === right.content
    && left.selectionStart === right.selectionStart
    && left.selectionEnd === right.selectionEnd
}

function copySnapshot(snapshot: ManuscriptEditSnapshot): ManuscriptEditSnapshot {
  return { ...snapshot }
}

export class ManuscriptEditHistory {
  private readonly past: ManuscriptEditSnapshot[] = []
  private readonly future: ManuscriptEditSnapshot[] = []
  private lastGroup = ''
  private lastRecordedAt = 0

  constructor(private readonly limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError('编辑历史上限无效')
  }

  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }

  reset(): void {
    this.past.length = 0
    this.future.length = 0
    this.lastGroup = ''
    this.lastRecordedAt = 0
  }

  record(snapshot: ManuscriptEditSnapshot, options: ManuscriptHistoryRecordOptions): boolean {
    const at = options.at ?? Date.now()
    const coalesceMs = Math.max(0, options.coalesceMs ?? 0)
    const coalesced = options.group === this.lastGroup && at - this.lastRecordedAt >= 0 && at - this.lastRecordedAt <= coalesceMs
    this.future.length = 0
    this.lastRecordedAt = at
    this.lastGroup = options.group
    if (coalesced) return false
    const previous = this.past.at(-1)
    if (previous && sameSnapshot(previous, snapshot)) return false
    this.past.push(copySnapshot(snapshot))
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit)
    return true
  }

  undo(current: ManuscriptEditSnapshot): ManuscriptEditSnapshot | null {
    const target = this.past.pop()
    if (!target) return null
    this.future.push(copySnapshot(current))
    this.lastGroup = ''
    this.lastRecordedAt = 0
    return copySnapshot(target)
  }

  redo(current: ManuscriptEditSnapshot): ManuscriptEditSnapshot | null {
    const target = this.future.pop()
    if (!target) return null
    this.past.push(copySnapshot(current))
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit)
    this.lastGroup = ''
    this.lastRecordedAt = 0
    return copySnapshot(target)
  }
}
