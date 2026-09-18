<script setup lang="ts">
import { ref } from 'vue'
import { X } from '@lucide/vue'
defineProps<{ placement: string }>()
const emit = defineEmits<{ close: [] }>()
const element = ref<HTMLElement>()
defineExpose({ element })
</script>
<template>
  <section ref="element" class="companion-dialogue-frame" role="dialog" aria-label="和岚笺档案员交流" data-anchor="stage-safe" :data-placement="placement" data-testid="archive-character-dialogue" @keydown.esc.stop="emit('close')">
    <header><span>LJ / ARCHIVIST<small>岚笺 · 本地陪伴</small></span><button type="button" aria-label="关闭人物对话" @click="emit('close')"><X :size="17" /></button></header>
    <div class="companion-dialogue-content"><slot /></div>
    <i class="dialogue-registration" aria-hidden="true" />
  </section>
</template>
<style scoped>
.companion-dialogue-frame{position:fixed;z-index:220;display:flex;flex-direction:column;box-sizing:border-box;min-inline-size:0;min-block-size:0;padding:.85rem;border:1px solid var(--line-strong,#6f7c73);background:color-mix(in srgb,var(--surface,#f7f4ec) var(--dialogue-opacity,78%),transparent);backdrop-filter:blur(8px);color:var(--ink,#202923);box-shadow:.25rem .4rem 1rem #10171222;clip-path:polygon(.6rem 0,100% 0,100% calc(100% - .6rem),calc(100% - .6rem) 100%,0 100%,0 .6rem);pointer-events:auto;overflow:hidden}
.companion-dialogue-frame>header{display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex:none;padding-block-end:.5rem;border-block-end:1px solid var(--line)}
.companion-dialogue-frame>header>span{font:600 .55rem/1.4 var(--sans);letter-spacing:.12em;color:var(--muted)}
.companion-dialogue-frame small{display:block;font:600 .8rem/1.5 var(--serif);letter-spacing:.03em;color:var(--ink)}
.companion-dialogue-frame>header button{display:grid;place-items:center;flex:none;inline-size:2rem;block-size:2rem;padding:0;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
.companion-dialogue-frame button:focus-visible{outline:2px solid var(--jade);outline-offset:2px}
.companion-dialogue-content{flex:0 1 auto;display:flex;flex-direction:column;min-block-size:0;min-inline-size:0;overflow:auto;overflow-wrap:anywhere;padding-block-start:.6rem;font:var(--dialogue-font-size,16px)/1.65 var(--sans)}
.companion-dialogue-content :deep(p){margin:0;white-space:pre-wrap}
.dialogue-registration{position:absolute;inset-inline-end:.75rem;inset-block-end:.3rem;inline-size:2.25rem;block-size:.2rem;background:repeating-linear-gradient(130deg,#e79b3e 0 .25rem,transparent .25rem .5rem);pointer-events:none}
</style>
