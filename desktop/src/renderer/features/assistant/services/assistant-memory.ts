import type { AssistantTurn } from './assistant-presentation'
import { decodeAuthorQuestionDraft, type AuthorQuestionDraft } from './author-question-draft'
export type ReadingPosition = { top: number; atBottom: boolean }
export type AssistantMemory = { draft: string; turns: AssistantTurn[]; position: ReadingPosition; runId: string; questionDraft: AuthorQuestionDraft | null }
export const emptyAssistantMemory = (): AssistantMemory => ({ draft: '', turns: [], position: { top: 0, atBottom: true }, runId: '', questionDraft: null })
let database: Promise<IDBDatabase> | undefined
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('lanjian-assistant-reading', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('conversation')
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined }; resolve(request.result) }
    request.onerror = () => { database = undefined; reject(request.error) }
    request.onblocked = () => reject(new Error('会话存储正被另一个窗口占用。'))
  })
}
export function validateAssistantMemory(value: AssistantMemory): AssistantMemory {
  try { decodeAuthorQuestionDraft(value.questionDraft) } catch { throw new Error('回答草稿格式异常或超过容量，已有记录未覆盖，请先复制保存当前内容。') }
  if (typeof value.draft !== 'string' || value.draft.length > 10000 || typeof value.runId !== 'string' || value.runId.length > 200 || !Number.isFinite(value.position?.top) || value.position.top < 0 || typeof value.position.atBottom !== 'boolean' || Object.keys(value.position).some(key=>!['top','atBottom'].includes(key)) || !Array.isArray(value.turns) || value.turns.length > 2000 || value.turns.some(t => !t || Object.keys(t).some(key=>!['role','content','tools','runId','incomplete','answerSubmissionId'].includes(key)) || !['user', 'assistant'].includes(t.role) || typeof t.content !== 'string' || t.content.length > 50000 || t.tools !== undefined && (!Array.isArray(t.tools) || t.tools.length>24 || t.tools.some(step => typeof step !== 'string'||step.length>240)) || t.runId !== undefined && (typeof t.runId !== 'string'||t.runId.length>200) || t.incomplete !== undefined && typeof t.incomplete !== 'boolean' || t.answerSubmissionId !== undefined && (t.role !== 'user' || !t.runId || typeof t.answerSubmissionId !== 'string' || !/^[\w.:-]{1,200}$/.test(t.answerSubmissionId) || ['__proto__','prototype','constructor'].includes(t.answerSubmissionId))) || value.turns.reduce((n, t) => n + t.content.length, 0) > 5000000) throw new Error('会话记录超过容量或格式异常；已有记录未覆盖，请先复制保存当前内容。')
  return value
}
export async function readAssistantMemory(book: string): Promise<AssistantMemory> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('conversation', 'readonly'), store = transaction.objectStore('conversation')
    const value = emptyAssistantMemory()
    for (const key of ['draft', 'turns', 'position', 'runId', 'questionDraft'] as const) {
      const request = store.get([book, key])
      request.onsuccess = () => { if (request.result !== undefined) (value as Record<string, unknown>)[key] = request.result }
    }
    transaction.oncomplete = () => { try { resolve(validateAssistantMemory(value)) } catch (error) { reject(error) } }
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
export async function writeAssistantMemory<K extends keyof AssistantMemory>(book: string, key: K, value: AssistantMemory[K]): Promise<void> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('conversation', 'readwrite')
    transaction.objectStore('conversation').put(value, [book, key])
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
