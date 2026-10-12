import { onBeforeUnmount, ref, watch } from 'vue'
import type { FieldAssistantApi, FieldTask } from '../../../../contracts/assistant/field-assistant-contracts'
import type { AssistantRunView } from '../../../../contracts/assistant/assistant-run-contracts'
import { fieldScope } from '../services/assistant-field-registry'

type HistoryPreview = { goal: string; message: string; run?: AssistantRunView; task?: FieldTask }

// Reading a historical task never replaces the live conversation or executes it.
export function useAssistantHistoryPreview(api: FieldAssistantApi) {
  const preview = ref<HistoryPreview | null>(null), loading = ref(false), error = ref('')
  let version = 0, disposed = false
  function close() { version++; preview.value = null; loading.value = false; error.value = '' }
  watch(() => fieldScope.epoch, close, { flush: 'sync' })
  onBeforeUnmount(() => { disposed = true; close() })

  async function refresh() {
    const item = preview.value?.run
    if (!item || !api.runs || disposed || item.workItemId !== fieldScope.workItemId) return
    const ticket = ++version, epoch = fieldScope.epoch, scope = fieldScope.workItemId
    const current = () => !disposed && ticket === version && epoch === fieldScope.epoch && scope === fieldScope.workItemId && preview.value?.run?.id === item.id
    loading.value = true; error.value = ''
    try {
      const fresh = await api.runs.status(item.id)
      if (!current()) return
      if (fresh.id !== item.id || fresh.workItemId !== scope) throw new Error('History identity changed')
      preview.value = { goal: fresh.goal, message: fresh.result?.message || fresh.message, run: fresh }
    } catch {
      if (current()) error.value = '暂时无法刷新这条任务，以下保留上次读取的内容。请重试后再恢复任务。'
    } finally { if (current()) loading.value = false }
  }
  async function inspectRun(item: AssistantRunView) {
    if (disposed || item.workItemId !== fieldScope.workItemId) return
    close(); preview.value = { goal: item.goal, message: item.result?.message || item.message, run: item }
    await refresh()
  }
  function inspectTask(item: FieldTask) {
    if (disposed || item.target.workItemId !== fieldScope.workItemId) return
    close(); preview.value = { goal: item.target.label, message: item.error || '已保存的字段修改记录', task: item }
  }
  return { preview, loading, error, close, refresh, inspectRun, inspectTask }
}
