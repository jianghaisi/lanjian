<script lang="ts">
export type ManuscriptRecoveryDialogItem = {
  id: string
  chapterId: number
  chapterPosition?: number
  chapterTitle: string
  source: 'renderer' | 'sqlite'
  updatedAt: string
  draftTitle: string
  draftContent: string
  currentTitle: string
  currentContent: string
  status?: 'recoverable' | 'conflict'
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import StudioIcon from '../../../ui/StudioIcon.vue'

const props = withDefaults(defineProps<{
  items: ManuscriptRecoveryDialogItem[]
  initialSelectedId?: string
  busyId?: string
}>(), {
  initialSelectedId: '',
  busyId: ''
})

const emit = defineEmits<{
  select: [item: ManuscriptRecoveryDialogItem]
  compare: [item: ManuscriptRecoveryDialogItem]
  restore: [item: ManuscriptRecoveryDialogItem]
  discard: [item: ManuscriptRecoveryDialogItem]
  close: []
}>()

const dialog = ref<HTMLElement | null>(null)
const selectedId = ref(props.initialSelectedId || props.items[0]?.id || '')
const showingFullComparison = ref(false)
let previouslyFocused: HTMLElement | null = null

const selected = computed(() => props.items.find((item) => item.id === selectedId.value) || props.items[0] || null)
const isBusy = computed(() => Boolean(props.busyId))
const selectedBusy = computed(() => Boolean(selected.value && props.busyId === selected.value.id))
const comparison = computed(() => {
  const item = selected.value
  if (!item) return null
  const currentCount = countWords(item.currentContent)
  const draftCount = countWords(item.draftContent)
  return {
    currentCount,
    draftCount,
    delta: draftCount - currentCount,
    currentExcerpt: showingFullComparison.value ? (item.currentContent || '这一版尚无正文。') : excerpt(item.currentContent),
    draftExcerpt: showingFullComparison.value ? (item.draftContent || '这一版尚无正文。') : excerpt(item.draftContent)
  }
})

watch(() => props.items, (items) => {
  if (!items.some((item) => item.id === selectedId.value)) selectedId.value = items[0]?.id || ''
}, { deep: true })

watch(() => props.initialSelectedId, (id) => {
  if (id && props.items.some((item) => item.id === id)) selectedId.value = id
})

onMounted(async () => {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
})

onBeforeUnmount(() => {
  if (previouslyFocused?.isConnected) previouslyFocused.focus()
})

function choose(item: ManuscriptRecoveryDialogItem): void {
  selectedId.value = item.id
  showingFullComparison.value = false
  emit('select', item)
}

function toggleComparison(item: ManuscriptRecoveryDialogItem): void {
  showingFullComparison.value = !showingFullComparison.value
  emit('compare', item)
}

function chooseRelative(direction: 1 | -1): void {
  if (!props.items.length) return
  const currentIndex = Math.max(0, props.items.findIndex((item) => item.id === selected.value?.id))
  const nextIndex = (currentIndex + direction + props.items.length) % props.items.length
  choose(props.items[nextIndex])
  nextTick(() => dialog.value?.querySelector<HTMLElement>(`[data-recovery-id="${cssEscape(props.items[nextIndex].id)}"]`)?.focus())
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date)
}

function sourceLabel(source: ManuscriptRecoveryDialogItem['source']): string {
  return source === 'sqlite' ? 'SQLite 检查点' : '本机恢复草稿'
}

function chapterLabel(item: ManuscriptRecoveryDialogItem): string {
  const position = item.chapterPosition || item.chapterId
  return `第 ${position} 章`
}

function countWords(value: string): number {
  return (value.match(/[\u3400-\u9fff]|[A-Za-z0-9]+/g) || []).length
}

function excerpt(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()
  if (!normalized) return '这一版尚无正文。'
  if (normalized.length <= 260) return normalized
  return `${normalized.slice(0, 170).trimEnd()}\n…\n${normalized.slice(-72).trimStart()}`
}

function deltaLabel(value: number): string {
  if (value === 0) return '字数持平'
  return `${value > 0 ? '增加' : '减少'} ${Math.abs(value).toLocaleString('zh-CN')} 字`
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
}
</script>

