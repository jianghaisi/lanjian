import { ref, watch, type Ref } from 'vue'
import { emptyAssistantMemory, readAssistantMemory, validateAssistantMemory, writeAssistantMemory, type AssistantMemory, type ReadingPosition } from '../services/assistant-memory'
import type { AssistantTurn } from '../services/assistant-presentation'
import type { AuthorQuestionDraft } from '../services/author-question-draft'

// Chat memory is an author draft, never an adoption receipt or a formal book store.
export function useAssistantMemory(draft: Ref<string>, turns: Ref<AssistantTurn[]>, storage = { read: readAssistantMemory, write: writeAssistantMemory }) {
  const position = ref<ReadingPosition>({ top: 0, atBottom: true }), runId = ref(''), revision = ref(0), loading = ref(false), saveError = ref(''), saving = ref(false), canRetry = ref(true)
  const questionDraft = ref<AuthorQuestionDraft | null>(null)
  const cache = new Map<string, AssistantMemory>(), lanes = new Map<string, Promise<unknown>>()
  const blocked=new Set<string>(), failed=new Map<string,Set<keyof AssistantMemory>>(), versions=new Map<string,number>()
  let book = '', generation = 0, restoring = false, writable = true, pending = 0
  function snapshot(): AssistantMemory { return JSON.parse(JSON.stringify({ draft: draft.value, turns: turns.value, position: position.value, runId: runId.value, questionDraft: questionDraft.value })) }
  function save<K extends keyof AssistantMemory>(key: K) {
    if (!book || restoring) return
    const id = book, value:AssistantMemory = {draft:draft.value,turns:turns.value,position:position.value,runId:runId.value,questionDraft:questionDraft.value}
    cache.set(id, value)
    if (!writable) return
    const ticket=JSON.stringify([id,key]), version=(versions.get(ticket)??0)+1;versions.set(ticket,version)
    try { key==='turns'?validateAssistantMemory(value):validateAssistantMemory({...emptyAssistantMemory(),[key]:value[key]}) } catch (e) { if(!failed.has(id))failed.set(id,new Set());failed.get(id)!.add(key);saveError.value = String((e as Error).message); return }
    const data=JSON.parse(JSON.stringify(value[key])) as AssistantMemory[K]
    pending++; saving.value = true
    const operation = (lanes.get(id) ?? Promise.resolve()).catch(() => {}).then(() => storage.write(id, key, data))
    lanes.set(id, operation)
    void operation.then(() => {
      if(versions.get(ticket)!==version)return
      failed.get(id)?.delete(key);if(book===id&&!failed.get(id)?.size)saveError.value=''
    }, () => {
      if(versions.get(ticket)!==version)return
      if(!failed.has(id))failed.set(id,new Set());failed.get(id)!.add(key)
      if(book===id)saveError.value='会话保存未完成，当前文字仍保留。请复制备份或重试保存。'
    }).finally(() => { pending--; saving.value = pending > 0 })
  }
  watch(draft, () => save('draft'), { flush: 'sync' })
  watch(turns, () => save('turns'), { deep: true, flush: 'post' })
  watch(position, () => save('position'), { deep: true })
  watch(runId, () => save('runId'), { flush: 'sync' })
  watch(questionDraft, () => save('questionDraft'), { deep: true, flush: 'sync' })
  async function open(id: string | null, reset: () => void) {
    if (book && !restoring) { cache.set(book, snapshot()); save('turns') }
    const epoch = ++generation; restoring = true; loading.value = true; book = id ?? ''; saveError.value = failed.get(book)?.size?'上次会话保存未完成，文字已恢复到窗口，请重试保存。':''; writable = !blocked.has(book);canRetry.value=writable
    reset(); position.value = { top: 0, atBottom: true }; runId.value = ''; questionDraft.value = null
    try {
      if (id) {
        await lanes.get(id)?.catch(() => {})
        const value = cache.get(id) ?? await storage.read(id)
        if (epoch !== generation) return false
        draft.value = value.draft; turns.value = value.turns; position.value = value.position; runId.value = value.runId; questionDraft.value = value.questionDraft ?? null
      }
    } catch {
      if (epoch !== generation) return false
      writable = false;canRetry.value=false; blocked.add(book); saveError.value = '会话记录暂时无法读取，已有记录未覆盖。当前输入可保留在本窗口，请稍后重新打开作品重试。'
    } finally {
      if (epoch === generation) { restoring = false; loading.value = false; revision.value++;if(!writable)saveError.value='会话记录读取失败，已有记录未覆盖；当前输入仅保留在窗口，请先复制备份，再重启后读取。' }
    }
    return epoch === generation
  }
  let opening:Promise<boolean>=Promise.resolve(true)
  function openBook(id:string|null,reset:()=>void){opening=open(id,reset);return opening}
  function retry() { for (const key of ['draft', 'turns', 'position', 'runId', 'questionDraft'] as const) save(key) }
  return { open:openBook, ready:()=>opening, position, runId, questionDraft, revision, loading, saving, saveError, canRetry, retry }
}
