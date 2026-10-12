import { reactive } from 'vue'
import { pluginError } from './plugin-error'
import type { PluginAuthoringApi, PluginDraft } from '../../../contracts/writing-plugins/authoring'

type Session = { draft: PluginDraft; saved: string; saving: boolean; composing: boolean; error: string }
const sessions = new Map<string, Session>(), pending = new Map<string, Promise<void>>()
const content = (d: PluginDraft) => JSON.stringify({ manifestText: d.manifestText, files: d.files })
export const draftDirty = (s: Session) => content(s.draft) !== s.saved
export function draftSession(draft: PluginDraft) {
  let session = sessions.get(draft.id)
  if (!session) { session = reactive({ draft: JSON.parse(JSON.stringify(draft)), saved: content(draft), saving: false, composing: false, error: '' }); sessions.set(draft.id, session) }
  else if (draft.revision > session.draft.revision && !draftDirty(session) && !session.saving && !session.composing) {
    session.draft = JSON.parse(JSON.stringify(draft)); session.saved = content(draft); session.error = ''
  }
  return session
}
/** Only call after the author reviews the newer saved snapshot and explicitly
 * chooses to save the editor's merged content. Main still enforces revision CAS.
 */
export function acceptDraftMerge(session: Session, latest: PluginDraft): void {
  if (session.saving || session.composing || latest.id !== session.draft.id || latest.pluginId !== session.draft.pluginId || latest.revision <= session.draft.revision) throw new Error('草稿状态已变化，请结束输入并刷新后重试。')
  session.draft.revision = latest.revision; session.draft.updatedAt = latest.updatedAt
  session.saved = content(latest); session.error = ''
}
/** Sessions survive settings navigation. Save failures retain author input; each
 * draft has one save lane so late receipts cannot erase newer keystrokes. */
export function saveDraftSession(session: Session, api: PluginAuthoringApi): Promise<void> {
  const active = pending.get(session.draft.id); if (active) return active
  const action = (async () => {
    session.saving = true; session.error = ''
    try {
      while (draftDirty(session) && !session.composing) {
        const submitted = content(session.draft), { manifestText, files } = JSON.parse(submitted)
        const saved = await api.saveDraft({ id: session.draft.id, revision: session.draft.revision, manifestText, files })
        session.draft.revision = saved.revision; session.draft.updatedAt = saved.updatedAt; session.saved = submitted
      }
    } catch (error) { session.error = pluginError(error, '草稿保存失败，输入已保留。'); throw error }
    finally { session.saving = false }
  })().finally(() => { pending.delete(session.draft.id) })
  pending.set(session.draft.id, action); return action
}
// Electron asks the author to stay when a draft is still unsaved. A successful
// save clears this guard; no manuscript or credential data enters this cache.
window.addEventListener('beforeunload', event => {
  if ([...sessions.values()].some(s => draftDirty(s) || s.composing || s.saving)) { event.preventDefault(); event.returnValue = '' }
})
