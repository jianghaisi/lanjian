<script setup lang="ts">
import CompanionDialogueSettings from '../../companion/components/CompanionDialogueSettings.vue'
import CompanionVoiceSettings from '../../companion/components/CompanionVoiceSettings.vue'
import { defaultLibraryCharacterPlacement, libraryBackgroundChoices, librarySceneChoices, type LibraryBackgroundId, type LibraryCharacterPlacement, type LibrarySceneId } from '../composables/library-appearance'

defineProps<{ background: LibraryBackgroundId; scene: LibrarySceneId; character: LibraryCharacterPlacement; error?: string }>()
const emit = defineEmits<{ background: [value: LibraryBackgroundId]; scene: [value: LibrarySceneId]; character: [value: Partial<LibraryCharacterPlacement>] }>()
</script>

<template>
  <section class="library-appearance-settings" data-testid="library-appearance-settings">
    <header><div><h3>作品库画面</h3><small>只改变本机显示，不会写入作品文件</small></div><span role="status">{{ error ? '尚未保存' : '自动保存' }}</span></header>
    <fieldset>
      <legend>左侧背景</legend>
      <div class="library-art-choices background-choices" role="radiogroup" aria-label="作品库背景">
        <label v-for="item in libraryBackgroundChoices" :key="item.id" :class="{ selected: background === item.id }">
          <input type="radio" name="library-background" :value="item.id" :checked="background === item.id" :data-testid="`library-background-${item.id}`" @change="emit('background', item.id)">
          <img :src="item.src" alt=""><span>{{ item.label }}</span>
        </label>
      </div>
    </fieldset>
    <fieldset class="character-composer" data-testid="library-character-composer">
      <legend><span>立绘构图</span><button type="button" data-testid="library-character-reset" @click="emit('character', defaultLibraryCharacterPlacement)">恢复默认</button></legend>
      <div class="character-sliders">
        <label><span>缩放</span><input type="range" min="0.7" max="2" step="0.01" :value="character.scale" data-testid="library-character-scale" @input="emit('character', { scale: Number(($event.target as HTMLInputElement).value) })"><output>{{ Math.round(character.scale * 100) }}%</output></label>
        <label><span>水平位置</span><input type="range" min="-40" max="40" step="1" :value="character.inlineOffset" data-testid="library-character-inline" @input="emit('character', { inlineOffset: Number(($event.target as HTMLInputElement).value) })"><output>{{ character.inlineOffset > 0 ? '+' : '' }}{{ character.inlineOffset }}%</output></label>
        <label><span>垂直位置</span><input type="range" min="-50" max="50" step="1" :value="character.blockOffset" data-testid="library-character-block" @input="emit('character', { blockOffset: Number(($event.target as HTMLInputElement).value) })"><output>{{ character.blockOffset > 0 ? '+' : '' }}{{ character.blockOffset }}%</output></label>
      </div>
      <p>像明日方舟主页一样，只调整作品库立绘的取景；不会修改原图。</p>
    </fieldset>
    <fieldset>
      <legend>右下角场景</legend>
      <div class="library-art-choices scene-choices" role="radiogroup" aria-label="右下角场景">
        <label v-for="item in librarySceneChoices" :key="item.id" :class="{ selected: scene === item.id, empty: !item.src }">
          <input type="radio" name="library-scene" :value="item.id" :checked="scene === item.id" :data-testid="`library-scene-${item.id}`" @change="emit('scene', item.id)">
          <img v-if="item.src" :src="item.src" alt=""><i v-else aria-hidden="true">×</i><span>{{ item.label }}</span>
        </label>
      </div>
    </fieldset>
    <CompanionVoiceSettings />
    <CompanionDialogueSettings />
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.library-appearance-settings{padding-block:1.25rem 1.75rem;border-block-end:1px solid var(--line);color:var(--ink)}
.library-appearance-settings>header{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-block-end:1rem}.library-appearance-settings>header>div{display:grid;gap:.125rem}.library-appearance-settings h3{margin:0;font:600 1rem/1.4 var(--sans)}.library-appearance-settings header small,.library-appearance-settings header>span{color:var(--muted);font:.6875rem/1.4 var(--sans)}
fieldset{margin:0;padding:0;border:0}fieldset+fieldset{margin-block-start:1rem}legend{margin-block-end:.5rem;color:var(--muted);font:.6875rem/1.4 var(--sans);letter-spacing:.08em}
.library-art-choices{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.625rem}.scene-choices{grid-template-columns:repeat(3,minmax(0,1fr))}.library-art-choices label{position:relative;display:grid;grid-template-rows:4.25rem auto;min-inline-size:0;border:1px solid var(--line);background:var(--surface-muted);cursor:pointer}.library-art-choices label.selected{border-color:var(--jade);box-shadow:inset 0 -.1875rem var(--jade)}.library-art-choices input{position:absolute;inline-size:1px;block-size:1px;opacity:0}.library-art-choices img{inline-size:100%;block-size:4.25rem;object-fit:cover;filter:saturate(.75)}.library-art-choices span{overflow:hidden;padding-block:.375rem;padding-inline:.5rem;text-overflow:ellipsis;white-space:nowrap;font:.6875rem/1.35 var(--sans)}.library-art-choices .empty i{display:grid;place-items:center;block-size:4.25rem;color:var(--muted);font:300 2rem/1 var(--sans)}.library-art-choices label:focus-within{outline:2px solid var(--focus);outline-offset:.125rem}.library-appearance-settings>p{margin:.75rem 0 0;color:var(--danger);font:.75rem/1.5 var(--sans)}
.character-composer{padding-block:.875rem;padding-inline:1rem;border:1px solid var(--line);background:linear-gradient(90deg,#78857b12 1px,transparent 1px),linear-gradient(#78857b12 1px,transparent 1px),var(--surface-muted);background-size:2.5rem 2.5rem}.character-composer legend{display:flex;align-items:center;justify-content:space-between;inline-size:100%;padding-inline:.125rem}.character-composer legend>span{color:var(--ink);font-weight:600;letter-spacing:.08em}.character-composer legend button{padding:.25rem .5rem;border:1px solid var(--line);background:var(--surface);color:var(--muted);font:.625rem/1.3 var(--sans);cursor:pointer}.character-composer legend button:hover{border-color:var(--jade);color:var(--jade)}.character-sliders{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.character-sliders label{display:grid;grid-template-columns:auto 1fr 2.75rem;align-items:center;gap:.625rem;color:var(--ink);font:.6875rem/1.4 var(--sans)}.character-sliders input{min-inline-size:0;inline-size:100%;accent-color:var(--jade)}.character-sliders output{text-align:end;color:var(--jade);font:600 .6875rem/1 var(--sans);font-variant-numeric:tabular-nums}.character-composer>p{margin:.625rem 0 0;color:var(--muted);font:.625rem/1.5 var(--sans)}
@media(max-width:42rem){.library-art-choices{grid-template-columns:repeat(2,minmax(0,1fr))}.scene-choices{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:52rem){.character-sliders{grid-template-columns:1fr}}
</style>
