<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChapterLifecycleState, WritingAgentInsertionAnchor, WritingAgentSkillId } from '../../../../contracts/index'
import { measureManuscript } from '../../../../contracts/manuscript/manuscript-metrics'
import { formatManuscriptParagraphs } from '../services/manuscript-formatting'
import { ManuscriptEditHistory, type ManuscriptEditSnapshot } from '../services/manuscript-edit-history'
import { useEditorPreferences, type EditorGuideStyle } from '../composables/editor-preferences'
import StudioIcon from '../../../ui/StudioIcon.vue'
import WorkspaceStorageStatus from '../../../app/components/workspace/WorkspaceStorageStatus.vue'
import PlainTextEditor from '../../../ui/PlainTextEditor.vue'

const props = defineProps<{
  chapterId: number
  title: string
  content: string
  position: number
  projectWordCount: number
  saveState: 'saved' | 'dirty' | 'saving' | 'checkpoint' | 'local' | 'error'
  saveErrorMessage?: string
  conflict?: {
    reason?: string
    baseTitle: string
    baseContent: string
    localTitle: string
    localContent: string
    externalChapter?: { title: string; content: string; revision?: string } | null
    expectedRevision?: string
  } | null
  lastSavedAt?: Date | string | null
  readOnly?: boolean
  storageMode?: 'files' | 'sqlite'
  textAuthority?: 'legacy-sqlite' | 'files-v1'
  mirrorStatus?: 'pending' | 'synced' | 'conflict' | 'failed'
  assistantOpen?: boolean
  lifecycleStatus?: ChapterLifecycleState
  hasUnconfirmedChanges?: boolean
  chapterConfirming?: boolean
}>()

const emit = defineEmits<{
  'update:title': [value: string]
  'update:content': [value: string]
  save: []
  confirm: []
  history: []
  delete: []
  'focus-mode': [enabled: boolean]
  'assistant-toggle': []
  guidance: [event: MouseEvent]
  'selection-ai': [skill: WritingAgentSkillId, message?: string]
  'selection-ai-menu': []
  'recover-conflict': []
  'recover-mirror': []
  'selection-change': [selection: { start: number; end: number; text: string } | null]
  'anchor-change': [anchor: WritingAgentInsertionAnchor]
  'manual-edit': []
  'history-restore': [direction: 'undo' | 'redo']
}>()

const titleDraft = ref(props.title)
const contentDraft = ref(props.content)
const editor = ref<InstanceType<typeof PlainTextEditor> | null>(null)
const selectionText = ref('')
const findInput = ref<HTMLInputElement | null>(null)
const manuscriptHead = ref<HTMLElement | null>(null)
const layoutTrigger = ref<HTMLButtonElement | null>(null)
const layoutPanel = ref<HTMLElement | null>(null)
const layoutPanelStyle = ref<Record<string, string>>({})
const findOpen = ref(false)
const layoutOpen = ref(false)
const findQuery = ref('')
const replaceText = ref('')
const currentMatch = ref(0)
const composing = ref(false)
const focusMode = ref(false)
const syncPending = ref(false)
const typewriterMode = ref(localStorage.getItem('lanjian-editor-typewriter') === 'true')
const {
  fontScale,
  leading: editorLeading,
  pageWidth,
  fontFamily,
  guideStyle,
  fontFamilyCss,
  save: saveEditorPreferences,
  reset: resetEditorPreferences
} = useEditorPreferences()
const guideStyleOptions: ReadonlyArray<{ id: EditorGuideStyle; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'solid', label: '实线' },
  { id: 'dashed', label: '虚线' }
]
const paperTheme = ref(localStorage.getItem('lanjian-editor-paper-theme') || 'theme')
const paragraphSpacing = ref(localStorage.getItem('lanjian-editor-paragraph-spacing') !== 'false')
const firstLineIndent = ref(localStorage.getItem('lanjian-editor-first-line-indent') !== 'false')
let syncTimer: number | null = null
let centerFrame: number | null = null
let layoutPlacementObserver: ResizeObserver | null = null
const compositionFlushWaiters = new Set<() => void>()
const editHistory = new ManuscriptEditHistory(100)
const historyRevision = ref(0)
const canUndo = computed(() => { historyRevision.value; return editHistory.canUndo })
const canRedo = computed(() => { historyRevision.value; return editHistory.canRedo })

const manuscriptPageStyle = computed(() => {
  const scale = Number.isFinite(fontScale.value) ? fontScale.value : 1
  const leading = Number.isFinite(editorLeading.value) ? editorLeading.value : 2.12
  const fontSize = 16 * scale
  return {
    '--manuscript-font-scale': scale,
    '--manuscript-font-size': `${fontSize}px`,
    // Resolve the physical rule spacing in JavaScript. CSS multiplication in
    // calc() is not supported by every Electron runtime and made the ruled
    // paper declaration invalid, so the lines could disappear entirely.
    '--manuscript-line-height': `${fontSize * leading}px`,
    '--editor-leading': leading,
    '--manuscript-page-width': `${pageWidth.value}px`,
    '--manuscript-font-family': fontFamilyCss.value
  }
})

