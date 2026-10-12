<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProjectSummary } from '../../../../contracts'
import type { BookTaskSummary } from '../../../../contracts/assistant/book-task-summary'
import StudioIcon from '../../../ui/StudioIcon.vue'
import LibraryBookCover from './LibraryBookCover.vue'
const props = defineProps<{ books: ProjectSummary[]; currentPath?: string; disabled?: boolean; readTasks?: () => Promise<BookTaskSummary[]> }>()
const emit = defineEmits<{ select: [book: ProjectSummary]; close: [book: ProjectSummary]; library: []; task: [task: BookTaskSummary] }>()
const tasks = ref<BookTaskSummary[]>([]), tasksOpen = ref(false), taskError = ref('')
const taskTrigger = ref<HTMLButtonElement | null>(null)
const taskPanel = ref<HTMLElement | null>(null)
watch(tasksOpen, async open => {
  if (!open) return
  await nextTick()
  if (tasksOpen.value) taskPanel.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
})
function closeTasks() { tasksOpen.value = false; taskTrigger.value?.focus({ preventScroll: true }) }
function deactivate(element: Element) { (element as HTMLElement).inert = true }
function resetTab(element: Element) {
  const tab = element as HTMLElement
  tab.inert = false
  for (const property of ['width', 'left', 'top']) tab.style.removeProperty(property)
}
function leaveTab(element: Element) {
  const tab = element as HTMLElement, parent = tab.parentElement
  const ownedFocus = tab.contains(document.activeElement)
  tab.style.width = `${tab.offsetWidth}px`
  tab.style.left = `${tab.offsetLeft}px`
  tab.style.top = `${tab.offsetTop}px`
  tab.inert = true
  if (ownedFocus) void nextTick(() => {
    if (document.activeElement !== document.body && !tab.contains(document.activeElement)) return
    const buttons = Array.from(parent?.querySelectorAll<HTMLButtonElement>('[data-book-tab]:not(:disabled)') ?? [])
      .filter(button => !button.closest('[inert]'))
    ;(buttons.find(button => button.hasAttribute('aria-current')) || buttons[0] || taskTrigger.value)?.focus({ preventScroll: true })
  })
}
const active = (task: BookTaskSummary) => ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)
const running = computed(() => tasks.value.filter(active).length)
const completed = computed(() => tasks.value.filter(task => ['succeeded', 'completed'].includes(task.status)).length)
const attention = computed(() => tasks.value.filter(task => ['failed', 'interrupted', 'paused', 'unavailable'].includes(task.status)).length)
const notification = ref<BookTaskSummary | null>(null)
function dismissNotification() { notification.value = null; taskTrigger.value?.focus({ preventScroll: true }) }
const label = (task: BookTaskSummary) => ({ queued: '排队中', resuming: '恢复中', preparing: '准备中', running: '运行中', streaming: '生成中', paused: '已暂停', succeeded: '已完成', completed: '已完成', failed: '失败', interrupted: '已中断', cancelled: '已停止', unavailable: '暂时无法读取' }[task.status] ?? task.status)
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false
async function refreshTasks() {
  try {
    const result = await props.readTasks?.()
    if (!disposed) {
      for (const task of result ?? []) {
        const before = tasks.value.find(old => old.bookPath === task.bookPath && old.taskId === task.taskId && old.kind === task.kind)
        if (before && active(before) && !active(task) && task.bookPath !== props.currentPath) notification.value = task
      }
      tasks.value = result ?? []; taskError.value = ''
    }
  }
  catch { if (!disposed) taskError.value = '任务状态暂时无法读取' }
  finally { if (!disposed) timer = setTimeout(refreshTasks, 1500) }
}
onMounted(refreshTasks)
onBeforeUnmount(() => { disposed = true; clearTimeout(timer) })
function navigate(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  const buttons = Array.from(target.closest('nav')?.querySelectorAll<HTMLButtonElement>('[data-book-tab]:not(:disabled)') ?? []).filter(button => !button.closest('[inert]'))
  const index = buttons.indexOf(target as HTMLButtonElement)
  if (index < 0) return
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : event.key === 'ArrowRight' ? (index + 1) % buttons.length
    : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : -1
  if (next >= 0) { event.preventDefault(); buttons[next]?.focus() }
}
</script>

