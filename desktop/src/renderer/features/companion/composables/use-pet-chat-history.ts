import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { CompanionChatEvent } from './use-companion-voice'

export type PetChatTurn = {
  id: string; user: string; reply: string
  status: 'pending' | 'streaming' | 'complete' | 'stopped' | 'failed'
  error: string
}

/** Display-only, scoped memory. It never supplies model context or writes storage. */
export function usePetChatHistory(scope: Ref<string | null>) {
  const turns = ref<PetChatTurn[]>([])
  function clear() { turns.value = [] }
  function receive(event: CompanionChatEvent) {
    if (!scope.value) return
    if (event.kind === 'start') {
      if (turns.value.some(turn => turn.id === event.id)) return
      turns.value = [...turns.value, { id: event.id, user: event.text.slice(0, 2000), reply: '', status: 'pending' as const, error: '' }].slice(-20)
      return
    }
    const turn = turns.value.find(item => item.id === event.id)
    if (!turn || !['pending', 'streaming'].includes(turn.status)) return
    if (event.kind === 'text' || event.kind === 'complete') turn.reply = event.text.slice(0, 8000)
    turn.status = event.kind === 'text' ? 'streaming' : event.kind
    if (event.kind === 'failed') turn.error = event.error
  }
  watch(scope, clear, { flush: 'sync' })
  onBeforeUnmount(clear)
  return { turns, receive, clear }
}