const manuscriptMetrics = computed(() => measureManuscript(contentDraft.value))
const wordCount = computed(() => manuscriptMetrics.value.wordCount)
const selectedWordCount = computed(() => measureManuscript(selectionText.value).wordCount)
const paragraphCount = computed(() => manuscriptMetrics.value.paragraphCount)
const localDirty = computed(() => titleDraft.value !== props.title || contentDraft.value !== props.content)
const visibleSaveState = computed(() => props.saveState === 'error' ? 'error' : localDirty.value ? 'dirty' : props.saveState)
const saveLabel = computed(() => ({
  saved: `${props.textAuthority === 'files-v1' ? '正文文件已保存' : props.storageMode === 'sqlite' ? '已存入数据库' : '已存于本地'}${props.lastSavedAt ? ` · ${formatTime(props.lastSavedAt)}` : ''}`,
  dirty: '有改动，稍后自动保存',
  saving: '正在保存…',
  checkpoint: props.textAuthority === 'files-v1' ? '正文文件已保存 · 正在整理历史' : '已形成恢复草稿 · 正在合并版本',
  local: '仅本机恢复草稿 · 尚未正式保存',
  error: props.saveErrorMessage || '保存失败，正文仍在当前窗口'
}[visibleSaveState.value]))
const confirmationLabel = computed(() => props.chapterConfirming ? '确认中…'
  : props.lifecycleStatus === 'CONFIRMED' && !props.hasUnconfirmedChanges ? '已确认本章'
    : props.hasUnconfirmedChanges ? '确认修订版' : '确认本章')
const matches = computed(() => {
  if (!findQuery.value) return [] as number[]
  const source = contentDraft.value.toLocaleLowerCase()
  const query = findQuery.value.toLocaleLowerCase()
  const result: number[] = []
  let cursor = 0
  while (cursor <= source.length - query.length) {
    const index = source.indexOf(query, cursor)
    if (index < 0) break
    result.push(index)
    cursor = index + Math.max(1, query.length)
  }
  return result
})

watch(() => props.chapterId, () => {
  clearSyncTimer()
  editHistory.reset()
  historyRevision.value += 1
  titleDraft.value = props.title
  contentDraft.value = props.content
  findOpen.value = false
  layoutOpen.value = false
  findQuery.value = ''
  replaceText.value = ''
  currentMatch.value = 0
  selectionText.value = ''
})

watch(() => [props.title, props.content] as const, ([title, content]) => {
  if (syncPending.value || composing.value || (title === titleDraft.value && content === contentDraft.value)) return
  editHistory.record(currentEditSnapshot(), { group: 'external', coalesceMs: 50 })
  historyRevision.value += 1
  titleDraft.value = title
  contentDraft.value = content
})

watch(findQuery, () => {
  currentMatch.value = 0
  if (matches.value.length) void selectMatch(0)
})

function formatTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function clearSyncTimer() {
  if (syncTimer !== null) window.clearTimeout(syncTimer)
  syncTimer = null
}

function scheduleSync(delay = 220) {
  if (props.readOnly) return
  syncPending.value = true
  clearSyncTimer()
  if (composing.value) return
  syncTimer = window.setTimeout(syncNow, delay)
}

function syncNow() {
  if (props.readOnly) return
  clearSyncTimer()
  if (composing.value) {
    syncPending.value = true
    return
  }
  if (titleDraft.value !== props.title) emit('update:title', titleDraft.value)
  if (contentDraft.value !== props.content) emit('update:content', contentDraft.value)
  syncPending.value = false
}

async function flush() {
  if (composing.value) await new Promise<void>((resolve) => compositionFlushWaiters.add(resolve))
  syncNow()
  await nextTick()
}

function beginComposition() {
  composing.value = true
  syncPending.value = true
  clearSyncTimer()
}

function endComposition() {
  composing.value = false
  scheduleSync(0)
  requestCursorCenter()
  for (const resolve of compositionFlushWaiters) resolve()
  compositionFlushWaiters.clear()
}

function endContentComposition(text: string) {
  contentDraft.value = text
  endComposition()
  onContentInput()
}

function endTitleComposition(event: CompositionEvent) {
  titleDraft.value = (event.currentTarget as HTMLInputElement).value
  endComposition()
}

function onTitleInput() {
  emit('manual-edit')
  scheduleSync()
}

function onTitleKeydown(event: KeyboardEvent) {
  if (props.readOnly) return
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key.toLocaleLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redoEdit()
    else undoEdit()
    return
  }
  if (modifier && event.key.toLocaleLowerCase() === 'y') {
    event.preventDefault()
    redoEdit()
    return
  }
  if (modifier && event.key.toLocaleLowerCase() === 's') {
    event.preventDefault()
    syncNow()
    emit('save')
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    editor.value?.focus()
  }
}

