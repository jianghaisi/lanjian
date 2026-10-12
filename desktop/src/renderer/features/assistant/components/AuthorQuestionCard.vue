<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { AuthorAnswer, AuthorQuestionCard } from '../../../../contracts/assistant/author-interaction-contracts'
import { authorAnswerProgress, restoreAuthorQuestionDraft, type AuthorQuestionDraft } from '../services/author-question-draft'
const props = defineProps<{ question: AuthorQuestionCard; bookTitle: string; busy: boolean; unavailable?: boolean; needsResume: boolean; runId?: string; draft?: AuthorQuestionDraft | null; draftStatus?: string }>()
const emit = defineEmits<{ submit: [answers: AuthorAnswer[]]; defer: []; cancel: []; resume: []; 'update:draft': [draft: AuthorQuestionDraft] }>()
const answers = reactive<Record<string, AuthorAnswer>>(Object.create(null))
const composing = ref(false)
const restored = ref(false), draftMismatch = ref(false)
let restoring = false
watch(() => JSON.stringify([props.runId, props.question.id, props.question.version]), () => {
  restoring = true; composing.value = false
  const saved = restoreAuthorQuestionDraft(props.runId, props.question, props.draft)
  restored.value = Boolean(saved)
  draftMismatch.value = Boolean(!saved && props.runId && props.draft?.runId === props.runId && props.draft.questionId === props.question.id && props.draft.questionVersion === props.question.version)
  for (const key of Object.keys(answers)) delete answers[key]
  for (const q of props.question.questions) answers[q.id] = saved?.find(a => a.id === q.id) ?? { id: q.id, chosenOptionIds: [], customText: '', skipped: false }
  restoring = false
}, { immediate: true })
watch(answers, () => {
  if (restoring || !props.runId) return
  restored.value = false; draftMismatch.value = false
  emit('update:draft', { runId: props.runId, questionId: props.question.id, questionVersion: props.question.version, answers: JSON.parse(JSON.stringify(props.question.questions.map(q => answers[q.id]))) })
}, { deep: true, flush: 'sync' })
const progress = computed(() => authorAnswerProgress(props.question, Object.values(answers)))
const ready = computed(() => progress.value.ready)
function choose(id: string, option: string, multiple: boolean) {
  const a = answers[id]; a.skipped = false
  a.chosenOptionIds = multiple ? a.chosenOptionIds.includes(option) ? a.chosenOptionIds.filter(value => value !== option) : [...a.chosenOptionIds, option] : [option]
  if (!multiple) a.customText = ''
}
function typed(id: string, single: boolean) { const a = answers[id]; a.skipped = false; if (single && a.customText.trim()) a.chosenOptionIds = [] }
function submit() { if (ready.value && !props.busy && !props.unavailable && !props.needsResume && !composing.value) emit('submit', props.question.questions.map(q => JSON.parse(JSON.stringify(answers[q.id])))) }
</script>
<template>
  <section class="author-question" data-testid="author-question-card" aria-label="等待作者回答">
    <header><span class="author-question-mark">待你决定</span><span>{{ bookTitle }}</span></header>
    <p class="author-question-source">{{ question.pluginId === 'builtin.core' ? '岚笺内置 · 作者交互' : question.pluginId === 'builtin.plugins' ? '岚笺内置 · 插件管理' : '创作插件 · 作者交互' }}</p>
    <details v-if="question.pluginId !== 'builtin.core' && question.pluginId !== 'builtin.plugins'" class="author-answer-backup" data-testid="author-question-source-details">
      <summary>工具来源详情</summary><pre>插件：{{ question.pluginId }}
