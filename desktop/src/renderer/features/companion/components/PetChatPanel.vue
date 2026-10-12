<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PetChatTurn } from '../composables/use-pet-chat-history'
const props = defineProps<{ input: string; turns: PetChatTurn[]; status: string; error: string; busy: boolean; playing: boolean; ready: boolean }>()
const emit = defineEmits<{ 'update:input': [value: string]; send: []; stop: []; retry: []; close: []; clear: [] }>()
const editor = ref<HTMLTextAreaElement>(), transcript = ref<HTMLElement>(), composing = ref(false), atBottom = ref(true)
const copyStatus = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined, disposed = false
function scroll() {
  const element = transcript.value
  if (element) atBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 48
}
function latest() { if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight; atBottom.value = true }
function copySelection(text: string) {
  // Sandboxed pet sessions deny clipboard permission requests. Retain the
  // ordinary user-triggered selection-copy path, as in workspace recovery.
  const previous = document.activeElement, selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const input = document.createElement('textarea')
  input.value = text; input.tabIndex = -1; input.setAttribute('aria-hidden', 'true')
  input.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0'
  document.body.append(input)
  try { input.select(); if (!document.execCommand('copy')) throw new Error('Copy unavailable') }
  finally {
    input.remove()
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
    if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range) }
  }
}
async function copy(text: string) {
  clearTimeout(copyTimer)
  try {
    try { await navigator.clipboard.writeText(text) }
    catch { if (disposed) return; copySelection(text) }
    if (!disposed) copyStatus.value = '已复制'
  }
  catch { if (!disposed) copyStatus.value = '复制未成功，可以选中文字复制' }
  if (!disposed) copyTimer = setTimeout(() => { copyStatus.value = '' }, 2500)
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing.value) { event.preventDefault(); emit('send') }
}
watch(() => props.turns, () => { if (!props.turns.length) atBottom.value = true; if (atBottom.value) void nextTick(latest) }, { deep: true })
onMounted(() => { editor.value?.focus(); latest() })
onBeforeUnmount(() => { disposed = true; clearTimeout(copyTimer) })
</script>
<template>
  <section class="pet-chat" data-pet-interactive data-testid="pet-chat-panel" aria-label="和岚笺聊天">
    <header><div><b>和岚笺聊聊</b><span class="pet-chat-status" role="status">{{ status }}</span></div><button type="button" aria-label="关闭聊天" @click="emit('close')">×</button></header>
    <div class="history-tools"><small>最近 20 轮 · 切换作品或关闭桌宠后清空</small><button type="button" :disabled="!turns.length" data-testid="pet-chat-clear" @click="emit('clear')">清空</button></div>
    <div ref="transcript" class="pet-chat-reply" role="log" aria-label="本次聊天记录" data-testid="pet-chat-history" @scroll="scroll">
      <p v-if="!turns.length" class="empty-history">想到什么，都可以和我说。聊天记录仅在本次运行中保留。</p>
      <article v-for="turn in turns" :key="turn.id" class="chat-turn" :data-status="turn.status" data-testid="pet-chat-turn">
        <div class="chat-message user-message"><div class="message-heading"><b>你</b><button type="button" aria-label="复制我的消息" @click="copy(turn.user)">复制</button></div><p>{{ turn.user }}</p></div>
        <div class="chat-message assistant-message"><div class="message-heading"><b>岚笺</b><button v-if="turn.reply" type="button" aria-label="复制伙伴回复" @click="copy(turn.reply)">复制</button></div><p>{{ turn.reply || (turn.status === 'pending' ? '正在准备回复…' : turn.status === 'streaming' ? '正在回复…' : turn.status === 'stopped' ? '这次回复已停止。' : turn.status === 'failed' ? '这次未能完成回复。' : '未收到回复文字。') }}</p><small v-if="turn.status === 'stopped'" class="message-state">已停止</small><small v-else-if="turn.status === 'failed'" class="pet-chat-error">{{ turn.error }}</small><small v-else-if="turn.status === 'streaming'" class="message-state">回复中…</small></div>
      </article>
      <p v-if="error" class="pet-chat-error" role="alert">{{ error }}</p><button v-if="error" type="button" @click="emit('retry')">重新连接</button>
    </div>
    <div v-if="copyStatus || !atBottom" class="history-feedback"><small role="status">{{ copyStatus }}</small><button v-if="!atBottom" type="button" @click="latest">回到最新 ↓</button></div>
    <div class="pet-chat-composer">
    <textarea ref="editor" :value="input" maxlength="2000" rows="3" aria-label="对伙伴说的话" placeholder="写下一句想说的话…" data-testid="pet-chat-input" @input="emit('update:input', ($event.target as HTMLTextAreaElement).value)" @keydown="keydown" @compositionstart="composing = true" @compositionend="composing = false" />
    <div class="composer-tools"><div class="input-tools"><slot name="input-tools" /></div><div class="pet-chat-actions"><button v-if="busy || playing" type="button" @click="emit('stop')">停止</button><button v-else-if="!ready" type="button" @click="emit('retry')">重新连接</button><button v-else class="send" type="button" :disabled="!input.trim()" title="Enter 发送，Shift+Enter 换行" data-testid="pet-chat-send" @click="emit('send')">发送 ↗</button></div></div>
    </div>
  </section>