function onContentInput() {
  const target = editor.value
  if (!composing.value && firstLineIndent.value && target && contentDraft.value && !contentDraft.value.startsWith('　　')) {
    const cursor = target.selectionStart
    contentDraft.value = `　　${contentDraft.value}`
    void nextTick(() => target.setSelectionRange(cursor + 2, cursor + 2))
  }
  emit('manual-edit')
  scheduleSync()
  requestCursorCenter()
}

function onEditorKeydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  const modifier = event.ctrlKey || event.metaKey
  if (props.readOnly && !(modifier && event.key.toLocaleLowerCase() === 'f')) return
  if (modifier && event.key.toLocaleLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redoEdit()
    else undoEdit()
    return
  }
  if (modifier && event.key.toLocaleLowerCase() === 'y') {
    event.preventDefault()
    redoEdit()
    return
  }
  if (modifier && event.key.toLocaleLowerCase() === 's') {
    event.preventDefault()
    syncNow()
    emit('save')
    return
  }
  if (modifier && event.key.toLocaleLowerCase() === 'f') {
    event.preventDefault()
    openFind()
    return
  }
  if (modifier && event.shiftKey && event.key.toLocaleLowerCase() === 'a') {
    event.preventDefault()
    reportSelection()
    emit('selection-ai', selectionSnapshot() ? 'custom' : 'continue')
    return
  }
  if (event.key === 'Tab' && !modifier && !event.altKey) {
    event.preventDefault()
    insertText('　　')
    return
  }
  if (event.key === 'Enter' && !modifier && !event.altKey && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    insertText(`${paragraphSpacing.value ? '\n\n' : '\n'}${firstLineIndent.value ? '　　' : ''}`)
    return
  }
  if (event.key === 'Escape' && findOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    closeFind()
  } else if (event.key === 'Escape' && focusMode.value) toggleFocusMode(false)
}

function formatParagraphs() {
  if (props.readOnly || !contentDraft.value.trim()) return
  recordCommand('format')
  contentDraft.value = formatManuscriptParagraphs(contentDraft.value, {
    firstLineIndent: firstLineIndent.value,
    paragraphSpacing: paragraphSpacing.value
  })
  scheduleSync(0)
  void nextTick(() => {
    editor.value?.focus()
    requestCursorCenter()
  })
}

function insertText(value: string) {
  const target = editor.value
  if (!target) return
  const start = target.selectionStart
  const end = target.selectionEnd
  recordCommand('insert')
  contentDraft.value = `${contentDraft.value.slice(0, start)}${value}${contentDraft.value.slice(end)}`
  scheduleSync()
  void nextTick(() => {
    target.setSelectionRange(start + value.length, start + value.length)
    target.focus()
    requestCursorCenter()
  })
}

function openFind() {
  findOpen.value = true
  void nextTick(() => {
    findInput.value?.focus()
    findInput.value?.select()
  })
}

function closeFind() {
  findOpen.value = false
  editor.value?.focus()
}

async function selectMatch(index: number) {
  if (!matches.value.length || !findQuery.value) return
  currentMatch.value = (index + matches.value.length) % matches.value.length
  const start = matches.value[currentMatch.value]
  await nextTick()
  // Selecting a match must not take typing/Enter away from the search controls.
  // Closing search or explicitly locating conflict evidence restores editor focus.
  editor.value?.setSelectionRange(start, start + findQuery.value.length)
  requestCursorCenter(true)
}

async function locateText(value: string): Promise<boolean> {
  const source = value.trim()
  const query = /\r|\n/.test(source)
    ? source.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean).sort((left, right) => right.length - left.length)[0] || ''
    : source
  const start = query ? contentDraft.value.indexOf(query) : -1
  if (start < 0) return false
  findOpen.value = true
  findQuery.value = query
  await nextTick()
  currentMatch.value = Math.max(0, matches.value.indexOf(start))
  editor.value?.focus()
  editor.value?.setSelectionRange(start, start + query.length)
  reportSelection()
  requestCursorCenter(true)
  return true
}

function replaceCurrent() {
  if (props.readOnly) return
  if (!matches.value.length) return
  const start = matches.value[currentMatch.value] ?? matches.value[0]
  recordCommand('replace')
  contentDraft.value = `${contentDraft.value.slice(0, start)}${replaceText.value}${contentDraft.value.slice(start + findQuery.value.length)}`
  scheduleSync(0)
  void nextTick(() => selectMatch(Math.min(currentMatch.value, matches.value.length - 1)))
}

