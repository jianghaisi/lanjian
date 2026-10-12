<script setup lang="ts">
import { ref } from 'vue'
import DesktopPetSettings from './DesktopPetSettings.vue'
import CompanionVoiceSettings from './CompanionVoiceSettings.vue'
const emit = defineEmits<{ close: []; activity: [value: { busy: boolean; playing: boolean }] }>()
const props = defineProps<{ initialTab?: 'pet' | 'voice' }>()
const tab = ref<'pet' | 'voice'>(props.initialTab ?? 'pet')
</script>
<template>
  <section class="pet-settings-panel" data-pet-interactive data-testid="pet-settings-panel" aria-label="桌宠设置">
    <header><h2>桌宠设置</h2><button type="button" aria-label="关闭桌宠设置" @click="emit('close')">×</button></header>
    <nav aria-label="伙伴设置"><button type="button" :aria-pressed="tab === 'pet'" @click="tab = 'pet'">外观与日常</button><button type="button" :aria-pressed="tab === 'voice'" @click="tab = 'voice'">模型与声音</button></nav>
    <div class="settings-scroll"><DesktopPetSettings v-if="tab === 'pet'" compact /><CompanionVoiceSettings v-else pet @activity="emit('activity', $event)" /></div>
  </section>
</template>
<style scoped>
.pet-settings-panel{height:100%;display:flex;flex-direction:column;min-height:0;overflow:hidden;border:1px solid var(--color-line);border-radius:16px;background:var(--color-surface);box-shadow:0 8px 25px #203f2b1a;--ink:var(--color-ink);--muted:var(--color-muted);--line:var(--color-line);--line-strong:#b8ccbb;--surface:var(--color-surface);--surface-muted:var(--color-paper);--jade:var(--color-jade);--danger:#a34539}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px 8px;flex:none}h2{font-size:16px;font-weight:600;margin:0}button{font:13px var(--sans);color:var(--color-ink);background:transparent;border:1px solid transparent;border-radius:7px;min-height:32px;padding:6px 10px;cursor:pointer}header button{font-size:20px;padding:0 5px}button:focus-visible{outline:2px solid var(--color-jade);outline-offset:1px}nav{display:flex;gap:8px;border-bottom:1px solid var(--color-line);padding:0 12px 9px;flex:none}nav button[aria-pressed=true]{background:#e8f0e3;color:var(--color-jade)}.settings-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:12px 14px 16px;flex:1}.settings-scroll :deep(.companion-voice-settings){margin:0;border:0;padding:0}.settings-scroll :deep(.sound-controls){grid-template-columns:minmax(0,1fr)}.settings-scroll :deep(.companion-voice-settings small),.settings-scroll :deep(.voice-choice span),.settings-scroll :deep(.sound-status){font-size:12px}.settings-scroll :deep(.companion-voice-settings header){flex-wrap:wrap}.settings-scroll :deep(.sound-toggle){align-items:flex-start}.settings-scroll :deep(.voice-check summary span){display:block;margin-left:0;font-size:12px}
</style>
