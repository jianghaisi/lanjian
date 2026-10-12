<script setup lang="ts">
import { computed, watch } from 'vue'
const props = defineProps<{ enabled: boolean; mode: 'hold' | 'toggle'; phase: string; seconds: number; level: number; error: string; alternative: string }>()
const emit = defineEmits<{ start: []; finish: []; cancel: []; useAlternative: []; discardAlternative: []; settings: [] }>()
const active = computed(() => props.phase !== 'idle')
let heldPointer: number | undefined, heldKey = ''
function toggle() { if (props.phase === 'idle') emit('start'); else if (props.phase !== 'transcribing') emit('finish') }
function hold(event: PointerEvent) {
  if (props.mode !== 'hold' || event.button !== 0 || !event.isPrimary || active.value || props.alternative || heldKey || heldPointer !== undefined) return
  heldPointer = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  emit('start')
}
function release(event: PointerEvent) {
  if (heldPointer !== event.pointerId) return
  heldPointer = undefined
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  emit('finish')
}
function cancelHold() {
  if (heldPointer === undefined && !heldKey) return
  heldPointer = undefined; heldKey = ''
  if (props.phase === 'requesting' || props.phase === 'recording') emit('cancel')
}
function keydown(event: KeyboardEvent) {
  if (event.key !== ' ' && event.key !== 'Enter') return
  if (event.repeat) { event.preventDefault(); return }
  // Toggle mode keeps the native button's click from both Enter and Space.
  if (props.mode !== 'hold') return
  event.preventDefault()
  if (active.value || props.alternative || heldKey || heldPointer !== undefined) return
  heldKey = event.key; emit('start')
}
function keyup(event: KeyboardEvent) {
  if (heldKey !== event.key) return
  event.preventDefault(); heldKey = ''; emit('finish')
}
watch(() => [props.enabled, props.mode], cancelHold)
// Automatic duration limits can finish before pointer/key release. Do not
// cancel that transcription when disabling the button drops its focus.
watch(() => props.phase, phase => { if (phase === 'idle' || phase === 'transcribing') cancelHold() })
</script>
<template>
  <div class="microphone-tools" title="本地识别后可编辑，由你确认发送">
    <template v-if="enabled && !alternative">
      <button type="button" :disabled="phase === 'transcribing' || !!alternative" data-testid="pet-microphone" @pointerdown="hold" @pointerup="release" @pointercancel="cancelHold" @lostpointercapture="cancelHold" @blur="cancelHold" @click="mode === 'toggle' && toggle()" @keydown="keydown" @keyup="keyup">
        {{ phase === 'recording' ? `● ${seconds}s / 30s · ${mode === 'hold' ? '松开结束' : '结束录音'}` : phase === 'requesting' ? '正在打开麦克风…' : phase === 'transcribing' ? '本地识别中…' : mode === 'hold' ? '按住说话' : '麦克风输入' }}
      </button><button v-if="active" type="button" @click="emit('cancel')">取消</button>
      <meter v-if="phase === 'recording'" :value="level" min="0" max="1" aria-label="麦克风声音强度" />

    </template>
    <button v-else-if="!alternative" type="button" @click="emit('settings')">启用麦克风 ↗</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="alternative" class="transcript" data-testid="pet-microphone-transcript"><small>原草稿已保留 · 处理后可继续录音</small><p tabindex="0" aria-label="暂存的识别文字">{{ alternative }}</p><div class="transcript-actions"><button type="button" @click="emit('useAlternative')">追加到草稿</button><button type="button" @click="emit('discardAlternative')">放弃这段</button></div></div>
  </div>
</template>
<style scoped>
.microphone-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font:12px/1.65 var(--sans);margin-top:8px;min-width:0}
.microphone-tools button{font:inherit;border:1px solid #d5dfcf;border-radius:8px;padding:5px 9px;min-height:30px;background:#fffefa;color:#3e654e;cursor:pointer;max-width:100%}.microphone-tools button:disabled{opacity:.5;cursor:default}.microphone-tools button:focus-visible,.transcript p:focus-visible{outline:2px solid var(--color-jade);outline-offset:2px}.microphone-tools small{font-size:12px;color:var(--color-muted)}.microphone-tools p{margin:3px 0}.microphone-tools [role=alert]{color:#9b4f45;width:100%;max-height:48px;overflow:auto}.transcript{box-sizing:border-box;background:#edf0e9;border-radius:6px;padding:7px;width:100%}.transcript p{max-height:36px;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap}.transcript-actions{display:flex;gap:6px}.microphone-tools meter{height:6px;width:100%;accent-color:#638861}
</style>