<template>
  <div class="recovery-backdrop" @mousedown.self="emit('close')">
    <section
      ref="dialog"
      class="recovery-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manuscript-recovery-title"
      aria-describedby="manuscript-recovery-description"
      data-testid="manuscript-recovery-dialog"
      @keydown="handleDialogKeydown"
    >
      <header class="dialog-heading">
        <div class="heading-mark" aria-hidden="true">续</div>
        <div class="heading-copy">
          <p>意外中断 · 原稿未动</p>
          <h2 id="manuscript-recovery-title">发现尚未归档的正文</h2>
          <span id="manuscript-recovery-description">先核对恢复稿与当前正式稿，再决定恢复或丢弃。关闭窗口不会删除这些草稿。</span>
        </div>
        <button class="close-button" type="button" aria-label="暂时关闭恢复窗口" data-autofocus @click="emit('close')">
          <StudioIcon name="close" :size="18" />
        </button>
      </header>

      <div v-if="items.length" class="dialog-workbench">
        <nav
          class="recovery-index"
          aria-label="待核对的恢复草稿"
          role="listbox"
          :aria-activedescendant="selected ? `recovery-${selected.id}` : undefined"
          @keydown.up.prevent="chooseRelative(-1)"
          @keydown.down.prevent="chooseRelative(1)"
        >
          <div class="index-caption"><span>待核案卷</span><b>{{ items.length }}</b></div>
          <button
            v-for="item in items"
            :id="`recovery-${item.id}`"
            :key="item.id"
            type="button"
            role="option"
            class="recovery-index-item"
            :class="{ selected: selected?.id === item.id, conflict: item.status === 'conflict' }"
            :aria-selected="selected?.id === item.id"
            :data-recovery-id="item.id"
            @click="choose(item)"
          >
            <span class="chapter-number">{{ chapterLabel(item) }}</span>
            <strong>{{ item.draftTitle || item.chapterTitle || '未命名章节' }}</strong>
            <small>{{ sourceLabel(item.source) }} · {{ formatTime(item.updatedAt) }}</small>
            <i aria-hidden="true">{{ item.status === 'conflict' ? '核' : '稿' }}</i>
          </button>
          <p class="index-note"><i></i>草稿只保存在这台电脑和当前作品中，不会上传。</p>
        </nav>

        <article v-if="selected && comparison" class="recovery-review">
          <header class="review-heading">
            <div>
              <span>{{ chapterLabel(selected) }} · {{ sourceLabel(selected.source) }}</span>
              <h3>{{ selected.draftTitle || selected.chapterTitle || '未命名章节' }}</h3>
            </div>
            <time :datetime="selected.updatedAt">最后改动 {{ formatTime(selected.updatedAt) }}</time>
          </header>

          <div v-if="selected.status === 'conflict'" class="conflict-notice" role="status">
            <b>正式稿在草稿之后又有变化</b>
            <span>恢复前必须查看差异；岚笺不会用旧基线静默覆盖新版本。</span>
          </div>

          <div class="comparison-summary" :class="{ full: showingFullComparison }" aria-label="正文对照摘要">
            <section class="paper current-paper">
              <header><span>当前正式稿</span><b>{{ comparison.currentCount.toLocaleString('zh-CN') }} 字</b></header>
              <h4>{{ selected.currentTitle || selected.chapterTitle || '未命名章节' }}</h4>
              <pre>{{ comparison.currentExcerpt }}</pre>
            </section>
            <div class="comparison-axis" aria-hidden="true"><span>对</span><i></i><em>{{ deltaLabel(comparison.delta) }}</em></div>
            <section class="paper draft-paper">
              <header><span>准备恢复的草稿</span><b>{{ comparison.draftCount.toLocaleString('zh-CN') }} 字</b></header>
              <h4>{{ selected.draftTitle || selected.chapterTitle || '未命名章节' }}</h4>
              <pre>{{ comparison.draftExcerpt }}</pre>
            </section>
          </div>

          <footer class="review-actions">
            <button class="discard-action" type="button" :disabled="isBusy" @click="emit('discard', selected)">丢弃这份草稿</button>
            <span class="action-guidance">恢复会建立一个新版本，历史稿仍会保留。</span>
            <div>
              <button class="compare-action" type="button" :disabled="isBusy" @click="toggleComparison(selected)">{{ showingFullComparison ? '收起完整正文' : '查看完整正文' }}</button>
              <button class="restore-action" type="button" :disabled="isBusy" @click="emit('restore', selected)">
                <span>{{ selectedBusy ? '正在恢复…' : '恢复为新版本' }}</span><i aria-hidden="true">复</i>
              </button>
            </div>
          </footer>
          <span class="busy-announcement" aria-live="polite">{{ selectedBusy ? '正在把恢复草稿建立为新的正式版本' : '' }}</span>
        </article>
      </div>

      <div v-else class="recovery-empty">
        <span aria-hidden="true">安</span>
        <h3>没有待恢复的正文</h3>
        <p>所有已识别草稿都已处理，当前正式稿保持不变。</p>
        <button type="button" @click="emit('close')">返回书稿</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.recovery-backdrop {
  --ink: #172b27;
  --ink-soft: #53615c;
  --paper: #f5f0e5;
  --paper-bright: #fbf8f0;
  --rule: rgba(56, 70, 63, .18);
  --jade: #24584e;
  --cinnabar: #a8493b;
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(16, 23, 21, .66);
  backdrop-filter: blur(6px) saturate(.8);
  color: var(--ink);
  font-family: "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif;
}

