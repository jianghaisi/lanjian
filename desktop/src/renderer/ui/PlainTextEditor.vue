<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { inlineReviewExtension, setInlineReviews, type InlineReviewItem } from '../features/document-review/inline-review'
import { snapshotChange } from '../../contracts/document-review/text-change'
import type { TextChange } from '../../contracts/document-review/anchors'
import { annotationMarkExtension, setAnnotationMarks, type AnnotationMark } from '../features/document-review/annotation-marks'
import { EditorView, keymap, placeholder as emptyHint } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth } from '@codemirror/commands'
import { searchKeymap, openSearchPanel, searchPanelOpen } from '@codemirror/search'
import { editorSearchExtensions } from '../features/manuscript/services/editor-search'
import { registerAssistantField, requestFieldAssistant, type FieldBinding } from '../features/assistant/services/assistant-field-registry'

import EditorToolbar from './EditorToolbar.vue'
import StudioIcon from './StudioIcon.vue'
import { useEditorPreferences } from '../features/manuscript/composables/editor-preferences'
import { formatEditorTransaction } from '../features/manuscript/services/editor-commands'
import { formatOutlineWhitespace } from '../features/planning/services/outline-formatting'

const props = withDefaults(defineProps<{
  modelValue: string
  documentKey: string
  ariaLabel: string
  placeholder?: string
  readOnly?: boolean
  interactionLocked?: boolean
  externalHistory?: boolean
  nativeSearch?: boolean
  comfortableCaret?: boolean
  testId?: string
  assistantField?: FieldBinding
  editingTools?: 'outline'
  reviews?: readonly InlineReviewItem[]
  annotations?: readonly AnnotationMark[]
  annotationTools?: boolean
  annotationOpen?: boolean
}>(), { nativeSearch: true })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  save: []
  selection: [value: { start: number; end: number; text: string }]
  'before-change': [value: { content: string; start: number; end: number; group: string }]
  beforeinput: [event: InputEvent]
  keydown: [event: KeyboardEvent]
  contextmenu: [event: MouseEvent]
  'composition-start': []
  'composition-end': [text: string]
  'review-action': [id: string, action: 'retain' | 'reject']
  'annotation-toggle': []
  'annotation-select': [id: string]
  'document-change': [value: { before: string; content: string; changes: TextChange[]; userEvent: string }]
}>()
const host = ref<HTMLDivElement | null>(null)
const editable = new Compartment()
const composing = ref(false)
const hasSelection = ref(false)
const canUndo = ref(false), canRedo = ref(false), findOpen = ref(false), layoutOpen = ref(false)
const layoutButton = ref<HTMLButtonElement | null>(null)
const { fontScale, leading, fontFamily, fontFamilyCss, pageWidth, save: saveEditorPreferences } = useEditorPreferences()
const outlineStyle = computed(() => props.editingTools ? ({
  fontSize: String(16 * fontScale.value) + 'px', lineHeight: String(leading.value),
  fontFamily: fontFamilyCss.value, '--document-page-width': String(pageWidth.value) + 'px'
}) : undefined)
function updateTools() {
  canUndo.value = Boolean(view && !props.externalHistory && undoDepth(view.state))
  canRedo.value = Boolean(view && !props.externalHistory && redoDepth(view.state))
  findOpen.value = Boolean(view && searchPanelOpen(view.state))
}
function editHistory(direction: 'undo' | 'redo') {
  if (!view || props.externalHistory || props.readOnly || props.interactionLocked || view.composing || composing.value) return false
  const result = (direction === 'undo' ? undo : redo)(view)
  view.focus()
  return result
}
function find() { if (view && !view.composing) openSearchPanel(view) }
function formatText(format = formatOutlineWhitespace) {
  if (!view || props.readOnly || props.interactionLocked || view.composing || composing.value) return false
  const transaction = formatEditorTransaction(view.state, format)
  if (!transaction) return false
  view.dispatch(transaction)
  view.focus()
  return true
}
function updateFontFamily(value: unknown) { if (value === 'serif' || value === 'song' || value === 'kai' || value === 'sans') { fontFamily.value = value; saveEditorPreferences() } }
function closeLayout() { layoutOpen.value = false; layoutButton.value?.focus() }
let view: EditorView | null = null
let applyingExternal = false
let compositionFrame: number | null = null
let fieldRegistration: ReturnType<typeof registerAssistantField> | null = null

