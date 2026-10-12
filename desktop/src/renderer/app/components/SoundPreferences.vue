<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiSounds } from '../composables/useUiSounds'
import type { SoundPreferences } from '../composables/useSoundPreferences'
import type { SoundId } from '../services/ui-sound-catalog'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const { store, player, feedback } = useUiSounds()
const { preferences, error, update, reset } = store
const root = ref<HTMLElement | null>(null), notice = ref('')
const preview = player.scope()
let host: HTMLDialogElement | null = null, previewRequest = 0
const groups = [{ key: 'boot', label: '开场与品牌播报' }, { key: 'loading', label: '作品载入' }, { key: 'interaction', label: '按钮与界面交互' }] as const
function stop() { previewRequest++; preview.stop() }
function apply(patch: Partial<SoundPreferences>) {
  stop(); notice.value = update(patch) ? '声音设置已保存。' : ''
  if (notice.value && !('volume' in patch)) feedback.play(Object.values(patch)[0] ? 'on' : 'off')
}
async function audition(id: SoundId) {
  stop(); const ticket = previewRequest
  if (!preferences.value.enabled || !preferences.value.volume) { notice.value = '请先开启声音并调高音量，再试听。'; return }
  if (!props.active || (host && !host.open)) return
  await player.preload([id])
  if (ticket !== previewRequest) return
  const played = await preview.play(id)
  if (ticket === previewRequest) notice.value = played ? '正在试听；可随时停止。' : '本项未播放，请检查分类开关或音频设备。'
}
function restore() { stop(); notice.value = reset() ? '原记录已备份，已恢复默认声音设置。' : ''; if (notice.value) feedback.play('warning') }
function hostChanged() { if (!host?.open) stop() }
watch(() => props.active, active => { if (!active) stop() })
watch(preferences, stop, { deep: true, flush: 'sync' })
onMounted(() => { host = root.value?.closest('dialog') ?? null; host?.addEventListener('toggle', hostChanged); host?.addEventListener('close', hostChanged) })
onBeforeUnmount(() => { stop(); preview.dispose(); host?.removeEventListener('toggle', hostChanged); host?.removeEventListener('close', hostChanged) })
</script>

<template>
  <section ref="root" class="sound-preferences" data-testid="sound-preferences" data-sound="none" aria-label="界面音效">
    <h3>界面音效</h3>
    <p class="sound-description">为开场、作品载入和日常操作添加轻量反馈。品牌播报使用 Lanjian，角色语音单独设置。</p>
    <label class="sound-switch"><input type="checkbox" :checked="preferences.enabled" data-testid="sound-enabled" @change="apply({ enabled: ($event.target as HTMLInputElement).checked })"><span>启用界面音效</span></label>
    <label class="sound-volume" for="ui-sound-volume">音量 <output>{{ Math.round(preferences.volume * 100) }}%</output>
      <input id="ui-sound-volume" type="range" min="0" max="100" step="1" :value="Math.round(preferences.volume * 100)" data-testid="sound-volume" @input="apply({ volume: Number(($event.target as HTMLInputElement).value) / 100 })">
    </label>
    <div class="sound-groups" role="group" aria-label="音效分类">
      <label v-for="group in groups" :key="group.key" class="sound-switch"><input type="checkbox" :checked="preferences[group.key]" :data-testid="`sound-${group.key}`" @change="apply({ [group.key]: ($event.target as HTMLInputElement).checked })"><span>{{ group.label }}</span></label>
    </div>
    <details class="sound-options"><summary>更多声音选项</summary>
      <label class="sound-switch"><input type="checkbox" :checked="preferences.hover" data-testid="sound-hover" @change="apply({ hover: ($event.target as HTMLInputElement).checked })"><span>鼠标悬停提示</span></label>
      <label class="sound-switch"><input type="checkbox" :checked="preferences.waiting" data-testid="sound-waiting" @change="apply({ waiting: ($event.target as HTMLInputElement).checked })"><span>载入等待氛围</span></label>
      <p>悬停和等待氛围默认关闭。文字输入与自动保存保持安静。</p>
    </details>
    <div class="sound-actions">
      <button type="button" data-testid="sound-preview-brand" @click="audition('V01')">试听 Lanjian</button>
      <button type="button" data-testid="sound-preview-loading" @click="audition('L01')">试听载入</button>
      <button type="button" data-testid="sound-preview-click" @click="audition('U02')">试听按钮</button>
      <button type="button" data-testid="sound-preview-stop" @click="stop(); notice = '试听已停止。'">停止</button>
    </div>
    <p v-if="notice" role="status" class="sound-notice">{{ notice }}</p>
    <div v-if="error" role="status" class="sound-error"><p>{{ error }}</p><button type="button" @click="restore">备份并恢复默认声音设置</button></div>
  </section>
</template>

<style scoped>
.sound-preferences{color:var(--color-ink);min-width:0;padding-bottom:24px;margin-bottom:24px;border-bottom:1px solid var(--color-line)}
h3{font:600 20px/1.4 var(--sans);margin:0 0 12px}.sound-description,.sound-options p{font-size:12px;line-height:1.8;color:var(--color-muted)}
.sound-switch{display:flex;align-items:center;gap:10px;min-height:40px;font-size:13px;cursor:pointer}.sound-switch input{width:16px;height:16px;flex-shrink:0;accent-color:var(--color-jade)}
.sound-volume{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 16px;font-size:13px}.sound-volume output{font-variant-numeric:tabular-nums;min-width:4em;color:var(--color-muted)}.sound-volume input{width:min(260px,100%);min-width:0;accent-color:var(--color-jade)}
.sound-groups{display:flex;flex-wrap:wrap;gap:4px 24px}.sound-options{margin:12px 0 20px}.sound-options summary{cursor:pointer;font-size:12px;line-height:2.5}.sound-actions{display:flex;flex-wrap:wrap;gap:8px}
button{padding:8px 12px;min-height:36px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink);font:12px/1.5 var(--sans);cursor:pointer}button:hover{border-color:var(--color-jade)}:is(button,input,summary):focus-visible{outline:2px solid var(--color-jade);outline-offset:3px}
.sound-notice{font-size:12px;color:var(--color-jade);line-height:1.8}.sound-error{font-size:12px;color:var(--color-danger);line-height:1.8}
</style>
