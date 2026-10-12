<script setup lang="ts">
import { useCompanionDialogueAppearance } from '../composables/use-companion-dialogue-appearance'
import type { CompanionDialogueAppearance } from '../services/companion-dialogue-appearance'
const { preferences, error, update, reset } = useCompanionDialogueAppearance()
const sliders = [
  { key: 'opacity', label: '背景不透明度', min: 35, max: 100, unit: '%', factor: 100 },
  { key: 'fontSize', label: '文字大小', min: 12, max: 24, unit: 'px', factor: 1 },
  { key: 'width', label: '最大宽度', min: 220, max: 560, unit: 'px', factor: 1 },
  { key: 'maxHeight', label: '高度上限', min: 140, max: 420, unit: 'px', factor: 1 },
] as const
</script>
<template>
  <fieldset class="dialogue-settings" data-testid="companion-dialogue-settings">
    <legend><span>人物对话框</span><button type="button" @click="reset">恢复默认</button></legend>
    <div class="dialogue-settings-controls">
      <label v-for="item in sliders" :key="item.key"><span>{{ item.label }}</span><input type="range" :min="item.min" :max="item.max" step="1" :value="Math.round(preferences[item.key] * item.factor)" :data-testid="`dialogue-${item.key}`" @input="update({ [item.key]: Number(($event.target as HTMLInputElement).value) / item.factor })"><output>{{ Math.round(preferences[item.key] * item.factor) }}{{ item.unit }}</output></label>
      <label><span>优先位置</span><select :value="preferences.placement" @change="update({ placement: ($event.target as HTMLSelectElement).value as CompanionDialogueAppearance['placement'] })"><option value="auto">自动避让</option><option value="above">人物上方优先</option><option value="right">人物右侧优先</option></select></label>
    </div>
    <div class="dialogue-settings-preview" :style="{ background: `color-mix(in srgb, var(--surface) ${preferences.opacity * 100}%, transparent)`, fontSize: `${preferences.fontSize}px`, maxInlineSize: `${preferences.width}px` }">欢迎回来。故事还在等你继续。</div>
    <p>气泡悬浮在模块上方，不挤动界面，也不裁切或缩放人物。高度随文字增长，到达上限后滚动；背景透明度不影响文字清晰度。</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </fieldset>
</template>
<style scoped>
.dialogue-settings{margin-block:1rem;padding:1rem;border:1px solid var(--line);background:var(--surface-muted);min-inline-size:0}.dialogue-settings legend{display:flex;align-items:center;gap:1rem;color:var(--ink);font:.8rem var(--sans)}.dialogue-settings button{border:1px solid var(--line);padding:.3rem .5rem;background:var(--surface);color:var(--muted);font:.65rem var(--sans);cursor:pointer}
.dialogue-settings-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.9rem 1.5rem}.dialogue-settings label{display:grid;grid-template-columns:6rem minmax(0,1fr) 3rem;align-items:center;gap:.5rem;font:.7rem var(--sans);color:var(--ink)}.dialogue-settings input{min-inline-size:0;inline-size:100%;accent-color:var(--jade)}.dialogue-settings output{text-align:end;font-variant-numeric:tabular-nums;color:var(--jade)}.dialogue-settings select{grid-column:2/-1;min-inline-size:0;color:var(--ink);background:var(--surface);border:1px solid var(--line);padding:.3rem}
.dialogue-settings-preview{margin-block-start:1rem;padding:.75rem;border:1px solid var(--line-strong);color:var(--ink);overflow-wrap:anywhere;line-height:1.65}.dialogue-settings p{margin-block:.65rem 0;color:var(--muted);font:.7rem/1.6 var(--sans)}.dialogue-settings :is(input,button,select):focus-visible{outline:2px solid var(--jade);outline-offset:2px}@media(max-width:52rem){.dialogue-settings-controls{grid-template-columns:minmax(0,1fr)}}
</style>
