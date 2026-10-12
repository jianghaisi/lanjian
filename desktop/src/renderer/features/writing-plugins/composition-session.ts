import { reactive } from 'vue'
import type { JsonValue } from '@lanjian/writing-plugin-contracts'
import type { CompositionEntry } from '../../../contracts/writing-plugins/contributions'
import type { WritingPluginsApi } from '../../../contracts/writing-plugins/management-contracts'
import { pluginError } from './plugin-error'

type EntryIdentity = Pick<CompositionEntry, 'pluginId' | 'digest' | 'contributionId'>
type CompositionInput = { entry: EntryIdentity; name: string; type: string }
export type CompositionSession = {
  title: string
  draft: CompositionEntry[]; savedContent: string
  textDrafts: Record<string, string>; invalidFields: Record<string, string>
  composing: boolean; input: CompositionInput | null
  busy: boolean; error: string; appliedSequence: number
}
const entryKey = (entry: Pick<EntryIdentity, 'pluginId' | 'contributionId'>) => `${entry.pluginId}/${entry.contributionId}`
export const compositionDirty = (session: CompositionSession) => JSON.stringify(session.draft) !== session.savedContent || Boolean(Object.keys(session.invalidFields).length)

/** Window-local author input only. Tokens, plans and revisions belong to each
 * mounted editor and must be reread after navigation. The caller supplies the
 * stable book ID + canonical path as a single cache identity. */
export function createCompositionSessions() {
  const sessions = new Map<string, CompositionSession>()
  function get(scopeKey: string, entries: CompositionEntry[], title = '未命名作品') {
    let session = sessions.get(scopeKey)
    if (!session) {
      session = reactive({ title, draft: [], savedContent: '[]', textDrafts: {}, invalidFields: {}, composing: false, input: null, busy: false, error: '', appliedSequence: 0 })
      loadCompositionSaved(session, entries); sessions.set(scopeKey, session)
    }
    session.title = title
    return session
  }
  const pending = () => [...sessions].filter(([, session]) => compositionDirty(session) || session.composing || session.busy)
  const snapshot = (entries: ReturnType<typeof pending>) => JSON.stringify(entries.map(([key, s]) => [key, s.draft, s.savedContent, s.textDrafts, s.invalidFields]))
  /** Confirmation belongs to one close attempt. Keep drafts intact until the
   * window really closes: another feature's flush can still fail or cancel. */
  function prepareClose(confirm: (message: string) => boolean, notice: (message: string) => void): (() => boolean) | null {
    const entries = pending()
    if (entries.some(([, s]) => s.busy)) { notice('插件组合正在预览或应用，请稍候再关闭。'); return null }
    if (entries.some(([, s]) => s.composing)) { notice('插件组合正在输入，请结束当前输入后再关闭。'); return null }
    const approved = snapshot(entries)
    if (entries.length) {
      const titles = entries.slice(0, 5).map(([, s]) => `《${s.title.replace(/\s+/g, ' ').slice(0, 80)}》`).join('、')
      const more = entries.length > 5 ? `，另有 ${entries.length - 5} 部作品` : ''
      if (!confirm(`${titles}${more}的插件组合还有本窗口中的编辑。\n\n关闭后，未应用的修改将丢失，已保存的组合不受影响。\n\n确认放弃这些修改并关闭？取消可返回继续编辑。`)) return null
    }
    return () => {
      const latest = pending()
      return !latest.length || !latest.some(([, s]) => s.busy || s.composing) && snapshot(latest) === approved
    }
  }
  return { get, prepareClose }
}
const sessions = createCompositionSessions()
export const compositionSession = sessions.get
export const prepareCompositionClose = sessions.prepareClose

export function loadCompositionSaved(session: CompositionSession, entries: CompositionEntry[]) {
  session.savedContent = JSON.stringify(entries); session.draft = JSON.parse(session.savedContent)
  session.textDrafts = {}; session.invalidFields = {}; session.composing = false; session.input = null; session.error = ''
}
/** Returns whether the author must review a changed saved baseline. */
export function reconcileComposition(session: CompositionSession, entries: CompositionEntry[]): boolean {
  const incoming = JSON.stringify(entries)
  if (!session.composing && !Object.keys(session.invalidFields).length && (!compositionDirty(session) || JSON.stringify(session.draft) === incoming)) {
    loadCompositionSaved(session, entries); return false
  }
  return incoming !== session.savedContent
}
export function clearCompositionFields(session: CompositionSession, entry: Pick<EntryIdentity, 'pluginId' | 'contributionId'>) {
  for (const values of [session.invalidFields, session.textDrafts]) {
    for (const field of Object.keys(values)) if (field.startsWith(`${entryKey(entry)}/`)) delete values[field]
  }
  if (session.input && entryKey(session.input.entry) === entryKey(entry)) { session.input = null; session.composing = false }
}
export function setCompositionParam(session: CompositionSession, row: EntryIdentity, name: string, value: string | boolean, type: string) {
  const entry = session.draft.find(e => entryKey(e) === entryKey(row) && e.digest === row.digest)
  if (!entry) return
  const field = `${entryKey(row)}/${name}`
  if (type === 'object' || type === 'array') session.textDrafts[field] = String(value)
  try {
    if (value === '') delete entry.params[name]
    else entry.params[name] = type === 'boolean' ? value as boolean : type === 'number' || type === 'integer' ? Number(value) : type === 'object' || type === 'array' ? JSON.parse(String(value)) as JsonValue : value
    delete session.invalidFields[field]
  } catch { session.invalidFields[field] = `${name} 的结构化内容格式有误。` }
}
export function beginCompositionInput(session: CompositionSession, entry: EntryIdentity, name: string, type: string, value: string) {
  session.input = { entry: { pluginId: entry.pluginId, contributionId: entry.contributionId, digest: entry.digest }, name, type }
  session.textDrafts[`${entryKey(entry)}/${name}`] = value; session.composing = true
}
/** Unmount may happen without compositionend. Finalize into the local draft,
 * retaining invalid raw JSON, without issuing any persistence operation. */
export function finishCompositionInput(session: CompositionSession) {
  const input = session.input
  session.composing = false; session.input = null
  if (input) setCompositionParam(session, input.entry, input.name, session.textDrafts[`${entryKey(input.entry)}/${input.name}`] ?? '', input.type)
}
/** A confirmed apply can settle after its editor unmounts. Keep its receipt and
 * busy state on the original book session; the current owner rereads main. */
export async function applyCompositionSession(session: CompositionSession, api: Pick<WritingPluginsApi, 'applyComposition'>, planId: string): Promise<void> {
  if (session.busy) return
  session.busy = true; session.error = ''
  try {
    if (await api.applyComposition(planId)) session.appliedSequence++
    else session.error = '应用未完成，请重新预览。'
  } catch (cause) { session.error = pluginError(cause, '应用未完成，请重新预览。') }
  finally { session.busy = false }
}