function createState() {
  return EditorState.create({
    doc: props.modelValue,
    extensions: [
      // Split only LF: any literal CR remains data rather than being silently normalized.
      EditorState.lineSeparator.of('\n'),
      inlineReviewExtension((id, action) => emit('review-action', id, action)),
      annotationMarkExtension(id => emit('annotation-select', id)),
      ...(props.nativeSearch ? editorSearchExtensions() : []),
      editable.of([EditorState.readOnly.of(Boolean(props.readOnly || props.interactionLocked)), EditorView.editable.of(!props.readOnly && !props.interactionLocked)]),
      EditorView.lineWrapping, ...(props.externalHistory ? [] : [history()]), emptyHint(props.placeholder || ''),
      ...(props.comfortableCaret ? [
        EditorView.cursorScrollMargin.of({ x: 8, y: 96 }),
        EditorView.scrollMargins.of((editorView) => ({
          bottom: Math.min(240, Math.max(96, editorView.scrollDOM.clientHeight * 0.28))
        }))
      ] : []),
      EditorView.contentAttributes.of(() => ({ 'aria-label': props.ariaLabel, 'aria-readonly': String(Boolean(props.readOnly || props.interactionLocked)), tabindex: '0', spellcheck: 'false', ...(props.testId ? { 'data-testid': props.testId } : {}) })),
      Prec.highest(EditorView.domEventHandlers({
        beforeinput: (event) => { emit('beforeinput', event); return event.defaultPrevented },
        keydown: (event, editor) => {
          emit('keydown', event)
          if (event.defaultPrevented) return true
          if (!props.readOnly || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
          const scroll = editor.scrollDOM
          if (event.key === 'PageDown') scroll.scrollTop += scroll.clientHeight * .85
          else if (event.key === 'PageUp') scroll.scrollTop -= scroll.clientHeight * .85
          else if (event.key === 'Home') scroll.scrollTop = 0
          else if (event.key === 'End') scroll.scrollTop = scroll.scrollHeight
          else return false
          event.preventDefault()
          return true
        },
        contextmenu: (event) => { emit('contextmenu', event); return event.defaultPrevented },
        compositionstart: () => { composing.value = true; emit('composition-start'); return false },
        compositionend: () => {
          if (compositionFrame !== null) cancelAnimationFrame(compositionFrame)
          compositionFrame = requestAnimationFrame(() => {
            compositionFrame = null
            composing.value = false
            if (view) emit('composition-end', view.state.doc.toString())
          })
          return false
        }
      })),
      // Search Escape must run before defaultKeymap's selection simplification.
      keymap.of([{ key: 'Mod-s', run: () => { if (!props.readOnly) emit('save'); return true } },
        { key: 'Mod-Shift-m', run: () => { if (props.annotationTools && !props.readOnly && !view?.composing) { emit('annotation-toggle'); return true } return false } },
        ...(props.nativeSearch ? searchKeymap : []), ...defaultKeymap, ...(props.externalHistory ? [] : historyKeymap)]),
      EditorView.updateListener.of((update) => {
        updateTools()
        if (update.docChanged) {
          const changes: TextChange[] = []
          update.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, insert: inserted.toString() }))
          emit('document-change', { before: update.startState.doc.toString(), content: update.state.doc.toString(), changes,
            userEvent: update.transactions.map(transaction => transaction.annotation(Transaction.userEvent) || '').join(' ') })
        }
        if (update.docChanged && !applyingExternal) {
          const previous = update.startState.selection.main
          emit('before-change', { content: update.startState.doc.toString(), start: previous.from, end: previous.to,
            group: update.transactions.some((transaction) => transaction.isUserEvent('input.review')) ? 'review' : update.transactions.some((transaction) => transaction.isUserEvent('delete')) ? 'delete' : 'typing' })
          emit('update:modelValue', update.state.doc.toString())
        }
        if (update.docChanged || update.selectionSet) {
          const range = update.state.selection.main
          hasSelection.value = !range.empty
          emit('selection', { start: range.from, end: range.to, text: update.state.sliceDoc(range.from, range.to) })
        }
      }),
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent', color: 'inherit', fontSize: 'inherit' },
        '&.cm-focused': { outline: 'none' },
        '.cm-content[aria-readonly=true]:focus-visible': { outline: '2px solid var(--jade)', outlineOffset: '-2px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: 'inherit' },
        '.cm-content': { padding: '20px 0 30vh', minHeight: '100%', caretColor: 'var(--accent, #315c52)' },
        '.cm-line': { padding: '0 clamp(20px, 4vw, 56px)' },
        '.cm-selectionBackground': { background: 'rgba(49, 92, 82, .18) !important' },
        '.cm-panels': { fontFamily: 'var(--sans)', fontSize: '13px', background: 'var(--surface-raised)', color: 'var(--ink)' }
      })
    ]
  })
}

function synchronize() {
  if (!view || view.composing || view.state.doc.toString() === props.modelValue) return
  applyingExternal = true
  try {
    view.dispatch({ changes: snapshotChange(view.state.doc.toString(), props.modelValue), annotations: Transaction.addToHistory.of(false) })
  } finally { applyingExternal = false }
}