.recovery-dialog {
  position: relative;
  width: min(900px, calc(100vw - 56px));
  max-height: min(760px, calc(100vh - 56px));
  overflow: hidden;
  border: 1px solid rgba(213, 202, 181, .72);
  border-radius: 4px 16px 4px 4px;
  background:
    linear-gradient(90deg, transparent 0 31px, rgba(168, 73, 59, .11) 31px 32px, transparent 32px),
    radial-gradient(circle at 76% 10%, rgba(255, 255, 255, .72), transparent 34%),
    var(--paper);
  box-shadow: 0 34px 90px rgba(0, 0, 0, .36), 0 2px 0 rgba(255, 255, 255, .45) inset;
  animation: recovery-arrive .22s cubic-bezier(.2, .8, .25, 1) both;
}

.recovery-dialog::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: .22;
  background-image: repeating-linear-gradient(0deg, transparent 0 27px, rgba(75, 66, 48, .035) 27px 28px);
}

.dialog-heading {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 52px 1fr auto;
  gap: 17px;
  align-items: center;
  min-height: 108px;
  padding: 19px 22px 17px 26px;
  border-bottom: 1px solid var(--rule);
}

.heading-mark {
  display: grid;
  width: 46px;
  aspect-ratio: 1;
  place-items: center;
  border: 1px solid rgba(168, 73, 59, .65);
  color: var(--cinnabar);
  font-size: 24px;
  line-height: 1;
  transform: rotate(-2deg);
  box-shadow: 0 0 0 3px rgba(168, 73, 59, .05) inset;
}

.heading-copy p,
.heading-copy h2,
.heading-copy span { margin: 0; }
.heading-copy p { color: var(--cinnabar); font-size: 11px; font-weight: 700; letter-spacing: .18em; }
.heading-copy h2 { margin-top: 5px; font-size: clamp(22px, 3vw, 29px); font-weight: 600; letter-spacing: .04em; }
.heading-copy span { display: block; margin-top: 6px; color: var(--ink-soft); font-size: 12px; line-height: 1.6; }

.close-button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
}
.close-button:hover,
.close-button:focus-visible { border-color: var(--rule); background: rgba(255, 255, 255, .5); color: var(--ink); outline: none; }

.dialog-workbench {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 238px minmax(0, 1fr);
  min-height: 460px;
  max-height: calc(min(760px, 100vh - 56px) - 108px);
}

.recovery-index {
  overflow: auto;
  padding: 18px 13px 14px 20px;
  border-right: 1px solid var(--rule);
  background: rgba(224, 217, 201, .34);
}

.index-caption { display: flex; align-items: center; justify-content: space-between; padding: 0 8px 10px; color: var(--ink-soft); font-size: 11px; letter-spacing: .12em; }
.index-caption b { display: grid; width: 23px; height: 23px; place-items: center; border: 1px solid var(--rule); border-radius: 50%; color: var(--jade); font-size: 11px; }

