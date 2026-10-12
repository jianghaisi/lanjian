<script setup lang="ts">
import { ref } from 'vue'
defineProps<{ compact?: boolean }>()
const expanded = ref(false)
</script>

<template>
  <span v-if="compact" class="desktop-companion-anchor"><button class="desktop-companion-link labeled-title-action" :aria-expanded="expanded" @click="expanded = !expanded" @keydown.esc="expanded = false" data-testid="desktop-companion-notice">桌宠 · 完整版</button><span v-if="expanded" class="desktop-companion-tip" role="status">独立桌宠需下载完整版体验。</span></span>
  <section v-else class="desktop-companion-notice" data-testid="desktop-companion-notice" aria-label="独立桌宠">
    <h3>把写作伙伴带回桌面</h3>
    <p>网页暂不展示作品内的独立桌宠。拖动、互动菜单和轻养成等完整体验，请下载桌面安装包使用。</p>
  </section>
</template>

<style scoped>
.desktop-companion-anchor{position:relative;display:inline-flex;flex:none}.desktop-companion-link{background:none;border:0;cursor:pointer}.desktop-companion-tip{position:absolute;right:0;top:100%;z-index:50;width:240px;padding:16px;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 8px 24px #0002;font:12px/1.7 var(--sans)}
.desktop-companion-link{display:inline-flex;align-items:center;padding:0 .75rem;height:2.5rem;color:var(--ink-muted);font:.75rem var(--sans);white-space:nowrap;text-decoration:none;border-left:1px solid var(--line)}
.desktop-companion-link:hover,.desktop-companion-notice a{color:var(--jade)}
.desktop-companion-notice{padding:1.5rem;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.desktop-companion-notice h3{margin:0 0 .75rem;font:1.3rem var(--serif)}.desktop-companion-notice p{max-width:40rem;line-height:1.8;color:var(--ink-muted)}
a:focus-visible{outline:2px solid var(--jade);outline-offset:3px}
</style>
