<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUpRight, RotateCcw, Square, X } from '@lucide/vue'
defineProps<{ ready: boolean; busy: boolean; playing: boolean; stateLabel: string; error: string }>()
const input = defineModel<string>({ required: true })
const emit = defineEmits<{ send: []; stop: []; replay: []; close: [] }>()
const element = ref<HTMLElement>(), composing = ref(false)
function submit() { if (!composing.value) emit('send') }
function keydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) return
  if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); submit() }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') }
}
defineExpose({ element })
</script>
<template>
  <section ref="element" class="companion-chat-composer" data-testid="companion-chat-composer" aria-label="人物下方聊天输入" @keydown="keydown">
    <header><label for="companion-message">和她聊聊 <small>MESSAGE / 文字交流</small></label><button type="button" class="composer-close" aria-label="关闭聊天输入" @click="emit('close')"><X :size="15" /></button></header>
    <form @submit.prevent="submit">
      <textarea id="companion-message" v-model="input" rows="2" maxlength="2000" placeholder="写下此刻的想法…" @compositionstart="composing = true" @compositionend="composing = false" />
      <footer>
        <div class="composer-status"><span role="status">{{ stateLabel }}</span><small>Ctrl + Enter 发送</small></div>
        <div class="composer-actions">
          <button v-if="busy || playing" type="button" aria-label="停止当前回复和声音" data-testid="companion-stop" @click="emit('stop')"><Square :size="14" /></button>
          <button v-else type="button" aria-label="重播回复" :disabled="!ready" @click="emit('replay')"><RotateCcw :size="15" /></button>
          <button class="voice-send" type="submit" :disabled="!ready || busy || composing || !input.trim()" aria-label="发送消息"><ArrowUpRight :size="19" /></button>
        </div>
      </footer>
      <p v-if="error" class="composer-error" role="alert">{{ error }}</p>
    </form>
  </section>
</template>
<style scoped>
.companion-chat-composer{position:fixed;z-index:221;box-sizing:border-box;min-inline-size:0;padding:.6rem .8rem .7rem;border:1px solid var(--line-strong);border-block-start:2px solid color-mix(in srgb,var(--jade) 65%,transparent);background:color-mix(in srgb,var(--surface) 48%,transparent);backdrop-filter:blur(7px);box-shadow:0 .25rem 1.2rem #10171216;clip-path:polygon(.5rem 0,100% 0,100% calc(100% - .5rem),calc(100% - .5rem) 100%,0 100%,0 .5rem);color:var(--ink);pointer-events:auto;overflow:auto;font:.75rem/1.5 var(--sans)}
header{display:flex;align-items:center;justify-content:space-between;gap:.5rem}header label{font-weight:600}header small{font:.5rem/1.4 var(--sans);letter-spacing:.1em;color:var(--muted);margin-inline-start:.5rem}
form{display:grid;gap:.4rem}textarea{box-sizing:border-box;display:block;inline-size:100%;min-inline-size:0;block-size:3rem;resize:none;padding:.35rem .1rem;border:0;border-block-end:1px solid var(--line);border-radius:0;background:transparent;color:var(--ink);font:inherit}textarea::placeholder{color:var(--muted)}footer{display:flex;align-items:center;justify-content:space-between;gap:.5rem}.composer-status{display:grid;min-inline-size:0;color:var(--ink);font:.6rem/1.4 var(--sans)}.composer-status small{font-size:.5rem;color:var(--muted)}.composer-actions{display:flex;gap:.4rem;flex:none}
button{display:grid;place-items:center;min-inline-size:2rem;min-block-size:2rem;padding:.3rem;border:1px solid var(--line);background:color-mix(in srgb,var(--surface) 72%,transparent);color:var(--ink);cursor:pointer}.composer-close{min-inline-size:1.65rem;min-block-size:1.65rem;background:transparent;border-color:transparent}button:hover:not(:disabled){border-color:var(--jade);color:var(--jade)}.voice-send{background:var(--jade);border-color:var(--jade);color:var(--surface)}button:disabled{opacity:.45;cursor:default}:is(button,textarea):focus-visible{outline:2px solid var(--jade);outline-offset:2px}.composer-error{margin:0;font-size:.65rem;color:var(--danger);overflow-wrap:anywhere}
</style>
