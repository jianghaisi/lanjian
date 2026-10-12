<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, watch } from 'vue'
import { interactionFeedbackKey } from './interaction-feedback'

const props = defineProps<{ readingKey?: string }>()
const emit = defineEmits<{ escape: [] }>()
const feedback = inject(interactionFeedbackKey, null)
let disposing = false
const triggers = new Map<HTMLElement, Element | null>()
const readingKeys = new WeakMap<HTMLElement, string | undefined>()
let readingPosition: { key: string; top: number; left: number } | null = null
watch(() => props.readingKey, () => { readingPosition = null }, { flush: 'sync' })
let current: HTMLElement | null = null
let revision = 0
const controls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')]
  .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[inert]') && node.getClientRects().length)

function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || !current || current.inert) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('escape')
  } else if (event.key === 'Tab') {
    const items = controls(current)
    const boundary = event.shiftKey ? items[0] : items.at(-1)
    if (document.activeElement === boundary) {
      event.preventDefault()
      ;(event.shiftKey ? items.at(-1) : items[0])?.focus({ preventScroll: true })
    }
  }
}
function enter(element: Element) {
  feedback?.play('open')
  const root = element as HTMLElement, ticket = ++revision
  current = root
  triggers.set(root, document.activeElement)
  readingKeys.set(root, props.readingKey)
  root.classList.add('library-dialog-surface')
  root.inert = false
  root.removeAttribute('aria-hidden')
  root.addEventListener('keydown', keydown)
  void nextTick(() => {
    if (ticket !== revision || !root.isConnected || root.inert) return
    if (!root.contains(document.activeElement)) controls(root)[0]?.focus({ preventScroll: true })
    const reading = root.querySelector<HTMLElement>('[data-dialog-reading]')
    if (reading && readingPosition && readingPosition.key === props.readingKey && readingKeys.get(root) === props.readingKey) {
      reading.scrollTo({ top: readingPosition.top, left: readingPosition.left, behavior: 'instant' })
    }
  })
}
function leave(element: Element) {
  if (!disposing) feedback?.play('close')
  const root = element as HTMLElement, trigger = triggers.get(root)
  const owned = document.activeElement === document.body || root.contains(document.activeElement)
  const readingKey = readingKeys.get(root)
  const reading = root.querySelector<HTMLElement>('[data-dialog-reading]')
  if (current === root && readingKey !== undefined && readingKey === props.readingKey && reading) {
    readingPosition = { key: readingKey, top: reading.scrollTop, left: reading.scrollLeft }
  }
  readingKeys.delete(root)
  if (current === root) { current = null; revision++ }
  root.removeEventListener('keydown', keydown)
  root.inert = true
  root.setAttribute('aria-hidden', 'true')
  // Release native modality now; only inert paint survives the exit transition.
  if (root instanceof HTMLDialogElement && root.open) root.close()
  triggers.delete(root)
  if (owned && trigger instanceof HTMLElement && trigger.isConnected && !trigger.closest('[inert]')) {
    trigger.focus({ preventScroll: true })
  }
}
onBeforeUnmount(() => { disposing = true; if (current) leave(current) })
</script>

<template>
  <Transition name="library-modal" appear @before-enter="enter" @before-leave="leave">
    <slot />
  </Transition>
</template>