function replaceAll() {
  if (props.readOnly) return
  if (!matches.value.length) return
  const pattern = new RegExp(escapeRegExp(findQuery.value), 'giu')
  recordCommand('replace-all')
  contentDraft.value = contentDraft.value.replace(pattern, () => replaceText.value)
  scheduleSync(0)
  currentMatch.value = 0
  editor.value?.focus()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function currentEditSnapshot(): ManuscriptEditSnapshot {
  const start = editor.value?.selectionStart ?? 0
  const end = editor.value?.selectionEnd ?? start
  return { title: titleDraft.value, content: contentDraft.value, selectionStart: start, selectionEnd: end }
}

function inputHistoryGroup(event: InputEvent, field: 'title' | 'content'): string {
  const action = event.inputType.startsWith('delete') ? 'delete'
    : event.inputType.startsWith('insert') ? 'typing'
      : event.inputType || 'input'
  return `${field}:${action}`
}

function recordBeforeInput(event: InputEvent, field: 'title' | 'content') {
  if (props.readOnly) return
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault()
    if (event.inputType === 'historyUndo') undoEdit()
    else redoEdit()
    return
  }
  editHistory.record(currentEditSnapshot(), { group: inputHistoryGroup(event, field), coalesceMs: 900 })
  historyRevision.value += 1
}

function recordContentChange(change: { content: string; start: number; end: number; group: string }) {
  if (props.readOnly) return
  editHistory.record({ title: titleDraft.value, content: change.content, selectionStart: change.start, selectionEnd: change.end },
    { group: `content:${change.group}`, coalesceMs: 900 })
  historyRevision.value += 1
}

function interceptContentHistory(event: InputEvent) {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') recordBeforeInput(event, 'content')
}

function recordCommand(group: string) {
  editHistory.record(currentEditSnapshot(), { group: `command:${group}` })
  historyRevision.value += 1
  emit('manual-edit')
}

function applyHistorySnapshot(snapshot: ManuscriptEditSnapshot, direction: 'undo' | 'redo') {
  clearSyncTimer()
  titleDraft.value = snapshot.title
  contentDraft.value = snapshot.content
  historyRevision.value += 1
  emit('manual-edit')
  emit('history-restore', direction)
  scheduleSync(0)
  void nextTick(() => {
    const target = editor.value
    if (!target) return
    const start = Math.min(snapshot.selectionStart, contentDraft.value.length)
    const end = Math.min(snapshot.selectionEnd, contentDraft.value.length)
    target.focus()
    target.setSelectionRange(start, end)
    reportSelection()
    requestCursorCenter(true)
  })
}

function undoEdit() {
  if (props.readOnly) return
  const snapshot = editHistory.undo(currentEditSnapshot())
  if (snapshot) applyHistorySnapshot(snapshot, 'undo')
}

function redoEdit() {
  if (props.readOnly) return
  const snapshot = editHistory.redo(currentEditSnapshot())
  if (snapshot) applyHistorySnapshot(snapshot, 'redo')
}

function toggleTypewriter() {
  typewriterMode.value = !typewriterMode.value
  localStorage.setItem('lanjian-editor-typewriter', String(typewriterMode.value))
  if (typewriterMode.value) requestCursorCenter(true)
  editor.value?.focus()
}

function closeLayoutPanel(returnFocus = false) {
  layoutOpen.value = false
  if (returnFocus) void nextTick(() => layoutTrigger.value?.focus())
}

function positionLayoutPanel() {
  const head = manuscriptHead.value
  const trigger = layoutTrigger.value
  const panel = layoutPanel.value
  if (!layoutOpen.value || !head || !trigger || !panel) return
  const headRect = head.getBoundingClientRect()
  const triggerRect = trigger.getBoundingClientRect()
  const panelWidth = panel.offsetWidth
  const preferredLeft = triggerRect.left - headRect.left
  const availableLeft = Math.max(0, headRect.width - panelWidth)
  const left = Math.min(Math.max(0, preferredLeft), availableLeft)
  layoutPanelStyle.value = {
    insetBlockStart: `${Math.max(0, triggerRect.bottom - headRect.top + 8)}px`,
    insetInlineStart: `${left}px`,
    insetInlineEnd: 'auto'
  }
}

async function toggleLayoutPanel() {
  layoutOpen.value = !layoutOpen.value
  if (!layoutOpen.value) return
  await nextTick()
  positionLayoutPanel()
  layoutPanel.value?.querySelector<HTMLSelectElement>('select')?.focus()
}

function toggleTypewriterFromMenu() {
  closeLayoutPanel()
  toggleTypewriter()
}

function toggleFocusFromMenu() {
  closeLayoutPanel()
  toggleFocusMode()
}

function toggleAssistantFromMenu() {
  closeLayoutPanel()
  emit('assistant-toggle')
}

function openHistoryFromMenu() {
  closeLayoutPanel()
  emit('history')
}

function toggleFocusMode(value = !focusMode.value) {
  focusMode.value = value
  emit('focus-mode', value)
  void nextTick(() => editor.value?.focus())
}

function saveLayoutPreferences() {
  saveEditorPreferences()
  localStorage.setItem('lanjian-editor-paper-theme', paperTheme.value)
  localStorage.setItem('lanjian-editor-paragraph-spacing', String(paragraphSpacing.value))
  localStorage.setItem('lanjian-editor-first-line-indent', String(firstLineIndent.value))
}

function setGuideStyle(value: EditorGuideStyle) {
  guideStyle.value = value
  saveLayoutPreferences()
}

