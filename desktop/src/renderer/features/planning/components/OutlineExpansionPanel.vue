<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OutlineExpansionTask, PlanningOutlineSource, OutlineExpansionAdoptionPreview } from '../../../../contracts/index'

const props = defineProps<{ source: PlanningOutlineSource | null; tasks: OutlineExpansionTask[]; loading: boolean; busy: boolean; error: string; preview: OutlineExpansionAdoptionPreview | null; notice: string }>()
const emit = defineEmits<{ close: []; refresh: []; start: [input: { count: number; instruction: string }]; cancel: [id: string]; retry: [id: string]; preview: [id: string]; dismissPreview: []; adopt: [] }>()
const count = ref(3)
const instruction = ref('')
const layer = computed(() => props.source?.kind === 'summary' ? '卷' : '章')
const candidateLayer = (task: OutlineExpansionTask) => task.proposal?.childType === 'stage' ? '阶段'
  : task.proposal?.childType === 'volume' ? '卷' : '章'
const running = computed(() => props.tasks.find(task => ['queued', 'preparing', 'running', 'streaming'].includes(task.status)))
const labels: Record<string, string> = { queued: '排队中', preparing: '准备中', running: '生成中', streaming: '生成中', succeeded: '候选已保存', failed: '生成失败', cancelled: '已停止', interrupted: '已中断，可重新生成' }
</script>

<template>
  <section class="expansion-panel" data-testid="outline-expansion-panel" aria-label="逐层规划候选" @keydown.esc.stop.prevent="!busy && (preview ? emit('dismissPreview') : emit('close'))">
    <header class="expansion-heading"><div><h2>拆解下一层</h2><p>只拆当前父稿，不改已有大纲和正文。</p></div></header>
    <p v-if="loading && !source" role="status">正在读取已保存的父稿与候选……</p>
    <p v-if="notice" class="expansion-success" role="status" tabindex="-1" data-testid="outline-expansion-notice">{{ notice }}</p>
    <div v-if="error" class="expansion-error" role="alert"><span>{{ error }}</span><button class="control-button secondary compact" type="button" :disabled="loading || busy" @click="emit('refresh')">重新读取</button></div>
    <template v-if="source">
      <details class="expansion-source"><summary>依据：{{ source.title || '当前大纲' }} · 已保存版本</summary><p>{{ source.content }}</p></details>
      <form class="expansion-form" @submit.prevent="emit('start', { count, instruction })">
        <label>预计几{{ layer }}<input v-assist-field="{ id: 'OutlineExpansionPanel.count', read: () => count, write: value => { count = Number(value) } }" v-model.number="count" data-testid="outline-expansion-count" type="number" min="1" max="12" required :disabled="busy || Boolean(running)"></label>
        <label class="expansion-instruction">本次要求（可选）<input v-assist-field="{ id: 'OutlineExpansionPanel.instruction', read: () => instruction, write: value => { instruction = String(value) } }" v-model="instruction" maxlength="2000" placeholder="例如：先安排校园日常，保留对话和吐槽" :disabled="busy || Boolean(running)"></label>
        <button v-if="!running" class="control-button primary compact" data-testid="start-outline-expansion" type="submit" :disabled="busy || loading || !source.content.trim() || !Number.isInteger(count) || count < 1 || count > 12">{{ busy ? '正在提交…' : `生成${layer}纲候选` }}</button>
        <button v-else class="control-button secondary compact" type="button" :disabled="busy" @click="emit('cancel', running.id)">停止生成</button>
      </form>
      <p class="expansion-hint">数量按实际故事节奏调整。生成后复核因果、展开与重复；可修问题最多修正一次。结果仍为候选，需预览采用。</p>
      <p v-if="!tasks.length && !loading" class="expansion-empty">还没有本层候选。可以先拆少量节点，再逐步完善。</p>
      <article v-for="task in tasks" :key="task.id" class="expansion-task" data-testid="outline-expansion-task">
        <header><b>{{ task.adoptedKeys?.length ? '已采用 · 待复核' : labels[task.status] || task.status }}</b><span>{{ task.model }} · {{ new Date(task.createdAt).toLocaleString('zh-CN') }}</span></header>
        <p v-if="task.sourceStale" class="expansion-warning">{{ task.adoptedKeys?.length ? '采用后父稿已有变化，请复核正式大纲。' : '父稿已变化，这份候选基于旧版本，请重新生成。' }}</p>
        <p v-if="task.error" role="alert">{{ task.error }}</p>
        <details v-if="task.rawResult" class="expansion-raw-result">
          <summary>查看模型最初返回的内容</summary>
          <p>{{ task.rawResult }}</p>
        </details>
        <details v-for="(child, index) in task.proposal?.children || []" :key="index" :open="index === 0" class="expansion-child">
          <summary>{{ index + 1 }} · {{ child.title }}</summary><p>{{ child.content }}</p>
          <details><summary>查看事件依据</summary><ol><li v-for="(event, eventIndex) in child.events" :key="eventIndex"><small>{{ event.time }} · {{ event.characters.join('、') }} · {{ event.location }}</small><p>{{ event.event }}</p></li></ol></details>
        </details>
        <small v-if="task.proposal" class="expansion-hint">{{ task.adoptedKeys?.length ? `已写入 ${task.adoptedKeys.length} 项正式大纲；未自动确认，未生成正文。` : '已保存到本书候选记录；尚未写入正式层级。' }}</small>
        <div v-if="['failed', 'cancelled', 'interrupted'].includes(task.status)" class="expansion-actions">
          <button class="control-button secondary compact" type="button" :data-testid="`retry-outline-expansion-${task.id}`" :disabled="busy || loading || task.sourceStale || Boolean(running)" @click="emit('retry', task.id)">重试</button>
        </div>
        <div v-if="task.status === 'succeeded' && task.proposal && !task.adoptedKeys?.length" class="expansion-actions">
          <button v-if="preview?.taskId !== task.id" class="control-button secondary compact" type="button" data-testid="preview-outline-expansion-adoption" :disabled="busy || loading || task.sourceStale" @click="emit('preview', task.id)">预览并采用</button>
        </div>
        <section v-if="preview?.taskId === task.id" class="expansion-adoption" data-testid="outline-expansion-adoption-preview" aria-label="采用预览" tabindex="-1">
          <h3>将新增 {{ preview.children.length }} 项{{ candidateLayer(task) }}纲</h3>
          <p>归入「{{ preview.parentTitle }}」。保留已有大纲及正文，仅新增以下内容，保存后仍需复核。</p>
          <details v-for="(child, index) in preview.children" :key="child.key" :open="index === 0" class="expansion-child">
            <summary>{{ index + 1 }} · {{ child.title }}</summary><p>{{ child.content }}</p>
          </details>
          <div class="expansion-actions">
            <button class="control-button primary compact" type="button" data-testid="confirm-outline-expansion-adoption" :disabled="busy || loading || task.sourceStale" @click="emit('adopt')">{{ busy ? '正在保存…' : `确认新增 ${preview.children.length} 项大纲` }}</button>
            <button class="control-button secondary compact" type="button" :disabled="busy" @click="emit('dismissPreview')">暂不采用</button>
          </div>
        </section>
      </article>
    </template>
  </section>
