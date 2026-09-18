<script setup lang="ts">
import { computed } from 'vue'
import fallbackTexture from '../../../assets/visuals/archive-observatory.png'
// Keep the author's local reference-derived texture, but permit a source snapshot
// without that asset. The distributed fallback has independent provenance.
const localTextures = import.meta.glob<string>('../../../assets/visuals/lanjian-quartet-workbench-v2.png', {
  eager: true, query: '?url', import: 'default'
})
const texture = localTextures['../../../assets/visuals/lanjian-quartet-workbench-v2.png'] || fallbackTexture
const props = defineProps<{ title: string; small?: boolean }>()
const tone = computed(() => [...props.title].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 3)
</script>

<template>
  <span class="library-book-cover" :class="[{ small }, `cover-tone-${tone}`]" aria-hidden="true">
    <img :src="texture" alt="" draggable="false">
    <span :class="{ 'long-title': title.length > 18 }">{{ title }}</span>
  </span>
</template>

<style scoped>
.library-book-cover { position: relative; display: grid; place-items: start center; width: 96px; height: 140px; flex: none; padding: 18px 10px; overflow: hidden; border-radius: 4px; background: #285a4c; color: #fff; box-shadow: inset 3px 0 #ffffff24; }
.library-book-cover.cover-tone-1 { background: #773e39; }
.library-book-cover.cover-tone-2 { background: #354f60; }
.library-book-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: right; mix-blend-mode: soft-light; opacity: .65; }
.library-book-cover > span { position: relative; text-align: center; overflow-wrap: anywhere; font: 600 16px/1.55 var(--serif); max-height: 108px; overflow: hidden; }
.library-book-cover > .long-title { font-size: 12px; }
.library-book-cover.small { width: 36px; height: 52px; padding: 7px 3px; border-radius: 3px; }
.library-book-cover.small > span { font-size: 6px; line-height: 1.45; max-height: 40px; }
</style>