function resetLayoutPreferences() {
  resetEditorPreferences()
  paperTheme.value = 'theme'
  paragraphSpacing.value = true
  firstLineIndent.value = true
  saveLayoutPreferences()
}

function requestCursorCenter(force = false) {
  if (!typewriterMode.value && !force) return
  if (centerFrame !== null) cancelAnimationFrame(centerFrame)
  centerFrame = requestAnimationFrame(() => {
    centerFrame = null
    const target = editor.value
    if (!target) return
    target.centerSelection()
  })
}

async function saveManuscript() {
  if (props.readOnly) return
  await flush()
  emit('save')
}

function selectionSnapshot() {
  const target = editor.value
  if (!target || target.selectionEnd <= target.selectionStart) return null
  return {
    start: target.selectionStart,
    end: target.selectionEnd,
    text: contentDraft.value.slice(target.selectionStart, target.selectionEnd)
  }
}

function insertionAnchorSnapshot(): WritingAgentInsertionAnchor | null {
  const target = editor.value
  if (!target) return null
  const offset = Math.min(target.selectionEnd, contentDraft.value.length)
  return {
    offset,
    before: contentDraft.value.slice(Math.max(0, offset - 120), offset),
    after: contentDraft.value.slice(offset, offset + 120)
  }
}

function reportSelection() {
  const selection = selectionSnapshot()
  selectionText.value = selection?.text || ''
  emit('selection-change', selection)
  const anchor = insertionAnchorSnapshot()
  if (anchor) emit('anchor-change', anchor)
}

function openSelectionAiMenu(event: MouseEvent) {
  reportSelection()
  if (!selectionSnapshot() || props.readOnly) return
  event.preventDefault()
  emit('selection-ai-menu')
}

defineExpose({ flush, focus: () => editor.value?.focus(), locateText, selectionSnapshot, insertionAnchorSnapshot })

onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !manuscriptHead.value) return
  layoutPlacementObserver = new ResizeObserver(positionLayoutPanel)
  layoutPlacementObserver.observe(manuscriptHead.value)
})

onBeforeUnmount(() => {
  if (!composing.value) syncNow()
  compositionFlushWaiters.clear()
  emit('focus-mode', false)
  if (centerFrame !== null) cancelAnimationFrame(centerFrame)
  layoutPlacementObserver?.disconnect()
})
</script>