工具：{{ question.toolId }}</pre>
    </details>
    <div class="author-question-progress" data-testid="author-question-progress"><span>已答 {{ progress.answered }} / {{ progress.total }} 题<span v-if="progress.skipped"> · 跳过 {{ progress.skipped }} 题</span></span><span v-if="draftStatus" data-testid="author-answer-save-status">{{ draftStatus }}</span></div>
    <p v-if="restored" class="author-question-detail">已恢复上次填写的回答，请核对后提交。</p>
    <details v-if="draftMismatch && draft" class="author-answer-backup"><summary>旧回答与当前问题不一致，未自动套用；展开可复制保留。</summary><pre>{{ draft.answers.map(a => [a.customText, ...a.chosenOptionIds].filter(Boolean).join('\n')).join('\n\n') }}</pre></details>
    <section v-if="question.review" class="author-action-review" data-testid="author-action-review" aria-label="操作前核对">
      <h4>{{ question.review.title }}</h4><p>{{ question.review.summary }}</p>
      <details v-for="(section,index) in question.review.sections" :key="index"><summary>{{ section.label }}</summary><pre>{{ section.content }}</pre></details>
    </section>
    <form @submit.prevent="submit" @keydown.enter="if (($event.ctrlKey || $event.metaKey) && !$event.isComposing) { $event.preventDefault(); submit() }">
      <fieldset v-for="(q,index) in question.questions" :key="q.id" :disabled="busy || needsResume">
        <legend><span v-if="question.questions.length > 1">{{ index + 1 }}.</span> {{ q.prompt }}<small v-if="!q.required">可跳过</small></legend>
        <p v-if="q.detail" class="author-question-detail">{{ q.detail }}</p>
        <div v-if="q.mode !== 'text'" class="author-question-options" :role="q.mode === 'single' ? 'radiogroup' : 'group'" :aria-label="q.prompt">
          <label v-for="option in q.options" :key="option.id" :class="{ chosen: answers[q.id]?.chosenOptionIds.includes(option.id) }">
            <input :type="q.mode === 'single' ? 'radio' : 'checkbox'" :name="question.id + q.id" :value="option.id" :checked="answers[q.id]?.chosenOptionIds.includes(option.id)" @change="choose(q.id, option.id, q.mode === 'multiple')">
            <span><b>{{ option.label }}</b><em v-if="option.recommended">建议</em><small v-if="option.description">{{ option.description }}</small></span>
          </label>
        </div>
        <label class="author-question-custom"><span>{{ q.mode === 'single' ? '或写下你的想法' : q.mode === 'multiple' ? '补充说明' : '你的回答' }}</span>
          <textarea v-model="answers[q.id]!.customText" :aria-label="q.prompt + '：自由回答'" maxlength="12000" rows="3" @input="typed(q.id,q.mode === 'single')" @compositionstart="composing=true" @compositionend="composing=false"/>
        </label>
        <label v-if="!q.required" class="author-question-skip"><input v-model="answers[q.id]!.skipped" type="checkbox" @change="if(answers[q.id]!.skipped){answers[q.id]!.chosenOptionIds=[];answers[q.id]!.customText=''}">跳过这道问题</label>
      </fieldset>
      <p v-if="unavailable" class="author-question-detail">请先在下方重新读取任务状态，已填写的回答会保留。</p>
      <p v-if="needsResume" class="author-question-detail">回答前，请先恢复任务并核对当前内容。</p>
      <footer>
        <button v-if="needsResume" type="button" class="control-button primary" :disabled="busy || unavailable" @click="emit('resume')">恢复任务</button>
        <button v-else type="submit" class="control-button primary" :disabled="busy || unavailable || !ready || composing" data-testid="submit-author-answer">{{ busy ? '正在提交…' : '提交并继续' }}</button>
        <button type="button" class="control-button secondary" :disabled="busy" @click="emit('defer')">暂不回答</button>
        <button type="button" class="author-question-stop" :disabled="busy" @click="emit('cancel')">停止任务</button>
      </footer>
    </form>
  </section>
</template>
<style scoped>
.author-question input[type="radio"],.author-question input[type="checkbox"]{appearance:auto;display:inline-block;flex:0 0 1rem;width:1rem;height:1rem;min-height:0;padding:0;margin:.15rem 0;align-self:flex-start;accent-color:var(--jade)}
.author-question{padding:1rem;border:1px solid var(--line);border-inline-start:3px solid var(--jade);border-radius:10px;background:var(--surface);min-width:0;color:var(--ink)}
.author-action-review{padding:.8rem;border:1px solid var(--line);background:var(--paper);overflow-wrap:anywhere}.author-action-review h4{margin:0;font:600 17px/1.5 var(--serif)}.author-action-review p{font-size:13px;line-height:1.7;white-space:pre-wrap}.author-action-review details{margin-top:.6rem;font-size:12px}.author-action-review summary{cursor:pointer}.author-action-review pre{max-height:18rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 var(--sans);margin:.6rem 0 0}
.author-question header{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem;font-size:.75rem;color:var(--muted);overflow-wrap:anywhere}.author-question-mark{color:var(--ink);font-weight:700;white-space:nowrap;letter-spacing:.1em}.author-question-source{font-size:.7rem;color:var(--muted);margin:.4rem 0 1rem;overflow-wrap:anywhere}
.author-question-progress{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.3rem .7rem;font-size:.7rem;line-height:1.6;color:var(--muted)}.author-answer-backup{font-size:.75rem;color:var(--muted);margin-top:.5rem}.author-answer-backup pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
fieldset{border:0;padding:0;margin:1rem 0;min-width:0}legend{font-weight:650;font-size:.9rem;line-height:1.6;overflow-wrap:anywhere}legend small{font-size:.65rem;color:var(--muted);margin-left:.4rem;font-weight:400}.author-question-detail{font-size:.8rem;line-height:1.6;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere;margin:.4rem 0 .7rem}
.author-question-options{display:grid;gap:.45rem}.author-question-options label{display:flex;align-items:flex-start;gap:.6rem;padding:.7rem;border:1px solid var(--line);border-radius:6px;cursor:pointer;min-width:0}.author-question-options label.chosen{border-color:var(--jade);background:color-mix(in srgb,var(--jade) 8%,var(--surface))}.author-question-options input{margin-top:.2rem;accent-color:var(--jade)}.author-question-options span{min-width:0;overflow-wrap:anywhere}.author-question-options b{font-size:.83rem;font-weight:550}.author-question-options small{display:block;font-size:.75rem;color:var(--muted);line-height:1.5;margin-top:.2rem}.author-question-options em{font-size:.65rem;font-style:normal;color:var(--muted);margin-left:.5rem}
.author-question-custom{display:grid;gap:.35rem;margin-top:.75rem;font-size:.75rem;color:var(--muted)}textarea{box-sizing:border-box;resize:vertical;min-height:4.5rem;width:100%;padding:.65rem;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:6px;font:inherit;line-height:1.6}textarea:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--jade);outline-offset:3px}.author-question-skip{display:flex;gap:.4rem;margin-top:.5rem;font-size:.75rem;color:var(--muted)}footer{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:1rem}.author-question-stop{border:0;background:transparent;color:var(--muted);font-size:.75rem;padding:.45rem;cursor:pointer}fieldset:disabled{opacity:.65}
</style>
