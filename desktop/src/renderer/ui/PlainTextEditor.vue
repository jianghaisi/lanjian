<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder as emptyHint } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { editorSearchExtensions } from '../features/manuscript/services/editor-search'
import { registerAssistantField, requestFieldAssistant, type FieldBinding } from '../features/assistant/services/assistant-field-registry'

const props = withDefaults(defineProps<{
  modelValue: string
  documentKey: string
  ariaLabel: string
  placeholder?: string
  readOnly?: boolean
  externalHistory?: boolean
  nativeSearch?: boolean
  comfortableCaret?: boolean
  testId?: string
  assistantField?: FieldBinding
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
}>()
const host = ref<HTMLDivElement | null>(null)
const editable = new Compartment()
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
      ...(props.nativeSearch ? editorSearchExtensions() : []),
      editable.of([EditorState.readOnly.of(Boolean(props.readOnly)), EditorView.editable.of(!props.readOnly)]),
      EditorView.lineWrapping, ...(props.externalHistory ? [] : [history()]), emptyHint(props.placeholder || ''),
      ...(props.comfortableCaret ? [
        EditorView.cursorScrollMargin.of({ x: 8, y: 96 }),
        EditorView.scrollMargins.of((editorView) => ({
          bottom: Math.min(240, Math.max(96, editorView.scrollDOM.clientHeight * 0.28))
        }))
      ] : []),
      EditorView.contentAttributes.of({ 'aria-label': props.ariaLabel, spellcheck: 'false', ...(props.testId ? { 'data-testid': props.testId } : {}) }),
      Prec.highest(EditorView.domEventHandlers({
        beforeinput: (event) => { emit('beforeinput', event); return event.defaultPrevented },
        keydown: (event) => { emit('keydown', event); return event.defaultPrevented },
        contextmenu: (event) => { emit('contextmenu', event); return event.defaultPrevented },
        compositionstart: () => { emit('composition-start'); return false },
        compositionend: () => {
          if (compositionFrame !== null) cancelAnimationFrame(compositionFrame)
          compositionFrame = requestAnimationFrame(() => {
            compositionFrame = null
            if (view) emit('composition-end', view.state.doc.toString())
          })
          return false
        }
      })),
      // Search Escape must run before defaultKeymap's selection simplification.
      keymap.of([{ key: 'Mod-s', run: () => { if (!props.readOnly) emit('save'); return true } },
        ...(props.nativeSearch ? searchKeymap : []), ...defaultKeymap, ...(props.externalHistory ? [] : historyKeymap)]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingExternal) {
          const previous = update.startState.selection.main
          emit('before-change', { content: update.startState.doc.toString(), start: previous.from, end: previous.to,
            group: update.transactions.some((transaction) => transaction.isUserEvent('delete')) ? 'delete' : 'typing' })
          emit('update:modelValue', update.state.doc.toString())
        }
        if (update.docChanged || update.selectionSet) {
          const range = update.state.selection.main
          emit('selection', { start: range.from, end: range.to, text: update.state.sliceDoc(range.from, range.to) })
        }
      }),
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent', color: 'inherit', fontSize: 'inherit' },
        '&.cm-focused': { outline: 'none' },
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
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.modelValue }, annotations: Transaction.addToHistory.of(false) })
  } finally { applyingExternal = false }
}

function moveToStart() {
  if (!view) return
  view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
  view.scrollDOM.scrollTop = 0
  view.scrollDOM.scrollLeft = 0
}

watch(() => props.modelValue, synchronize)
watch(() => props.documentKey, () => {
  if (!view) return
  view.setState(createState()) // Never carry another document's undo history or viewport.
  moveToStart()
})
watch(() => props.readOnly, () => view?.dispatch({ effects: editable.reconfigure([
  EditorState.readOnly.of(Boolean(props.readOnly)), EditorView.editable.of(!props.readOnly)
]) }))
onMounted(() => {
  view = new EditorView({ state: createState(), parent: host.value! })
  if (props.assistantField) {
    fieldRegistration = registerAssistantField({
      ...props.assistantField,
      read: () => props.modelValue,
      identity: () => props.documentKey,
      available: () => !props.readOnly,
      write: value => {
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
  insertText: (text: string) => {
    if (!view || view.composing || props.readOnly) return false
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

<template><div ref="host" class="plain-text-editor" /></template>

<style scoped>
.plain-text-editor { min-width: 0; min-height: 0; overflow: hidden; }
.plain-text-editor :deep(.cm-scroller) { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.plain-text-editor:hover :deep(.cm-scroller), .plain-text-editor:focus-within :deep(.cm-scroller) { scrollbar-color: rgba(49, 92, 82, .4) transparent; }
</style>