<template>
  <article class="manuscript-editor" :class="{ 'is-focus-mode': focusMode, 'is-typewriter-mode': typewriterMode, 'is-read-only': readOnly, 'has-conflict': Boolean(conflict), 'editor-guides-hidden': guideStyle === 'off' }" :data-guide-style="guideStyle" data-testid="manuscript-editor">
    <header ref="manuscriptHead" class="manuscript-head">
      <nav class="writing-toolbar" aria-label="正文编辑工具">
        <div class="writing-tool-group">
          <span class="history-tool-group" role="group" aria-label="编辑与查找">
            <button type="button" class="editor-icon-tool" data-testid="manuscript-undo" title="撤销（Ctrl+Z）" aria-label="撤销" :disabled="readOnly || !canUndo" @mousedown.prevent @click="undoEdit"><StudioIcon name="undo" :size="18"/></button>
            <button type="button" class="editor-icon-tool" data-testid="manuscript-redo" title="重做（Ctrl+Y 或 Ctrl+Shift+Z）" aria-label="重做" :disabled="readOnly || !canRedo" @mousedown.prevent @click="redoEdit"><StudioIcon name="redo" :size="18"/></button>
            <button type="button" class="editor-icon-tool" data-testid="manuscript-find" title="查找与替换（Ctrl+F）" aria-label="查找与替换" :aria-pressed="findOpen" @mousedown.prevent @click="findOpen ? closeFind() : openFind()"><StudioIcon name="search" :size="18"/></button>
          </span>
          <button type="button" class="direct-format-action" data-testid="manuscript-format" title="一键排版：按当前版式统一段落缩进和段间空行" aria-label="一键排版" :disabled="readOnly || !contentDraft.trim()" @click="formatParagraphs"><StudioIcon name="outline" :size="17"/><span class="tool-label">一键排版</span></button>
          <button ref="layoutTrigger" type="button" class="direct-layout-action" data-testid="manuscript-layout" title="调整字体、行距、行宽和纸张" aria-label="正文版式" :class="{ active: layoutOpen }" :aria-expanded="layoutOpen" aria-controls="manuscript-layout-panel" @click="toggleLayoutPanel"><StudioIcon name="panel" :size="16"/><span>版式</span><i aria-hidden="true"></i></button>
          <button type="button" data-testid="manuscript-typewriter" title="让当前输入行保持在视野中央" aria-label="跟随输入" :class="{ active: typewriterMode }" :aria-pressed="typewriterMode" @click="toggleTypewriterFromMenu"><StudioIcon name="events" :size="17"/><span class="tool-label">跟随输入</span></button>
          <button type="button" data-testid="manuscript-focus" title="专注模式（Esc 退出）" aria-label="专注模式" :class="{ active: focusMode }" :aria-pressed="focusMode" @click="toggleFocusFromMenu"><StudioIcon name="panel" :size="17"/><span class="tool-label">{{ focusMode ? '退出专注' : '专注模式' }}</span></button>
        </div>
        <button v-if="focusMode" type="button" data-testid="manuscript-focus-assistant" class="focus-assistant-toggle" :aria-pressed="assistantOpen" @click="toggleAssistantFromMenu">{{ assistantOpen ? '收起智能助笔' : '打开智能助笔' }}</button>
          <button v-if="focusMode" type="button" data-testid="focus-workspace-guidance" aria-label="写作指引" aria-haspopup="dialog" aria-controls="workspace-guidance-panel" aria-expanded="false" @click="emit('guidance', $event)"><StudioIcon name="outline" :size="16"/>写作指引</button>
      </nav>
      <section v-if="layoutOpen" id="manuscript-layout-panel" ref="layoutPanel" class="writing-layout-popover" role="dialog" aria-label="正文版式" :style="layoutPanelStyle" @change="saveLayoutPreferences" @keydown.esc.stop.prevent="closeLayoutPanel(true)">
        <header><div><b>正文版式</b><span>只改变阅读与输入方式；“一键排版”才会整理正文字符。</span></div><button type="button" aria-label="关闭版式" @click="closeLayoutPanel(true)">关闭</button></header>
        <div class="layout-control-grid">
          <label class="layout-font"><span>字体</span><select v-assist-field="{ id: 'ManuscriptEditor.fontFamily', read: () => fontFamily, write: value => { fontFamily = String(value) } }" v-model="fontFamily"><option value="serif">岚笺宋体</option><option value="song">系统宋体</option><option value="kai">系统楷体</option><option value="sans">系统黑体</option></select></label>
          <label><span>字号 <em>{{ Math.round(fontScale * 16) }} px</em></span><input v-assist-field="{ id: 'ManuscriptEditor.fontScale', read: () => fontScale, write: value => { fontScale = Number(value); saveLayoutPreferences() } }" v-model.number="fontScale" type="range" min="0.85" max="1.25" step="0.05" @input="saveLayoutPreferences"></label>
          <label><span>行距 <em>{{ editorLeading.toFixed(2) }}</em></span><input v-assist-field="{ id: 'ManuscriptEditor.editorLeading', read: () => editorLeading, write: value => { editorLeading = Number(value); saveLayoutPreferences() } }" v-model.number="editorLeading" type="range" min="1.6" max="2.5" step="0.05" @input="saveLayoutPreferences"></label>
          <label><span>行宽 <em>{{ pageWidth }} px</em></span><input v-assist-field="{ id: 'ManuscriptEditor.pageWidth', read: () => pageWidth, write: value => { pageWidth = Number(value); saveLayoutPreferences() } }" v-model.number="pageWidth" type="range" min="620" max="980" step="20" @input="saveLayoutPreferences"></label>
        </div>
        <div class="layout-switches">
          <label><input v-assist-field="{ id: 'ManuscriptEditor.paragraphSpacing', read: () => paragraphSpacing, write: value => { paragraphSpacing = Boolean(value) } }" v-model="paragraphSpacing" type="checkbox"><span>段间空行</span></label>
          <label><input v-assist-field="{ id: 'ManuscriptEditor.firstLineIndent', read: () => firstLineIndent, write: value => { firstLineIndent = Boolean(value) } }" v-model="firstLineIndent" type="checkbox"><span>首行缩进</span></label>
        </div>
        <div class="layout-choice-row"><span>横线</span><div class="line-choice" role="group" aria-label="横线辅助样式"><button v-for="item in guideStyleOptions" :key="item.id" type="button" :class="{ selected: guideStyle === item.id }" :aria-pressed="guideStyle === item.id" @click="setGuideStyle(item.id)"><i :class="item.id"></i>{{ item.label }}</button></div></div>

        <div class="layout-choice-row"><span>背景</span><div class="paper-choice" role="group" aria-label="编辑背景"><button v-for="item in [{ id: 'theme', label: '跟随主题' }, { id: 'rice', label: '米纸' }, { id: 'green', label: '护眼' }, { id: 'gray', label: '雾灰' }, { id: 'night', label: '夜墨' }]" :key="item.id" type="button" :class="[item.id, { selected: paperTheme === item.id }]" :aria-pressed="paperTheme === item.id" @click="paperTheme = item.id; saveLayoutPreferences()"><i></i>{{ item.label }}</button></div></div>
        <footer><span>回车会按当前“段间空行 / 首行缩进”继续下一段。</span><button type="button" @click="resetLayoutPreferences">恢复默认</button></footer>
      </section>
      <form v-if="findOpen" class="manuscript-find" @submit.prevent="selectMatch(currentMatch + 1)" @keydown.esc.prevent.stop="closeFind">
        <label><span>查找</span><input v-assist-field="{ id: 'ManuscriptEditor.findQuery', read: () => findQuery, write: value => { findQuery = String(value) } }" ref="findInput" v-model="findQuery" aria-label="查找正文" autocomplete="off"></label>
        <span class="match-count" aria-live="polite">{{ matches.length ? `${currentMatch + 1} / ${matches.length}` : '没有匹配' }}</span>
        <button type="button" aria-label="上一个匹配" :disabled="!matches.length" @click="selectMatch(currentMatch - 1)">上一处</button>
        <button type="submit" :disabled="!matches.length">下一处</button>
        <label><span>替换</span><input v-assist-field="{ id: 'ManuscriptEditor.replaceText', read: () => replaceText, write: value => { replaceText = String(value) } }" v-model="replaceText" aria-label="替换为" autocomplete="off" :disabled="readOnly"></label>
        <button type="button" :disabled="readOnly || !matches.length" @click="replaceCurrent">替换</button>
        <button type="button" :disabled="readOnly || !matches.length" @click="replaceAll">全部替换</button>
        <button class="find-close" type="button" aria-label="关闭查找" @click="closeFind">关闭</button>
      </form>
    </header>

    <div class="manuscript-page" :class="[`paper-${paperTheme}`]" :style="manuscriptPageStyle">
      <div v-if="readOnly" class="manuscript-read-only" data-testid="manuscript-order-read-only">章序账本待核对：当前仅按稳定文件编号列出正文，叙事顺序未知，所有改写动作已暂停。</div>
      <label class="manuscript-title-row">
        <span class="manuscript-chapter-label">第 {{ position }} 章</span>
        <input v-assist-field="{ id: 'ManuscriptEditor.titleDraft', read: () => titleDraft, write: value => { recordCommand('assistant-title'); titleDraft = String(value); onTitleInput() }, identity: () => chapterId }" v-model="titleDraft" data-testid="manuscript-title-input" aria-label="章节标题" title="修改章节标题" maxlength="120" autocomplete="off" placeholder="填写章节标题" :readonly="readOnly" @beforeinput="recordBeforeInput($event, 'title')" @input="onTitleInput" @keydown="onTitleKeydown" @compositionstart="beginComposition" @compositionend="endTitleComposition">
      </label>
      <PlainTextEditor ref="editor" v-model="contentDraft" :document-key="String(chapterId)" class="manuscript" :style="manuscriptPageStyle" test-id="manuscript-input" aria-label="章节正文" title="选中文字后按 Ctrl+Shift+A，或右键交给智能助笔" placeholder="从这里开始写……" :read-only="readOnly" :native-search="false" comfortable-caret external-history @beforeinput="interceptContentHistory" @before-change="recordContentChange" @update:model-value="onContentInput" @keydown="onEditorKeydown" @selection="reportSelection(); requestCursorCenter()" @contextmenu="openSelectionAiMenu" @composition-start="beginComposition" @composition-end="endContentComposition" />
    </div>

    <section v-if="conflict" class="manuscript-conflict" role="alert" data-testid="manuscript-conflict" :data-expected-revision="conflict.expectedRevision" :data-external-revision="conflict.externalChapter?.revision">
      <header><div><b>检测到磁盘正文冲突</b><span>{{ conflict.reason === 'missing' ? '原正文已被移动或删除' : '原正文已被其他程序修改' }}，岚笺没有覆盖它。</span></div></header>
      <div class="manuscript-conflict-versions">
        <article><b>共同基线</b><small>{{ conflict.baseTitle || '未命名' }}</small><p>{{ conflict.baseContent.slice(0, 180) || '（空白）' }}</p></article>
        <article class="local"><b>岚笺草稿</b><small>{{ conflict.localTitle || '未命名' }}</small><p>{{ conflict.localContent.slice(0, 180) || '（空白）' }}</p></article>
        <article><b>磁盘版本</b><small>{{ conflict.externalChapter?.title || '文件不存在' }}</small><p>{{ conflict.externalChapter?.content?.slice(0, 180) || '（无法读取）' }}</p></article>
      </div>
      <footer><span>离开当前章节前必须先处理；你的草稿仍完整保留。</span><button type="button" data-testid="recover-manuscript-conflict" @click="emit('recover-conflict')">{{ conflict.reason === 'missing' ? '备份当前草稿' : '备份草稿并载入磁盘版本' }}</button></footer>
    </section>

    <section v-if="storageMode === 'sqlite' && (mirrorStatus === 'conflict' || mirrorStatus === 'failed')" class="manuscript-mirror-notice" :class="mirrorStatus" role="alert" data-testid="manuscript-mirror-notice">
      <i aria-hidden="true">镜</i><div><b>{{ mirrorStatus === 'conflict' ? 'Markdown 有外部修改' : 'Markdown 写回失败' }}</b><span>{{ mirrorStatus === 'conflict' ? 'SQLite 与可读正文都已保留；请先查看差异，再决定是否把 Markdown 收为新版本。' : '正文已安全存入本地数据库；可到“设置 → 项目数据”重新同步。' }}</span></div><button v-if="mirrorStatus === 'conflict'" type="button" data-testid="recover-external-mirror" @click="emit('recover-mirror')">查看并恢复</button>
    </section>

    <footer class="editor-foot">
      <WorkspaceStorageStatus :label="saveLabel" :state="visibleSaveState" />
      <div class="manuscript-metrics" aria-label="正文统计"><span>第 {{ position }} 章</span><i></i><span>本章 {{ wordCount.toLocaleString() }} 字</span><template v-if="selectedWordCount"><i></i><span class="selection-count" data-testid="manuscript-selection-word-count">选区 {{ selectedWordCount.toLocaleString() }} 字</span></template><i></i><span class="project-count" data-testid="manuscript-project-word-count">全书 {{ projectWordCount.toLocaleString() }} 字</span><i></i><span>{{ paragraphCount }} 段</span><em v-if="focusMode">按 Esc 退出专注</em></div>
      <div class="manuscript-actions">
        <span class="editor-save-state sr-only" :class="visibleSaveState" data-testid="manuscript-save-state">{{ saveLabel }}</span>
        <details class="manuscript-more-actions"><summary aria-label="更多正文操作" title="章节确认与删除">…</summary><div><button class="danger-link" type="button" :disabled="readOnly" @click="emit('delete')">移至回收站</button><button v-if="lifecycleStatus" class="history-action chapter-confirm-action" type="button" data-testid="confirm-current-chapter" :class="{ confirmed: lifecycleStatus === 'CONFIRMED' && !hasUnconfirmedChanges }" :disabled="readOnly || chapterConfirming || !contentDraft.trim() || (lifecycleStatus === 'CONFIRMED' && !hasUnconfirmedChanges)" @click="emit('confirm')">{{ confirmationLabel }}</button></div></details>
        <button class="history-action archive-history-action" type="button" data-testid="open-manuscript-history" aria-label="历史版本" title="历史版本" @click="openHistoryFromMenu"><StudioIcon name="history" :size="17"/><span>历史版本</span></button>
        <button class="control-button primary editor-save-button save-action" data-testid="save-manuscript" :data-save-action="visibleSaveState === 'error' ? 'retry' : 'save'" type="button" :disabled="readOnly || visibleSaveState === 'saving'" @click="saveManuscript"><StudioIcon name="save" :size="17"/>{{ visibleSaveState === 'saving' ? '正在保存…' : visibleSaveState === 'error' ? '重试保存' : '立即保存' }}</button>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.manuscript-editor .direct-layout-action { display: inline-flex; align-items: center; }