</template>
<style scoped>
.pet-chat{display:flex;flex-direction:column;min-height:0;background:var(--color-surface);border:1px solid var(--color-line);border-radius:16px;box-shadow:0 8px 25px #203f2b1a;color:var(--color-ink);user-select:text;overflow:hidden;font:13px/1.7 var(--sans)}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:13px 14px 10px;border-bottom:1px solid var(--color-line);flex:none}header>div{display:grid;gap:3px;min-width:0}header b{font-size:16px;font-weight:600}.pet-chat-status{font-size:12px;color:var(--color-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}header button{border:0;background:transparent;font-size:20px;padding:0 5px;min-height:28px}
p{margin:0}.pet-chat-reply{flex:1;min-height:35px;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain;padding:13px 14px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.pet-chat-error{color:#a94236;margin-top:8px}
.pet-chat-composer{flex:none;padding:10px 12px;border-top:1px solid var(--color-line);background:#f5f7f1}.composer-tools{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-top:8px}.input-tools{min-width:0;flex:1;max-height:120px;overflow:auto}.input-tools :deep(.microphone-tools){margin-top:0}.pet-chat-actions{display:flex;align-items:center;gap:8px;flex:none}
.history-tools,.history-feedback{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 12px;flex:none}.history-tools small,.history-feedback small{font-size:12px;color:var(--color-muted);line-height:1.5}.history-tools button,.history-feedback button{font-size:12px;min-height:26px;padding:2px 7px;flex:none}.chat-turn{display:grid;gap:8px;margin-bottom:16px}.chat-message{border:1px solid var(--color-line);border-radius:10px;padding:8px 10px}.user-message{margin-left:16px;background:color-mix(in srgb,var(--color-jade) 7%,var(--color-surface))}.assistant-message{margin-right:8px}.message-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;white-space:normal}.message-heading b{font-size:12px;font-weight:500;color:var(--color-muted)}.message-heading button{border:0;background:transparent;min-height:24px;padding:2px 4px;font-size:12px;color:var(--color-muted)}.message-state{display:block;margin-top:4px;font-size:12px;color:var(--color-muted)}.empty-history{color:var(--color-muted)}
textarea{display:block;resize:none;box-sizing:border-box;min-width:0;width:100%;height:52px;border:1px solid #d6dfd1;border-radius:9px;background:var(--color-surface);color:var(--color-ink);padding:9px 10px;font:13px/1.65 var(--sans)}
button{font:13px var(--sans);border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink);border-radius:8px;min-height:32px;padding:5px 12px;cursor:pointer}.send{background:var(--color-jade);border-color:var(--color-jade);color:#fff}button:disabled{opacity:.45;cursor:default}button:focus-visible,textarea:focus-visible{outline:2px solid var(--color-jade);outline-offset:2px}
</style>
