import { AsyncLocalStorage } from 'node:async_hooks'
import type { BookTaskSummary } from '../../../../contracts/assistant/book-task-summary'
type Task = { id: string; status: string; chapterId?: number }
const active = new Set(['queued', 'resuming', 'preparing', 'running', 'streaming'])
const terminal = new Set(['succeeded', 'completed', 'failed', 'cancelled', 'interrupted'])

/** Session projection only. Durable results remain in their owning book. */
export class BookTaskRegistry {
  private readonly entries = new Map<string, { summary: BookTaskSummary; read: () => Promise<Task> }>()
  track(task: Task, book: { id: string; path: string; title: string }, kind: string, read: () => Task | Promise<Task>): void {
    const resume = AsyncLocalStorage.snapshot()
    const summary = { bookId: book.id, bookPath: book.path, bookTitle: book.title, kind, taskId: task.id, status: task.status,
      ...(task.chapterId === undefined ? {} : { chapterId: task.chapterId }) }
    this.entries.set(JSON.stringify([book.path, kind, task.id]), { summary, read: async () => resume(read) })
    if (this.entries.size > 200) {
      for (const [key, item] of this.entries) {
        if (!active.has(item.summary.status)) this.entries.delete(key)
        if (this.entries.size <= 200) break
      }
    }
  }
  async list(): Promise<BookTaskSummary[]> {
    const entries = [...this.entries.values()]
    await Promise.all(entries.map(async item => {
      if (terminal.has(item.summary.status)) return
      try { item.summary.status = (await item.read()).status }
      catch { item.summary.status = 'unavailable' }
    }))
    return entries.map(item => ({ ...item.summary }))
  }
}