<template>
  <nav class="book-tabs" aria-label="已打开的作品" data-testid="book-tabs" @keydown="navigate">
    <slot name="leading" />
    <button aria-label="返回我的作品" class="book-library" type="button" :disabled="disabled || !currentPath" @click="emit('library')">
      <span>我的作品</span>
    </button>
    <TransitionGroup tag="div" name="book-strip" class="book-tabs-scroll" @before-leave="leaveTab" @before-enter="resetTab" @leave-cancelled="resetTab">
      <div v-for="book in books" :key="book.path" class="book-tab" :class="{ selected: currentPath === book.path }">
        <button type="button" data-book-tab :data-book-path="book.path" :title="book.title"
          :aria-current="currentPath === book.path ? 'page' : undefined" :disabled="disabled"
          @click="emit('select', book)"><LibraryBookCover :title="book.title" small /><span>{{ book.title }}</span><i v-if="tasks.some(task => task.bookPath === book.path && active(task))" class="running-dot" aria-label="有任务进行中" /></button>
        <button class="close-book-tab" type="button" :aria-label="`关闭《${book.title}》标签`"
          title="关闭标签，作品仍在书架中" :disabled="disabled" @click="emit('close', book)">
          <StudioIcon name="close" :size="14"/>
        </button>
      </div>
    </TransitionGroup>
    <slot name="actions" />
    <div class="book-task-menu">
      <button ref="taskTrigger" type="button" :aria-expanded="tasksOpen" aria-controls="book-task-popover" @click="tasksOpen = !tasksOpen; notification = null" data-testid="background-tasks-toggle">任务 <b v-if="running">{{ running }}</b><span v-else-if="attention"> · {{ attention }} 需处理</span><span v-else-if="completed"> · {{ completed }} 完成</span></button>
      <Transition name="book-surface" @before-leave="deactivate">
      <section v-if="tasksOpen" ref="taskPanel" id="book-task-popover" class="book-task-popover" aria-label="各作品任务" @keydown.esc.prevent.stop="closeTasks">
        <header><b>各作品任务</b><button type="button" aria-label="关闭任务列表" @click="closeTasks">×</button></header>
        <p v-if="tasks.length">{{ running }} 进行中 · {{ completed }} 完成 · {{ attention }} 需处理</p>
        <p v-if="taskError" role="status">{{ taskError }}</p><p v-else-if="!tasks.length">本次打开应用后，还没有发起任务。</p>
        <button v-for="task in tasks" :key="`${task.bookPath}:${task.kind}:${task.taskId}`" class="book-task-row" type="button" :disabled="disabled || task.status === 'unavailable'" @click="emit('task', task); tasksOpen = false">
          <strong>{{ task.bookTitle }}</strong><span>{{ task.kind }} · {{ label(task) }}</span><small>前往查看 →</small>
        </button>
      </section>
      </Transition>
      <Transition name="book-notification" @before-leave="deactivate">
      <div v-if="notification && !tasksOpen" class="book-completion" role="status">
        <button type="button" :disabled="disabled" @click="emit('task', notification); notification = null">《{{ notification.bookTitle }}》{{ notification.kind }}：{{ label(notification) }}<small>前往查看 →</small></button>
        <button type="button" aria-label="关闭任务通知" @click="dismissNotification">×</button>
      </div>
      </Transition>
    </div>
  </nav>
</template>

<style scoped>
.book-tab :deep(.library-book-cover.small){width:18px;height:26px;padding:3px 1px;border-radius:1px}
.book-tab :deep(.library-book-cover.small>span){font-size:3px;max-height:21px}
.book-tabs { position:relative; z-index:45; display:flex; flex:none; align-items:center; height:48px; min-width:0; padding:0 12px;
  background:var(--surface); border-bottom:1px solid var(--line); color:var(--ink); gap:8px; }