</template>

<style scoped>
.expansion-panel { flex: 1; min-height: 0; overflow: auto; padding: 24px clamp(18px, 3vw, 44px); font-family: var(--sans); color: var(--ink); }
.expansion-heading, .expansion-task > header, .expansion-error { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.expansion-panel h2 { margin: 0; font: 600 19px/1.4 var(--sans); }
.expansion-panel .expansion-heading, .expansion-panel .expansion-task > header { min-height: 0; padding: 0; border: 0; }
.expansion-heading p, .expansion-hint, .expansion-task > header span { color: var(--ink-soft); font-size: 12px; }
.expansion-source { margin: 20px 0; border-block: 1px solid var(--line); padding: 12px 0; }
summary { cursor: pointer; font-size: 14px; line-height: 1.7; }
.expansion-source p, .expansion-child p { white-space: pre-wrap; line-height: 1.8; font-size: 14px; overflow-wrap: anywhere; }
.expansion-form { display: flex; flex-wrap: wrap; align-items: end; gap: 14px; }
label { display: grid; gap: 8px; font-size: 12px; }
input { box-sizing: border-box; min-height: 38px; padding: 8px 10px; border: 1px solid var(--line); background: var(--surface-raised); color: inherit; font: inherit; }
input[type=number] { width: 88px; }
.expansion-instruction { flex: 1; min-width: 200px; }
.expansion-task { margin-top: 24px; padding-block: 18px; border-top: 1px solid var(--line); }
.expansion-task > header { flex-wrap: wrap; font-size: 14px; }
.expansion-child { padding: 14px 0; }
.expansion-raw-result { margin-top: 12px; padding: 10px 12px; border-left: 2px solid var(--cinnabar); background: color-mix(in srgb, var(--surface-raised) 88%, var(--cinnabar) 12%); }
.expansion-raw-result p { max-height: 260px; margin: 10px 0 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 var(--sans); }
.expansion-child small { color: var(--ink-soft); }
.expansion-child ol { padding-left: 22px; }
.expansion-error, .expansion-warning { color: var(--cinnabar); font-size: 13px; }
.expansion-empty { padding-block: 24px; color: var(--ink-soft); font-size: 14px; }
.expansion-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.expansion-adoption { margin-top: 16px; padding: 18px; border: 1px solid var(--jade); background: var(--surface-raised); }
.expansion-panel .expansion-adoption h3 { margin: 0; font: 600 16px/1.6 var(--sans); }
.expansion-adoption > p { font-size: 13px; line-height: 1.8; color: var(--ink-soft); }
.expansion-success { color: var(--jade); font-size: 13px; line-height: 1.8; }
.expansion-adoption:focus, .expansion-success:focus { outline: 2px solid var(--jade); outline-offset: 3px; }
input:focus-visible, summary:focus-visible { outline: 2px solid var(--jade); outline-offset: 3px; }
</style>