.direct-layout-action > i { inline-size: .4em; block-size: .4em; border-inline-end: 1px solid currentColor; border-block-end: 1px solid currentColor; transform: translateY(-.15em) rotate(45deg); margin-inline-start: .25em; }
.direct-layout-action[aria-expanded="true"] > i { transform: translateY(.1em) rotate(225deg); }
.manuscript-editor .writing-layout-popover { inset-block-start: 100%; inset-inline-end: 0; inline-size: min(29rem, 100%); max-block-size: min(38rem, calc(100dvh - var(--archive-header-size, 3rem) - var(--archive-toolbar-size, 4rem) - 2rem)); box-sizing: border-box; overflow: auto; padding: 0 1rem; border-radius: .125rem; background: var(--surface); }
.writing-layout-popover > header { min-block-size: 4rem; gap: 1rem; padding-block: .5rem; }
.writing-layout-popover > header > div { gap: .25rem; }
.writing-layout-popover > header b { font-size: .9375rem; }
.writing-layout-popover > header span, .writing-layout-popover > footer span { font-size: .75rem; }
.writing-layout-popover > header button, .writing-layout-popover > footer button { padding: .5rem; font-size: .8125rem; }
.layout-control-grid { gap: 1rem; padding-block: 1rem; }
.layout-control-grid > label { gap: .5rem; font-size: .8125rem; }
.layout-control-grid em { font-size: .6875rem; }
.layout-control-grid select { block-size: 2.25rem; padding-inline: .5rem; background: var(--surface); }
.layout-switches { flex-wrap: wrap; gap: .75rem 1rem; padding-block-end: 1rem; }
.layout-switches label { gap: .5rem; font-size: .8125rem; }
.layout-switches input { inline-size: 1rem; block-size: 1rem; }
.layout-choice-row { grid-template-columns: auto minmax(0, 1fr); gap: .5rem; padding-block-start: 1rem; }
.paper-choice { grid-template-columns: repeat(auto-fit, minmax(4rem, 1fr)); gap: .375rem; }
.paper-choice button { block-size: auto; min-block-size: 3rem; padding: .375rem; font-size: .75rem; }
.writing-layout-popover > footer { gap: 1rem; margin-block-start: 1rem; padding-block: .5rem; }
.focus-assistant-toggle { margin-block-start: .75rem; padding: .5rem .75rem; border: 1px solid var(--line); color: var(--ink); background: var(--surface); font: .8125rem var(--sans); }
</style>