button { border:0; background:transparent; color:inherit; font:500 12px/1.4 var(--sans); cursor:pointer; -webkit-app-region:no-drag; }
button:disabled { cursor:default; opacity:.55; }
button:focus-visible { outline:2px solid var(--jade); outline-offset:-3px; }
.book-library { display:flex; align-items:center; gap:8px; padding:0 12px; height:36px; flex:none; white-space:nowrap; }
.book-tabs-scroll { display:flex; flex:1; height:36px; min-width:0; overflow-x:auto; scrollbar-width:thin; align-items:stretch; gap:3px; }
.book-tabs-scroll{position:relative}
.book-strip-enter-active{transition:opacity 220ms ease}
.book-strip-enter-from,.book-strip-leave-to{opacity:0}
.book-tabs-scroll>.book-strip-move{transition:transform 260ms cubic-bezier(.2,.8,.2,1)}
.book-tabs-scroll>.book-strip-leave-active{position:absolute;pointer-events:none;transition:opacity 140ms ease}
.book-tab{position:relative}
.book-tab::after{content:'';position:absolute;inset:auto 12px 0;height:2px;background:var(--color-jade,var(--jade));scale:0 1;transform-origin:left;transition:scale 200ms cubic-bezier(.2,.8,.2,1);pointer-events:none}
.book-tab.selected::after{scale:1 1}
.book-surface-leave-active,.book-notification-leave-active{transition:opacity 120ms ease;pointer-events:none}
.book-surface-leave-to,.book-notification-leave-to{opacity:0}
.book-notification-enter-active{transition:opacity 220ms ease,translate 220ms cubic-bezier(.2,.8,.2,1)}
.book-notification-enter-from{opacity:0;translate:0 -6px}
@media(prefers-reduced-motion:reduce){.book-strip-enter-active,.book-tabs-scroll>.book-strip-move,.book-tabs-scroll>.book-strip-leave-active,.book-tab::after,.book-surface-leave-active,.book-notification-enter-active,.book-notification-leave-active{transition:none!important}}
.book-tab { display:flex; flex:0 0 174px; max-width:220px; min-width:110px; border:1px solid transparent;
  border-radius:0; color:var(--muted); transition:background .15s; }
.book-tab:hover { background:var(--surface-muted); color:var(--ink); }
.book-tab.selected { color:var(--ink); background:var(--jade-wash); border-color:var(--line); }
.book-tab > [data-book-tab] { display:flex; align-items:center; gap:9px; min-width:0; flex:1; padding:0 8px 0 12px; text-align:left; }
.book-tab span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.close-book-tab { flex:none; width:30px; padding:0; }
.close-book-tab:hover { color:var(--cinnabar); background:var(--surface-muted); }
.running-dot { width:6px; height:6px; flex:none; border-radius:50%; background:var(--jade); }
.book-task-menu { height:36px; flex:none; position:relative; display:flex; }
.book-task-menu > button { padding:0 12px; white-space:nowrap; }
.book-task-popover { position:absolute; top:100%; right:0; width:min(360px,85vw); max-height:65vh; overflow:auto; z-index:100; background:var(--surface); border:1px solid var(--line); box-shadow:0 8px 24px #0002; padding:12px; }
.book-task-popover header { display:flex; justify-content:space-between; padding:4px 8px 12px; }
.book-task-popover p { font-size:12px; padding:8px; color:var(--muted); }
.book-task-row { display:grid; width:100%; gap:5px; text-align:left; padding:12px 8px; border-top:1px solid var(--line); }
.book-task-row span,.book-task-row small { color:var(--muted); }
.book-task-row:hover { background:var(--jade-wash); }
.book-completion { position:absolute; top:calc(100% + 8px); right:0; z-index:101; display:flex; width:min(340px,80vw); background:var(--surface); border:1px solid var(--line); box-shadow:0 6px 20px #0002; padding:10px; }
.book-completion > button:first-child { flex:1; text-align:left; line-height:1.7; }.book-completion small { display:block; color:var(--jade); }
@media(max-width:800px) { .book-tab { flex-basis:138px; } .book-library { padding-inline:8px; } }
</style>
