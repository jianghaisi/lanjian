<script setup lang="ts">
import { hostedModelMode } from '../../../features/models/services/hosted-model-mode'
defineProps<{ label?: string; state?: string }>()
const guest = Boolean(window.novelDesktop?.app.hosted?.readOnly)
</script>
<template>
  <span class="workspace-storage-status" :class="state" data-testid="workspace-storage-status"><span class="storage-location" :title="guest ? '游客只读样书' : hostedModelMode() ? '作品保存在账户书库' : '作品保存在本机'"><i aria-hidden="true"></i>{{ guest ? '公开样书 · 只读' : hostedModelMode() ? '账户书库' : '本地' }}</span><span v-if="label && !guest" class="storage-save-label" :role="state === 'error' ? 'alert' : 'status'"><span :key="state" class="storage-state-mark" :class="state" aria-hidden="true"><svg v-if="state === 'saved'" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" /></svg><span v-else-if="state === 'error'">!</span></span>{{ label }}</span></span>
</template>
<style>
.workspace-storage-status { display:inline-flex;align-items:center;gap:.5rem;min-inline-size:0;color:var(--color-muted);font:400 .75rem/1.4 var(--sans);letter-spacing:0; }
.workspace-storage-status :is(.storage-location,.storage-save-label) { display:inline-flex;align-items:center;gap:.375rem; }
.workspace-storage-status .storage-location { flex:none; }
.workspace-storage-status .storage-location>i { width:6px;height:6px;flex:none;border-radius:50%;background:var(--color-jade);box-shadow:none; }
.workspace-storage-status.error .storage-save-label { color:var(--color-danger); }
.workspace-storage-status :is(.storage-location,.storage-save-label) { font:inherit; }
.storage-state-mark{display:inline-grid;place-items:center;flex:none;width:12px;height:12px;color:var(--color-jade,var(--jade));animation:storage-mark-in 180ms ease-out}
.storage-state-mark svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:14;animation:storage-check 260ms ease-out}
.storage-state-mark.saving{border:1px solid var(--color-line,var(--line));border-top-color:var(--color-jade,var(--jade));border-radius:50%;animation:storage-turn .9s linear infinite}
.storage-state-mark.dirty:before{content:'';width:5px;height:5px;border:1px solid var(--color-accent,var(--cinnabar));border-radius:50%}
.storage-state-mark.checkpoint:before{content:'';width:7px;height:9px;border:1px solid currentColor;border-radius:1px;box-shadow:inset 0 -3px 0 -2px currentColor}
.storage-state-mark.local:before{content:'';width:6px;height:6px;border:1px solid var(--color-accent,var(--cinnabar));rotate:45deg}
.storage-state-mark.error{color:var(--color-danger,var(--cinnabar));font-weight:700}
@keyframes storage-mark-in{from{opacity:0;scale:.85}to{opacity:1;scale:1}}
@keyframes storage-check{from{stroke-dashoffset:14}to{stroke-dashoffset:0}}
@keyframes storage-turn{to{rotate:360deg}}
@media(prefers-reduced-motion:reduce){.storage-state-mark,.storage-state-mark svg{animation:none!important}}
</style>