.recovery-index-item {
  position: relative;
  display: grid;
  width: 100%;
  gap: 5px;
  margin-bottom: 7px;
  padding: 13px 32px 12px 13px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 2px 9px 2px 2px;
  background: transparent;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.recovery-index-item:hover { background: rgba(255, 255, 255, .48); }
.recovery-index-item:focus-visible { outline: 2px solid rgba(36, 88, 78, .45); outline-offset: 1px; }
.recovery-index-item.selected { border-color: rgba(36, 88, 78, .22); background: rgba(255, 255, 255, .72); box-shadow: -3px 0 0 var(--jade); }
.recovery-index-item.conflict.selected { box-shadow: -3px 0 0 var(--cinnabar); }
.recovery-index-item .chapter-number { color: var(--cinnabar); font-size: 11px; letter-spacing: .06em; }
.recovery-index-item strong { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.recovery-index-item small { overflow: hidden; color: var(--ink-soft); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.recovery-index-item > i { position: absolute; right: 10px; top: 50%; color: rgba(36, 88, 78, .42); font-size: 18px; font-style: normal; transform: translateY(-50%); }
.recovery-index-item.conflict > i { color: rgba(168, 73, 59, .7); }

.index-note { display: flex; gap: 7px; margin: 18px 7px 0; color: #78817d; font-size: 10px; line-height: 1.55; }
.index-note i { flex: 0 0 5px; width: 5px; height: 5px; margin-top: 5px; border-radius: 50%; background: var(--jade); }

.recovery-review {
  min-width: 0;
  overflow: auto;
  padding: 22px 24px 18px;
}

.review-heading { display: flex; gap: 20px; align-items: flex-start; justify-content: space-between; }
.review-heading span { color: var(--cinnabar); font-size: 11px; letter-spacing: .08em; }
.review-heading h3 { margin: 4px 0 0; font-size: 21px; font-weight: 600; }
.review-heading time { flex: 0 0 auto; padding-top: 3px; color: var(--ink-soft); font-size: 10px; }

.conflict-notice {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin-top: 15px;
  padding: 10px 13px;
  border-left: 2px solid var(--cinnabar);
  background: rgba(168, 73, 59, .075);
  font-size: 11px;
}
.conflict-notice b { color: var(--cinnabar); }
.conflict-notice span { color: var(--ink-soft); }

.comparison-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 46px minmax(0, 1fr);
  align-items: stretch;
  margin-top: 18px;
}

.paper {
  min-width: 0;
  min-height: 246px;
  padding: 15px 16px 17px;
  border: 1px solid rgba(73, 77, 65, .16);
  background:
    repeating-linear-gradient(0deg, transparent 0 25px, rgba(65, 81, 75, .065) 25px 26px),
    rgba(251, 248, 240, .84);
  box-shadow: 0 8px 22px rgba(46, 48, 40, .07);
}
.current-paper { border-radius: 2px 2px 2px 12px; }
.draft-paper { border-color: rgba(36, 88, 78, .26); border-radius: 2px 12px 2px 2px; box-shadow: 0 8px 24px rgba(36, 88, 78, .09); }
.paper header { display: flex; justify-content: space-between; gap: 12px; color: var(--ink-soft); font-size: 10px; letter-spacing: .08em; }
.paper header b { color: var(--jade); font-weight: 600; letter-spacing: 0; }
.paper h4 { margin: 12px 0 9px; padding-bottom: 8px; overflow: hidden; border-bottom: 1px solid var(--rule); font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.paper pre { margin: 0; color: #3e4945; font: 12px/26px "Songti SC", "STSong", serif; white-space: pre-wrap; overflow-wrap: anywhere; }
.comparison-summary.full .paper pre { max-height: min(44vh, 520px); overflow: auto; padding-right: 6px; }

.comparison-axis { display: grid; grid-template-rows: auto 1fr auto; place-items: center; padding: 12px 5px; color: var(--ink-soft); }
.comparison-axis span { display: grid; width: 27px; height: 27px; place-items: center; border: 1px solid var(--rule); border-radius: 50%; background: var(--paper); font-size: 12px; }
.comparison-axis i { width: 1px; height: 100%; background: linear-gradient(transparent, var(--rule) 18%, var(--rule) 82%, transparent); }
.comparison-axis em { writing-mode: vertical-rl; color: var(--jade); font-size: 9px; font-style: normal; letter-spacing: .08em; }

.review-actions {
  display: grid;
  grid-template-columns: auto minmax(100px, 1fr) auto;
  gap: 14px;
  align-items: center;
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid var(--rule);
}
.review-actions button { min-height: 35px; border-radius: 2px; font-family: inherit; font-size: 11px; cursor: pointer; }
.review-actions button:disabled { cursor: wait; opacity: .55; }
.review-actions button:focus-visible { outline: 2px solid rgba(36, 88, 78, .4); outline-offset: 2px; }
.review-actions > div { display: flex; gap: 8px; }
.discard-action { border: 0; background: transparent; color: var(--cinnabar); }
.discard-action:hover { text-decoration: underline; text-underline-offset: 4px; }
.action-guidance { color: var(--ink-soft); font-size: 10px; line-height: 1.5; text-align: center; }
.compare-action { padding: 0 14px; border: 1px solid var(--rule); background: rgba(255, 255, 255, .42); color: var(--ink); }
.compare-action:hover { border-color: rgba(36, 88, 78, .42); background: rgba(255, 255, 255, .74); }
.restore-action { display: inline-flex; align-items: center; gap: 11px; padding: 0 7px 0 16px; border: 1px solid var(--jade); background: var(--jade); color: #f8f4e9; box-shadow: 0 5px 14px rgba(36, 88, 78, .18); }
.restore-action i { display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid rgba(255, 255, 255, .36); font-size: 12px; font-style: normal; }
.restore-action:hover { background: #1d4b42; }
.busy-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }

.recovery-empty {
  position: relative;
  z-index: 1;
  display: grid;
  min-height: 360px;
  place-items: center;
  align-content: center;
  padding: 40px;
  text-align: center;
}
.recovery-empty > span { display: grid; width: 56px; height: 56px; place-items: center; border: 1px solid rgba(36, 88, 78, .3); border-radius: 50%; color: var(--jade); font-size: 23px; }
.recovery-empty h3 { margin: 17px 0 6px; font-size: 22px; font-weight: 600; }
.recovery-empty p { margin: 0; color: var(--ink-soft); font-size: 12px; }
.recovery-empty button { margin-top: 22px; padding: 9px 18px; border: 1px solid var(--jade); border-radius: 2px; background: var(--jade); color: #fff; font-family: inherit; cursor: pointer; }

@keyframes recovery-arrive {
  from { opacity: 0; transform: translateY(10px) scale(.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 720px) {
  .recovery-backdrop { padding: 12px; }
  .recovery-dialog { width: calc(100vw - 24px); max-height: calc(100vh - 24px); border-radius: 3px 11px 3px 3px; }
  .dialog-heading { grid-template-columns: 38px 1fr auto; min-height: 94px; gap: 11px; padding: 14px; }
  .heading-mark { width: 36px; font-size: 19px; }
  .heading-copy span { display: none; }
  .dialog-workbench { grid-template-columns: 1fr; max-height: calc(100vh - 118px); overflow: auto; }
  .recovery-index { display: flex; gap: 7px; overflow-x: auto; padding: 11px 13px; border-right: 0; border-bottom: 1px solid var(--rule); }
  .index-caption,
  .index-note { display: none; }
  .recovery-index-item { flex: 0 0 196px; margin: 0; }
  .recovery-review { overflow: visible; padding: 18px 14px; }
  .comparison-summary { grid-template-columns: 1fr; gap: 9px; }
  .comparison-axis { display: none; }
  .paper { min-height: 188px; }
  .review-actions { grid-template-columns: 1fr; }
  .action-guidance { grid-row: 1; text-align: left; }
  .review-actions > div { display: grid; grid-template-columns: 1fr 1fr; }
  .discard-action { justify-self: start; }
}

@media (prefers-reduced-motion: reduce) {
  .recovery-dialog { animation: none; }
}
</style>
