<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { rebaseWritingAgentText, type WritingRebaseChoice } from '../../../../contracts/assistant/writing-rebase'

const props = defineProps<{ base: string; current: string; proposed: string; busy: boolean }>()
const emit = defineEmits<{ close: []; confirm: [choices: Record<string, WritingRebaseChoice>] }>()
const dialog = ref<HTMLDialogElement>()
const choices = ref<Record<string, WritingRebaseChoice>>({})
const comparison = computed(() => rebaseWritingAgentText(props.base, props.current, props.proposed, choices.value))
const activeConflict = ref(0)
function visitConflict(index: number) {
  const count = comparison.value.conflicts.length
  if (!count) return
  activeConflict.value = Math.max(0, Math.min(count - 1, index))
  const field = dialog.value?.querySelectorAll<HTMLElement>('fieldset')[activeConflict.value]
  field?.scrollIntoView({ block: 'start', behavior: 'instant' })
  field?.focus({ preventScroll: true })
}
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="writing-rebase-dialog" aria-labelledby="writing-rebase-title" data-testid="writing-rebase-dialog" @cancel.prevent="!busy && emit('close')">
    <header><div><small class="eyebrow">MANUSCRIPT REVIEW / 正文合并审阅</small><h2 id="writing-rebase-title">把 AI 候选合并到最新正文</h2><p>你在等待时写的内容会保留。返回后可继续写，候选仍然保留。</p></div><button class="control-button" type="button" :disabled="busy" aria-label="关闭合并核对" @click="emit('close')">← 返回写作</button></header>
    <nav v-if="comparison.conflicts.length" class="rebase-navigation" aria-label="逐处核对修改"><span>已选择 {{ comparison.conflicts.length - comparison.unresolved }} / {{ comparison.conflicts.length }} 处</span><div><button type="button" :disabled="activeConflict === 0" @click="visitConflict(activeConflict - 1)">↑ 上一处</button><button type="button" :disabled="activeConflict >= comparison.conflicts.length - 1" @click="visitConflict(activeConflict + 1)">下一处 ↓</button><button type="button" @click="visitConflict(0)">定位第一处</button></div></nav>
    <div class="rebase-scroll">
      <p v-if="!comparison.conflicts.length" class="rebase-summary">没有重叠修改。已保留你的新内容，请核对右侧合并结果。</p>
      <p v-else class="rebase-summary">有 {{ comparison.conflicts.length }} 处双方都改过，请逐处选择。其他不重叠的修改会一并保留。</p>
      <fieldset v-for="(conflict, index) in comparison.conflicts" :key="conflict.id" :data-testid="conflict.id" tabindex="-1" @focusin="activeConflict = index">
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
.writing-rebase-dialog { width:calc(100vw - 32px); height:calc(100dvh - 32px); max-width:1600px; max-height:none; padding:0; border:1px solid var(--line); border-radius:2px; color:var(--ink); background:var(--surface); }
.writing-rebase-dialog { flex-direction:column; opacity:0; translate:0 8px; transition:opacity 240ms ease,translate 240ms ease,display 240ms allow-discrete,overlay 240ms allow-discrete; }
.writing-rebase-dialog[open] { display:flex; opacity:1; translate:0 0; }
.writing-rebase-dialog.library-modal-enter-active { transition:opacity 240ms ease,translate 240ms ease,display 240ms allow-discrete,overlay 240ms allow-discrete; }
.writing-rebase-dialog.library-modal-leave-active { transition:opacity 180ms ease,translate 180ms ease,display 180ms allow-discrete,overlay 180ms allow-discrete; }
.writing-rebase-dialog:not([open]),.writing-rebase-dialog:not([open])::backdrop { pointer-events:none; }
.writing-rebase-dialog::backdrop { background:rgb(19 30 26 / 45%); opacity:0; transition:opacity 180ms ease,display 180ms allow-discrete,overlay 180ms allow-discrete; }
.writing-rebase-dialog[open]::backdrop { opacity:1; }
@starting-style { .writing-rebase-dialog[open] { opacity:0; translate:0 8px; } .writing-rebase-dialog[open]::backdrop { opacity:0; } }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 24px; flex: 0 0 auto; }
header { border-bottom: 1px solid var(--line, #d8d0c3); }
header h2 { font-size: 20px; margin: 0 0 8px; } header p { margin: 0; font-size: 14px; line-height: 1.6; } header > button { align-self: flex-start; font-size: 24px; }
.rebase-scroll { overflow:auto; padding:0 32px 24px; min-height:0; flex:1; scroll-padding-top:16px; overscroll-behavior:contain; }
.rebase-navigation { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; padding:12px 24px; border-bottom:1px solid var(--line); color:var(--muted); font:12px var(--sans); }
.rebase-navigation > div { display:flex; gap:8px; }.rebase-navigation button { border:1px solid var(--line); background:var(--surface); color:var(--ink); padding:8px 12px; }
.rebase-preview > section { min-width:0; }.rebase-preview h3 { position:sticky; top:0; margin:0; padding:12px; background:var(--surface); border-bottom:1px solid var(--line); }
fieldset:focus { outline:2px solid var(--jade); outline-offset:3px; }header > button.control-button { font-size:13px; white-space:nowrap; }
.rebase-summary { line-height: 1.7; }
.rebase-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
fieldset { margin: 16px 0; padding: 14px; border: 1px solid var(--line, #d8d0c3); } legend { padding: 0 6px; }
label { cursor:pointer; border-radius:3px; padding:8px; transition:background-color 140ms ease,box-shadow 140ms ease; }
label:has(input:checked) { background:var(--jade-wash,var(--surface-muted)); box-shadow:inset 2px 0 var(--jade); }
label:focus-within { outline:2px solid var(--jade); outline-offset:2px; }
input { accent-color:var(--jade); width:16px; height:16px; vertical-align:middle; } h3 { font-size: 15px; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; font:15px/1.9 var(--serif); padding:20px; background:var(--surface-muted); color:var(--ink); border:1px solid var(--line); }
footer { border-top: 1px solid var(--line, #d8d0c3); flex-wrap: wrap; } footer > div { display: flex; gap: 10px; flex-wrap: wrap; } button { cursor: pointer; } button:disabled { cursor: default; } :focus-visible { outline: 2px solid #2d594e; outline-offset: 3px; }
@media (max-width: 720px) { .rebase-columns { grid-template-columns: minmax(0, 1fr); } header, footer { padding: 14px; } .rebase-scroll { padding: 0 14px 14px; } }
@media(prefers-reduced-motion:reduce) { .writing-rebase-dialog,.writing-rebase-dialog::backdrop,.writing-rebase-dialog.library-modal-enter-active,.writing-rebase-dialog.library-modal-leave-active,label { transition:none!important; translate:none!important; } }
</style>
