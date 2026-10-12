<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  loading: Boolean,
  busyId: { type: String, default: '' }
})
const emit = defineEmits(['refresh', 'action'])
const filter = ref('attention')

const activeStatuses = new Set(['queued', 'resuming', 'preparing', 'running', 'streaming'])
const isResumable = (item) => item.status === 'paused' && item.actions.includes('resume')
const isActive = (item) => activeStatuses.has(item.status) || isResumable(item)
const isContinued = (item) => item.status === 'paused' && item.hasContinuation === true
const completed = ref(new Set())
const departures = new Map()
// Briefly show the acknowledged completion before an attention filter retires it.
watch(() => props.items.map(item => [item.id, item.status]), (items, previous) => {
  const before = new Map(previous)
  const current = new Map(items)
  for (const [id, timer] of departures) {
    if (current.get(id) !== 'succeeded') { clearTimeout(timer); departures.delete(id); completed.value.delete(id) }
  }
  for (const [id, status] of items) {
    if (status !== 'succeeded' || !activeStatuses.has(before.get(id))) continue
    clearTimeout(departures.get(id))
    completed.value.add(id)
    departures.set(id, setTimeout(() => { completed.value.delete(id); departures.delete(id) }, 700))
  }
})
onBeforeUnmount(() => { for (const timer of departures.values()) clearTimeout(timer) })
function retire(element) { element.inert = true; element.setAttribute('aria-hidden', 'true') }
function restore(element) { element.inert = false; element.removeAttribute('aria-hidden') }
const needsAttention = (item) => isActive(item) || (item.status === 'paused' && !isContinued(item)) || ['failed', 'interrupted'].includes(item.status)
const visibleItems = computed(() => props.items.filter((item) => {
  if (filter.value === 'active') return isActive(item) || completed.value.has(item.id)
  if (filter.value === 'attention') return needsAttention(item) || completed.value.has(item.id)
  return true
}))
const activeCount = computed(() => props.items.filter(isActive).length)

const statusLabels = {
  queued: '排队中', resuming: '恢复中', preparing: '准备中', running: '执行中', streaming: '生成中', paused: '已暂停',
  succeeded: '已完成', cancelled: '已停止', failed: '未完成', interrupted: '已中断'
}
const actionLabels = { view: '打开', pause: '暂停', resume: '继续', cancel: '停止', retry: '重试' }
const statusLabel = (item) => isContinued(item) ? '已续接' : (statusLabels[item.status] || item.status)
const timeLabel = (value) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
</script>

<template>
  <section class="task-center" data-testid="task-center-panel">
    <header class="task-center-heading">
      <div><b>任务中心</b><small>{{ activeCount ? `${activeCount} 项等待处理` : '当前没有运行中的任务' }}</small></div>
      <button class="task-center-refresh" type="button" :disabled="loading" :aria-busy="loading" aria-label="刷新任务" data-testid="refresh-task-center" @click="emit('refresh')"><span class="task-refresh-mark" aria-hidden="true">↻</span>{{ loading ? '读取中' : '刷新' }}</button>
    </header>
    <nav class="task-center-filters" aria-label="筛选任务">
      <button type="button" :class="{ active: filter === 'attention' }" :aria-pressed="filter === 'attention'" data-testid="task-filter-attention" @click="filter = 'attention'">需处理</button>
      <button type="button" :class="{ active: filter === 'active' }" :aria-pressed="filter === 'active'" data-testid="task-filter-active" @click="filter = 'active'">进行中</button>
      <button type="button" :class="{ active: filter === 'all' }" :aria-pressed="filter === 'all'" data-testid="task-filter-all" @click="filter = 'all'">全部记录</button>
    </nav>
    <TransitionGroup tag="div" name="task-record" class="task-center-list" @before-enter="restore" @before-leave="retire" @leave-cancelled="restore">
      <article v-for="item in visibleItems" :key="item.id" class="task-card" :class="[`is-${item.status}`, { 'is-continued': isContinued(item) }]" :data-testid="`task-center-item-${item.id}`">
        <div class="task-card-mark" aria-hidden="true">{{ item.label.slice(0, 1) }}</div>
        <div class="task-card-body">
          <header><div><b>{{ item.label }}</b><span v-if="item.chapterId">第 {{ item.chapterId }} 章</span></div><em :key="statusLabel(item)" class="task-status-label" :data-running="activeStatuses.has(item.status)"><i aria-hidden="true"><svg v-if="item.status === 'succeeded'" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" /></svg></i>{{ statusLabel(item) }}</em></header>
          <p>{{ item.detail }}</p>
          <small>{{ timeLabel(item.updatedAt) }}<span v-if="item.attempt > 1">第 {{ item.attempt }} 次</span></small>
          <details v-if="item.errorMessage"><summary>查看原因</summary><p>{{ item.errorMessage }}</p></details>
          <div class="task-card-actions">
            <button v-for="action in item.actions" :key="action" type="button" :class="{ primary: action === 'resume' || action === 'retry' }" :disabled="busyId === item.id" :data-testid="`task-center-${action}-${item.id}`" @click="emit('action', item, action)">{{ busyId === item.id && action !== 'view' ? '处理中' : actionLabels[action] }}</button>
          </div>
        </div>
      </article>
    </TransitionGroup>
    <div v-if="!visibleItems.length" class="task-center-empty">
      <span aria-hidden="true">静</span>
      <b>{{ filter === 'all' ? '还没有任务记录' : '没有需要处理的任务' }}</b>
      <p>写作、灵感、谋篇与重要变化提炼会统一出现在这里。</p>
    </div>
  </section>