function moveToStart() {
  if (!view) return
  view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
  view.scrollDOM.scrollTop = 0
  view.scrollDOM.scrollLeft = 0
}

watch(() => props.modelValue, synchronize)
watch(() => props.reviews, reviews => view?.dispatch({ effects: setInlineReviews.of(reviews || []) }), { deep: true })
watch(() => props.annotations, annotations => view?.dispatch({ effects: setAnnotationMarks.of(annotations || []) }), { deep: true })
watch(() => props.documentKey, () => {
  if (!view) return
  view.setState(createState()) // Never carry another document's undo history or viewport.
  composing.value = false
  layoutOpen.value = false
  updateTools()
  view.dispatch({ effects: setInlineReviews.of(props.reviews || []) })
  view.dispatch({ effects: setAnnotationMarks.of(props.annotations || []) })
  moveToStart()
})
watch(() => [props.readOnly, props.interactionLocked], () => view?.dispatch({ effects: editable.reconfigure([
  EditorState.readOnly.of(Boolean(props.readOnly || props.interactionLocked)), EditorView.editable.of(!props.readOnly && !props.interactionLocked)
]) }))
onMounted(() => {
  view = new EditorView({ state: createState(), parent: host.value! })
  view.dispatch({ effects: [setInlineReviews.of(props.reviews || []), setAnnotationMarks.of(props.annotations || [])] })
  updateTools()
  if (props.assistantField) {
    fieldRegistration = registerAssistantField({
      ...props.assistantField,
      read: () => props.modelValue,
      identity: () => props.documentKey,
      available: () => !props.readOnly,
      write: (value: unknown) => {
        if (!view || view.composing || props.readOnly) throw new Error('编辑器当前无法回填，请结束输入后重试。')
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(value) }, annotations: Transaction.userEvent.of('input.assistant') })
      }
    }, view.contentDOM)
    view.contentDOM.dataset.assistantField = props.assistantField.id
    view.contentDOM.addEventListener('keydown', fieldShortcut)
    view.contentDOM.addEventListener('compositionstart', fieldCompositionStart)
    view.contentDOM.addEventListener('compositionend', fieldCompositionEnd)
  }
})
function fieldShortcut(event: KeyboardEvent) { if (event.altKey && event.key === 'Enter' && fieldRegistration) { event.preventDefault();requestFieldAssistant(fieldRegistration.key) } }
function fieldCompositionStart() { fieldRegistration?.composing(true) }
function fieldCompositionEnd() { queueMicrotask(() => fieldRegistration?.composing(false)) }
onBeforeUnmount(() => {
  fieldRegistration?.dispose()
  view?.contentDOM.removeEventListener('keydown', fieldShortcut)
  view?.contentDOM.removeEventListener('compositionstart', fieldCompositionStart)
  view?.contentDOM.removeEventListener('compositionend', fieldCompositionEnd)
  if (compositionFrame !== null) cancelAnimationFrame(compositionFrame)
  view?.destroy(); view = null
})
function select(start: number, end = start) {
  if (!view) return
  const bound = (value: number) => Math.max(0, Math.min(view!.state.doc.length, value))
  view.dispatch({ selection: { anchor: bound(start), head: bound(end) }, scrollIntoView: true })
}
defineExpose({
  applyReview: (expected: string, start: number, end: number, replacement: string) => {
    if (!view || props.readOnly || view.composing || composing.value || view.state.doc.toString() !== expected || start < 0 || end < start || end > expected.length) return false
    view.dispatch({ changes: { from: start, to: end, insert: replacement }, selection: { anchor: start + replacement.length },
      annotations: [Transaction.userEvent.of('input.review'), isolateHistory.of('full')] })
    return true
  },
  undo: () => editHistory('undo'), redo: () => editHistory('redo'), find, formatText,
  viewSnapshot: () => view ? { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head, top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft } : null,
  restoreView: (snapshot: { anchor: number; head: number; top: number; left: number } | null) => {
    if (!view || !snapshot) return
    const bound = (offset: number) => Math.max(0, Math.min(view!.state.doc.length, offset))
    view.dispatch({ selection: { anchor: bound(snapshot.anchor), head: bound(snapshot.head) } })
    view.scrollDOM.scrollTop = snapshot.top; view.scrollDOM.scrollLeft = snapshot.left
  },
  insertText: (text: string) => {
    if (!view || view.composing || props.readOnly || props.interactionLocked) return false
    const selection = view.state.selection.main
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length }, annotations: Transaction.userEvent.of('input.template') })
    view.focus()
    return true
  },
  focus: () => view?.focus(),
  text: () => view?.state.doc.toString() ?? props.modelValue,
  get selectionStart() { return view?.state.selection.main.from ?? 0 },
  get selectionEnd() { return view?.state.selection.main.to ?? 0 },
  setSelectionRange: select,
  select,
  moveToStart,
  centerSelection: () => { if (view) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) }) }
})
</script>

