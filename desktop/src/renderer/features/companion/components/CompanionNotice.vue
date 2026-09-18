<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
defineProps<{text:string;status:string;playing:boolean}>()
const emit = defineEmits<{close:[];height:[value:number]}>()
const element = ref<HTMLElement>()
let observer: ResizeObserver | undefined
onMounted(() => { if(element.value) { observer=new ResizeObserver(() => emit('height',element.value!.getBoundingClientRect().height)); observer.observe(element.value) } })
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <aside ref="element" class="companion-notice" data-testid="companion-notice" :data-playing="playing" aria-live="polite">
    <div><span class="notice-label"><i :class="{playing}" />岚笺 · 陪伴</span><p>{{ text }}</p><small v-if="status">{{ status }}</small></div>
    <button type="button" aria-label="略过这条提醒" @click="emit('close')"><X :size="14" /></button>
  </aside>
</template>
<style scoped>
.companion-notice{position:fixed;z-index:220;display:flex;align-items:flex-start;gap:.7rem;box-sizing:border-box;padding:.7rem .85rem;border:1px solid var(--line-strong);border-inline-start:2px solid var(--jade);background:color-mix(in srgb,var(--surface) 76%,transparent);backdrop-filter:blur(6px);clip-path:polygon(0 0,100% 0,100% calc(100% - .45rem),calc(100% - .45rem) 100%,0 100%);color:var(--ink);font:.8rem/1.6 var(--sans);pointer-events:auto;max-block-size:12rem;overflow:auto}.companion-notice>div{flex:1;min-inline-size:0}.notice-label{display:flex;align-items:center;gap:.4rem;color:var(--muted);font:.55rem/1.4 var(--sans);letter-spacing:.12em}.notice-label i{inline-size:.3rem;block-size:.3rem;background:var(--jade);border-radius:50%}.notice-label i.playing{animation:notice-pulse 1s ease-in-out infinite}p{margin:.4rem 0 0;overflow-wrap:anywhere}small{font-size:.6rem;color:var(--muted)}button{display:grid;place-items:center;flex:none;inline-size:1.65rem;block-size:1.65rem;border:0;background:transparent;color:var(--muted);cursor:pointer}button:hover{color:var(--ink);background:var(--surface-muted)}button:focus-visible{outline:2px solid var(--jade);outline-offset:2px}@keyframes notice-pulse{50%{opacity:.35}}
</style>
