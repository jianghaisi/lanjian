<script setup lang="ts">
import type { CompanionOptions } from '../services/companion-controller'
defineProps<{ options: CompanionOptions; error?: string; workItem?: string; projectSpecific?: boolean; embedded?: boolean }>()
const emit = defineEmits<{ update: [patch: Partial<CompanionOptions>]; scope: [enabled: boolean]; recover: [] }>()
</script>
<template>
  <section class="companion-settings settings-section settings-page-section" data-testid="companion-settings">
    <header v-if="!embedded"><div><b>写作伙伴</b><small>进入作品后显示在写作界面外侧，不会遮挡正文或自行调用模型。</small></div></header>
    <div v-if="error" role="alert" class="preference-error"><p>{{ error }}</p><button type="button" class="control-button secondary" @click="emit('recover')">保留原记录并恢复默认偏好</button></div>
    <label v-if="workItem" class="companion-setting-row"><span><b>仅为当前作品设置</b><small>关闭后跟随全局偏好；不改变小说数据。</small></span><input type="checkbox" :checked="projectSpecific" data-testid="companion-project-specific" @change="emit('scope', ($event.target as HTMLInputElement).checked)"></label>
    <div class="companion-settings-grid">
      <label>进入作品后展示<select v-assist-field="{id:'Companion.writingMode',read:()=>options.writingMode,write:value=>emit('update',{writingMode:value as CompanionOptions['writingMode']})}" :value="options.writingMode" data-testid="companion-writing-select" @change="emit('update', { writingMode: ($event.target as HTMLSelectElement).value as CompanionOptions['writingMode'] })"><option value="detailed">Live2D 立绘 · 独立伙伴</option><option value="chibi">Q版 · 独立伙伴</option><option value="hidden">隐藏</option></select></label>
    </div>
    <label v-for="option in ([['followPointer','跟随鼠标视线'],['autoBlink','自动眨眼'],['stateFeedback','AI状态反馈'],['focusAutoHide','专注模式自动隐藏']] as const)" :key="option[0]" class="companion-setting-row"><span>{{ option[1] }}</span><input type="checkbox" v-assist-field="{id:`Companion.${option[0]}`,read:()=>options[option[0]],write:value=>emit('update',{[option[0]]:Boolean(value)})}" :checked="options[option[0]]" :data-testid="`companion-setting-${option[0]}`" @change="emit('update', { [option[0]]: ($event.target as HTMLInputElement).checked })"></label>
    <label class="companion-setting-row"><span>动画强度</span><input type="range" min="0" max="1" step="0.05" v-assist-field="{id:'Companion.intensity',read:()=>options.intensity,write:value=>emit('update',{intensity:Number(value)})}" :value="options.intensity" aria-label="伙伴动画强度" @input="emit('update', { intensity: Number(($event.target as HTMLInputElement).value) })"></label>
    <p class="companion-settings-note">更改自动保存在本机。伙伴只在进入作品后出现，可拖动和缩放；点击 Live2D 立绘会说话并轻轻点头，平时会自动眨眼、呼吸并随物理参数轻摆。</p>
  </section>
</template>
<style scoped>
.companion-settings{font-family:var(--sans);color:var(--color-ink)}.companion-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0}.companion-settings-grid label{display:grid;gap:8px;font-size:14px}.companion-settings-grid select{min-width:0;width:100%;height:40px;padding:0 12px;color:var(--color-ink);background:var(--color-surface);border:1px solid var(--color-line);font:14px var(--sans)}
.companion-setting-row{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:52px;border-bottom:1px solid var(--color-line);font:14px/1.5 var(--sans)}.companion-setting-row>span{display:grid;gap:3px}.companion-setting-row small,.companion-settings-note{font-size:12px;color:var(--color-muted)}.companion-setting-row input[type=checkbox]{width:18px;height:18px;accent-color:var(--color-jade)}.companion-setting-row input[type=range]{width:140px;accent-color:var(--color-jade)}.companion-settings-note{line-height:1.7;margin-top:16px}.preference-error{color:var(--color-danger)}@media(max-width:800px){.companion-settings-grid{grid-template-columns:1fr}}
</style>