</template>

<style scoped>
.task-record-enter-active{transition:opacity 200ms ease,transform 240ms cubic-bezier(.2,.8,.2,1)}
.task-record-move{transition:transform 240ms cubic-bezier(.2,.8,.2,1)}
.task-record-enter-from{opacity:0;transform:translateY(6px)}
.task-center-list{position:relative}
.task-record-leave-active{position:absolute;inset-inline:0;transition:opacity 160ms ease,transform 160ms ease;pointer-events:none}
.task-record-leave-to{opacity:0;transform:translateY(-4px)}
.task-status-label{display:inline-flex;align-items:center;gap:5px;animation:task-status-in 180ms ease-out}
.task-center .task-card-body>header>.task-status-label{color:var(--color-jade,var(--jade));font-size:11px}
.task-center :is(.is-paused,.is-failed,.is-interrupted) .task-card-body>header>.task-status-label{color:var(--color-danger,var(--cinnabar))}
.task-center .is-continued .task-card-body>header>.task-status-label{color:var(--color-muted,var(--muted))}
.task-status-label i{display:grid;place-items:center;width:12px;height:12px;flex:none}
.task-status-label i:empty:before{content:'';width:4px;height:4px;border:1px solid currentColor;border-radius:50%}
.task-status-label[data-running=true] i:before{background:currentColor;animation:task-signal 1.6s ease-in-out infinite}
.task-status-label svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-dasharray:14;animation:task-check 260ms ease-out}
.task-refresh-mark{display:inline-block;margin-inline-end:5px}
.task-center-refresh[aria-busy=true] .task-refresh-mark{animation:task-refresh .9s linear infinite}
@keyframes task-status-in{from{opacity:0;translate:0 3px}to{opacity:1;translate:0 0}}
@keyframes task-signal{50%{opacity:.35;scale:.8}}
@keyframes task-check{from{stroke-dashoffset:14}to{stroke-dashoffset:0}}
@keyframes task-refresh{to{rotate:360deg}}
@media(prefers-reduced-motion:reduce){.task-record-enter-active,.task-record-move,.task-record-leave-active{transition:none!important}.task-status-label,.task-status-label svg,.task-status-label i:before,.task-refresh-mark{animation:none!important}}
/* This nested header is not the assistant's chrome close button. Pair the
   foreground/background explicitly so global white-on-hover cannot leak in. */
.task-center .task-center-heading > .task-center-refresh {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  width: auto;
  min-width: 64px;
  height: 32px;
  padding: 0 12px;
  flex-shrink: 0;
  border: 1px solid var(--color-line, var(--line));
  border-radius: 2px;
  background: var(--color-surface, var(--surface));
  color: var(--color-ink, var(--ink));
  font: 500 12px/1 var(--sans);
  opacity: 1;
}
.task-center .task-center-heading > .task-center-refresh:hover:not(:disabled) {
  border-color: var(--color-jade, var(--jade));
  background: var(--color-paper, var(--paper));
  color: var(--color-ink, var(--ink));
}
.task-center .task-center-heading > .task-center-refresh:focus-visible {
  outline: 2px solid var(--color-jade, var(--jade));
  outline-offset: 2px;
}
.task-center .task-center-heading > .task-center-refresh:disabled {
  background: var(--color-surface, var(--surface));
  color: var(--color-ink, var(--ink));
  opacity: 1;
  cursor: wait;
}
</style>
