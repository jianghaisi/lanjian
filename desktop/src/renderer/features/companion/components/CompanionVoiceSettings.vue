<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Volume2 } from '@lucide/vue'
import { companionVoices, voiceId } from '../../../../contracts/companion/companion-voice-contracts'
import { useCompanionVoicePreferences } from '../composables/use-companion-voice-preferences'
import { useCompanionVoice } from '../composables/use-companion-voice'
import { companionPreparation } from '../composables/use-companion-runtime'

const { preferences, error: preferenceError, update } = useCompanionVoicePreferences()
const { open, close, run, ready, busy, playing, error, stateLabel } = useCompanionVoice(ref(null), { autoOpen: false })
const element = ref<HTMLElement>(), preparing = ref(false), attempted = ref(false)
let observer: MutationObserver | undefined
let previewEpoch = 0
function cancelPreview() { previewEpoch++; preparing.value = false; close() }
async function preview() {
  const epoch = ++previewEpoch
  attempted.value = true; preparing.value = true
  try {
    if (!ready.value) await open()
    if (epoch !== previewEpoch) return
    preparing.value = false
    if (ready.value) await run('preview')
  } finally { if (epoch === previewEpoch) preparing.value = false }
}
onMounted(() => {
  const dialog = element.value?.closest('dialog')
  if (dialog) {
    observer = new MutationObserver(() => { if (!dialog.open) cancelPreview() })
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] })
  }
})
onBeforeUnmount(() => { observer?.disconnect(); cancelPreview() })
</script>

<template>
  <section ref="element" class="companion-voice-settings" data-testid="companion-voice-settings" aria-labelledby="companion-sound-title">
    <header><div><small>COMPANION / 本地陪伴</small><h3 id="companion-sound-title"><Volume2 :size="18" />看板娘 · 模型与声音</h3></div><span role="status">{{ preferenceError ? '尚未保存' : '自动保存' }}</span></header>
    <p class="voice-choice" data-testid="companion-mode-summary"><strong>{{ preferences.textModel ? '智能对话' : '预设陪伴' }} · {{ preferences.mute ? '仅文字' : 'GPT-SoVITS 语音' }}</strong><span>{{ preferences.textModel ? '文字模型生成自由问答；会占用额外内存和 CPU。' : '按点按、时间和当前作品使用预设台词，不加载 Qwen。' }}{{ preferences.mute ? '不再生成语音；本次已加载的模型保留至退出，下次启动不加载。' : '当前语音模型保留至退出岚笺；打开设置、切换作品和空闲不会重新加载。会持续占用内存与显存。' }}</span></p>
    <div class="sound-controls">
      <label class="sound-toggle"><input type="checkbox" :checked="preferences.textModel" data-testid="companion-text-model-enabled" @change="update({ textModel: ($event.target as HTMLInputElement).checked })"><span>文字模型 · Qwen<small>关闭后仍有预设台词、时间和作品查询</small></span></label>
      <label class="sound-toggle"><input type="checkbox" :checked="!preferences.mute" data-testid="companion-sound-enabled" @change="update({ mute: !($event.target as HTMLInputElement).checked })"><span>语音模型 · GPT-SoVITS<small>可单独朗读预设台词；已加载模型退出岚笺后释放</small></span></label>
      <label class="sound-toggle"><input type="checkbox" :checked="preferences.preload" :disabled="!preferences.textModel && preferences.mute" data-testid="companion-preload-enabled" @change="update({ preload: ($event.target as HTMLInputElement).checked })"><span>启动时提前加载<small>提前准备已启用的模型，减少首次对话等待</small></span></label>
      <label class="sound-toggle"><input type="checkbox" :checked="preferences.proactive" data-testid="companion-proactive-enabled" @change="update({ proactive: ($event.target as HTMLInputElement).checked })"><span>主动陪伴<small>夜深关怀、继续创作停留提醒；不会连续打断你</small></span></label>
      <label class="sound-toggle"><input type="checkbox" :checked="preferences.subtitles" @change="update({ subtitles: ($event.target as HTMLInputElement).checked })"><span>提醒时显示短字幕<small>聊天输入仅在长按人物 3 秒后出现</small></span></label>
      <label class="sound-volume"><span>音量</span><input type="range" min="0" max="1" step="0.05" :disabled="preferences.mute" :value="preferences.volume" data-testid="companion-sound-volume" @input="update({ volume: Number(($event.target as HTMLInputElement).value) })"><output>{{ Math.round(preferences.volume * 100) }}%</output></label>
      <label class="sound-voice"><span>当前音色</span><select :value="preferences.voice" :disabled="preparing || busy || playing" data-testid="companion-sound-voice" @change="update({ voice: voiceId(($event.target as HTMLSelectElement).value) })"><option v-for="voice in companionVoices" :key="voice.id" :value="voice.id">{{ voice.label }} · GPT-SoVITS</option></select></label>
      <div class="sound-preview"><button type="button" :disabled="preparing || busy || playing || preferences.mute || preferences.volume === 0" data-testid="companion-sound-preview" @click="preview">{{ preparing ? '正在准备…' : '试听当前音色' }}</button><button v-if="preparing || busy || playing" type="button" @click="cancelPreview">停止试听</button></div>
    </div>
    <p class="sound-status" role="status" data-testid="companion-preparation-status">{{ companionPreparation }}</p>
    <p v-if="attempted" class="sound-status" role="status">{{ stateLabel }}</p>
    <p v-if="error || preferenceError" class="sound-error" role="alert">{{ preferenceError || error }}</p>
  </section>
</template>

<style scoped>
.companion-voice-settings{margin-block:1.5rem .5rem;border-block-start:1px solid var(--line);padding-block-start:1.25rem;color:var(--ink);font:.75rem/1.6 var(--sans)}
header{display:flex;justify-content:space-between;align-items:center;gap:1rem}header small{font:.6rem/1.4 var(--sans);letter-spacing:.13em;color:var(--muted)}h3{display:flex;gap:.55rem;align-items:center;margin:.25rem 0 0;font:600 1rem/1.4 var(--sans)}header>span{font-size:.7rem;color:var(--muted)}
.voice-choice{display:grid;gap:.2rem;margin:1rem 0;padding:.75rem 1rem;border-inline-start:2px solid var(--jade);background:var(--surface-muted)}.voice-choice strong{font-size:.8rem}.voice-choice span{color:var(--muted);font-size:.7rem}
.sound-controls{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1rem 1.5rem;align-items:center}.sound-toggle{display:flex;align-items:center;gap:.7rem}.sound-toggle small{display:block;color:var(--muted);font-size:.65rem}.sound-volume,.sound-voice{display:flex;align-items:center;gap:.65rem}.sound-volume input{flex:1;min-inline-size:0}.sound-volume output{min-inline-size:3rem;text-align:end;color:var(--jade);font-variant-numeric:tabular-nums}
input{accent-color:var(--jade)}select{flex:1;min-inline-size:0;max-inline-size:100%;padding:.45rem;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit}.sound-preview{display:flex;gap:.5rem;flex-wrap:wrap}button{min-block-size:2.25rem;padding:.4rem .85rem;border:1px solid var(--line-strong);background:var(--surface);color:var(--ink);font:inherit;cursor:pointer}button:hover:not(:disabled){border-color:var(--jade);color:var(--jade)}button:disabled{opacity:.5;cursor:default}:is(button,select,input):focus-visible{outline:2px solid var(--jade);outline-offset:3px}.sound-status{color:var(--muted)}.sound-error{color:var(--danger)}
@media(max-width:52rem){.sound-controls{grid-template-columns:minmax(0,1fr)}}
</style>