<template>
  <div class="plain-text-editor" :class="{ 'has-editing-tools': editingTools }">
    <div v-if="editingTools" class="outline-editing-toolbar" aria-label="大纲编辑工具">
      <EditorToolbar prefix="outline" :read-only="readOnly || interactionLocked" :composing="composing" :can-undo="canUndo" :can-redo="canRedo" :empty="!modelValue.trim()" :find-open="findOpen" format-title="一键排版：整理空白，保留标题、列表和代码结构" @undo="editHistory('undo')" @redo="editHistory('redo')" @find="find" @format="formatText()">
        <button ref="layoutButton" type="button" data-testid="outline-layout" aria-label="大纲版式" :aria-expanded="layoutOpen" @click="layoutOpen = !layoutOpen"><StudioIcon name="panel" :size="16"/>版式</button>
        <button v-if="annotationTools" type="button" data-testid="outline-annotations" :aria-expanded="annotationOpen" :disabled="composing" title="批注（Ctrl+Shift+M）" @click="emit('annotation-toggle')">批注</button>
      </EditorToolbar>
    </div>
    <section v-if="editingTools && layoutOpen" class="outline-layout-panel" aria-label="大纲版式" @keydown.esc.stop.prevent="closeLayout">
      <label>字体<select v-assist-field="{ id: 'ManuscriptEditor.fontFamily', read: () => fontFamily, write: updateFontFamily }" v-model="fontFamily" @change="saveEditorPreferences"><option value="serif">岚笺宋体</option><option value="song">系统宋体</option><option value="kai">系统楷体</option><option value="sans">系统黑体</option></select></label>
      <label>字号 {{ Math.round(fontScale * 16) }} px<input v-assist-field="{ id: 'ManuscriptEditor.fontScale', read: () => fontScale, write: (value: unknown) => { fontScale = Number(value); saveEditorPreferences() } }" v-model.number="fontScale" aria-label="大纲字号" type="range" min="0.85" max="1.25" step="0.05" @input="saveEditorPreferences"></label>
      <label>行距 {{ leading.toFixed(2) }}<input v-assist-field="{ id: 'ManuscriptEditor.editorLeading', read: () => leading, write: (value: unknown) => { leading = Number(value); saveEditorPreferences() } }" v-model.number="leading" aria-label="大纲行距" type="range" min="1.6" max="2.5" step="0.05" @input="saveEditorPreferences"></label>
      <label>行宽 {{ pageWidth }} px<input v-assist-field="{ id: 'ManuscriptEditor.pageWidth', read: () => pageWidth, write: (value: unknown) => { pageWidth = Number(value); saveEditorPreferences() } }" v-model.number="pageWidth" aria-label="大纲行宽" type="range" min="620" max="980" step="20" @input="saveEditorPreferences"></label>
      <button type="button" aria-label="关闭大纲版式" @click="closeLayout">关闭</button>
    </section>
    <button v-if="annotationTools && hasSelection && !annotationOpen" type="button" class="selection-annotation-action" :disabled="readOnly || composing" @click="emit('annotation-toggle')">为选文添加批注</button>
    <div ref="host" class="plain-text-host" :style="outlineStyle" />
  </div>
</template>

<style scoped>
.plain-text-editor { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.plain-text-host { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.selection-annotation-action { flex:none; align-self:flex-start; margin:4px 16px; padding:4px 10px; border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); font:12px/1.5 var(--sans); cursor:pointer; }
.outline-editing-toolbar { flex: none; padding: 6px clamp(12px, 2vw, 24px); border-bottom: 1px solid var(--line); background: var(--surface); }
.outline-editing-toolbar button, .outline-layout-panel button { display: inline-flex; align-items: center; gap: 5px; background: transparent; color: var(--ink); border: 0; padding: 6px 8px; min-height: 32px; font: 500 12px var(--sans); cursor: pointer; }
.outline-editing-toolbar button:hover, .outline-layout-panel button:hover { background: var(--surface-muted); }
.outline-layout-panel { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 20px; max-height: 180px; overflow: auto; border-bottom: 1px solid var(--line); background: var(--surface); color: var(--ink); font: 12px var(--sans); }
.outline-layout-panel label { display: grid; gap: 5px; }
.outline-layout-panel select { background: var(--surface); color: var(--ink); border: 1px solid var(--line); }
.has-editing-tools :deep(.cm-content) { max-width: var(--document-page-width); margin-inline: auto; width: 100%; }
.plain-text-editor :deep(.cm-scroller) { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.plain-text-editor:hover :deep(.cm-scroller), .plain-text-editor:focus-within :deep(.cm-scroller) { scrollbar-color: rgba(49, 92, 82, .4) transparent; }
</style>
