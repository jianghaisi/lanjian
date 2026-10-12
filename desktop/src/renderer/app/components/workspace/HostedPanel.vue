<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ narrow: boolean; open: boolean; label: string; id: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLDialogElement | null>(null)
let trigger: HTMLElement | null = null, generation = 0
watch(() => [props.narrow, props.open], async () => {
  const ticket = ++generation
  await nextTick()
  if (ticket !== generation || !panel.value) return
  if (props.narrow && props.open && !panel.value.open) {
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.value.showModal()
  } else if ((!props.narrow || !props.open) && panel.value.open) {
    panel.value.close()
    if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus({ preventScroll: true })
  }
}, { immediate: true, flush: 'post' })
onBeforeUnmount(() => { generation++; panel.value?.close() })
</script>
<template>
  <dialog ref="panel" :id="id" class="hosted-panel" :aria-label="label" @cancel.prevent="emit('close')" @click="event => { if (event.target === panel) emit('close') }">
    <header class="hosted-panel-heading"><h2>{{ label }}</h2><button type="button" :aria-label="'关闭' + label" @click="emit('close')">关闭</button></header>
  </dialog>
  <!-- Teleport moves the existing controls. Their drafts and selection are not remounted. -->
  <Teleport :to="panel || 'body'" :disabled="!narrow || !panel"><slot /></Teleport>
</template>
