import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { DesktopApi } from '../../../../contracts'
import type { GroupSessionView, MemberId, PreparationCandidate } from '../../../../contracts/group-chat/group-chat'
import type { GroupAdoptionPreview } from '../../../../contracts/group-chat/adoption'
import type { ModelCreationPreview } from '../../../../contracts/models/model-connections-contracts'
import type { AuthorAnswer } from '../../../../contracts/assistant/author-interaction-contracts'
import type { ModelProfile } from '../../../../contracts/models/types'
import type { ReadingPosition } from '../../assistant/services/assistant-memory'
const errorText = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : '暂时无法完成，请重试；输入和已有成果保留。'
export function useGroupChat(api: DesktopApi, visible: () => boolean, beforeCreate: () => Promise<boolean>, created: (project: import('../../../../contracts').ProjectSummary) => Promise<void>, book: () => import('../../../../contracts').ProjectSummary | null) {
  const sessions = shallowRef<GroupSessionView[]>([]), session = shallowRef<GroupSessionView | null>(null), loading = ref(false), busy = ref(false), error = ref(''), draft = ref(''), target = ref<MemberId | ''>(''), creationOpen = ref(false), creationName = ref(''), parent = ref(''), preview = shallowRef<ModelCreationPreview | null>(null), adoption = shallowRef<GroupAdoptionPreview | null>(null)
  const drafts = new Map<string, string>(), positions = new Map<string, ReadingPosition>(), questionDrafts = new Map<string, import('../../assistant/services/author-question-draft').AuthorQuestionDraft>()
  const position = shallowRef<ReadingPosition>(), questionDraft = shallowRef<import('../../assistant/services/author-question-draft').AuthorQuestionDraft | null>(null), scopeEpoch = ref(0), restoreRevision = ref(0)
  let generation = 0, disposed = false, timer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined, pendingSend: { sessionId: string; text: string; member: string; id: string } | undefined
  let pendingAnswer: { key: string; id: string } | undefined
  const command = () => ({ sessionId: session.value!.id, expectedRevision: session.value!.revision })
  const turns = computed(() => (session.value?.messages ?? []).filter(m => m.role !== 'activity').map(m => ({ ...m, role: m.role === 'user' ? 'user' : 'assistant' })))
  const running = computed(() => session.value?.status === 'running')
  const waiting = computed(() => session.value && ['waiting-input', 'waiting-creation', 'paused-limit', 'interrupted'].includes(session.value.status))
  function accept(view: GroupSessionView) { if (view.book?.id !== book()?.id || !book()) return; session.value = view; const i = sessions.value.findIndex(s => s.id === view.id); sessions.value = i < 0 ? [view, ...sessions.value] : sessions.value.map(s => s.id === view.id ? view : s) }
  async function action<T>(operation: () => Promise<T>): Promise<T | undefined> { busy.value = true; error.value = ''; try { return await operation() } catch (e) { error.value = errorText(e) } finally { busy.value = false } }
  async function load() {
    const ticket = ++generation, bookId = book()?.id
    const saving = flushDraft()
    if (session.value?.book?.id !== bookId || !bookId) { session.value = null; sessions.value = []; draft.value = ''; position.value = undefined; questionDraft.value = null; scopeEpoch.value++ }
    creationOpen.value = false; adoption.value = null; loading.value = Boolean(bookId); error.value = ''
    if (!bookId) return
    try {
      await saving
      if (ticket !== generation || disposed) return
      const all = await api.groupChat.list()
      if (ticket !== generation || disposed) return
      sessions.value = all.filter(s => s.book?.id === bookId)
      const opened = await api.groupChat.openBook(bookId)
      const result = await api.groupChat.get({ sessionId: opened.id, limit: 100 })
      if (ticket !== generation || disposed || book()?.id !== bookId) return
      attach(result)
    } catch (e) { if (ticket === generation) error.value = errorText(e) }
    finally { if (ticket === generation) loading.value = false }
  }
  function attach(result: GroupSessionView) { if (session.value?.id !== result.id) target.value = ''; accept(result); draft.value = drafts.get(result.id) ?? result.draft; position.value = positions.get(result.id) ?? result.position; questionDraft.value = questionDrafts.get(result.id) ?? null; scopeEpoch.value++; restoreRevision.value++ }
  async function select(id: string) {
    if (!sessions.value.some(s => s.id === id && s.book?.id === book()?.id)) return
    const ticket = ++generation; loading.value = true; creationOpen.value = false; adoption.value = null
    try { if (session.value) { drafts.set(session.value.id, draft.value); await flushDraft() }; if (ticket !== generation || disposed) return; const result = await api.groupChat.get({ sessionId: id, limit: 100 }); if (ticket !== generation || disposed || result.book?.id !== book()?.id) return; attach(result) }
    catch (e) { if (ticket === generation) error.value = errorText(e) }
    finally { if (ticket === generation) loading.value = false }
  }
  async function create() {
    const currentBook = book(); if (!currentBook || busy.value || loading.value) return
    const ticket = ++generation; loading.value = true; error.value = ''
    try {
      if (session.value) drafts.set(session.value.id, draft.value)
      if (!await flushDraft() || ticket !== generation || disposed || book()?.id !== currentBook.id) return
      const result = await api.groupChat.createForBook(currentBook.id)
      if (ticket !== generation || disposed || book()?.id !== currentBook.id || result.book?.id !== currentBook.id) return
      sessions.value = [result, ...sessions.value.filter(session => session.id !== result.id)]
      attach(result)
    } catch (e) { if (ticket === generation) error.value = errorText(e) }
    finally { if (ticket === generation) loading.value = false }
  }
  async function fresh() { if (session.value) { const id = session.value.id, ticket = generation; const result = await api.groupChat.get({ sessionId: id, limit: 100 }); if (ticket === generation && session.value?.id === id) accept(result) } }
  async function freshCommand() { const id = session.value?.id, ticket = generation; if (!id) throw new Error('请先打开本书创作群。'); await fresh(); if (ticket !== generation || session.value?.id !== id) throw new Error('当前作品或会话已切换，请在目标作品中重新操作。'); if (session.value.readOnly) throw new Error('旧讨论为只读历史，请新建讨论。'); return command() }
  async function send() {
    if (!draft.value.trim() || busy.value || waiting.value) return
    if (!book() || loading.value) return
    if (!session.value) await load()
    if (!session.value) return
    if (session.value.readOnly) { error.value = '旧讨论为只读历史，请新建讨论使用当前团队。'; return }
    const text = draft.value, id = session.value.id, ticket = generation
    if (!pendingSend || pendingSend.sessionId !== id || pendingSend.text !== text || pendingSend.member !== target.value) pendingSend = { sessionId: id, text, member: target.value, id: crypto.randomUUID() }
    const operationId = pendingSend.id
    await action(async () => { if (!await flushDraft() || ticket !== generation || session.value?.id !== id) return; await fresh(); if (ticket !== generation || session.value?.id !== id) return; const result = await api.groupChat.send({ ...command(), operationId, message: text, ...(target.value ? { memberId: target.value } : {}) }); if (ticket === generation && session.value?.id === id) { accept(result); pendingSend = undefined; if (draft.value === text) draft.value = ''; drafts.set(id, draft.value) } })
  }
  const stop = () => action(async () => { const result = await api.groupChat.stop(command()); accept(result) })
  const resume = () => action(async () => { accept(await api.groupChat.resume(await freshCommand())) })
  const answer = (answers: AuthorAnswer[]) => action(async () => { const questionId = session.value!.question!.id, key = JSON.stringify([session.value!.id, questionId, answers]); if (pendingAnswer?.key !== key) pendingAnswer = { key, id: crypto.randomUUID() }; const answerSubmissionId = pendingAnswer.id; accept(await api.groupChat.answer({ ...await freshCommand(), questionId, answerSubmissionId, answers })); pendingAnswer = undefined })
  const saveMember = (memberId: MemberId, profile: ModelProfile) => action(async () => { accept(await api.groupChat.saveMember({ ...await freshCommand(), memberId, profile })) })
  function openCreation() { creationName.value = session.value?.creation?.suggestedTitle ?? ''; if (api.app.platform === 'browser') parent.value = '账户书库'; creationOpen.value = true; preview.value = null }
  const chooseDirectory = () => action(async () => { parent.value = await api.projects.chooseDirectory() || parent.value })
  const createBook = () => action(async () => {
    if (!preview.value || !session.value?.creation || !creationName.value.trim() || !parent.value || !await beforeCreate()) return
    const scopedCommand = await freshCommand()
    const result = await api.groupChat.createBook({ ...scopedCommand, creationId: session.value!.creation!.id, token: preview.value.token, project: { name: creationName.value.trim(), parentPath: parent.value } })
    accept(result.session)
    if (result.result.status === 'partial') { error.value = result.result.message; return }
    creationOpen.value = false; await created(result.result.project)
  })
  const prepareAdoption = (candidate: PreparationCandidate) => action(async () => { const input = await freshCommand(), ticket = generation; const result = await api.groupChat.prepareAdoption({ ...input, candidateId: candidate.id }); if (ticket === generation && session.value?.id === input.sessionId) adoption.value = result })
  const adopt = () => action(async () => { if (!adoption.value) return; accept(await api.groupChat.adopt(adoption.value.token)); adoption.value = null })
  function savePosition(value: ReadingPosition) { position.value = value; if (session.value) positions.set(session.value.id, value) }
  function saveQuestionDraft(value: import('../../assistant/services/author-question-draft').AuthorQuestionDraft) { questionDraft.value = value; if (session.value) questionDrafts.set(session.value.id, value) }
  async function poll() { try { if (visible() && session.value && !busy.value && !loading.value) await fresh() } catch (e) { if (!disposed) error.value = errorText(e) } finally { if (!disposed) timer = setTimeout(poll, running.value ? 700 : 3000) } }
  watch([visible, () => book()?.id], ([value]) => { if (value) void load(); else { generation++; loading.value = false; void flushDraft(); if (session.value?.book?.id !== book()?.id) { session.value = null; sessions.value = []; draft.value = ''; position.value = undefined; scopeEpoch.value++ } } }, { immediate: true })
  watch(draft, value => { if (session.value) drafts.set(session.value.id, value) })
  async function flushDraft() {
    clearTimeout(saveTimer); const current = session.value, ticket = generation; if (!current || current.readOnly) return true
    try { await api.groupChat.saveDraft({ sessionId: current.id, expectedRevision: current.revision, draft: draft.value, position: position.value ?? { top: 0, atBottom: true } }); return true }
    catch (e) { if (session.value?.id === current.id && ticket === generation) error.value = `草稿暂未保存，当前输入保留。${errorText(e)}`; return false }
  }
  watch([draft, position, busy, loading], () => { clearTimeout(saveTimer); if (!session.value || busy.value || loading.value || session.value.readOnly) return; saveTimer = setTimeout(() => { if (!disposed && !busy.value && !loading.value) void flushDraft() }, 400) })
  void poll()
  onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer); clearTimeout(saveTimer) })
  return { sessions, session, loading, busy, error, draft, target, turns, running, waiting, scopeEpoch, restoreRevision, position, questionDraft, creationOpen, creationName, parent, preview, adoption, load, select, create, send, stop, resume, answer, saveMember, openCreation, chooseDirectory, createBook, prepareAdoption, adopt, savePosition, saveQuestionDraft }
}
