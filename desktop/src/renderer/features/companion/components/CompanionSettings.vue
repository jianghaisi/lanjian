<script setup lang="ts">
import type { CompanionOptions } from '../services/companion-controller'
import DesktopPetSettings from './DesktopPetSettings.vue'
import CompanionVoiceSettings from './CompanionVoiceSettings.vue'
defineProps<{ options: CompanionOptions; error?: string; workItem?: string; projectSpecific?: boolean; embedded?: boolean }>()
const emit = defineEmits<{ update: [patch: Partial<CompanionOptions>]; scope: [enabled: boolean]; recover: [] }>()
</script>
<template>
  <section class="companion-settings settings-section settings-page-section" data-testid="companion-settings">
    <p class="companion-settings-note companion-shared-note">书库看板娘与桌宠是同一位伙伴，声音和养成档案共用。这里管理写作时的桌宠；书库背景、立绘和对话框在“我的作品”设置中调整。</p>
    <DesktopPetSettings />
    <header class="companion-presentation-heading"><div><h3>写作时的陪伴方式</h3><small>以下显示与动作偏好可单独应用于当前作品，不改变共用的声音和养成档案。</small></div></header>
    <div v-if="error" role="alert" class="preference-error"><p>{{ error }}</p><button type="button" class="control-button secondary" @click="emit('recover')">保留原记录并恢复默认偏好</button></div>
    <label v-if="workItem" class="companion-setting-row"><span><b>仅为当前作品设置</b><small>关闭后跟随全局偏好；不改变小说数据。</small></span><input type="checkbox" :checked="projectSpecific" data-testid="companion-project-specific" @change="emit('scope', ($event.target as HTMLInputElement).checked)"></label>
    <div class="companion-settings-grid">
      <label>当前作品的显示方式<select v-assist-field="{id:'Companion.writingMode',read:()=>options.writingMode,write:value=>emit('update',{writingMode:value as CompanionOptions['writingMode']})}" :value="options.writingMode === 'detailed' ? 'chibi' : options.writingMode" data-testid="companion-writing-select" @change="emit('update', { writingMode: ($event.target as HTMLSelectElement).value as CompanionOptions['writingMode'] })"><option value="chibi">Q版（启用桌宠后）</option><option value="hidden">在此作品中隐藏</option></select></label>
    </div>
    <label v-for="option in ([['followPointer','跟随鼠标视线'],['autoBlink','自动眨眼'],['stateFeedback','AI状态反馈'],['focusAutoHide','专注模式自动隐藏']] as const)" :key="option[0]" class="companion-setting-row"><span>{{ option[1] }}</span><input type="checkbox" v-assist-field="{id:`Companion.${option[0]}`,read:()=>options[option[0]],write:value=>emit('update',{[option[0]]:Boolean(value)})}" :checked="options[option[0]]" :data-testid="`companion-setting-${option[0]}`" @change="emit('update', { [option[0]]: ($event.target as HTMLInputElement).checked })"></label>
    <label class="companion-setting-row"><span>动画强度</span><input type="range" min="0" max="1" step="0.05" v-assist-field="{id:'Companion.intensity',read:()=>options.intensity,write:value=>emit('update',{intensity:Number(value)})}" :value="options.intensity" aria-label="伙伴动画强度" @input="emit('update', { intensity: Number(($event.target as HTMLInputElement).value) })"></label>
    <p class="companion-settings-note">桌宠使用 Q 版形象。单击摸摸，拖动移动，右键打开互动菜单；声音设置与书库看板娘共用。</p>
    <CompanionVoiceSettings />
  </section>
</template>
<style scoped>
.companion-shared-note{margin:0 0 1.5rem}.companion-presentation-heading h3{margin:0 0 .5rem;font:600 1rem/1.4 var(--sans)}.companion-presentation-heading small{color:var(--color-muted);font:12px/1.7 var(--sans)}
.companion-settings{font-family:var(--sans);color:var(--color-ink)}.companion-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0}.companion-settings-grid label{display:grid;gap:8px;font-size:14px}.companion-settings-grid select{min-width:0;width:100%;height:40px;padding:0 12px;color:var(--color-ink);background:var(--color-surface);border:1px solid var(--color-line);font:14px var(--sans)}
.companion-setting-row{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:52px;border-bottom:1px solid var(--color-line);font:14px/1.5 var(--sans)}.companion-setting-row>span{display:grid;gap:3px}.companion-setting-row small,.companion-settings-note{font-size:12px;color:var(--color-muted)}.companion-setting-row input[type=checkbox]{width:18px;height:18px;accent-color:var(--color-jade)}.companion-setting-row input[type=range]{width:140px;accent-color:var(--color-jade)}.companion-settings-note{line-height:1.7;margin-top:16px}.preference-error{color:var(--color-danger)}@media(max-width:800px){.companion-settings-grid{grid-template-columns:1fr}}
</style>
