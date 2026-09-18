<script setup>
import { computed, ref } from 'vue'

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
const needsAttention = (item) => isActive(item) || (item.status === 'paused' && !isContinued(item)) || ['failed', 'interrupted'].includes(item.status)
const visibleItems = computed(() => props.items.filter((item) => {
  if (filter.value === 'active') return isActive(item)
  if (filter.value === 'attention') return needsAttention(item)
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
      <button class="task-center-refresh" type="button" :disabled="loading" :aria-busy="loading" aria-label="刷新任务" data-testid="refresh-task-center" @click="emit('refresh')">{{ loading ? '读取中' : '刷新' }}</button>
    </header>
    <nav class="task-center-filters" aria-label="筛选任务">
      <button type="button" :class="{ active: filter === 'attention' }" :aria-pressed="filter === 'attention'" data-testid="task-filter-attention" @click="filter = 'attention'">需处理</button>
      <button type="button" :class="{ active: filter === 'active' }" :aria-pressed="filter === 'active'" data-testid="task-filter-active" @click="filter = 'active'">进行中</button>
      <button type="button" :class="{ active: filter === 'all' }" :aria-pressed="filter === 'all'" data-testid="task-filter-all" @click="filter = 'all'">全部记录</button>
    </nav>
    <div v-if="visibleItems.length" class="task-center-list">
      <article v-for="item in visibleItems" :key="item.id" class="task-card" :class="[`is-${item.status}`, { 'is-continued': isContinued(item) }]" :data-testid="`task-center-item-${item.id}`">
        <div class="task-card-mark" aria-hidden="true">{{ item.label.slice(0, 1) }}</div>
        <div class="task-card-body">
          <header><div><b>{{ item.label }}</b><span v-if="item.chapterId">第 {{ item.chapterId }} 章</span></div><em>{{ statusLabel(item) }}</em></header>
          <p>{{ item.detail }}</p>
          <small>{{ timeLabel(item.updatedAt) }}<span v-if="item.attempt > 1">第 {{ item.attempt }} 次</span></small>
          <details v-if="item.errorMessage"><summary>查看原因</summary><p>{{ item.errorMessage }}</p></details>
          <div class="task-card-actions">
            <button v-for="action in item.actions" :key="action" type="button" :class="{ primary: action === 'resume' || action === 'retry' }" :disabled="busyId === item.id" :data-testid="`task-center-${action}-${item.id}`" @click="emit('action', item, action)">{{ busyId === item.id && action !== 'view' ? '处理中' : actionLabels[action] }}</button>
          </div>
        </div>
      </article>
    </div>
    <div v-else class="task-center-empty">
      <span aria-hidden="true">静</span>
      <b>{{ filter === 'all' ? '还没有任务记录' : '没有需要处理的任务' }}</b>
      <p>写作、灵感、谋篇与重要变化提炼会统一出现在这里。</p>
    </div>
  </section>
</template>

<style scoped>
/* This nested header is not the assistant's chrome close button. Pair the
   foreground/background explicitly so global white-on-hover cannot leak in. */
.task-center .task-center-heading > .task-center-refresh {
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
