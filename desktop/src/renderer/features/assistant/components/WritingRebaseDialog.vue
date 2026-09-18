<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { rebaseWritingAgentText, type WritingRebaseChoice } from '../../../../contracts/assistant/writing-rebase'

const props = defineProps<{ base: string; current: string; proposed: string; busy: boolean }>()
const emit = defineEmits<{ close: []; confirm: [choices: Record<string, WritingRebaseChoice>] }>()
const dialog = ref<HTMLDialogElement>()
const choices = ref<Record<string, WritingRebaseChoice>>({})
const comparison = computed(() => rebaseWritingAgentText(props.base, props.current, props.proposed, choices.value))
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="writing-rebase-dialog" aria-labelledby="writing-rebase-title" data-testid="writing-rebase-dialog" @cancel.prevent="!busy && emit('close')">
    <header><div><h2 id="writing-rebase-title">把 AI 候选合并到最新正文</h2><p>你在等待时写的内容不会直接被旧稿覆盖。关闭此窗口可继续写，候选仍然保留。</p></div><button type="button" :disabled="busy" aria-label="关闭合并核对" @click="emit('close')">×</button></header>
    <div class="rebase-scroll">
      <p v-if="!comparison.conflicts.length" class="rebase-summary">没有重叠修改。已保留你的新内容，请核对右侧合并结果。</p>
      <p v-else class="rebase-summary">有 {{ comparison.conflicts.length }} 处双方都改过，请逐处选择。其他不重叠的修改会一并保留。</p>
      <fieldset v-for="conflict in comparison.conflicts" :key="conflict.id" :data-testid="conflict.id">
        <legend>重叠修改 {{ conflict.id.split('-')[1] }}</legend>
        <div class="rebase-columns">
          <label><input v-model="choices[conflict.id]" type="radio" :name="conflict.id" value="current" :disabled="busy"> 保留我的修改<pre>{{ conflict.current || '（删除这段）' }}</pre></label>
          <label><input v-model="choices[conflict.id]" type="radio" :name="conflict.id" value="candidate" :disabled="busy"> 使用 AI 修改<pre>{{ conflict.candidate || '（删除这段）' }}</pre></label>
        </div>
      </fieldset>
      <div class="rebase-columns rebase-preview"><section><h3>现在的正文</h3><pre>{{ current }}</pre></section><section><h3>合并后的正文 · 尚未写入</h3><pre data-testid="rebase-result">{{ comparison.content }}</pre></section></div>
    </div>
    <footer><small>{{ comparison.unresolved ? `还有 ${comparison.unresolved} 处需要选择` : '确认后保存为新版本；现在的正文保留在历史中。' }}</small><div><button class="control-button" type="button" :disabled="busy" @click="emit('close')">稍后处理，继续写</button><button class="control-button primary" type="button" data-testid="confirm-writing-rebase" :disabled="busy || comparison.unresolved > 0 || comparison.content === current" @click="emit('confirm', { ...choices })">{{ busy ? '正在合并…' : '合并并保存' }}</button></div></footer>
  </dialog>
</template>

<style scoped>
.writing-rebase-dialog { width: min(1060px, calc(100vw - 48px)); max-height: calc(100vh - 48px); padding: 0; border: 1px solid var(--line, #d8d0c3); border-radius: 8px; color: var(--ink, #233b35); background: var(--paper, #faf8f1); }
.writing-rebase-dialog[open] { display: flex; flex-direction: column; }
.writing-rebase-dialog::backdrop { background: rgb(19 30 26 / 45%); }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 24px; flex: 0 0 auto; }
header { border-bottom: 1px solid var(--line, #d8d0c3); }
header h2 { font-size: 20px; margin: 0 0 8px; } header p { margin: 0; font-size: 14px; line-height: 1.6; } header > button { align-self: flex-start; font-size: 24px; }
.rebase-scroll { overflow: auto; padding: 0 24px 20px; min-height: 0; }
.rebase-summary { line-height: 1.7; }
.rebase-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
fieldset { margin: 16px 0; padding: 14px; border: 1px solid var(--line, #d8d0c3); } legend { padding: 0 6px; }
label { cursor: pointer; } input { accent-color: #2d594e; } h3 { font-size: 15px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 15px; line-height: 1.9; padding: 12px; background: rgb(255 255 255 / 65%); border: 1px solid var(--line, #d8d0c3); }
footer { border-top: 1px solid var(--line, #d8d0c3); flex-wrap: wrap; } footer > div { display: flex; gap: 10px; flex-wrap: wrap; } button { cursor: pointer; } button:disabled { cursor: default; } :focus-visible { outline: 2px solid #2d594e; outline-offset: 3px; }
@media (max-width: 720px) { .rebase-columns { grid-template-columns: minmax(0, 1fr); } header, footer { padding: 14px; } .rebase-scroll { padding: 0 14px 14px; } }
</style>
